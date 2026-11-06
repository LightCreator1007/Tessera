"""Hardware probe: node labels, size classes and which device classes a node can take."""
import sys
import types

import pytest

from tod_workloads import hardware


def test_probe_without_torch(monkeypatch):
    monkeypatch.setitem(sys.modules, "torch", None)  # makes `import torch` raise ImportError
    p = hardware.probe()
    assert p["torch"] is None
    assert p["gpus"] == []
    assert (p["label"], p["size"]) == ("cpu", "s")
    assert p["cores"] >= 1 and p["ramGB"] > 0


def test_probe_survives_a_broken_torch(monkeypatch):
    def boom():
        raise RuntimeError("driver crashed")
    fake = types.SimpleNamespace(__version__="9.9", cuda=types.SimpleNamespace(is_available=boom),
                                 backends=types.SimpleNamespace(mps=types.SimpleNamespace(is_available=boom)))
    monkeypatch.setitem(sys.modules, "torch", fake)
    p = hardware.probe()
    assert p["gpus"] == [] and p["label"] == "cpu"


@pytest.mark.parametrize("gpus,expected", [
    ([], ("cpu", "s")),
    ([{"kind": "mps", "name": "Apple GPU", "memGB": 16}], ("gpu-apple", "l")),
    ([{"kind": "cuda", "name": "RTX", "memGB": 6}], ("gpu-nvidia", "s")),
    ([{"kind": "cuda", "name": "RTX", "memGB": 12}], ("gpu-nvidia", "m")),
])
def test_label_from_gpus(gpus, expected):
    assert hardware.label(gpus) == expected


def test_meets():
    cpu = {"gpus": []}
    gpu = {"gpus": [{"kind": "mps", "name": "Apple GPU", "memGB": 16}]}
    assert hardware.meets(cpu, "cpu") and hardware.meets(cpu, "any") and not hardware.meets(cpu, "gpu")
    assert all(hardware.meets(gpu, c) for c in ("cpu", "gpu", "any"))


def test_best_device_order():
    mps = {"kind": "mps", "name": "Apple GPU", "memGB": 16}
    cuda = {"kind": "cuda", "name": "RTX", "memGB": 8}
    assert hardware.best_device({"gpus": [mps, cuda]}) == "cuda"
    assert hardware.best_device({"gpus": [mps]}) == "mps"
    assert hardware.best_device({"gpus": []}) == "cpu"


def test_probe_on_windows_without_sysconf(monkeypatch):
    # Windows has no os.sysconf, and Windows laptops with NVIDIA GPUs are likely nodes.
    monkeypatch.delattr(hardware.os, "sysconf")
    monkeypatch.setitem(sys.modules, "torch", None)
    assert hardware.probe()["ramGB"] == 0.0
