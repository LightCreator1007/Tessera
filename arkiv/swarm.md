# Swarm alongside Arkiv

## What lives where

| | Swarm | Arkiv |
|---|---|---|
| Final models | The weights bytes (about 400 KB for the MNIST MLP) | A `tod.model` entity: job, round, keccak, dataset, workload, and the Swarm reference in **`swarmRef`** |
| Job data | Deterministic shard files, one or more per train shard plus the validation slice (MNIST: about 11.5 MB per train shard) | One `tod.shards` entity per job whose payload lists each file's rows, keccak and **`swarmRef`** |

Arkiv caps a bytes attribute at 128 KiB, so bytes go to Swarm and Arkiv holds what a reader needs to find and check them. Every reference is unencrypted on purpose: these are public models and public data, and an encrypted reference would carry its key into a public entity.

## One entity and its Swarm copy

- Arkiv entity: `0xabfe22c89b506ce08afbcc3197fd2e649caf717350fda748ea0a70834cd465bc` (job 1's final model, round 2; writer `0x8Bb9FE30662594A7b7c193100bf92696Abb9c200`; expires at Rabdi block 1,593,023, about 30 days after it was written on 6 November)
- Swarm reference: `bfce0d94c0010fee6c1149ad78126f66ed2d299972a669acbe6f28444209d1da`, open it at https://api.gateway.ethswarm.org/bytes/bfce0d94c0010fee6c1149ad78126f66ed2d299972a669acbe6f28444209d1da
- Check: the download is 407,116 bytes with keccak `0xfc51bceb6e53a931e39f13e73c350f769119da881512656873ae408bc735db2c`. That equals the entity's `keccak` and the round's `aggregateHash` on the chain, which we compared when this was written.

## Postage batch and Bee node

Uploads go through Swarm's public gateway, `https://api.gateway.ethswarm.org`, which stamps them with its own postage batch. We didn't buy a batch, and the gateway doesn't tell us which one it used.

**Open:** the batch ID the bonus asks for. Either get it from the Swarm team for the gateway, or run our own Bee node with a batch we buy and set `SWARM_BATCH_ID`, which `publish/swarm.py` already supports.

## Code

- Upload and read-back check: `services/coordinator/publish/swarm.py` (`Swarm.put` uploads to `/bytes`, then downloads and checks the keccak before trusting the reference)
- Model upload, then the Arkiv record with `swarmRef`: `services/coordinator/publish/__init__.py`
- Shard files, upload and listing: `packages/datasets/tod_datasets/shards.py` and `services/coordinator/publish/shards.py`
- Reading: `GET /v1/models/{keccak}` falls back to the Swarm copy and serves it only if it still hashes right. `tod_datasets.shards.fetch` downloads a shard's files from any Bee node and checks each one. The web app's Models page links each model's Swarm copy.

## Run one upload and one read

With the stack and the Arkiv override up (see `docker/compose.arkiv.yml`), post a job and let it finish:

```sh
docker compose -f docker/compose.dev.yml exec coordinator python docker/dev/post_job.py --quorum 2
```

About three minutes later `GET /v1/jobs/<id>` shows `published.state: "indexed"` with an `arkivKey` and a `swarmRef`. Read it back:

```sh
curl -s https://api.gateway.ethswarm.org/bytes/<swarmRef> -o model.bin
python -c "import sys; from eth_utils import keccak; print('0x' + keccak(open('model.bin','rb').read()).hex())"
```

The printed hash equals the entity's `keccak`.

## In the demo video

**Open:** the timestamp, once the video is cut.

## What got in the way

- The public gateway answered `/health` with 200 while every upload got a 500, for about an hour. Our publisher used to wait for Swarm before writing to Arkiv, so nothing got indexed. Now it gives Swarm three tries and then indexes without the reference.
- A 11.5 MB shard upload hit a write timeout on the gateway, and our retry count ran out across a five-file set even though files were landing. Each successful upload now resets the count.
- Without our own Bee node there's no way to see or choose the postage batch, which is exactly what this bonus asks for.
