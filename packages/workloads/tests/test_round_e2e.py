"""One full round across the packages: nodes train, both verifiers replay and judge, merge, gate."""
import numpy as np

from tod_core import encodings as enc
from tod_core.aggregate import Outer, gate
from tod_core.blob import k256, whash
from tod_core.judge import judge
from tod_workloads.mlp_exact import MLPExact
from tod_workloads.runner import run_round, sampler

SH = k256(b"e2e")
DOM = enc.domain(31337, "0x" + "11" * 20)
WL = MLPExact(16, 3, hidden=16)
rng = np.random.default_rng(0)
X = rng.random((1200, 16), dtype=np.float32)
Y = (X[:, :3].argmax(1)).astype(np.int64)
VAL = np.arange(1000, 1200)
OPS = ["0x" + f"{i + 1:040x}" for i in range(4)]


def train(g, shard):
    final = {}
    rows = sampler(DOM, 1, shard, {"start": shard * 250, "len": 250}, 0, 20, 32)
    hs = run_round(WL, g, X, Y, rows, 20, 4, SH, on_checkpoint=lambda k, w: final.update(w=w))
    return hs, final["w"]


def test_round_end_to_end():
    g = WL.init(0)
    commits, weights = {}, {}
    for i, op in enumerate(OPS):
        commits[op], weights[op] = train(g, i)
    faker = OPS[3]
    weights[faker] = (g + 0.01).astype(np.float32)
    commits[faker] = commits[faker][:-1] + [whash(SH, weights[faker])]

    accepted = []
    for i, op in enumerate(OPS):
        verdicts = {judge("exact", SH, g, _replay_final(g, i), commits[op][-1]).kind for _ in ("A", "B")}
        assert len(verdicts) == 1  # both verifiers must agree, or the round can't be signed
        if verdicts == {None}:
            accepted.append(op)
    assert accepted == OPS[:3]

    def val_loss(w):
        return WL.evaluate(w, X[VAL], Y[VAL])[0]

    r = gate(g, [(op, weights[op]) for op in accepted], Outer(), None, val_loss)
    assert not r.reverted and r.accepted == OPS[:3] and r.loss_new < r.loss_prev


def _replay_final(g, shard):
    return train(g, shard)[1]
