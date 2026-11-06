"""Dev-only: post a training job as a requester on the compose stack's chain, until the web app's wallet is wired.

Run inside the stack: `docker compose -f docker/compose.dev.yml exec coordinator python docker/dev/post_job.py`
  --epochs N       passes over the data (default 1); the draft turns this into a number of rounds and a price
  --quorum N       nodes a round needs (default 2); up to --max nodes are seated per round (default 3)
  --name NAME      which dev requester pays (default requester/demo)

It drafts through POST /v1/jobs/draft, the same route the web app uses, then funds and creates the job onchain.
Local chain only: the requester is a public dev key.
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

from tod_core.ledger import Ledger, Network, Reverted
from tod_core.txmgr import ANVIL_CHAIN_ID
from tod_node.devnet import Actor

ROOT = Path(__file__).resolve().parents[2]
DATA = Path(os.environ.get("DEV_DATA", "/dev-data"))
NET_FILE = os.environ["TOD_NETWORK"]
COORD = os.environ.get("TOD_COORDINATOR", "http://127.0.0.1:8000")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--epochs", type=int, default=1)
    ap.add_argument("--quorum", type=int, default=2)
    ap.add_argument("--max", type=int, default=3)
    ap.add_argument("--name", default="requester/demo")
    a = ap.parse_args()
    l = Ledger(Network.load(NET_FILE))
    if l.net.chain_id != ANVIL_CHAIN_ID:
        sys.exit("docker/dev/post_job.py is for the local chain only")
    mnist = json.loads((ROOT / "vectors/kernel/presets.json").read_text())["mnist"]["card"]["hash"]
    # No budget: the coordinator prices the job from its spec (1 TOD pays for 1 Gop) and quotes it in the draft.
    body = {"workload": "mlp-exact/1", "datasetHash": mnist, "epochs": a.epochs,
            "minQuorum": a.quorum, "maxPerRound": a.max}
    req = urllib.request.Request(f"{COORD}/v1/jobs/draft", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            draft = json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit(f"draft refused: {e.code} {e.read().decode()[:300]}")
    before = {e.args["jobId"] for e in l.events() if e.name == "JobCreated"}
    units = draft["budget"]
    requester = Actor(l, NET_FILE, DATA, a.name, units=units)
    try:
        requester.l.token.approve(l.net.market, units)
        requester.l.sender.transact(l.net.market, draft["createJobCalldata"])
    except Reverted as e:
        sys.exit(f"createJob failed: {e}")
    job = max({e.args["jobId"] for e in l.events() if e.name == "JobCreated"} - before)
    p = l.rebuild().jobs[job]["params"]
    print(f"job {job}: {units / 1e6:g} TOD for {draft['computeOps'] / 1e9:g} Gop over {p.rounds} rounds, {p.minQuorum}-{p.maxPerRound} nodes a round, "
          f"stake {p.stakePerNode / 1e6:g} TOD per node, requested by {requester.address}", flush=True)


if __name__ == "__main__":
    main()
