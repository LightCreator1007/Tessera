"""Dev-only: host, enter, reveal and settle competitions on the compose stack's chain, until the web wallet is real.

Run inside the stack: `docker compose -f docker/compose.dev.yml exec coordinator python docker/dev/competition.py ...`
  host   --title T [--items 1000] [--prize 20] [--open 180] [--window 120] [--name host/demo]
         labels are the true digits of MNIST test images, which no ToD job trains or validates on
  enter  ID --name NAME (--job J | --accuracy 0.8)
         predictions from job J's final model, or random ones right that often
  reveal ID      waits for the deadline, reveals the labels, then every entry made from this machine
  settle ID      waits for the scoring window, then pays the winner (or refunds the host)
  status [ID]

Labels, predictions and salts are kept in /dev-data/competitions so the reveals can be made later.
Local chain only: hosts and entrants are public dev keys derived from --name.
"""
import argparse
import json
import os
import secrets
import sys
import time
import urllib.request
from pathlib import Path

import numpy as np
from eth_abi import encode
from eth_utils import keccak
from tod_core.ledger import Ledger, Network, Reverted
from tod_core.txmgr import ANVIL_CHAIN_ID
from tod_datasets import presets
from tod_datasets.canonical import split
from tod_node.devnet import Actor

sys.path.insert(0, "/app/services/coordinator")
DATA = Path(os.environ.get("DEV_DATA", "/dev-data"))
NET_FILE = os.environ["TOD_NETWORK"]
COORD = os.environ.get("TOD_COORDINATOR", "http://127.0.0.1:8000")
KEEP = DATA / "competitions"
TOD = 1_000_000


def http(path, body=None):
    req = urllib.request.Request(COORD + path, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"content-type": "application/json"}, method="POST" if body else "GET")
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def mnist_test(items: int):
    """The first `items` images and labels of MNIST's canonical test slice, the same slice every job holds out."""
    c = presets.load("mnist", Path(os.environ.get("DATASET_CACHE", DATA / "datasets")))
    lo, n = split(len(c.X), 1, "0.05", "0.1")["test"]
    if items > n:
        sys.exit(f"MNIST's test slice has {n} images")
    return c.X[lo:lo + items].reshape(items, -1), c.y[lo:lo + items].astype(np.uint8)


def wait_until(ledger, t: int, what: str):
    while (now := ledger.w3.eth.get_block("latest")["timestamp"]) < t:
        print(f"waiting {t - now} s for {what}", flush=True)
        time.sleep(min(10, t - now))


def actor(ledger, name: str, units: int = 0) -> Actor:
    return Actor(ledger, NET_FILE, DATA, name, units=units)


def pass_for(a: Actor) -> tuple:
    p = http("/v1/identity/entry-pass", {"owner": a.address})
    return bytes.fromhex(p["nullifier"][2:]), p["deadline"], bytes.fromhex(p["signature"][2:])


def host(ledger, args):
    X, y = mnist_test(args.items)
    labels, salt = bytes(y), secrets.token_bytes(32)
    prize = round(args.prize * TOD)
    a = actor(ledger, args.name, units=prize)
    deadline = ledger.w3.eth.get_block("latest")["timestamp"] + args.open
    meta = json.dumps({"title": args.title, "task": f"Predict the digit (0-9) in each of the first {args.items} images "
                       "of MNIST's canonical test slice, as one byte per image.", "dataset": "mnist",
                       "items": args.items}, separators=(",", ":"))
    labels_hash = keccak(keccak(labels) + salt)  # abi.encode(bytes32, bytes32) is the two words back to back
    a.l.token.approve(ledger.net.competitions, prize)
    before = ledger.competitions.count()
    a.l.competitions.create(prize, labels_hash, deadline, args.window, args.items, meta, *pass_for(a))
    cid = ledger.competitions.count()
    if cid == before:
        sys.exit("create did not go through")
    KEEP.mkdir(parents=True, exist_ok=True)
    (KEEP / f"{cid}-labels.json").write_text(json.dumps({"labels": labels.hex(), "salt": salt.hex()}))
    print(f"competition {cid}: '{args.title}', {args.prize:g} TOD, {args.items} items, entries close in {args.open} s, "
          f"hosted by {a.address}", flush=True)


def predictions_from_job(job: int, X) -> bytes:
    from api.draft import mlp
    from store import DiskStore
    from tod_core.blob import from_blob

    spec_bytes = urllib.request.urlopen(f"{COORD}/v1/jobs/{job}/spec", timeout=30).read()
    spec = json.loads(spec_bytes)
    rounds = http(f"/v1/jobs/{job}/rounds")
    agg = next(r["aggregateHash"] for r in reversed(rounds) if r["aggregateHash"])
    wl = mlp(spec["model"], spec["train"]["lr"])
    blob = DiskStore(Path(os.environ["STORE_DIR"])).get(agg)
    w = from_blob(keccak(spec_bytes), blob, wl.n_params())
    _, z = wl._forward(w, X.astype(np.float32))
    return bytes(z.argmax(1).astype(np.uint8))


