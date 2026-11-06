"""cnn-torch/1: shapes, start weights, CPU repeatability, training, the selftest and the round runner."""
import sys

import numpy as np
import pytest

from tod_core.blob import k256, whash
from tod_datasets.schema import DatasetCard
from tod_workloads import base, hardware
from tod_workloads.runner import run_round

CPU_ONLY = {"gpus": [], "label": "cpu", "size": "s"}


def test_missing_torch_message(monkeypatch):
    monkeypatch.setitem(sys.modules, "torch", None)
    with pytest.raises(RuntimeError, match=r"tod-workloads\[torch\]"):
        base.get("cnn-torch/1", input_shape=(32, 32, 3), n_out=10)


torch = pytest.importorskip("torch")
from tod_workloads.cnn_torch import CNNTorch, selftest  # noqa: E402


def batch(n, shape, classes=10, seed=1):
    rng = np.random.default_rng(seed)
    return rng.integers(0, 256, (n, *shape), dtype=np.uint8), rng.integers(0, classes, n)


def test_n_params():
    assert CNNTorch((32, 32, 3), 10, device="cpu").n_params() == 25578
    assert CNNTorch((28, 28), 10, device="cpu").n_params() == 20490


def test_init_is_numpy_only_and_repeatable():
    a, b = CNNTorch((32, 32, 3), 10, device="cpu"), CNNTorch((32, 32, 3), 10, device="cpu")
    w = a.init(7)
    assert w.dtype == np.float32 and w.shape == (a.n_params(),)
    assert w.tobytes() == b.init(7).tobytes()
    assert w.tobytes() != a.init(8).tobytes()


def test_cpu_steps_repeat_exactly():
    x, y = batch(16, (32, 32, 3))
    runs = []
    for _ in range(2):
        wl = CNNTorch((32, 32, 3), 10, device="cpu")
        w = wl.init(0)
        for _ in range(5):
            w = wl.step(w, x, y)
        runs.append(w)
    assert np.array_equal(runs[0], runs[1])


@pytest.mark.parametrize("shape", [(28, 28), (784,), (32, 32, 3)], ids=["mnist", "flat-mnist", "cifar"])
def test_input_layouts(shape):
    image = (28, 28) if shape == (784,) else shape
    wl = CNNTorch(image, 10, device="cpu")
    x, y = batch(8, shape)
    w = wl.step(wl.init(0), x, y)
    assert w.dtype == np.float32 and w.shape == (wl.n_params(),) and np.isfinite(w).all()


def test_training_lowers_loss():
    wl = CNNTorch((32, 32, 3), 10, device="cpu")
    x, y = batch(64, (32, 32, 3))
    w = w0 = wl.init(0)
    for _ in range(50):
        w = wl.step(w, x, y)
    assert wl.evaluate(w, x, y)[0] < wl.evaluate(w0, x, y)[0]


def test_fits():
    wl = CNNTorch((32, 32, 3), 10, device="cpu")
    assert wl.fits(DatasetCard("0x", 1000, (32, 32, 3), "classification", 10, "uint8"))
    assert not wl.fits(DatasetCard("0x", 1000, (32, 32, 3), "regression", None, "uint8"))
    assert not wl.fits(DatasetCard("0x", 1000, (100, 100, 3), "classification", 10, "uint8"))


def test_selftest_gpu_on_cpu_only_fails(monkeypatch):
    monkeypatch.setattr(hardware, "probe", lambda: CPU_ONLY)
    r = selftest("gpu")
    assert r["ok"] is False and "GPU" in r["reason"]


def test_selftest_any_passes(monkeypatch):
    monkeypatch.setattr(hardware, "probe", lambda: CPU_ONLY)
    r = selftest("any")
    assert r["ok"] is True and r["device"] == "cpu" and r["seconds"] > 0


def test_round_runs_through_runner():
    wl = CNNTorch((32, 32, 3), 10, device="cpu")
    X, y = batch(64, (32, 32, 3))
    start, sh = wl.init(3), k256(b"tod-test")
    hs = run_round(wl, start, X, y, lambda s: np.arange(s * 8, s * 8 + 8) % 64, 8, 2, sh)
    assert len(hs) == 3 and hs[0] == whash(sh, start) and hs[1] != hs[2]
