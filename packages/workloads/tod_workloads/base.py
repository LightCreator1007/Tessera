"""Workload contract, registry, round defaults and epoch-to-round maths."""
from dataclasses import dataclass
from typing import Protocol

import numpy as np

from tod_datasets.schema import DatasetCard

H_MIN, H_MAX = 50, 500


@dataclass(frozen=True)
class RoundDefaults:
    H: int
    K: int
    B: int
    lr: str  # decimal string, so the spec never depends on float parsing


class Workload(Protocol):
    id: str
    determinism: str  # "exact" | "tolerance"

    def n_params(self) -> int: ...
    def init(self, seed: int) -> np.ndarray: ...
    def step(self, w: np.ndarray, x: np.ndarray, y: np.ndarray) -> np.ndarray: ...
    def evaluate(self, w: np.ndarray, X: np.ndarray, y: np.ndarray) -> tuple[float, float]: ...
    def fits(self, card: DatasetCard) -> bool: ...
    def defaults(self) -> RoundDefaults: ...


_REGISTRY: dict[str, type] = {}


def register(cls):
    _REGISTRY[cls.id] = cls
    return cls


def get(workload_id: str, **sizes) -> Workload:
    return _REGISTRY[workload_id](**sizes)


def derive_h(d: RoundDefaults, shard_rows: int) -> int:
    # More than about 2 passes over one shard per round makes nodes drift apart on their own data.
    h = max(H_MIN, min(d.H, H_MAX, 2 * shard_rows // d.B))
    h -= h % d.K
    return h + d.K if h < H_MIN else h


def rounds_for_epochs(epochs: int, train_rows: int, nodes: int, H: int, B: int) -> int:
    return -(-epochs * train_rows // (nodes * H * B))
