"""Training through the Docker sandbox gives the same checkpoints as training in-process."""
import json
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pytest
from tod_workloads.runner import run_round

from tod_node import sandbox
from tod_node.trainer import workload

SPEC = Path(__file__).resolve().parents[3] / "vectors" / "spec.example.mlp.json"


def inputs(spec):
    rng = np.random.default_rng(7)
    wl = workload(spec)
    d_in, n_out = int(np.prod(spec["model"]["inputShape"])), spec["model"]["outputs"]
    X = rng.standard_normal((64, d_in)).astype(np.float32)
    y = rng.integers(0, n_out, 64)
    H, K = 8, 4
    rows = rng.integers(0, 64, (H, 4))
    return rng.standard_normal(wl.n_params()).astype(np.float32), X, y, rows, H, K


def in_process(spec, start, X, y, rows, H, K, spec_hash):
    final = {}
    hs = run_round(workload(spec), start, X, y, lambda s: rows[s], H, K, spec_hash,
                   on_checkpoint=lambda k, w: final.update(w=w))
    return hs, final["w"]


def test_the_container_side_matches_training_in_process(tmp_path, monkeypatch):
    raw = SPEC.read_bytes()
    spec, spec_hash = json.loads(raw), b"\x01" * 32
    start, X, y, rows, H, K = inputs(spec)

    def fake_run(self, args, mounts):  # what the container does, minus Docker: the same module on the mounted dirs
        work, data = (Path(m.split(":")[0]) for m in mounts[1::2])
        assert args == ["train"] and mounts[3].endswith(":/data:ro")
        sandbox._train(work, data)

    monkeypatch.setattr(sandbox.DockerSandbox, "_run", fake_run)
    sb = sandbox.DockerSandbox(tmp_path)
    hs, w = sb.train(raw, spec_hash, start, "0xab", X, y, rows, H, K)
    want_hs, want_w = in_process(spec, start, X, y, rows, H, K, spec_hash)
    assert hs == want_hs and np.array_equal(w, want_w)
    assert (tmp_path / "0xab" / "X.npy").exists() and not list(tmp_path.glob("round-*"))  # data kept, round removed


def test_the_container_has_no_network_and_drops_privileges(tmp_path, monkeypatch):
    seen = {}
    monkeypatch.setattr(sandbox.subprocess, "run",
                        lambda cmd, **kw: seen.setdefault("cmd", cmd) and subprocess.CompletedProcess(cmd, 0, "0xhash\n", ""))
    assert sandbox.DockerSandbox(tmp_path, image="img").selftest() == "0xhash"
    cmd = " ".join(seen["cmd"])
    for flag in ("--network none", "--read-only", "--cap-drop ALL", "no-new-privileges", "--entrypoint python img"):
        assert flag in cmd


def test_check_says_what_is_missing(tmp_path, monkeypatch):
    monkeypatch.setattr(sandbox.shutil, "which", lambda name: None)
    assert "not installed" in sandbox.DockerSandbox(tmp_path).check()
    monkeypatch.setattr(sandbox.shutil, "which", lambda name: "/usr/bin/docker")
    monkeypatch.setattr(sandbox.subprocess, "run", lambda cmd, **kw: subprocess.CompletedProcess(cmd, 1))
    assert "isn't answering" in sandbox.DockerSandbox(tmp_path).check()


def test_off_switch(monkeypatch):
    monkeypatch.setenv("TOD_SANDBOX", "off")
    assert not sandbox.enabled()
    monkeypatch.delenv("TOD_SANDBOX")
    assert sandbox.enabled()


@pytest.mark.skipif(not shutil.which("docker") or subprocess.run(["docker", "image", "inspect", sandbox.IMAGE],
                                                                 capture_output=True).returncode,
                    reason="needs Docker and the node image")
def test_real_container_reproduces_the_selftest_vector(tmp_path):
    vec = json.loads((SPEC.parent / "kernel" / "mlp_exact.json").read_text())
    assert sandbox.DockerSandbox(tmp_path).selftest() == vec["hash"]
