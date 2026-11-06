"""Runs a round's training, and the self-test, in a throwaway Docker container with no network and no host access."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np

IMAGE = os.environ.get("TOD_NODE_IMAGE", "ghcr.io/lightcreator1007/tod-node:latest")
TIMEOUT = 30 * 60  # s; a round that trains longer than this has missed its commit window anyway


def enabled() -> bool:
    """TOD_SANDBOX=off trains in-process, for the node image itself (already a container) and the tests."""
    return os.environ.get("TOD_SANDBOX", "docker") != "off"


class DockerSandbox:
    def __init__(self, cache: Path, image: str = IMAGE, cpus: str = "", memory: str = ""):
        self.cache, self.image = cache, image
        self.cpus = cpus or os.environ.get("TOD_CPUS", "2")
        self.memory = memory or os.environ.get("TOD_MEMORY", "2g")

    def check(self) -> str | None:
        """None if Docker answers and the image is here (pulled if it wasn't), else what is wrong."""
        if not shutil.which("docker"):
            return "docker is not installed"
        if subprocess.run(["docker", "version"], capture_output=True).returncode:
            return "docker is installed but the daemon isn't answering (is Docker running?)"
        have = subprocess.run(["docker", "image", "inspect", self.image], capture_output=True).returncode == 0
        if not have and subprocess.run(["docker", "pull", self.image]).returncode:
            return f"could not pull {self.image}"
        return None

    def _run(self, args: list[str], mounts: list[str]) -> subprocess.CompletedProcess:
        # The job's code is a stranger's: no network, no new privileges, a read-only root, capped CPU and memory.
        cmd = ["docker", "run", "--rm", "--network", "none", "--read-only", "--tmpfs", "/tmp",
               "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--pids-limit", "256",
               "--cpus", self.cpus, "--memory", self.memory, "--memory-swap", self.memory,
               "--user", f"{os.getuid()}:{os.getgid()}" if hasattr(os, "getuid") else "10001",
               "-e", "OMP_NUM_THREADS=1", "-e", "OPENBLAS_NUM_THREADS=1", "-e", "MKL_NUM_THREADS=1",
               *mounts, "--entrypoint", "python", self.image, "-m", "tod_node.sandbox", *args]
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=TIMEOUT)
        if out.returncode:
            raise RuntimeError(f"training container exited {out.returncode}: {out.stderr.strip()[-500:]}")
        return out

    def _dataset(self, data_hash: str, X: np.ndarray, y: np.ndarray) -> Path:
        """The dataset as .npy files, written once per dataset and mounted read-only into every round."""
        d = self.cache / data_hash
        if not (d / "y.npy").exists():
            self.cache.mkdir(parents=True, exist_ok=True)
            tmp = Path(tempfile.mkdtemp(dir=self.cache))
            np.save(tmp / "X.npy", X)
            np.save(tmp / "y.npy", y)
            shutil.rmtree(d, ignore_errors=True)
            os.replace(tmp, d)
        return d

    def train(self, spec_bytes: bytes, spec_hash: bytes, start: np.ndarray, data_hash: str, X, y,
              rows: np.ndarray, H: int, K: int) -> tuple[list[bytes], np.ndarray]:
        data = self._dataset(data_hash, X, y)
        with tempfile.TemporaryDirectory(dir=self.cache, prefix="round-") as work:
            w = Path(work)
            (w / "spec.json").write_bytes(spec_bytes)
            np.save(w / "start.npy", start)
            np.save(w / "rows.npy", rows)
            (w / "meta.json").write_text(json.dumps({"specHash": spec_hash.hex(), "H": H, "K": K}))
            self._run(["train"], ["-v", f"{w}:/work", "-v", f"{data}:/data:ro"])
            hashes = [bytes.fromhex(h) for h in json.loads((w / "hashes.json").read_text())]
            return hashes, np.load(w / "final.npy")

    def selftest(self) -> str:
        return self._run(["selftest"], []).stdout.strip()


def _train(work: Path, data: Path) -> None:
    from tod_workloads.runner import run_round

    from .trainer import workload

    meta, spec = json.loads((work / "meta.json").read_text()), json.loads((work / "spec.json").read_bytes())
    rows = np.load(work / "rows.npy")
    X, y = np.load(data / "X.npy", mmap_mode="r"), np.load(data / "y.npy", mmap_mode="r")
    final = {}
    hs = run_round(workload(spec), np.load(work / "start.npy"), X, y, lambda s: rows[s], meta["H"], meta["K"],
                   bytes.fromhex(meta["specHash"]), on_checkpoint=lambda k, w: final.update(w=w))
    np.save(work / "final.npy", final["w"])
    (work / "hashes.json").write_text(json.dumps([h.hex() for h in hs]))


def main(argv: list[str]) -> None:
    """Inside the container: `train` reads /work and /data, `selftest` prints the mlp-exact hash."""
    if argv[:1] == ["train"]:
        _train(Path("/work"), Path("/data"))
    elif argv[:1] == ["selftest"]:
        from tod_workloads.mlp_exact import selftest
        print(selftest())
    else:
        sys.exit(f"usage: python -m tod_node.sandbox train|selftest, not {argv}")


if __name__ == "__main__":
    main(sys.argv[1:])
