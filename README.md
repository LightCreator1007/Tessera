# ToD

ToD (Training over Decentralized Networks) lets a group of laptops train one model together. Each laptop trains on its own slice of the data, two verifiers replay that work to check it, and honest work gets paid in a test token onchain.

The trick that makes checking cheap and fair is that training is exactly reproducible. The same weights, data and settings give the same bytes on a Mac or an x86 Linux box, so a verifier doesn't have to judge whether a result looks plausible. It reruns the work and compares hashes.

## How a round works

A job owner funds a job with TOD and picks a dataset and model. The job then runs as a series of rounds.

1. **Open.** The coordinator opens a round on the contract, naming the nodes and which data shard each one trains.
2. **Train.** Every node starts from the same global weights and trains on its shard for a fixed number of steps. The batches come from a seeded shuffle, so nobody chooses their own data.
3. **Commit.** Each node posts a hash of its checkpoints plus a secret salt. Nobody can copy someone else's result after seeing it.
4. **Reveal.** Nodes publish the checkpoint hashes and salt, and upload the weights to the blob store.
5. **Replay.** Both verifiers rerun every node's training from the same start and compare the bytes. A node whose checkpoints don't match is flagged.
6. **Merge.** The accepted updates are combined into new global weights. A validation check accepts the merge, drops the one node that made it worse, or reverts the round.
7. **Settle.** The coordinator posts the settlement and the verifiers co-sign it. Honest nodes get paid, flagged nodes lose stake, and payouts are claimed from the contract.

[docs/how-it-works.md](docs/how-it-works.md) explains the pieces that make this hold together: the exact kernel, the merge and gate, the judge and canonical datasets.

## Run the demo

You need Python 3.12 and [uv](https://docs.astral.sh/uv/).

```sh
git clone https://github.com/LightCreator1007/ToD
cd ToD
uv sync --locked --all-packages
uv run python -m tod_workloads.demo
```

This downloads MNIST once (into `~/.cache/tod/datasets`, checked against a pinned sha256), then runs one round with four nodes. Three train honestly. The fourth skips training and claims slightly nudged weights. You should see nodes 1 to 3 accepted, node 4 marked `ReplayMismatch`, the merge keeping the three honest updates, and validation loss dropping from about 2.55 to 0.51. On a recent laptop it takes under 30 seconds including the download.

Every hash it prints should match [vectors/kernel/demo_round.json](vectors/kernel/demo_round.json). If yours differ, something in your setup isn't reproducing the kernel and we'd like to know.

## Run the onchain rehearsal

This one also needs [Foundry](https://getfoundry.sh/) for `anvil` and `forge`.

```sh
git submodule update --init --recursive
uv run pytest packages/core/tests/ledger_test.py::test_faucet_to_stake_settlement_claim_and_withdrawal -q -s
```

It starts its own local Anvil chain, deploys the real contracts, and walks the money path: faucet, stake, training with two independent replays, slashing a bad node, settlement, claims and converting earned TOD to a local test USDC and back. Without Foundry the test is skipped rather than failing. [docs/token/TEST_EXCHANGE.md](docs/token/TEST_EXCHANGE.md) has the details.

To run every test, use `uv run pytest`. The contract tests are `cd contracts && forge test`.

## Run the whole network

`docker compose -f docker/compose.dev.yml up --build` starts a local chain, the coordinator, two verifiers and four nodes, one of which cheats, and drafts a job. Other PCs on your network can join as nodes, and you can post jobs from the command line. [docs/lan-demo.md](docs/lan-demo.md) walks through it.

## Arkiv and Swarm

Every finished model gets a public `tod.model` entity on Arkiv (Rabdi testnet), and every job's data is cut into shard files listed in a `tod.shards` entity. The bytes live on Swarm, and each entity holds the Swarm reference and the keccak, so anyone can find a model and check it against the contract without trusting the coordinator. The web app's Models page reads its list from Arkiv. Add `-f docker/compose.arkiv.yml` to the compose command to turn publishing on.

- Writer wallet: `0x8Bb9FE30662594A7b7c193100bf92696Abb9c200`
- Every finished model on our JobMarket, newest first:

  ```
  arkiv.schema = str('tod.model') AND $owner = addr(0x8Bb9FE30662594A7b7c193100bf92696Abb9c200) AND jobMarket = addr(0xfdAfECB684069F7dfFDd83997a0cf30B2f06438d) ORDER BY job:u64 DESC
  ```

[arkiv/](arkiv/) has the schema, how and why we use Arkiv, who it's for, what got in the way, and how Swarm fits in.

## World ID

One human, one node: a laptop joins the pool only after its owner proves they're human with World ID, verified on the coordinator's server and bound to the owner's wallet, and the contract refuses a second node for the same person. Small jobs accept Selfie Check, and jobs of 500 TOD or more need Proof of Human. [docs/world-id.md](docs/world-id.md) explains the choice, every path and our integration debrief.

## What's in the repo

| Path | What it is |
|---|---|
| `packages/core` | Hashing and encodings shared with the contracts, weight blobs, merge and gate, the judge, settlement |
| `packages/workloads` | The exact kernel, the exact MLP, the round runner and the demo |
| `packages/datasets` | Making datasets canonical, splits and shards, and the MNIST and CIFAR-10 presets |
| `apps/node` | The `tod-node` CLI a laptop runs to train |
| `apps/verifier` | The `tod-verifier` CLI that replays and attests |
| `services/coordinator` | The REST API, blob store, job drafts and round scheduling |
| `contracts` | The TOD token, node registry, job market, faucet and test exchange ([README](contracts/README.md)) |
| `networks` | Anvil and Base Sepolia settings ([README](networks/README.md)) |
| `vectors` | Shared test vectors and the job spec schema |

## Limitations

These are true today, and we'd rather say so up front.

- Only public datasets. Every node and verifier sees the training data, so don't use ToD for anything private.
- The team runs the coordinator and both verifiers. Replay makes cheating by nodes detectable, but you're still trusting us not to collude with ourselves.
- TOD is a capped test token with no dollar value. The test exchange uses a made-up 1:1 quote against test USDC and is not a way to cash out.
- The chain is Base Sepolia, a testnet. Nothing is deployed to a public network yet. The settings in `networks/` are a template.
- Exact replay only covers the CPU MLP for now. Bigger models and GPUs need a tolerance-based judge that isn't wired up.
- The whole network runs on a local Anvil chain with public dev keys. Joining and posting jobs from the web app still use a simulated wallet, so for now they're done from the command line.

## How we used AI

We built ToD at ETHGlobal Mumbai as five people, each working with a coding agent (Claude Code among them). The agents wrote a large share of the code, tests, docs and PR descriptions, including the `arkiv/` folder and this section. Each of us directed our own agent, reviewed what it wrote and merged through pull requests, and [AGENTS.md](AGENTS.md) is the shared brief the agents worked from. Design decisions, the protocol and what got merged were ours.

## License

MIT, see [LICENSE](LICENSE).
