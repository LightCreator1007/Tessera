# Why Arkiv and not Postgres

Our coordinator already has a database. The question is what people lose if the model index lives only there.

**Anyone could be told a different story.** ToD's whole point is that nobody has to trust the coordinator: verifiers replay the work and the contract settles the pay. If the list of finished models lived in our database, we could quietly drop a model, swap its bytes or change which dataset it claims, and a reader couldn't tell. On Arkiv the record is signed by our writer key, timestamped by the chain, and readable through anyone's RPC. Combined with the contract's `aggregateHash`, a reader can check that a model really came from round r of job j without asking us anything.

**The list would die with the coordinator.** Coordinators come and go. Our records are created with permissionless extension, so a requester who still cares about a model can keep its record alive after we stop running, which a Postgres row can't offer.

**Nobody else could build on it.** With Postgres, other apps would need our API, our uptime and our rate limits. On Arkiv, the query in `schema.md` gives anyone the same list our web app shows, filtered by job, dataset or workload, and it's typed and indexed so it doesn't need an indexer of their own.

**Expiry fits the data.** Most trained models are worth keeping for weeks, not forever. Arkiv lets us pick 30 days and let others extend the ones that matter, instead of keeping everything or running our own cleanup.

## What we kept off Arkiv

- **Weights and data bytes.** Arkiv caps a bytes attribute at 128 KiB, and a model or a shard is far bigger. The bytes go to Swarm, and Arkiv holds the reference and the keccak.
- **Live round state.** Commits, reveals, seeds and payouts are on the JobMarket contract, because they move money and need its rules. The coordinator's tables mirror them for fast reads.
- **Identity.** World ID nullifiers are on the NodeRegistry contract, which enforces one human per node. Nothing about people goes to Arkiv.
- **Anything private.** Keys, tokens and private URLs never go into a record. The publisher scrubs the Arkiv access key from every error it logs.
