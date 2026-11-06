# Who this is for

ToD lets people pool their laptops to train a model together, with every node's work replayed by verifiers and paid onchain. Arkiv is where the result of that work becomes public: every finished model, and every job's training data, gets a record anyone can query.

**People who want a model trained.** A requester posts a job and pays in TOD. When it finishes, they don't have to trust our coordinator to hand back the right weights. They query Arkiv for the job, download the bytes from Swarm or any copy, and check the keccak against the aggregate hash the contract recorded.

**People who run a node.** An operator can see on Arkiv which models their laptop helped train, and later find a job's data shards there and fetch only their own shard from Swarm.

**Anyone who wants open models.** The Models page in our web app lists every finished model straight from Arkiv, with its dataset, workload and a checked download. Anyone can build the same list without us, with the query in `schema.md`.

## Can people try it today

Yes, on a local chain. `docker compose -f docker/compose.dev.yml -f docker/compose.arkiv.yml up` runs the whole network (chain, coordinator, verifiers and nodes) and publishes each finished model to the Rabdi testnet. Other PCs join it as nodes with `docs/lan-demo.md`. The records our runs wrote are live on Rabdi now, under the writer in `schema.md`.

## After Mumbai

The five of us are building ToD as a project, not a weekend demo. Next, models and shards move to Base Sepolia jobs, and nodes start reading their shard lists from Arkiv instead of downloading full datasets. Arkiv records for finished models are the piece we keep no matter how the rest changes, because they're what lets someone outside the network find and check our work.
