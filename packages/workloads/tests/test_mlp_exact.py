"""mlp-exact: MSE path, fit rules, deterministic log, and the self-test vector that pins its bytes."""
import json
import pathlib
import sys

import numpy as np

from tod_core.blob import k256
from tod_datasets.schema import DatasetCard
from tod_workloads.base import get
from tod_workloads.kernel import log64
from tod_workloads.mlp_exact import MLPExact, selftest

ROOT = pathlib.Path(__file__).parents[3]
VEC = ROOT / "vectors" / "kernel" / "mlp_exact.json"
SH = k256(b"tod-selftest")


def test_mse_step_reduces_loss():
    rng = np.random.default_rng(5)
    x = rng.random((64, 8), dtype=np.float32)
    y = (x @ rng.random((8, 2))).astype(np.float32)
    wl = MLPExact(8, 2, hidden=16, loss="mse")
    w = wl.init(0)
    assert wl.evaluate(wl.step(w, x, y), x, y)[0] < wl.evaluate(w, x, y)[0]


def test_fits():
    clf, reg = MLPExact(784, 10), MLPExact(784, 1, loss="mse")
    assert clf.fits(DatasetCard("0x", 1000, (784,), "classification", 10))
    assert not clf.fits(DatasetCard("0x", 1000, (5000,), "classification", 10))
    assert reg.fits(DatasetCard("0x", 1000, (784,), "regression", None))
    assert not reg.fits(DatasetCard("0x", 1000, (784,), "classification", 10))


def test_init_deterministic_and_registered():
    a, b = get("mlp-exact/1", d_in=20, n_out=3), MLPExact(20, 3)
    assert np.array_equal(a.init(0), b.init(0)) and a.init(0).dtype == np.float32
    assert len(a.init(0)) == a.n_params()


def test_log64_matches_libm_closely():
    x = np.geomspace(1e-300, 1e300, 10_001)
    assert np.allclose(log64(x), np.log(x), rtol=1e-14, atol=1e-300) and log64(np.array([1.0]))[0] == 0.0


def test_selftest_vector():
    assert json.loads(VEC.read_text())["hash"] == selftest()


if __name__ == "__main__" and "--write" in sys.argv:
    VEC.write_text(json.dumps({"workload": "mlp-exact/1", "d_in": 8, "hidden": 16, "n_out": 4, "init_seed": 0,
                               "data": "default_rng(1): random((32, 8), float32), integers(0, 4, 32)", "steps": 10,
                               "specHash": SH.hex(), "hash": selftest()}, indent=1) + "\n")
