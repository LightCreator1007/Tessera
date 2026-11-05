"""mlp-exact/1: one-hidden-layer MLP on the fixed-order kernel, cross-entropy or MSE, bit-exact replay."""
import math

import numpy as np

from tod_core.blob import k256, whash
from tod_datasets.schema import DatasetCard

from .base import RoundDefaults, register
from .kernel import colsum, exp64, log64, mm, rowmax, rowsum

f32 = np.float32
MAX_INPUTS = 4096


def _as_f32(x):
    return x.astype(f32) / f32(255) if x.dtype == np.uint8 else x.astype(f32, copy=False)


@register
class MLPExact:
    id = "mlp-exact/1"
    determinism = "exact"

    def __init__(self, d_in: int, n_out: int, hidden: int = 128, loss: str = "ce", lr: str = "0.05"):
        self.shapes = [(d_in, hidden), (hidden,), (hidden, n_out), (n_out,)]
        self.loss_kind, self.lr = loss, f32(float(lr))

    def n_params(self) -> int:
        return sum(math.prod(s) for s in self.shapes)

    def _unpack(self, w):
        out, o = [], 0
        for s in self.shapes:
            out.append(w[o:o + math.prod(s)].reshape(s))
            o += math.prod(s)
        return out

    def init(self, seed: int) -> np.ndarray:
        rng = np.random.default_rng(seed)
        (d_in, h), _, (_, n_out), _ = self.shapes
        W1 = rng.normal(0, math.sqrt(2 / d_in), (d_in, h))
        W2 = rng.normal(0, math.sqrt(2 / h), (h, n_out))
        return np.concatenate([W1.ravel(), np.zeros(h), W2.ravel(), np.zeros(n_out)]).astype(f32)

    def _forward(self, w, x):
        W1, b1, W2, b2 = self._unpack(w)
        h = np.maximum(mm(x, W1) + b1, f32(0))
        return h, mm(h, W2) + b2

    def _softmax64(self, z):
        z = z.astype(np.float64)
        e = exp64(z - rowmax(z)[:, None])
        return e, rowsum(e)

    def step(self, w, x, y):
        x = _as_f32(x)
        W1, b1, W2, b2 = self._unpack(w)
        B = x.shape[0]
        h, z = self._forward(w, x)
        if self.loss_kind == "ce":
            e, s = self._softmax64(z)
            p = (e / s[:, None]).astype(f32)
            p[np.arange(B), y] -= f32(1)
            p = p / f32(B)
        else:
            p = (z - y.reshape(z.shape).astype(f32)) * f32(2 / B)
        dh = np.where(h > 0, mm(p, W2.T), f32(0))
        grad = np.concatenate([mm(x.T, dh).ravel(), colsum(dh), mm(h.T, p).ravel(), colsum(p)])
        return w - self.lr * grad

    def evaluate(self, w, X, y) -> tuple[float, float]:
        """(loss, metric) in fixed order, so the validation gate gives both verifiers the same number."""
        _, z = self._forward(w, _as_f32(X))
        if self.loss_kind == "ce":
            e, s = self._softmax64(z)
            zz = z.astype(np.float64)
            per_row = rowmax(zz) + log64(s) - zz[np.arange(len(y)), y]
            return math.fsum(per_row.tolist()) / len(y), float((z.argmax(1) == y).mean())
        d = (z - y.reshape(z.shape)).astype(np.float64)
        mse = math.fsum(rowsum(d * d).tolist()) / len(y)
        return mse, mse

    def fits(self, card: DatasetCard) -> bool:
        flat_ok = math.prod(card.x_shape) <= MAX_INPUTS
        return flat_ok and (card.task == "regression" if self.loss_kind == "mse" else (card.classes or 0) >= 2)

    def defaults(self) -> RoundDefaults:
        return RoundDefaults(200, 4, 64, "0.05")


def selftest() -> str:
    """Hex weight hash after 10 steps on a fixed batch; must equal vectors/kernel/mlp_exact.json "hash" on every machine."""
    wl = MLPExact(8, 4, hidden=16)
    w = wl.init(0)
    rng = np.random.default_rng(1)
    x, y = rng.random((32, 8), dtype=f32), rng.integers(0, 4, 32)
    for _ in range(10):
        w = wl.step(w, x, y)
    return whash(k256(b"tod-selftest"), w).hex()
