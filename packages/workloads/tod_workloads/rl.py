"""Runs an RL policy on a host's environment over fixed seeds and returns its mean return, the score verifiers sign."""
import importlib
import io
import json
import math
import os
import subprocess
import sys
import threading
import zipfile
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

SCALE = 1000  # RLCompetitions.SCALE: the signed score is round(mean return x 1000)
INT64 = (-(2**63), 2**63 - 1)
MAX_UNPACKED = 64 << 20
TIMEOUT = 30 * 60  # s for a whole evaluation


@dataclass(frozen=True)
class Result:
    returns: list[list[float]]  # per seed, per episode
    mean: float
    score: int


def unpack(blob: bytes, dest: Path, single: str) -> Path:
    """A zip is unpacked into dest; any other file is saved as `single`, so a one-file package needs no zip."""
    dest.mkdir(parents=True, exist_ok=True)
    if not blob.startswith(b"PK\x03\x04"):
        (dest / single).write_bytes(blob)
        return dest
    with zipfile.ZipFile(io.BytesIO(blob)) as z:
        if sum(i.file_size for i in z.infolist()) > MAX_UNPACKED:
            raise ValueError("package unpacks to more than 64 MB")
        for i in z.infolist():
            if not (dest / i.filename).resolve().is_relative_to(dest.resolve()):
                raise ValueError(f"package path escapes its folder: {i.filename}")
        z.extractall(dest)
    return dest


def _number(x) -> float:
    r = float(x)
    if not math.isfinite(r):
        raise ValueError(f"reward is not a finite number: {x!r}")
    return r


def evaluate(env: Callable[[dict], dict], act: Callable[[object], object], seeds: list[int], episodes: int,
             max_steps: int) -> Result:
    """Steps the environment with the policy's actions and adds up the reward here, outside both.

    Each seed seeds a fresh environment's first reset, and the episodes after it continue that RNG, as Gymnasium does.
    """
    returns = []
    for seed in seeds:
        env({"op": "make"})
        per = []
        for k in range(episodes):
            obs = env({"op": "reset", "seed": int(seed) if k == 0 else None})["obs"]
            total = 0.0
            for _ in range(max_steps):
                r = env({"op": "step", "action": act(obs)})
                total += _number(r["reward"])
                obs = r["obs"]
                if r["done"]:
                    break
            per.append(total)
        returns.append(per)
    flat = [r for per in returns for r in per]
    mean = sum(flat) / len(flat)
    return Result(returns, mean, min(max(round(mean * SCALE), INT64[0]), INT64[1]))


class Peer:
    """A package served in its own process (or sandbox container), spoken to in JSON lines over its stdin and stdout."""

    def __init__(self, cmd: list[str]):
        self.proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                     text=True)

    def __call__(self, msg: dict) -> dict:
        self.proc.stdin.write(json.dumps(msg) + "\n")
        self.proc.stdin.flush()
        line = self.proc.stdout.readline()
        if not line:
            err = self.proc.stderr.read()[-500:].strip() if self.proc.poll() is not None else ""
            raise RuntimeError(f"package process stopped answering: {err}")
        reply = json.loads(line)
        if "error" in reply:
            raise RuntimeError(f"package raised: {reply['error']}")
        return reply

    def close(self):
        self.proc.kill()
        self.proc.wait()


def run(env_cmd: list[str], policy_cmd: list[str], seeds: list[int], episodes: int, max_steps: int,
        timeout: float = TIMEOUT) -> Result:
    env, policy = Peer(env_cmd), Peer(policy_cmd)
    timer = threading.Timer(timeout, lambda: (env.proc.kill(), policy.proc.kill()))
    timer.start()
    try:
        return evaluate(env, lambda obs: policy({"obs": obs})["action"], seeds, episodes, max_steps)
    finally:
        timer.cancel()
        env.close()
        policy.close()


def serve_command(kind: str, folder: Path, entrypoint: str = "policy:act") -> list[str]:
    return [sys.executable, "-m", "tod_workloads.rl", kind, str(folder), entrypoint]


def _plain(x):
    return x.tolist() if hasattr(x, "tolist") else x


def _load(folder: Path, entrypoint: str):
    module, _, attr = entrypoint.partition(":")
    sys.path.insert(0, str(folder))
    obj = importlib.import_module(module)
    return getattr(obj, attr) if attr else obj


def serve(kind: str, folder: Path, entrypoint: str) -> None:
    """Inside the sandbox: answer the evaluator. Prints from the package go to stderr so they can't fake a reply."""
    out = os.fdopen(os.dup(1), "w")
    os.dup2(2, 1)
    target = _load(folder, entrypoint)
    env = None
    for line in sys.stdin:
        m = json.loads(line)
        try:
            if kind == "policy":
                reply = {"action": _plain(target(m["obs"]))}
            elif m["op"] == "make":
                env, reply = target(), {}
            elif m["op"] == "reset":
                reply = {"obs": _plain(env.reset(seed=m["seed"])[0])}
            else:
                obs, reward, terminated, truncated, _ = env.step(m["action"])
                reply = {"obs": _plain(obs), "reward": float(reward), "done": bool(terminated or truncated)}
        except Exception as e:  # reported to the evaluator, which fails the run
            reply = {"error": f"{type(e).__name__}: {e}"}
        out.write(json.dumps(reply) + "\n")
        out.flush()


if __name__ == "__main__":
    serve(sys.argv[1], Path(sys.argv[2]), sys.argv[3])
