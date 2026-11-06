"""Dev-only seed for docker/compose.dev.yml: draft and create an MNIST job, then pair, join and stake the nodes.

Goes through the real routes (POST /v1/jobs/draft, and POST /v1/identity/join in dev mode) and the real node CLI,
on the local chain only. Safe to rerun: an existing job and nodes that already joined are left as they are.
"""
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

from tod_core.ledger import Ledger, Network, Reverted
from tod_core.txmgr import ANVIL_CHAIN_ID
from tod_datasets import presets
from tod_node.devnet import Actor, script

ROOT = Path(__file__).resolve().parents[2]
DATA = Path(os.environ.get("DEV_DATA", "/dev-data"))
NET_FILE = os.environ["TOD_NETWORK"]
COORD = os.environ.get("TOD_COORDINATOR", "http://127.0.0.1:8000")
NODES = int(os.environ.get("DEV_NODES", "4"))

l = Ledger(Network.load(NET_FILE))
if l.net.chain_id != ANVIL_CHAIN_ID:
    sys.exit("docker/dev/seed.py is for the local chain only")

# Fill the shared cache once, before any node or verifier starts, instead of every one downloading its own copy.
presets.load("mnist", Path(os.environ.get("DATASET_CACHE", DATA / "datasets")))
print("mnist cached", flush=True)


def http(path, body=None):
    req = urllib.request.Request(COORD + path, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"content-type": "application/json"}, method="POST" if body is not None else "GET")
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        sys.exit(f"{path}: HTTP {e.code} {e.read()[:400]!r}")


def node_cli(i, *args):
    env = {**os.environ, "TOD_DATA": str(DATA / f"node{i}")}
    out = subprocess.run(["tod-node", *args, "--json"], env=env, capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


if not any(e.name == "JobCreated" for e in l.events()):
    mnist = json.loads((ROOT / "vectors/kernel/presets.json").read_text())["mnist"]["card"]["hash"]
    # One under the node count: node-0 cheats and loses its stake, and the honest nodes must still fill later rounds.
    draft = http("/v1/jobs/draft", {"workload": "mlp-exact/1", "datasetHash": mnist, "epochs": 1,
                                    "minQuorum": max(1, NODES - 1), "maxPerRound": NODES})
    requester = Actor(l, NET_FILE, DATA, "requester/dev", units=draft["budget"])
    requester.l.token.approve(l.net.market, draft["budget"])
    requester.l.sender.transact(l.net.market, draft["createJobCalldata"])
state = l.rebuild()
job = max(state.jobs)
stake = state.jobs[job]["params"].stakePerNode
print(f"job {job}: stake {stake / 1e6} TOD per node", flush=True)

for i in range(NODES):
    op = node_cli(i, "init")["operator"]
    if l.registry.getNode(op).joined:
        print(f"node{i} {op} already joined", flush=True)
        continue
    script("fund.py", op, "--tokens", "0", "--journal-dir", str(DATA / "faucet"), rpc=l.net.rpc, net=NET_FILE)  # gas
    owner = Actor(l, NET_FILE, DATA, f"owner/dev/{i}", units=stake)
    code = node_cli(i, "pair", "--owner", owner.address, "--chain-id", str(l.net.chain_id),
                    "--registry", l.net.registry)["code"]
    inv = http("/v1/identity/join", {"owner": owner.address, "pairingCode": code})
    try:
        owner.l.registry.join(op, bytes.fromhex(inv["nullifier"][2:]), inv["inviteDeadline"], inv["consentDeadline"],
                              bytes.fromhex(inv["inviteSig"][2:]), bytes.fromhex(inv["consentSig"][2:]))
        owner.l.token.approve(l.net.registry, stake)
        owner.l.registry.depositStake(op, stake)
    except Reverted as e:
        sys.exit(f"node{i} join failed: {e}")
    print(f"node{i} {op} joined and staked by {owner.address}", flush=True)
