# Running the demo across PCs on one network

One PC hosts the chain, the coordinator and the two verifiers with `docker/compose.dev.yml`, which also starts three nodes of its own (node-0 cheats). Every other PC runs one node and the web app. Everything is on a local Anvil chain with public dev keys, so only do this on a network you trust.

You need Docker on every PC, and Node.js 22+ with pnpm on any PC that shows the web app.

## On the host PC

```sh
git clone https://github.com/LightCreator1007/ToD && cd ToD && git submodule update --init
TOD_BIND=0.0.0.0 docker compose -f docker/compose.dev.yml up --build -d
```

`TOD_BIND=0.0.0.0` publishes the chain (8545) and the coordinator (8000) on the LAN. Find the host's LAN address (`ip -4 addr` or `ipconfig`) and check it from another PC with `curl http://<host>:8000/v1/health`. If that hangs, open ports 8000 and 8545 in the host's firewall.

## On each other PC

Use the `docker/tod-node` wrapper from the repo, or `docker/tod-node.ps1` on Windows. It pulls the node image built from `main`.

```sh
export TOD_NETWORK=anvil ANVIL_RPC_URL=http://<host>:8545 TOD_COORDINATOR=http://<host>:8000
docker/tod-node init --network anvil --coordinator http://<host>:8000
```

The web join flow's wallet is still simulated, so the host admits each PC from the command line. Pick a name for this PC, then on the host:

```sh
docker compose -f docker/compose.dev.yml exec coordinator python docker/dev/admit.py owner <name>
```

That prints a dev owner address. On the PC, pair with it, using the registry address from `curl http://<host>:8000/v1/config`:

```sh
docker/tod-node pair --owner <owner> --chain-id 31337 --registry <nodeRegistry>
```

Copy the whole `tod-pair:...` line back to the host. It expires in 30 minutes.

```sh
docker compose -f docker/compose.dev.yml exec coordinator python docker/dev/admit.py join <name> <tod-pair:...>
```

That funds the owner, gets an invite through the dev identity route, joins the node and stakes enough for every open job. Then start the node on the PC:

```sh
docker/tod-node run
```

It downloads the job's dataset in the background (`dataset.fetching`, then `dataset.ready` in `docker/tod-node logs`) and reports busy until it has it, so it isn't seated in a round it would miss.

### With a real World ID check

`docker/compose.worldid.yml` switches the coordinator to World ID staging, with the app settings from your `.env`:

```sh
docker compose --env-file .env -f docker/compose.dev.yml -f docker/compose.worldid.yml up -d --no-deps --force-recreate coordinator
```

Then, instead of the `join` step, the PC's owner opens `http://<host>:8000/v1/identity/test`, enters the owner address and the pairing code, picks Proof of Human (Orb) and verifies in the World ID simulator, one simulator identity per PC. The page prints an invite as JSON. On the host:

```sh
docker compose -f docker/compose.dev.yml exec coordinator python docker/dev/admit.py invite <name> '<invite json>'
```

Browsers may block World ID's crypto on a plain-http page that isn't localhost. If the page errors on a PC, do that verification on the host at `http://localhost:8000/v1/identity/test`.

## Posting a job

The web app's "Post a job" uses the simulated wallet, so post from the host for now. This drafts through the coordinator, which prices the job from its spec, then funds a dev requester with that price and creates the job onchain:

```sh
docker compose -f docker/compose.dev.yml exec coordinator python docker/dev/post_job.py --quorum 2
```

`--quorum` is how many nodes a round needs. Keep it below the number of nodes you have, since a slashed cheater can't be seated again.

## The web app

On any PC, from `apps/web`:

```sh
pnpm install
NEXT_PUBLIC_COORDINATOR_URL=http://<host>:8000 pnpm dev
```

Open http://localhost:3100. Job, round and node pages read the coordinator. The node page reads the node on the same PC through its local API on 127.0.0.1:7777, so open the web app on the PC whose node you want to show.

## When something looks wrong

- A node sits at `round.waiting` with a 403: the coordinator lists a round's roster a few seconds after opening it. It retries on its own.
- Pairing fails with an expired consent: the PC's clock is off. The code's deadline comes from the PC, and the chain checks it against its own time.
- Two missed rounds bench a node. Re-arm it with the admin token in `docker/compose.dev.yml`.
- Publishing to Arkiv and Swarm is off unless you add `-f docker/compose.arkiv.yml` with a funded Arkiv writer key (see that file). The public Swarm gateway sometimes refuses uploads; the model still gets indexed on Arkiv without its Swarm copy.
