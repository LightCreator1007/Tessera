"""cnn-torch/1: a small PyTorch CNN that trains on CUDA, an Apple GPU or the CPU, checked by tolerance replay."""
import math
import time

import numpy as np

from tod_datasets.canonical import cnn_eligible
from tod_datasets.schema import DatasetCard

from . import hardware
from .base import RoundDefaults, register

f32 = np.float32
EVAL_CHUNK = 1024


def _torch():
    # Imported here, not at module level, so nodes that only run the exact MLP never need PyTorch.
    try:
        import torch
    except ImportError:
        raise RuntimeError("cnn-torch/1 needs PyTorch: install tod-workloads[torch]") from None
    return torch


def _net(torch, channels: int, side: tuple[int, int], n_out: int):
    nn = torch.nn
    flat = 32 * (side[0] // 4) * (side[1] // 4)
    return nn.Sequential(
        nn.Conv2d(channels, 16, 3, padding=1), nn.ReLU(), nn.MaxPool2d(2),
        nn.Conv2d(16, 32, 3, padding=1), nn.ReLU(), nn.MaxPool2d(2),
        nn.Flatten(), nn.Linear(flat, n_out))


@register
class CNNTorch:
    id = "cnn-torch/1"
    determinism = "tolerance"

    def __init__(self, input_shape: tuple[int, ...], n_out: int, lr: str = "0.05", device: str | None = None):
        torch = self.torch = _torch()
        # Fewer nondeterministic kernels means less drift between a node and its verifiers; warn_only because
        # MPS doesn't offer a deterministic version of every op.
        torch.use_deterministic_algorithms(True, warn_only=True)
        self.image = tuple(input_shape) if len(input_shape) == 3 else (*input_shape, 1)
        self.n_out, self.lr = n_out, float(lr)
        self.device = device or hardware.best_device(hardware.probe())
        h, w, c = self.image
        self.net = _net(torch, c, (h, w), n_out).to(self.device)
        # Evaluation stays on CPU, so both verifiers' gate losses come out as close as they can.
        self.cpu_net = _net(torch, c, (h, w), n_out)

    def n_params(self) -> int:
        return sum(p.numel() for p in self.cpu_net.parameters())

    def init(self, seed: int) -> np.ndarray:
        # numpy's generator, not torch's, so start weights hash the same whatever torch build a party has.
        rng = np.random.default_rng(seed)
        parts = []
        for p in self.cpu_net.parameters():
            shape = tuple(p.shape)
            parts.append(rng.normal(0, math.sqrt(2 / math.prod(shape[1:])), shape).ravel() if len(shape) > 1
                         else np.zeros(shape))
        return np.concatenate(parts).astype(f32)

    def _x(self, x, device):
        x = np.asarray(x)
        x = x.astype(f32) / f32(255) if x.dtype == np.uint8 else x.astype(f32, copy=False)
        t = self.torch.from_numpy(np.ascontiguousarray(x.reshape(len(x), *self.image)))
        return t.permute(0, 3, 1, 2).contiguous().to(device)

    def _load(self, net, w, device):
        self.torch.nn.utils.vector_to_parameters(self.torch.from_numpy(np.ascontiguousarray(w, f32)).to(device),
                                                 net.parameters())

    def step(self, w, x, y):
        torch = self.torch
        self._load(self.net, w, self.device)
        self.net.zero_grad(set_to_none=True)
        loss = torch.nn.functional.cross_entropy(self.net(self._x(x, self.device)),
                                                 torch.from_numpy(np.asarray(y, np.int64)).to(self.device))
        loss.backward()
        with torch.no_grad():
            for p in self.net.parameters():
                p -= self.lr * p.grad
        return torch.nn.utils.parameters_to_vector(self.net.parameters()).detach().cpu().numpy().astype(f32)

    def evaluate(self, w, X, y) -> tuple[float, float]:
        torch = self.torch
        self._load(self.cpu_net, w, "cpu")
        total, right = [], 0
        with torch.no_grad():
            for i in range(0, len(y), EVAL_CHUNK):
                z = self.cpu_net(self._x(X[i:i + EVAL_CHUNK], "cpu")).double()
                t = torch.from_numpy(np.asarray(y[i:i + EVAL_CHUNK], np.int64))
                total += torch.nn.functional.cross_entropy(z, t, reduction="none").tolist()
                right += int((z.argmax(1) == t).sum())
        return math.fsum(total) / len(y), right / len(y)

    def fits(self, card: DatasetCard) -> bool:
        return card.task == "classification" and (card.classes or 0) >= 2 and cnn_eligible(card.x_shape)

    def defaults(self) -> RoundDefaults:
        return RoundDefaults(100, 4, 64, "0.05")


def selftest(device_class: str = "gpu") -> dict:
    """Can this node run cnn-torch/1 jobs of this device class? Trains 20 steps on fixed synthetic data."""
    profile = hardware.probe()
    if not hardware.meets(profile, device_class):
        return {"ok": False, "seconds": 0.0, "device": "cpu", "reason": f"{device_class} jobs need a GPU"}
    try:
        wl = CNNTorch((32, 32, 3), 10, device=hardware.best_device(profile))
        rng = np.random.default_rng(1)
        x, y = rng.integers(0, 256, (64, 32, 32, 3), dtype=np.uint8), rng.integers(0, 10, 64)
        t0 = time.perf_counter()
        w = wl.init(0)
        first = wl.evaluate(w, x, y)[0]
        for _ in range(20):
            w = wl.step(w, x, y)
        last = wl.evaluate(w, x, y)[0]
        ok = math.isfinite(last) and last < first
        return {"ok": ok, "seconds": round(time.perf_counter() - t0, 3), "device": wl.device,
                "reason": None if ok else "training did not lower the loss"}
    except Exception as e:  # a GPU op that this machine's torch can't run should fail the selftest, not the node
        return {"ok": False, "seconds": 0.0, "device": hardware.best_device(profile), "reason": str(e)}
