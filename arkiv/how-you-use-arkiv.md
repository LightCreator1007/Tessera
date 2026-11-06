# How ToD uses Arkiv

## Writing

The coordinator writes over plain JSON-RPC from Python, with no SDK: `services/coordinator/publish/arkiv.py` encodes `execute((uint8,bytes)[])` with one create op, estimates gas, signs and sends. Two publishers use it:

- **Models** (`publish/__init__.py`): once JobMarket says a job completed, its final model is uploaded to Swarm and indexed as a `tod.model` entity. If Swarm is down, the record still goes out without `swarmRef` after three tries, so an outage there never hides a model.
- **Shards** (`publish/shards.py`): each job's data is cut into deterministic shard files, uploaded to Swarm, and listed in one `tod.shards` entity.

Both follow the same safety rules. The signed transaction's hash is saved before anything is sent, so a crash is settled from its receipt and never re-signed. A record from an earlier run is found by query before creating a new one. A 429 waits without counting as a failure.

## Reading

- **The web app's Models page** (`apps/web/features/models/ModelsPage.tsx`) reads `GET /v1/models`, which queries Arkiv for every `tod.model` entity on this JobMarket, newest first, and does not read the coordinator's own tables. Each row shows the dataset, workload, keccak, size, the Swarm link and how long the record has left.
- **Public model downloads** (`GET /v1/models/{keccak}`) serve only models that were published. When the coordinator has lost its copy, it fetches the Swarm copy and serves it only if the bytes still hash to the published keccak.
- **Shard lookup** (`tod_datasets.shards.lookup` and `fetch`) reads a job's `tod.shards` entity and downloads one shard from any Bee node, checking each file's keccak. The node's trainer doesn't call it yet. Nodes still download the full public dataset, so today this read path is a library, not something a user sees.

## Arkiv features and what each one changes

| Feature | How we use it | What a user sees |
|---|---|---|
| Typed, indexed attributes | `job`, `chainId` and `round` are u64; `jobMarket` is an address; tags are strings | The Models page lists models newest first with `ORDER BY job:u64 DESC`, and anyone can filter by dataset or workload |
| `$owner` | Every query filters on our writer | Records someone else writes with our tags never show up, so the list can't be spoofed |
| Expiry | 30 days by default, with the time left shown per row | A model's record visibly ages, and the page says when it goes |
| Permissionless extension | Set on every create | Someone who still needs a model can keep its record alive after we're gone |
| Payload attribute | The whole record as canonical JSON | One read gives a client everything it needs, and the shard manifest's per-file keccaks |

Edit permissions are the one feature we don't use: records are never changed after the create, which is what lets a reader trust they describe what the contract settled.
