"""One round of local training, shared by the node (training) and the verifiers (full replay)."""
from collections.abc import Callable

import numpy as np

from tod_core import encodings as enc
from tod_core.blob import whash


def run_round(wl, g_r: np.ndarray, X, y, batch_rows: Callable[[int], np.ndarray], H: int, K: int, spec_hash: bytes,
              start_segment: int = 0, w_start: np.ndarray | None = None,
              on_checkpoint: Callable[[int, np.ndarray], None] | None = None) -> list[bytes]:
    """Train H steps from G_r and return the checkpoint hashes [h_start_segment .. h_K].

    batch_rows(s) gives the dataset rows for global step s; the epoch shuffle and cursor live behind it,
    so the node and both verifiers feed identical batches. The inner optimizer restarts every round, so
    weights alone are the whole state and a resume needs only the last checkpoint.
    """
    if H % K:
        raise ValueError("H must be a multiple of K")
    if start_segment and w_start is None:
        raise ValueError("resuming needs w_start")
    n = H // K
    w = g_r.copy() if start_segment == 0 else w_start.copy()
    hashes = [whash(spec_hash, w)]
    for k in range(start_segment, K):
        for s in range(k * n, (k + 1) * n):
            rows = batch_rows(s)
            w = wl.step(w, X[rows], y[rows])
        if on_checkpoint:
            on_checkpoint(k + 1, w)
        hashes.append(whash(spec_hash, w))
    return hashes


def sampler(dom: bytes, job: int, shard: int, entry: dict, rounds_done: int, H: int, B: int,
            rows=None) -> Callable[[int], np.ndarray]:
    """batch_rows(s) for run_round from the shared epoch shuffle; rounds_done counts Accepted rounds on this shard."""
    shard_rows = enc.shard_rows(entry, rows)
    return lambda s: np.asarray(enc.batch(dom, job, shard, shard_rows, rounds_done, H, B, s), dtype=np.int64)
