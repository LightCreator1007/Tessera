"""Runner: hash list shape, crash-resume equality, full-replay determinism, batches from the callback and the sampler."""
import json
import pathlib

import numpy as np
import pytest

from tod_core.blob import k256, whash
from tod_workloads.mlp_exact import MLPExact
from tod_workloads.runner import run_round, sampler

SH = k256(b"t")
WL = MLPExact(8, 3, hidden=8)
G = WL.init(0)
rng = np.random.default_rng(0)
X, Y = rng.random((500, 8), dtype=np.float32), rng.integers(0, 3, 500)
SHARD = np.arange(100, 400)


def rows(offset=0):
    return lambda s: SHARD[(np.arange(16) + (s + offset) * 16) % len(SHARD)]


def test_hash_list_shape():
    hs = run_round(WL, G, X, Y, rows(), 20, 4, SH)
    assert len(hs) == 5 and hs[0] == whash(SH, G)


def test_resume_identical():
    saved = {}
    full = run_round(WL, G, X, Y, rows(), 20, 4, SH, on_checkpoint=lambda k, w: saved.setdefault(k, w.copy()))
    assert run_round(WL, G, X, Y, rows(), 20, 4, SH, start_segment=2, w_start=saved[2]) == full[2:]


def test_full_replay_equals_node():
    assert run_round(WL, G, X, Y, rows(), 20, 4, SH) == run_round(WL, G, X, Y, rows(), 20, 4, SH)


def test_different_batches_differ():
    assert run_round(WL, G, X, Y, rows(), 20, 4, SH)[1] != run_round(WL, G, X, Y, rows(7), 20, 4, SH)[1]


def test_bad_args():
    with pytest.raises(ValueError):
        run_round(WL, G, X, Y, rows(), 21, 4, SH)
    with pytest.raises(ValueError):
        run_round(WL, G, X, Y, rows(), 20, 4, SH, start_segment=1)


def test_sampler_matches_encodings_vectors():
    vec = json.loads((pathlib.Path(__file__).parents[3] / "vectors" / "encodings.json").read_text())["batch"]
    assert vec
    for v in vec:
        dom = bytes.fromhex(v["domain"][2:])
        rows = sampler(dom, v["jobId"], v["shard"], v["entry"], v["roundsDone"], v["H"], v["B"])
        assert [rows(s).tolist() for s in range(v["H"])] == v["steps"]
