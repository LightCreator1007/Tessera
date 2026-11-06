# How it works

ToD only works if a verifier can rerun a node's training and get the same bytes. This page covers the four pieces that make that true and decide what happens to the results: the exact kernel, canonical datasets, the judge, and the merge with its gate. The code for each is linked so you can check the details.

## The exact kernel

Floating point addition isn't associative, so the order you add numbers in changes the last bits of the answer. Normal numpy hands matrix multiplies to BLAS, which picks a summation order based on the CPU and thread count, and `exp` and `log` come from the system math library, which differs between macOS and Linux. Two honest laptops can disagree in the last bit, and after a few hundred steps those bits grow into different weights.

[kernel.py](../packages/workloads/tod_workloads/kernel.py) avoids both problems. Matrix multiplies, row and column sums and the row max run as plain loops in one fixed order. `exp` and `log` are computed in float64 from fixed series written in the file, using only adds, multiplies and exponent shifts, then rounded back to float32. Every operation left is a single IEEE add, multiply or divide, which gives the same bits on any CPU.

[mlp_exact.py](../packages/workloads/tod_workloads/mlp_exact.py) builds a one-hidden-layer MLP on top of that, with cross-entropy for classification and MSE for regression. It's slower than a BLAS version, but MNIST with 32 hidden units still trains a round in under a second per node. CI runs the tests on both x86 and arm, and checks the results against hashes made on a Mac.

Weights are stored as a blob: the 32-byte spec hash, a 4-byte dtype tag, then the float32 weights in little endian ([blob.py](../packages/core/tod_core/blob.py)). The weight hash is the keccak of that blob. Negative zero is turned into positive zero first, so equal weights always hash the same.

## Canonical datasets

Everyone has to agree on which row is row 7 and which rows are in shard 2. [canonical.py](../packages/datasets/tod_datasets/canonical.py) turns an uploaded CSV or `.npz` into fixed arrays. It checks the data has no NaNs, renumbers class labels to 0 through C−1, and puts rows in an order set by the keccak of each row's index. The dataset hash covers the arrays and their shapes, not the file, so re-saving the same data gives the same hash.

The canonical rows are split into train, validation and test, and the training part is cut into one contiguous shard per node. Fractions come from the spec as decimal strings, so 0.29 of 100 rows is 29 and not 28.

Inside a shard, batches come from a Fisher-Yates shuffle seeded from the job, the shard and the epoch ([encodings.py](../packages/core/tod_core/encodings.py)). A node can't pick easy rows, and a verifier can work out exactly which rows any step used. Where a shard resumes depends on how many earlier rounds trained it, and that count comes from the chain, so every party agrees on it.

MNIST and CIFAR-10 have presets with a pinned sha256 for the download ([presets.py](../packages/datasets/tod_datasets/presets.py)).

For a job, [shards.py](../packages/datasets/tod_datasets/shards.py) turns each training shard and the validation slice into files: a short header, then the raw rows, with at most 500 MB of rows per file so a big shard spans several. The same dataset and split always give the same bytes, so anyone can rebuild a job's shard files from the public dataset and check their keccaks. The coordinator uploads the files to Swarm and writes one `tod.shards` record per job on Arkiv. The record lists each piece's rows, keccak and Swarm reference, so a node can look up its job by id and download only its own shard from any Bee node or gateway. The download is checked against the keccak before training. This only runs when the coordinator has Arkiv and Swarm configured, and nodes don't use it yet.

## The judge

During a round a node saves K checkpoints and commits their hashes. A verifier replays the whole round from the same start weights and the same batches, then hands the result to [judge.py](../packages/core/tod_core/judge.py).

For an exact workload the rule is simple. If the replayed weight hash equals the committed one, the node is fine. Otherwise it's a `ReplayMismatch`. There's no threshold to tune and no way to be slightly wrong.

The judge also has a tolerance class for future workloads that can't be bit exact, such as GPU training. It compares how far the replay landed from the claimed weights with how far the node moved from the start. A small ratio passes, a medium one is `ReplayDrift` and a large one is `ReplayMismatch`. No workload uses it yet.

## The merge and the gate

Accepted updates are merged by [aggregate.py](../packages/core/tod_core/aggregate.py). Each node's update is its final weights minus the start weights.

1. Updates bigger than the median size are scaled down to the median, so one huge update can't drag the model.
2. For each weight, the largest and smallest values across nodes are dropped and the rest are averaged. With three or more nodes this trims one value from each end, or a fifth of the nodes from each end in bigger groups.
3. The average is applied to the global weights, either directly or with a Nesterov momentum step.

Sizes use a correctly rounded sum, and rows are added in a fixed order sorted by operator address, so both verifiers get the same merged bytes.

An update can replay perfectly and still be bad, say a node trained honestly on poisoned rows. The gate checks the merged model's validation loss against the old one. If it's no worse than 10% plus 0.01, the merge is accepted. If not, the gate tries leaving out each node in turn, and if dropping one node fixes the loss, that node is excluded. If nothing works, the round reverts and the global weights stay as they were. Those limits were the tightest ones that gave no false reverts or exclusions across 120 simulated honest rounds.

## Settlement

Each verifier reports its failures to the contract. A node loses stake only when enough verifiers report the same failure, so one verifier alone can't slash an honest node.

The coordinator then turns the verdicts and the merge into a settlement: the outcome, the new weights hash, which nodes were flagged and who gets paid. The verifiers recompute it with the same code ([finalize.py](../packages/core/tod_core/finalize.py)) and sign it only on an exact match, and the contract won't finalize the round without those signatures. Honest nodes are paid from the job budget, and their owners claim the earnings. The verifier side of co-signing is still being connected, so today the rehearsal test is the place this whole path runs.
