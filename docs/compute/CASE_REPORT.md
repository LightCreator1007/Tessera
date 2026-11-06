# Tying TOD to compute: case report

Status: proposal for team review. Nothing is built or deployed. This PR only adds a benchmark script and one contract test. TOD and test USDC have no financial value, and nothing here changes that.

Companion docs: [implementation plan](IMPLEMENTATION_PLAN.md), and [audit and compatibility check](AUDIT.md).

## The proposal

1. **1 TOD pays for at least 1 Gop of replay-verified training.** A Gop is one billion exact-kernel float operations. One TOD base unit is 1,000 ops.
2. **A job's budget comes from its spec.** `budget = rounds × minQuorum × H × step_ops / 1000`. Nobody types it in.
3. **The test desk quotes TOD from what that work costs on a public cloud CPU.** The placeholder is 5 test-USDC base units per TOD, replacing today's 1:1.

This needs no new token, registry or market. Job budgets, stake, the faucet and the 10 TOD redemption floor all stay about the size they are now. The deployed market has zero jobs, so there is nothing to migrate.

## Why we need it

Today nothing connects TOD to work, so converting it to USDC can't mean anything.

- `draft.py` accepts any budget of at least one base unit per round. The seed job pays 30 TOD for one MNIST epoch, about 0.95 TOD per Gop. `test_draft` pays 600 TOD for two epochs, about 9.5 TOD per Gop. Both are valid, and so is a budget of a few base units.
- Nodes can't turn down a cheap job. The matcher assigns them, and they stake 15 TOD either way.
- `refWorkSecondsPerRound` is the coordinator timing its own CPU, or whatever the requester passes as an override.
- The desk's 1:1 quote is "a demo parameter" by its own docs. At that quote, the work in a TOD costs about 200,000 times what it costs on AWS.

## Why count operations

| Unit | Can we verify it? | Problem |
|---|---|---|
| **Ops counted from the spec** (proposed) | Yes. It's a pure function of the spec, and replay proves every step ran | The cost of an op differs between workloads |
| Seconds on the coordinator (today) | No | Changes with the machine, and a requester can override it |
| Time or benchmarks reported by nodes | No | BOINC's write-up says it plainly: "cheaters can falsify elapsed time or device attributes" |
| Joules | No | Nobody can measure a stranger's power draw remotely |
| Dollars, like Akash's ACT | Yes, with an oracle | "1 ACT ≈ $1 of compute credit" pegs to USD, not to any amount of compute |

Ops work here because of what we already built. The exact kernel runs every operation as a single IEEE add, multiply or divide in a fixed order, and verifiers replay it to the byte. So the count isn't an estimate of the work. It's the work the spec defines, the same way gas counts EVM steps however fast the client is. A node with a faster CPU does the same ops in less time and keeps the difference. That's a fair edge, not a cheat.

For `mlp-exact/1` the count is a closed form:

```
step_ops = 4·B·d·h + 6·B·h·o + 2·B·h + 37·B·o + 2·params    (cross-entropy; 4·B·o instead of 37·B·o for MSE)
```

`scripts/compute_bench.py` checks this against what numpy really executes, on six shapes, and the match is exact. The count doesn't depend on the data. It leaves out dividing `uint8` inputs by 255 (about 0.2%), so it never overstates the work.

The chain from token to something physical, with what's measured and what isn't:

| Link | Value | Basis |
|---|---|---|
| 1 TOD | 1,000,000,000 float ops | Definition, proven by replay |
| Time | about 0.17 s on one Apple M5 core | Measured, 5.8 Gops/s. **Only one machine so far** |
| Energy | about 3.4 J | Assumes 20 W per core. Not measured |
| Electricity | about 0.14 µUSD | Assumes $0.15/kWh |
| Cloud price | about 5 µUSD (range 1.7 to 7.1) | Published vCPU prices. **Cloud throughput is a placeholder**, see below |

## It already fits the numbers we have

The seed job works out to 31.7 Gops and pays 30 TOD. We landed on this scale by accident, which is why so little has to move.

| Constant | Today | At 1 TOD = 1 Gop |
|---|---|---|
| One-epoch MNIST job, 3 nodes | 30 TOD (seed) | 31.71 TOD (2 rounds × 3 nodes × 5.285 Gops) |
| One node's pay per round | 5 TOD | 5.285 TOD |
| `MIN_REDEEM` | 10 TOD | Unchanged. An honest node clears it with one job (10.57 TOD) |
| `MIN_STAKE` | 15 TOD | Unchanged. About 2.8 rounds of a node's pay |
| Faucet | 100 TOD a day | Unchanged. About three MNIST jobs |
| `ORB_MIN_BUDGET` | 500 TOD | Unchanged. About 16 MNIST jobs |
| Supply cap | 1,000,000 TOD | Unchanged. 10^15 ops |

