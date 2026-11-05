"""Turn an uploaded CSV or .npz into canonical arrays, a dataset card, and the spec's split and shard table."""
import json
import os
from dataclasses import dataclass
from decimal import ROUND_FLOOR, Decimal

import numpy as np

from tod_core.blob import k256

from .schema import DatasetCard

MAX_BYTES = 200 * 2**20
MIN_ROWS = 1000
MAX_CLASSES = 100


class DatasetError(ValueError):
    pass


@dataclass
class Canonical:
    X: np.ndarray
    y: np.ndarray
    card: DatasetCard


def _load(path) -> tuple[np.ndarray, np.ndarray]:
    if os.path.getsize(path) > MAX_BYTES:
        raise DatasetError(f"file over {MAX_BYTES} bytes")
    if str(path).endswith(".npz"):
        with np.load(path, allow_pickle=False) as z:
            if "X" not in z or "y" not in z:
                raise DatasetError(".npz needs arrays X and y")
            return z["X"], z["y"]
    with open(path) as f:
        first = f.readline().split(",")
    try:
        [float(v) for v in first]
        skip = 0
    except ValueError:
        skip = 1
    try:
        a = np.loadtxt(path, delimiter=",", skiprows=skip, dtype=np.float64, ndmin=2)
    except ValueError as e:
        raise DatasetError(f"non-numeric value: {e}") from None
    return a[:, :-1], a[:, -1]


def dataset_hash(X: np.ndarray, y: np.ndarray) -> str:
    # The .npz container carries zip timestamps, so the hash covers the arrays and their layout, not the file.
    head = json.dumps({"x": [X.dtype.str, list(X.shape)], "y": [y.dtype.str, list(y.shape)]}, sort_keys=True)
    return "0x" + k256(b"tod-dataset/1" + head.encode() + X.tobytes() + y.tobytes()).hex()


def cnn_eligible(x_shape: tuple[int, ...]) -> bool:
    if len(x_shape) not in (2, 3) or max(x_shape[:2]) > 64:
        return False
    return len(x_shape) == 2 or x_shape[2] in (1, 3)


def canonicalise(path, task: str | None = None) -> Canonical:
    return from_arrays(*_load(path), task=task)


def from_arrays(X: np.ndarray, y: np.ndarray, task: str | None = None) -> Canonical:
    if len(X) != len(y) or len(X) < MIN_ROWS:
        raise DatasetError(f"need at least {MIN_ROWS} rows with one target each")
    X = X if X.dtype == np.uint8 else X.astype(np.float32)
    y = y.astype(np.float64).reshape(len(y))
    if not (np.isfinite(y).all() and (X.dtype == np.uint8 or np.isfinite(X).all())):
        raise DatasetError("NaN or Inf in the data")
    integral = bool(np.all(y == np.round(y)))
    labels = np.unique(y)
    if task is None:
        task = "classification" if integral and len(labels) <= MAX_CLASSES else "regression"
    if task == "classification":
        if not integral or not 2 <= len(labels) <= MAX_CLASSES:
            raise DatasetError(f"classification needs 2 to {MAX_CLASSES} integer labels")
        # shortcut: labels are renumbered 0..C-1 in sorted order; keep the original names in the card if the web needs them.
        y = np.searchsorted(labels, y).astype(np.int64)
    else:
        y = y.astype(np.float32)
    # Row order comes from keccak of the row index, so every party derives the same canonical order from the file.
    order = sorted(range(len(y)), key=lambda i: k256(i.to_bytes(32, "big")))
    X, y = np.ascontiguousarray(X[order]), np.ascontiguousarray(y[order])
    card = DatasetCard(dataset_hash(X, y), len(y), tuple(X.shape[1:]), task,
                       len(labels) if task == "classification" else None, "uint8" if X.dtype == np.uint8 else "float32")
    return Canonical(X, y, card)


def _count(rows: int, frac) -> int:
    # Fractions come from the spec as decimal strings; Decimal avoids 0.29 * 100 becoming 28.
    return int((Decimal(str(frac)) * rows).to_integral_value(ROUND_FLOOR))


def split(rows: int, n_shards: int, val_frac, test_frac) -> dict:
    """[train | val | test] in canonical order; train cut into n_shards contiguous ranges, larger ones first."""
    val, test = _count(rows, val_frac), _count(rows, test_frac)
    train = rows - val - test
    q, r = divmod(train, n_shards)
    shards, start = [], 0
    for i in range(n_shards):
        n = q + (1 if i < r else 0)
        shards.append({"start": start, "len": n})
        start += n
    return {"train": (0, train), "val": (train, val), "test": (train + val, test), "shards": shards}


def row_list(rows, train: tuple[int, int]) -> tuple[bytes, str]:
    """A {rowsHash, len} shard's row list as blob bytes and rowsHash = keccak(bytes)."""
    lo, n = train
    rows = [int(r) for r in rows]
    # Ascending makes the list canonical; the order inside a shard comes from the epoch shuffle, not the list.
    if not rows or any(a >= b for a, b in zip(rows, rows[1:])) or rows[0] < lo or rows[-1] >= lo + n:
        raise DatasetError("row list must be non-empty, strictly ascending and inside the train range")
    data = b"".join(r.to_bytes(4, "big") for r in rows)
    return data, "0x" + k256(data).hex()


def parse_rows(data: bytes, rows_hash: str) -> list[int]:
    """Row list fetched from the blob store by rowsHash, checked against it."""
    if len(data) % 4 or "0x" + k256(data).hex() != rows_hash:
        raise DatasetError("row list does not match its rowsHash")
    return [int.from_bytes(data[i:i + 4], "big") for i in range(0, len(data), 4)]
