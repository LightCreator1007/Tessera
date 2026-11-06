# What ToD writes to Arkiv

ToD writes two kinds of entity, both from the coordinator's own Arkiv key and never from the role keys that move money. All of them are public. Every field is a hash, a size, an id or a label, never a key, a token or a private URL.

Writer wallet: `0x8Bb9FE30662594A7b7c193100bf92696Abb9c200` (holds test tGLM only). Network: Rabdi testnet, `https://rpc.rabdi.db-chain.testnet.arkiv.network`.

Readers must always filter on `$owner`, since anyone can write any tag.

## `tod.model`: a finished job's final model

Written by `services/coordinator/publish/__init__.py` once JobMarket says a job completed (`publish/chain.py` watches for `JobClosed`). One entity per job, created once and never edited.

| Attribute | Type | Indexed | Meaning |
|---|---|---|---|
| `arkiv.schema` | str | yes | Always `tod.model` |
| `chainId` | u64 | yes | Chain the job ran on (31337 local, 84532 Base Sepolia) |
| `jobMarket` | address | yes | The JobMarket contract, so two deployments never mix |
| `job` | u64 | yes | Job id on that contract |
| `round` | u64 | yes | The last finalized round, whose aggregate is this model |
| `keccak` | str | yes | keccak256 of the weights blob, equal to that round's `aggregateHash` onchain |
| `datasetHash` | str | yes | Card hash of the dataset it was trained on |
| `workload` | str | yes | Model family, e.g. `mlp-exact/1` |
| `visibility` | str | yes | `public` |
| `swarmRef` | str | yes | Swarm reference holding the bytes, when Swarm took the upload |
| `size` | u64 | no | Bytes |
| `contentType` | str | no | `application/x-tod-weights` |
| `url` | str | no | The coordinator's public download, when it has a public URL |
| `payload` | bytes | no | The whole record as canonical JSON, with `version: 1` |

Expiry: `ARKIV_LIFETIME_DAYS`, 30 days by default, capped at Arkiv's 182 days. Entities are created with permissionless extension, so anyone who still wants a model can keep its record alive after the coordinator is gone.

## `tod.shards`: a job's data, cut into shard files

Written by `services/coordinator/publish/shards.py` for every job the coordinator drafts, when Swarm is configured. One entity per job.

| Attribute | Type | Indexed | Meaning |
|---|---|---|---|
| `arkiv.schema` | str | yes | Always `tod.shards` |
| `chainId`, `jobMarket`, `job` | u64, address, u64 | yes | Same as above |
| `datasetHash` | str | yes | The dataset the shards are cut from |
| `keccak` | str | no | keccak256 of the payload |
| `size` | u64 | no | Payload bytes |
| `payload` | bytes | no | The manifest: one entry per file with `part` (train or val), `shard`, `piece`, `start`, `len`, `keccak`, `size` and `swarmRef` |

The files are deterministic (`packages/datasets/tod_datasets/shards.py`), so anyone can rebuild them from the public dataset and check every keccak.

## Queries

Every finished model on a JobMarket, newest first. This is what the web app's Models page shows, through `GET /v1/models`:

```
arkiv.schema = str('tod.model') AND $owner = addr(0x8Bb9FE30662594A7b7c193100bf92696Abb9c200) AND jobMarket = addr(0xfdAfECB684069F7dfFDd83997a0cf30B2f06438d) ORDER BY job:u64 DESC
```

One job's shard list, as `tod_datasets.shards.lookup` reads it:

```
arkiv.schema = str('tod.shards') AND $owner = addr(0x8Bb9FE30662594A7b7c193100bf92696Abb9c200) AND chainId = u64(31337) AND jobMarket = addr(0xfdAfECB684069F7dfFDd83997a0cf30B2f06438d) AND job = u64(1)
```

Run either with `arkiv_query`, for example:

```sh
curl -s https://rpc.rabdi.db-chain.testnet.arkiv.network -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"arkiv_query","params":["<query>",{"select":{"key":true,"attributes":true},"limit":"0x10"}]}'
```