The obvious alternative is to keep the 1:1 desk and make 1 TOD worth a dollar of compute. Then a MNIST job costs 0.00016 TOD, the stake is worth about 95,000 jobs, and no node ever reaches the redemption floor. Everything would have to change to protect the one number the docs already call made up.

## Exchanging with USDC

```
usdc_per_tod = (USD per vCPU-hour / 3600) / (Gops per second on that vCPU)
```

| Reference, 6 Nov 2026 | Price | At 2 Gops/s (placeholder) | At 5.8 Gops/s (our M5) |
|---|---|---|---|
| AWS `c7g.medium`, 1 vCPU, Graviton3 | $0.0363/h | 5.0 µUSDC per TOD | 1.7 µUSDC per TOD |
| AWS `c7a.medium`, 1 vCPU, EPYC | $0.0513/h | 7.1 µUSDC per TOD | 2.5 µUSDC per TOD |

We propose **5 base units of test USDC per TOD** until teammates post benchmarks from x86 machines. What that gives us:

- A MNIST job costs about $0.00016. A node's 10.57 TOD redeems for 52 base units.
- The 20 test USDC reserve covers 4,000,000 TOD, four times the whole supply cap. Today two 10 TOD redemptions empty it.
- Farming the faucet stops being worth anything. 100 TOD a day is 500 base units.
- The reverse direction needs TOD stock. 1 test USDC would buy 200,000 TOD, and the desk holds 100, so we'd seed it with more.

Keep the quote immutable, as it is now. The current desk's safety story is that it has no mutable price and no admin, and we want to keep that. A new price means a new desk. No oracle: nobody publishes a vCPU price onchain, and my search found no Chainlink feed for compute. GPU rental indexes do exist (Silicon Data, and an H100 feed on Injective), so that's worth another look if GPU jobs become the main product.

## Where the floor holds, and where it doesn't

The floor is a pricing rule. The deployed contracts can't enforce it on every path, and this table is the honest version. `contracts/test/ComputeFloorGaps.t.sol` pins the two void rows against today's code.

| Path | TOD per replayed Gop | Holds? |
|---|---|---|
| Accepted round, `minQuorum` seats | 1 | Yes |
| Accepted round, more seats than `minQuorum` | `minQuorum / n` | Yes for the requester, but a node gets less than the rate. At 6 seats on a quorum of 3, half |
| Slash top-up or community drip | Above 1, paid from slashed stake or the pool | Yes for the requester, whose money isn't involved |
| Accepted round after a void | Up to all remaining budget | **No.** One void raised the next round from 100 to 150.3 TOD for the same work |
| Reverted round | 0 now, more later | **No.** Replayed work goes unpaid, and its budget raises later rounds |
| `finalizeFallback` | Pays with nothing verified | **No.** Needs a silent coordinator or a verifier down |
| `claimLeftover` after voids | Pays with nothing replayed | **No.** See below |

The last row is the serious one. In the test, three seats of a 300 TOD job void all three rounds. One reveals made-up hashes, and the other two stay silent. Sub-quorum rounds can't be attested, so nothing is ever replayed. The fake seat is paid 340.67 TOD, the silent seats lose 81.33 TOD in penalties, and together they keep 259.33 TOD, or 86% of the budget. The requester gets nothing back. It takes three owners, so World ID doesn't stop it. This is testnet money and the code does what it was written to do: leftovers go to clean seats so a requester can't void on purpose and keep the work. But it means "paid" doesn't imply "verified", and we should fix that before TOD could ever be worth anything.

## What this doesn't do

- **A protocol can't set a market price.** The floor says what a priced job buys. Nodes still only show up if a TOD is worth more than their costs. On testnet the desk's quote is a number we picked with a stated method, and a finite reserve stands behind it.
- **TOD loses dollar value as compute gets cheaper.** The unit is fixed, so the desk needs recalibrating. That's the opposite trade to Akash, which keeps prices stable in USD and leaves the token floating.
- **It doesn't price CNNs or GPUs yet.** A BLAS or GPU op costs far less than an exact-kernel op, so `cnn-torch/1` will need its own count and a weight. Only `mlp-exact/1` can be drafted today, so one row is live. We haven't measured the CNN.
- **Verifiers aren't paid.** Two full replays mean three ops burned for every op paid for. The team absorbs that today.

## The economics we should be straight about

These apply if anyone asks how this works on a real network, and the anchor is what makes them visible.

