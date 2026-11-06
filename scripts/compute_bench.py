"""Counts the exact-kernel float ops in a training step, checks the count against numpy and times it on this machine."""
import json
import math
import os
import platform
import time
from pathlib import Path

# One thread, so ops per second compares one core across machines.
for var in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "VECLIB_MAXIMUM_THREADS"):
    os.environ[var] = "1"

import numpy as np  # noqa: E402
from tod_datasets.canonical import split  # noqa: E402
from tod_workloads import base  # noqa: E402
from tod_workloads.mlp_exact import MLPExact  # noqa: E402

PRESETS = Path(__file__).resolve().parents[1] / "vectors/kernel/presets.json"
ARITHMETIC = {np.add, np.subtract, np.multiply, np.divide}
counted = 0


def step_ops(B: int, d: int, h: int, o: int, loss: str = "ce") -> int:
    """Adds, subtracts, multiplies and divides in one mlp-exact step. Dividing uint8 inputs by 255 is left out, so
    this is never above what really runs."""
    params = d * h + h + h * o + o
    return 4 * B * d * h + 6 * B * h * o + 2 * B * h + (37 if loss == "ce" else 4) * B * o + 2 * params


class Counting(np.ndarray):
    def __array_ufunc__(self, ufunc, method, *inputs, **kw):
        global counted
        plain = [np.asarray(i) if isinstance(i, np.ndarray) else i for i in inputs]
        if "out" in kw:
            kw["out"] = tuple(np.asarray(o) for o in kw["out"])
        result = getattr(ufunc, method)(*plain, **kw)
        if ufunc in ARITHMETIC:
            counted += np.size(result)
        return result.view(Counting) if isinstance(result, np.ndarray) else result

    def __array_function__(self, func, types, args, kwargs):
        # np.where and np.concatenate hand back plain arrays, which would hide every op after them.
        result = super().__array_function__(func, types, args, kwargs)
        return result.view(Counting) if isinstance(result, np.ndarray) else result


def count_one_step(wl, w, x, y) -> int:
    global counted
    w, x = w.view(Counting), x.view(Counting)
    counted = 0
    wl.step(w, x, y)
    return counted


def check_the_count():
    rng = np.random.default_rng(0)
    for B, d, h, o, loss in [(64, 784, 128, 10, "ce"), (64, 784, 32, 10, "ce"), (64, 3072, 128, 10, "ce"),
                             (32, 8, 16, 4, "ce"), (32, 20, 16, 1, "mse"), (16, 50, 8, 1, "mse")]:
        wl = MLPExact(d, o, hidden=h, loss=loss)
        y = rng.integers(0, o, B) if loss == "ce" else rng.random(B, dtype=np.float32)
        x = rng.random((B, d), dtype=np.float32)
        want = step_ops(B, d, h, o, loss)
        assert count_one_step(wl, wl.init(0), x, y) == want, (B, d, h, o, loss)
        assert count_one_step(wl, wl.init(1) * 0.5, x * 0 + 1, y) == want, "the count must not depend on the data"


def timed(step, seconds=1.0) -> float:
    n, start = 0, time.perf_counter()
    while (spent := time.perf_counter() - start) < seconds:
        step()
        n += 1
    return spent / n


def blas_step_seconds(B, d, h, o) -> float:
    """The same maths with BLAS matmul and libm exp, to show what the exact kernel costs."""
    rng = np.random.default_rng(0)
    W1, W2 = rng.normal(0, .05, (d, h)).astype(np.float32), rng.normal(0, .1, (h, o)).astype(np.float32)
    x, y = rng.random((B, d), dtype=np.float32), rng.integers(0, o, B)

    def step():
        hidden = np.maximum(x @ W1, 0)
        z = hidden @ W2
        e = np.exp(z - z.max(1, keepdims=True))
        p = e / e.sum(1, keepdims=True)
        p[np.arange(B), y] -= 1
        W1 - .05 * (x.T @ np.where(hidden > 0, p @ W2.T, 0)), W2 - .05 * (hidden.T @ p)
    return timed(step)


def main():
    check_the_count()
    print(f"{platform.system()} {platform.machine()}, numpy {np.__version__}. Count checked against numpy on 6 shapes.")
    summary = []
    for name, preset in json.loads(PRESETS.read_text()).items():
        card = preset["card"]
        d, o, hidden, quorum = math.prod(card["x_shape"]), card.get("classes") or 1, 128, 3
        wl = MLPExact(d, o, hidden=hidden)
        dflt = wl.defaults()
        shards = split(card["rows"], quorum, "0.05", "0.1")["shards"]
        H = base.derive_h(dflt, shards[-1]["len"])
        rounds = base.rounds_for_epochs(1, sum(s["len"] for s in shards), quorum, H, dflt.B)
        ops = step_ops(dflt.B, d, hidden, o)
        rng = np.random.default_rng(0)
        w, x, y = wl.init(0), rng.random((dflt.B, d), dtype=np.float32), rng.integers(0, o, dflt.B)
        per_step = timed(lambda: wl.step(w, x, y))
        gops_per_second = ops / per_step / 1e9
        slowdown = per_step / blas_step_seconds(dflt.B, d, hidden, o)
        print(f"{name}: {ops:,} ops per step, {H} steps, {ops * H / 1e9:.2f} Gops per node per round. One epoch with "
              f"{quorum} nodes is {rounds} rounds and {rounds * quorum * ops * H / 1e9:.1f} Gops. Measured "
              f"{gops_per_second:.2f} Gops/s, {per_step * H:.1f} s per node per round, {slowdown:.0f}x slower than BLAS.")
        summary.append(f"{name} {gops_per_second:.2f} Gops/s, {slowdown:.0f}x BLAS")
    print("Paste this in #1 with your CPU model:", "; ".join(summary))


if __name__ == "__main__":
    main()
