# Tying TOD to compute: implementation plan

This is the plan if the team agrees with the [case report](CASE_REPORT.md). No phase starts until its owner is on board, and any objection reopens that decision. Line counts are rough guesses, not commitments.

The order is 1, 2, 3, then the #59 rehearsal, so the rehearsal records the amounts we mean to keep. If time runs short, phase 1 alone is still useful. See "Scope cuts" below.

## Phase 0: this PR

The docs, `scripts/compute_bench.py` and `contracts/test/ComputeFloorGaps.t.sol`. No behaviour changes.

Done when everyone has run the bench and posted their number in #1, and the [decisions](CASE_REPORT.md#decisions-we-need) have answers.

## Phase 1: count and show

Owner: Arunit. Review: Dhairya on the maths, Shantanu on the API. About 80 lines plus tests.

Add `packages/workloads/tod_workloads/compute.py`. It's a new file, so the `Workload` protocol doesn't change.

```python
OPS_PER_TOD = 10**9
OPS_PER_UNIT = 10**3

def round_ops(spec) -> int: ...                        # H × step_ops for one node, from the spec alone
def job_budget(spec, rounds, quorum) -> int:           # floor division, so a TOD is never below 1 Gop
    return rounds * quorum * round_ops(spec) // OPS_PER_UNIT
def ref_work(spec) -> int:                             # whole Gops, rounded up, for refWorkSecondsPerRound
    return -(-round_ops(spec) // OPS_PER_TOD)
```

`Draft` gains `budget` and `computeOps`. Adding fields doesn't break anyone. Add a small `vectors/compute.json` so the web app can check its own display against ours. Nothing is refused yet.

Done when the counts match the vector in Python, the bench uses this module, and the draft response shows the numbers. Today's tests should pass untouched.

## Phase 2: price jobs from the spec

Owner: Shantanu for the coordinator, Rounak for the seed. About 60 lines plus test updates.

- **`draft.py`**: `budget` becomes optional. Leave it out and you get the priced amount. Send a different number and you get a 422 that says the right one.
- **`refWorkSecondsPerRound`**: now `ref_work(spec)`, and it comes out of `TUNABLE`. It keeps its field and its contract checks, and it now means something exact: one reference second is one Gop, one second on a 1 GFLOPS reference machine. `verifiedWorkSeconds` in the registry then becomes an onchain total of each owner's verified Gops, with no contract change. Fallback, reverted and voided rounds already earn no credit.
- **Windows**: `_dry_run` stays, because deadlines depend on real time. Commit becomes `max(45, 3 × measured, ref_work)` so the contract's `refWork <= commit` check still passes on big jobs.
- **`driver.py`**: `open_rounds` skips and logs a job whose `p.budget != job_budget(spec, p.rounds, p.minQuorum)`. `createJob` calldata is just bytes, so a requester could otherwise draft one budget and send another. Only the coordinator can open rounds, so this one check is enough for now.
- **`docker/dev/seed.py`**: read `draft["budget"]` in place of `BUDGET`.

Update `test_draft.py`, which has `BODY` at 600 TOD and bad-budget cases, and the budget in `test_driver.py`'s fixture. Direct `createJob` callers (`devnet.py`, `ledger_test.py`, the anvil tests) skip the draft and the driver, so they don't change.

Done when the compose stack finalizes a round at the priced budget, a job with a hand-edited budget never opens, and its requester can still leave through `abandonJob` and `withdrawRefund`.

## Phase 3: the cost-based desk

Owner: Arunit. Review: Shantanu and Ashutosh. About 15 lines of Solidity, plus tests and scripts.

Change `ToDTestExchange` in place, because that's the smaller diff. The old desk stays verified at its recorded revision, `39026c2`.

```solidity
uint256 public immutable usdcPerTod; // test-USDC base units per whole TOD, fixed at deployment

uint256 out = todToUsdc ? Math.mulDiv(amount, usdcPerTod, 1e6) : Math.mulDiv(amount, 1e6, usdcPerTod);
if (amount == 0 || minOut == 0 || minOut > out) revert InvalidQuote();
// inventory and received-balance checks stay, and now compare against out
```

`mulDiv` rounds down, so rounding always favours the desk, and it can't overflow on the full range the fuzz tests already cover. The constructor rejects a zero quote. Passing `1e6` reproduces today's behaviour, so existing tests keep working by passing that.

Tests, per `.claude/skills/testing`, because this is a fixed exchange rate feeding value math:

- Fuzz the quote across its whole accepted range with `bound()`, including 1 and values that make a small `amount` round to zero, which must revert.
- Extend the existing handler invariant so desk inventories still equal cumulative flows at a non-1:1 quote, and read its revert stats.
- Rerun the pinned Circle fork test.
- Run `slither .`.

Also: `scripts/exchange.py` takes `--quote` and defaults `--min-out` from the desk. `status` prints the quote instead of `demoQuote`. Regenerate `packages/abi`. Ashutosh's screens read `usdcPerTod` instead of assuming 1:1.

**Deployment is a separate go-ahead from Arunit.** It spends from funded keys:

1. Deploy the desk.
2. Move the reserve, either by swapping 20 TOD into the old desk to pull out its 20 test USDC, or with fresh Circle test USDC.
3. Mint a bounded amount of TOD to the new desk, within the cap.
4. Update `contracts.exchange` in `networks/base-sepolia-demo.toml` and record the receipts.

The old desk keeps working and is simply no longer the one we point at.

## Then: the #59 rehearsal

Run it as already planned, at the new amounts. An honest node should end a one-epoch MNIST job holding about 10.57 TOD (more if a cheater was slashed), and redeem it at the desk quote. The UI, CLI and chain should all show the same numbers.

## Phase 4: close the gaps in the contracts

Owner: Arunit, with Shantanu on settlement. Not before the demo unless we choose otherwise. It needs a new registry and market. The token, faucet and desk stay, and owners withdraw and re-stake. The ABI stays the same apart from new errors.

| Change | How | Status |
|---|---|---|
| Enforce the price onchain | One line in `_checkParams`: `budget <= rounds × minQuorum × refWork × 1e6` | Ready to write. Can't check `refWork` against the spec, so verifiers should too |
| Stop voids raising the rate | `openRound` caps `r.budget` at `p.budget / p.rounds` | Ready to write |
| Stop leftovers paying for nothing | Open. Refunding everything lets a requester void on purpose and keep the work. Capping a clean seat at the rate for rounds it revealed cuts the 86% loss in the test, but still pays for unchecked reveals | **Needs design** |
| Fallback pays with nothing verified | Open. It exists so a dead coordinator can't trap nodes, so this is liveness against the floor | **Needs design** |

Before that, a driver-only mitigation is possible: stop opening rounds for a job after its first void and let the requester abandon it. It limits the damage and costs nothing onchain.

## Later

- `cnn-torch/1`: Dhairya adds an op count and a measured cost weight when the workload becomes draftable. `torch.utils.flop_counter` could cross-check the formula.
- Verifier pay, once verifiers aren't the team.
- Rounds big enough to pay their gas, or batching settlement, before any real-money network.

## Scope cuts

- **Short on time:** do phase 1 and show the compute value in the UI. Keep the 1:1 desk and label it clearly as a demo quote.
- **Middle ground:** do phases 1 and 2, skip the new desk.
- **If phase 2 breaks the rehearsal:** revert the commit. No deployed contract depends on it.
- **Not doing, whatever happens:** an oracle, a mutable quote, an admin on the desk, a token change, or any real-money route. Those are separate decisions.