def enter(ledger, args):
    c = http(f"/v1/competitions/{args.id}")
    X, y = mnist_test(c["items"])
    if args.job:
        preds = predictions_from_job(args.job, X)
        how = f"job {args.job}'s model"
    else:
        rng = np.random.default_rng(secrets.randbits(32))
        guess = rng.integers(0, 10, len(y), dtype=np.uint8)
        preds = bytes(np.where(rng.random(len(y)) < args.accuracy, y, guess).astype(np.uint8))
        how = f"random, right about {args.accuracy:.0%} of the time"
    a = actor(ledger, args.name)
    salt = secrets.token_bytes(32)
    commit = keccak(encode(["uint256", "address", "bytes32", "bytes32"], [args.id, a.address, keccak(preds), salt]))
    a.l.competitions.enter(args.id, commit, *pass_for(a))
    KEEP.mkdir(parents=True, exist_ok=True)
    kept = {"predictions": preds.hex(), "salt": salt.hex()}
    (KEEP / f"{args.id}-entry-{a.address}.json").write_text(json.dumps(kept))
    right = sum(p == t for p, t in zip(preds, bytes(y)))
    print(f"{args.name} ({a.address}) entered competition {args.id} with {how}; it will score {right}/{len(y)}",
          flush=True)


def reveal(ledger, args):
    c = ledger.competitions.competition(args.id)
    me = actor(ledger, "reveal/dev")  # anyone may reveal; this key only pays the gas
    if not c.labelsRevealedAt:
        wait_until(ledger, c.deadline, "the deadline")
        kept = json.loads((KEEP / f"{args.id}-labels.json").read_text())
        me.l.competitions.revealLabels(args.id, bytes.fromhex(kept["labels"]), bytes.fromhex(kept["salt"]))
        print(f"labels revealed for competition {args.id}", flush=True)
    for f in sorted(KEEP.glob(f"{args.id}-entry-*.json")):
        entrant = f.stem.split("-entry-")[1]
        kept = json.loads(f.read_text())
        try:
            preds, salt = bytes.fromhex(kept["predictions"]), bytes.fromhex(kept["salt"])
            me.l.competitions.revealEntry(args.id, entrant, preds, salt)
            print(f"revealed {entrant}'s entry", flush=True)
        except Reverted as e:
            print(f"{entrant}: {e}", flush=True)


def settle(ledger, args):
    c = ledger.competitions.competition(args.id)
    if not c.labelsRevealedAt:
        sys.exit("labels aren't revealed yet; run reveal first")
    wait_until(ledger, c.labelsRevealedAt + c.revealWindow, "the scoring window to close")
    actor(ledger, "reveal/dev").l.competitions.settle(args.id)
    out = http(f"/v1/competitions/{args.id}")
    print(json.dumps(out["settled"]), flush=True)


def status(_, args):
    rows = [http(f"/v1/competitions/{args.id}")] if args.id else http("/v1/competitions")
    for c in rows:
        board = ", ".join(f"{e['entrant'][:10]} {e['score']}/{c['items']}" for e in c["leaderboard"]) or "no scores yet"
        print(f"#{c['id']} {c['title']} [{c['status']}] {c['prize'] / TOD:g} TOD, {c['entries']} entries | {board}")


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    h = sub.add_parser("host")
    h.add_argument("--title", required=True)
    h.add_argument("--items", type=int, default=1000)
    h.add_argument("--prize", type=float, default=20)
    h.add_argument("--open", type=int, default=180, help="seconds until entries close")
    h.add_argument("--window", type=int, default=120, help="seconds for each reveal step")
    h.add_argument("--name", default="host/demo")
    e = sub.add_parser("enter")
    e.add_argument("id", type=int)
    e.add_argument("--name", required=True)
    g = e.add_mutually_exclusive_group(required=True)
    g.add_argument("--job", type=int)
    g.add_argument("--accuracy", type=float)
    for cmd in ("reveal", "settle"):
        sub.add_parser(cmd).add_argument("id", type=int)
    sub.add_parser("status").add_argument("id", type=int, nargs="?")
    args = ap.parse_args()
    ledger = Ledger(Network.load(NET_FILE))
    if ledger.net.chain_id != ANVIL_CHAIN_ID:
        sys.exit("docker/dev/competition.py is for the local chain only")
    if not ledger.net.competitions:
        sys.exit("this network file has no Competitions contract; redeploy the stack")
    {"host": host, "enter": enter, "reveal": reveal, "settle": settle, "status": status}[args.cmd](ledger, args)


if __name__ == "__main__":
    main()
