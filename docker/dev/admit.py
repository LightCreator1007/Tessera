"""Dev-only: admit a node running on another PC into the compose stack's chain, until the web join flow has a real wallet.

Run inside the stack, e.g. `docker compose -f docker/compose.dev.yml exec coordinator python docker/dev/admit.py ...`:
  owner <name>         print the dev owner address for <name>, to pass to `tod-node pair --owner` on the other PC
  join <name> <code>   fund that owner, get an invite from POST /v1/identity/join (dev mode), then join and stake
  invite <name> <json> the same with an invite from a real World ID check: the JSON the coordinator's
                       /v1/identity/test page prints (IDENTITY_MODE=worldid)

Local chain only: the owner is a public dev key derived from <name>.
"""
import base64
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

from tod_core.ledger import JobStatus, Ledger, Network, Reverted
from tod_core.txmgr import ANVIL_CHAIN_ID, LocalSigner, dev_key
from tod_node.devnet import Actor, script

ROOT = Path(__file__).resolve().parents[2]
DATA = Path(os.environ.get("DEV_DATA", "/dev-data"))
NET_FILE = os.environ["TOD_NETWORK"]
COORD = os.environ.get("TOD_COORDINATOR", "http://127.0.0.1:8000")
PREFIX = "tod-pair:"


def label(name: str) -> str:
    return f"owner/remote/{name}"


def stake_needed(l: Ledger) -> int:
    """Enough for every active job, so the node can be seated in any of them. Before any job is open, what the
    coordinator would ask of post_job.py's default job (the draft route prices it and posts nothing)."""
    state = l.rebuild()
    open_jobs = [j["params"].stakePerNode for j in state.jobs.values() if j["status"] == JobStatus.ACTIVE]
    if open_jobs:
        return max(open_jobs)
    mnist = json.loads((ROOT / "vectors/kernel/presets.json").read_text())["mnist"]["card"]["hash"]
    body = {"workload": "mlp-exact/1", "datasetHash": mnist, "epochs": 1, "minQuorum": 2, "maxPerRound": 3}
    req = urllib.request.Request(f"{COORD}/v1/jobs/draft", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)["minStake"]


def join(l: Ledger, name: str, code: str) -> None:
    if not code.startswith(PREFIX):
        sys.exit("that isn't a pairing code; copy the whole tod-pair:... line that tod-node pair printed")
    raw = code[len(PREFIX):]
    fields = json.loads(base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)))
    check_owner(name, fields["owner"])
    req = urllib.request.Request(f"{COORD}/v1/identity/join",
                                 data=json.dumps({"owner": fields["owner"], "pairingCode": code}).encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            inv = json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit(f"identity/join refused: {e.code} {e.read().decode()[:300]}")
    stake_in(l, name, inv)


def check_owner(name: str, owner: str) -> None:
    mine = LocalSigner(dev_key(label(name))).address
    if owner.lower() != mine.lower():
        sys.exit(f"the code names owner {owner}, but {name} is {mine}; pair again with that --owner")


def stake_in(l: Ledger, name: str, inv: dict) -> None:
    """Fund the owner and the operator's gas, then join with the invite and stake enough for every active job."""
    check_owner(name, inv["owner"])
    op = inv["operator"]
    if l.registry.getNode(op).joined:
        sys.exit(f"{op} has already joined")
    # 10% over the floor: one missed reveal costs 1%, and a node exactly at the floor would then sit out every job.
    stake = stake_needed(l) * 11 // 10
    script("fund.py", op, "--tokens", "0", "--journal-dir", str(DATA / "faucet"), rpc=l.net.rpc, net=NET_FILE)  # gas
    owner = Actor(l, NET_FILE, DATA, label(name), units=stake)
    try:
        owner.l.registry.join(op, bytes.fromhex(inv["nullifier"][2:]), inv["inviteDeadline"], inv["consentDeadline"],
                              bytes.fromhex(inv["inviteSig"][2:]), bytes.fromhex(inv["consentSig"][2:]))
        owner.l.token.approve(l.net.registry, stake)
        owner.l.registry.depositStake(op, stake)
    except Reverted as e:
        sys.exit(f"join failed: {e}")
    print(f"{op} joined and staked {stake / 1e6} TOD, owned by {owner.address} ({inv.get('credential', 'dev')})",
          flush=True)


def main() -> None:
    l = Ledger(Network.load(NET_FILE))
    if l.net.chain_id != ANVIL_CHAIN_ID:
        sys.exit("docker/dev/admit.py is for the local chain only")
    args = sys.argv[1:]
    if len(args) == 2 and args[0] == "owner":
        print(LocalSigner(dev_key(label(args[1]))).address)
    elif len(args) == 3 and args[0] == "join":
        join(l, args[1], args[2])
    elif len(args) == 3 and args[0] == "invite":
        stake_in(l, args[1], json.loads(args[2]))
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
