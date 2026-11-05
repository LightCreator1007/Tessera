"""The demo job: one exact-MLP round on MNIST with three honest nodes and one cheater, and the hashes everyone should get."""
import argparse
import copy
import json
import math
import time
from pathlib import Path

import numpy as np

from tod_core import encodings as enc
from tod_core.aggregate import Outer, gate
from tod_core.blob import whash
from tod_core.evidence import canonical
from tod_core.hashing import k256
from tod_datasets import presets
from tod_datasets.canonical import split

from .mlp_exact import MLPExact
from .runner import run_round, sampler

ROOT = Path(__file__).resolve().parents[3]
VECTOR = ROOT / "vectors" / "kernel" / "demo_round.json"
CHAIN_ID, MARKET = 31337, "0x" + "00" * 19 + "01"  # local Anvil defaults; pass the real ones for a deployed market
JOB, ROUND = 1, 0
NODES = ["0x" + f"{i + 1:040x}" for i in range(4)]
CHEATER = NODES[3]


def demo_spec(dataset_hash: str, rows: int) -> dict:
    """The job spec, built from the shared example so it stays valid against vectors/spec.schema.json."""
    spec = copy.deepcopy(json.loads((ROOT / "vectors" / "spec.example.mlp.json").read_text()))
    s = split(rows, len(NODES), "0.05", "0.1")
    spec["model"]["hidden"] = 32  # small enough that a round takes seconds on a laptop
    spec["train"].update(H=200, K=4, B=64, lr="0.05", epochs=1)
    spec["data"].update(datasetHash=dataset_hash, shards=s["shards"], valFrac="0.05", testFrac="0.1")
    # A fixed figure instead of a timed one, so the spec bytes, and every hash after them, are the same everywhere.
    spec["refWorkSecondsPerRound"] = 5
    return spec


def run(X, y, dataset_hash: str, chain_id: int = CHAIN_ID, market: str = MARKET) -> dict:
    """Train, cheat, replay, judge and merge one round; returns every hash a teammate should reproduce."""
    X = X.reshape(len(X), -1)  # the MLP takes flat rows; MNIST arrives as 28x28 images
    spec = demo_spec(dataset_hash, len(y))
    sh = k256(canonical(spec))
    m, t = spec["model"], spec["train"]
    wl = MLPExact(math.prod(m["inputShape"]), m["outputs"], hidden=m["hidden"], lr=t["lr"])
    g = wl.init(int.from_bytes(sh[:8], "big"))  # same seed rule the coordinator uses for a job's start weights
    dom = enc.domain(chain_id, market)
    s = split(len(y), len(NODES), "0.05", "0.1")

    def train(i):
        out = {}
        rows = sampler(dom, JOB, i, s["shards"][i], 0, t["H"], t["B"])
        hs = run_round(wl, g, X, y, rows, t["H"], t["K"], sh, on_checkpoint=lambda k, w: out.update(w=w))
        return hs, out["w"]

    t0 = time.perf_counter()
    commits, weights = {}, {}
    for i, op in enumerate(NODES):
        if op == CHEATER:
            # Skips training and claims slightly moved start weights, hoping nobody checks.
            weights[op] = (g + np.float32(0.001)).astype(np.float32)
            commits[op] = [whash(sh, g)] + [whash(sh, weights[op])] * t["K"]
        else:
            commits[op], weights[op] = train(i)
    train_s = time.perf_counter() - t0

    t0 = time.perf_counter()
    verdicts = {}
    for i, op in enumerate(NODES):
        # A verifier replays the node's whole round from the same start weights and shard; both verifiers get the same bytes.
        replay = train(i)[0]
        verdicts[op] = "accepted" if replay == commits[op] else "ReplayMismatch"
    replay_s = time.perf_counter() - t0

    lo, n = s["val"]
    val = np.arange(lo, lo + n)
    honest = [op for op in NODES if verdicts[op] == "accepted"]
    r = gate(g, [(op, weights[op]) for op in honest], Outer(), None, lambda w: wl.evaluate(w, X[val], y[val])[0])
    return {
        "chainId": chain_id, "market": market, "job": JOB, "round": ROUND,
        "datasetHash": dataset_hash, "specHash": "0x" + sh.hex(), "startWeightsHash": "0x" + whash(sh, g).hex(),
        "nodes": [{"operator": op, "shard": i, "honest": op != CHEATER, "verdict": verdicts[op],
                   "checkpoints": ["0x" + h.hex() for h in commits[op]]} for i, op in enumerate(NODES)],
        "merge": {"accepted": r.accepted, "excluded": r.excluded, "reverted": r.reverted,
                  "newWeightsHash": "0x" + whash(sh, r.w_new).hex(),
                  "valLossBefore": round(r.loss_prev, 6), "valLossAfter": round(r.loss_new, 6)},
        "seconds": {"trainAllNodes": round(train_s, 2), "replayAllNodes": round(replay_s, 2)},
    }


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--cache", type=Path, default=Path.home() / ".cache" / "tod" / "datasets")
    p.add_argument("--chain-id", type=int, default=CHAIN_ID)
    p.add_argument("--market", default=MARKET)
    p.add_argument("--write", action="store_true", help="save the result as the shared demo vector")
    a = p.parse_args()
    c = presets.load("mnist", a.cache)
    result = run(c.X, c.y, c.card.hash, a.chain_id, a.market)
    print(json.dumps(result, indent=1))
    if a.write:
        # Timings depend on the machine, so they stay out of the shared vector.
        VECTOR.write_text(json.dumps({k: v for k, v in result.items() if k != "seconds"}, indent=1) + "\n")


if __name__ == "__main__":
    main()