- **Gas costs more than the work.** A 3-node round is about 1.76M gas. At the 0.006 gwei Base mainnet showed on 6 Nov 2026 and ETH at $2,235, that's about 2.4 cents, and data fees add about 0.2%. The work in a MNIST round is worth about $0.00008, so gas is about 300 times the work it settles. Breaking even takes about 4,700 Gops per round, roughly 13 minutes per node at 2 Gops/s. By default `H_MAX = 500` holds our biggest preset at 51 Gops per node.
- **Redeeming costs more than it pays.** A swap is about 100k gas, or $0.0013, against $0.00005 for 10 TOD.
- **The exact kernel is slow on purpose.** On the M5 it runs 67 to 97 times slower than BLAS on the same maths. That's the price of bit-exact replay, though Apple's matrix hardware flatters BLAS here and x86 may differ. Someone buying MLP training from us pays for proof, not for cheap compute.
- **GPUs are where this could add up.** H100 listings run from about $1.49 to $6.98 an hour, so at $3 a round's gas is about 28 seconds of one GPU. That needs tolerance replay, which isn't wired up yet.

Our pitch should be "verifiable training with a real unit of account", not "cheaper than the cloud".

## CROPS review

Chosen default: an op count from the public spec, a price rule in public code, and an immutable desk quote. No oracle, no new admin power. It is the most open option because anyone can recompute every number from the spec and chain data.

- **Censorship resistance.** Risk: the coordinator gets one more reason to refuse a job, on top of already deciding who is matched. Mitigation: the rule is a public function, and `budget`, `rounds`, `minQuorum` and `refWorkSecondsPerRound` are all onchain, so anyone can check it. User escape: `abandonJob` is permissionless after the stall window, and never-opened rounds are refunded.
- **Open source.** Risk: the quote leans on prices from a third-party page. Mitigation: the method, inputs and benchmark are in the repo. User escape: rerun the bench and deploy your own desk.
- **Free, as in freedom.** Everything stays MIT. There are no new dependencies.
- **Privacy.** No new data is collected. Bench results are posted only if someone chooses to, and they show a CPU model.
- **Security.** Risk: a wrong quote is permanent for that desk. Mitigation: it's fixed at deployment and bounded by what we seed, on testnet only. User escape: swaps still need the user's own exact approval, and a new desk replaces a bad one. Walkaway: the desk and all contract exits keep working with nobody operating them.

Accepted compromises: the floor is enforced by the team-run coordinator until the contracts change, and the void, leftover and fallback paths stay open until then. Both are fine on a testnet and neither would be fine with real money. A real-money version also needs its own decisions on reserves, an oracle, custody and legal review. This report doesn't make them.

## Decisions we need

1. Is 1 TOD = 1 Gop the right anchor?
2. Exact posted price, or a floor with room to pay more? We lean towards exact, because nodes can't refuse a job and any premium breaks "at least 1 Gop per TOD".
3. Replace the 1:1 desk before the #59 rehearsal, or keep it for the demo and just show the compute value next to it?
4. Should nodes get the full rate when `maxPerRound > minQuorum`? The simple answer is to draft with them equal.
5. When do we fix the void, leftover and fallback paths? They need a new registry and market, though not a new token.
6. Who pays verifiers once they aren't us?

## Sources

- AWS prices via Vantage, read 6 Nov 2026: [c7g.medium](https://instances.vantage.sh/aws/ec2/c7g.medium), [c7a.medium](https://instances.vantage.sh/aws/ec2/c7a.medium). The pages don't state the region or OS behind the figure.
- [BOINC CreditNew](https://github.com/BOINC/boinc/wiki/CreditNew), on credit as a FLOP count (`cobblestone_scale` is 200/86400e9) and why reported benchmarks failed.
- [Akash AEP-76](https://akash.network/roadmap/aep-76/), on ACT's USD peg and paying providers at a TWAP.
- [Silicon Data H100 index](https://www.silicondata.com/products/silicon-index/h100) and [Injective's onchain H100 market](https://injective.com/blog/injective-releases-the-first-ever-onchain-nvidia-gpu-market). I found no Chainlink feed, but that was one search and not a check of their catalog.
- [H100 rental comparison](https://intuitionlabs.ai/pdfs/h100-rental-prices-compared-1-49-6-98-hr-across-15-cloud-providers-2026.pdf). Most public sources here are vendor blogs and they disagree, so treat the range as rough.
- Gas: `forge test --gas-report` medians. Fees: `cast gas-price` and `GasPriceOracle.getL1Fee` on Base mainnet, and the Coinbase ETH spot price, all read 6 Nov 2026.
