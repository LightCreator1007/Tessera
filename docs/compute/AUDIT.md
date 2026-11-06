# Where we stand: audit and compatibility check

A snapshot from 6 November 2026 at commit `738aaf9`, written for the [compute proposal](CASE_REPORT.md). This is a team self-review and not an independent audit. Things I didn't check are listed at the end.

## Current state

**Tests.** Python: 377 passed, 1 skipped (`test_cnn_torch`, because torch isn't installed here). Contracts: 92 passed, 1 skipped (the Circle fork test, which needs an RPC). The 92 includes the two new tests in this PR. CI runs the Python suite on x86 and arm. I ran it only on one Apple M5.

**Public chain.** Read from Base Sepolia at block 55211435:

| Item | Value |
|---|---|
| Jobs in the market | 0 |
| TOD supply | 1,100 of a 1,000,000 cap |
| Faucet stock | 900 TOD |
| Desk stock | 100 TOD and 20 test USDC |
| Community pool, probation | 0, 0 |
| Gas price | 0.006 gwei |
| Coordinator ETH | 0.0005, about 98 rounds at this gas price |
| Each verifier's ETH | 0.0005, about 440 rounds |

Role gas is fine for the rehearsal, though a price spike would change that.

**Work in flight.** No open PRs. #59 is still the release gate, and none of its checkboxes are ticked, even for finished items. The compose stack finalizes a round locally (Rounak, #83 and #84). The service path hasn't run on the public chain. `apps/web` isn't on `main`, and I couldn't find a branch or PR for it yet, so the UI part of #59 can't be checked.

## Concerns

Ranked by what could hurt the demo or the design soonest.

| # | Concern | Evidence | Who | Suggested fix |
|---|---|---|---|---|
| 1 | TOD has no link to work, so the USDC quote means nothing | `draft.py:128` only needs one base unit per round. Same work ranges from a few base units to 9.5 TOD per Gop | Arunit | [The proposal](CASE_REPORT.md) |
| 2 | A job can pay out almost its whole budget with nothing replayed | `test_voidedJobPaysLeftoverWithNoReplayedWork`: three seats keep 86% | Arunit, Shantanu | [Phase 4](IMPLEMENTATION_PLAN.md#phase-4-close-the-gaps-in-the-contracts). Needs a design talk |
| 3 | One verifier going down means unverified pay | Threshold is 2 of 2. With one verifier missing, nothing can finalize, and `finalizeFallback` pays every eligible seat after `finalizeBy`. A cheater can't be confirmed either, so they're paid too | Rounak, Arunit | Watch verifier liveness in the rehearsal. Consider 2 of 3 |
| 4 | Voids and reverts change the pay rate | `openRound` spreads returned budget over later rounds. One void: 100 to 150.3 TOD. The last round takes everything left | Arunit | Phase 4 |
| 5 | Nodes can't refuse a bad job | The matcher assigns them, and there's no price floor. `pick` checks stake, selftest and credential only | Shantanu | Phase 2 |
| 6 | Shared SQLite connection with no lock | `api/nodes.py:13` and `identity/router.py:85` use `check_same_thread=False` with no lock, while the driver thread reads and the API threadpool writes. Rounak saw heartbeat 500s. Still on `main` | Shantanu | A `threading.Lock`, as Rounak suggested. Small, and it could bite the rehearsal |
| 7 | Restart safety is unproven end to end | `tables.py` state is in memory. #63 re-posts signatures and #77 keeps the chain and job, but #59's restart check hasn't been done | Rounak, Shantanu | Do it in the rehearsal |
| 8 | Only one workload can settle | `draft.py` returns 501 for anything but `mlp-exact/1`, and `Driver.prepare` builds an MLP directly. `cnn-torch/1` isn't connected | Dhairya, Shantanu | Dhairya's hooks are coming. Outside the #59 gate |
| 9 | Requester overrides can inflate work credit | `refWorkSecondsPerRound` and `windows` are both in `TUNABLE`, so one accepted round can credit a lot. No effect at zero probation, but `networks/base-sepolia.toml` has 300 | Shantanu | Phase 2 removes it |
| 10 | Verifiers do twice the paid work for free | Two full replays per node. The contract has no verifier fee | Team | Decide before verifiers stop being us |
| 11 | Economics don't work on a real network for CPU jobs | Gas is about 300 times the work settled. [Numbers here](CASE_REPORT.md#the-economics-we-should-be-straight-about) | Team | Be honest in the pitch. Look at GPU rounds |
| 12 | Roster reaches the API a tick late | `tick` still runs `publish` before `open_rounds`, so nodes get a brief 403. Nodes retry now (#83) | Shantanu | Call `publish` again after `open_rounds` |
| 13 | Matcher ranks by round size, not rate | `queue` sorts on round budget, so bigger jobs always go first whatever they pay per Gop | Shantanu | Phase 2 makes rates equal, then older goes first |
| 14 | Docs are behind | `README.md:70` says nothing is deployed. `how-it-works.md:49` says co-signing is still being connected. The README doesn't mention the 10 TOD floor. Already raised with Dhairya | Dhairya | Quick edit |
| 15 | Single EOAs hold token admin, minting and deployment | `networks/base-sepolia-demo.toml`. Fine on testnet, and the docs say so | Arunit | Threshold account before any value |

## Technology audit

| Layer | What we use | Finding |
|---|---|---|
| Contracts | Solidity 0.8.38, Cancun, via IR, optimizer 200 | Good and pinned. The compiler warns that `at` (in `INodeRegistry`) and `error` (in OpenZeppelin) become keywords later. Not urgent |
| Contract libraries | OpenZeppelin 5.6.1, forge-std 1.17.0 | 5.7.0 is out. The newest advisory on GitHub was fixed in 5.4.0, so nothing forces a move, and deployed code can't change anyway |
| Contract tooling | Foundry 1.9.0, unit, fuzz, invariant and fork tests, Sourcify | Solid. I didn't rerun Slither. Phase 3 should |
| Python | 3.12, uv with a lockfile, 67 pinned packages | `pip-audit` found no known vulnerabilities. That run excludes the torch extra |
| Numerics | numpy 2.5.4 with our fixed-order kernel | CI compares hashes on x86 and arm, which is the right check. The op count doesn't depend on numpy's version |
| PyTorch | `torch>=2.4` as an optional extra | Not pinned in `pyproject.toml`, not installed or audited here. `use_deterministic_algorithms` runs with `warn_only`, so CPU and GPU can drift. That's why it's tolerance class |
| Chain access | web3 8.0.0, eth-account 0.14.0, our transaction journal | Fine |
| Coordinator | FastAPI 0.162, Starlette 1.10, pydantic 2.14, SQLite | Fine apart from concern 6. One deprecation warning: `TestClient` wants `httpx2` instead of `httpx`, tests only |
| Identity | World ID, Agent Pass | Rounak's live check ran against staging. `agentpass.py` defaults to a sandbox issuer. Confirm what the public stack will use |
| Network | Base Sepolia, Alchemy, Blockscout, Circle test USDC | Working, with receipts recorded. One RPC provider, but it's swappable by config |
| Containers | Foundry image pinned by digest, `python:3.12-slim-bookworm` by tag only | The Python tag can move under us. Pin the digest for a reproducible demo |
| CI | Actions pinned by SHA, size, binary and trailer gates | Good |
| Web | pnpm 10.33.0, generated viem/wagmi ABIs | No app on `main` to audit |

The proposal adds no dependencies. `torch.utils.flop_counter` would only be needed for a later CNN cross-check, and torch is already the extra that workload uses.

## Compatibility check

The first question was whether this breaks anyone's work. Through phase 3 it doesn't touch the money path. Every eligible seat in a job runs the same `H` and `B`, so the equal split is already proportional to compute, and `settle`, `finalize`, `payout.equal` and `cosign` stay exactly as they are.

| Area | Owner | Effect | Needs work? |
|---|---|---|---|
| `ToDToken`, `NodeRegistry`, `JobMarket`, `ToDFaucet` | Arunit | Same bytecode, addresses and ABI through phase 3 | No |
| `JobParams.refWorkSecondsPerRound` | Shantanu | Same field and checks, new value. Only `draft.py` writes it for drafted jobs | Phase 2 |
| `finalize`, `settle`, `payout`, `cosign`, evidence schema, EIP-712 digests | Shantanu, Rounak | Unchanged | No |
| `vectors/spec.schema.json`, `spec.example.*` | Dhairya | No new field, which matters because the schema has `additionalProperties: false`. A drafted spec's hash changes only through the new `refWork` number | No |
| `Workload` protocol, `mlp_exact`, `cnn_torch`, `hardware` | Dhairya | New `compute.py` beside them. `_dry_run` keeps setting windows | Review the maths |
| `api/draft.py`, `api/models.py` | Shantanu | Phase 1 adds response fields. Phase 2 makes `budget` optional and strict | Phases 1, 2 |
| `tests/test_draft.py` | Shantanu | `BODY` budget and bad-budget cases change | Phase 2 |
| `driver.py` | Shantanu | One check in `open_rounds` | Phase 2 |
| `scheduler`, `ORB_MIN_BUDGET`, exclusions | Shantanu, Rounak | No code change. Equal rates mean ties go to the older job | No |
| `tests/test_driver.py` | Shantanu | The fixture's budget has to be the priced amount | Phase 2 |
| `docker/dev/seed.py` | Rounak | Reads `draft["budget"]` in place of `BUDGET` | Phase 2 |
| `devnet.py`, `ledger_test.py`, anvil tests, `tod_workloads.demo` | Rounak, Arunit | Create jobs directly, so they skip the draft and driver | No |
| `tod-node`, verifier, gas top-up, NAT overlay, identity | Rounak | Unchanged | No |
| `ToDTestExchange.sol` and its tests | Arunit | Constructor takes the quote. `swap` keeps its signature. Passing `1e6` gives today's behaviour | Phase 3 |
| `scripts/exchange.py`, `ledger_test.py` rehearsal | Arunit | `--quote`, and `--min-out` from the desk. The rehearsal passes a quote | Phase 3 |
| `packages/abi` | Arunit | Regenerate. New `usdcPerTod` view, same `swap` | Phase 3 |
| `networks/base-sepolia-demo.toml`, deployment docs | Arunit | New `contracts.exchange` address and receipts. The other four stay | Phase 3, with go-ahead |
| `apps/web` (not on `main`) | Ashutosh | Take the budget from the draft instead of an input. Read `usdcPerTod` and don't hard-code 1:1. `MIN_REDEEM` doesn't change | Worth knowing now, before it's built |
| `README`, `how-it-works`, `TEST_EXCHANGE`, `FAUCET` | Dhairya, Arunit | Update wording once decided | After phase 3 |
| Change gates | Everyone | Every phase fits under 2,000 lines. No binaries or trailers | No |

Phase 4 is different. It replaces the registry and market, so owners re-stake and every client gets new addresses, though the ABI barely moves. That's why it's kept apart and left for a separate decision.

## What I didn't check

- x86 throughput. Every timing here is from one Apple M5, and the cloud figure of 2 Gops/s is a placeholder.
- Energy. The 20 W and $0.15/kWh are assumptions.
- `cnn-torch/1`. Torch isn't installed here.
- The compose stack and any service on the public chain. I relied on Rounak's reports for those.
- Slither, and JS dependencies (there's no web app on `main` yet).
- Whether World ID on the public stack will be production or staging.
- The `verifier` replay and `identity` code in any depth. This audit followed the money path.
