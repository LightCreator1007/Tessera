"""Round merge and validation gate: median-norm clipping, coordinate-wise trimmed mean, then the outer step."""
import math
from dataclasses import dataclass

import numpy as np


def norm64(v: np.ndarray) -> float:
    # fsum is correctly rounded, so every machine gets the same norm; np.linalg.norm's summation order varies by CPU.
    v = np.asarray(v, dtype=np.float64)
    return math.sqrt(math.fsum((v * v).tolist()))


def _f32(x: np.ndarray) -> np.ndarray:
    return x.astype(np.float32) + np.float32(0)


@dataclass(frozen=True)
class Outer:
    kind: str = "avg"  # "avg" | "nesterov"
    lr: float = 1.0
    momentum: float = 0.0


@dataclass
class MergeResult:
    w_new: np.ndarray
    m_new: np.ndarray | None
    clip: list[float]
    trim: int


def merge(g_r, updates, outer=Outer(), m_prev=None) -> MergeResult:
    """updates: [(operator, h_K weights)]; sorted by address value here so callers can't change the bytes."""
    if not updates:
        return MergeResult(g_r.copy(), m_prev, [], 0)
    ups = sorted(updates, key=lambda u: int(u[0], 16))
    g64 = g_r.astype(np.float64)
    d = np.stack([w.astype(np.float64) - g64 for _, w in ups])
    norms = [norm64(row) for row in d]
    med = float(np.median(norms))
    clip = [1.0 if nrm <= med else med / nrm for nrm in norms]
    d *= np.array(clip)[:, None]
    n = len(ups)
    t = max(1, n // 5) if n >= 3 else 0
    acc = np.zeros_like(g64)
    # Rows are added one at a time so the summation order is the same everywhere; np.sum may reorder.
    for row in np.sort(d, axis=0)[t:n - t]:
        acc += row
    delta = acc / (n - 2 * t)
    if outer.kind == "avg":
        return MergeResult(_f32(g64 + delta), None, clip, t)
    m = outer.momentum * (m_prev if m_prev is not None else 0.0) + delta
    return MergeResult(_f32(g64 + outer.lr * (outer.momentum * m + delta)), m, clip, t)


@dataclass
class GateResult:
    w_new: np.ndarray
    m_new: np.ndarray | None
    accepted: list[str]
    excluded: list[str]
    reverted: bool
    loss_prev: float
    loss_new: float
    loo: list[tuple[str, float]]  # kept for the evidence record so verifiers can show why a node was dropped


def gate(g_r, updates, outer, m_prev, val_loss, rel_tol=0.1, abs_tol=0.01) -> GateResult:
    """Accept the merge, or drop the one node that explains a bad merge, or revert.

    val_loss must be deterministic (fixed-order eval) so both verifiers reach the same verdict.
    Defaults are the smallest pair that gave no false revert or exclusion over 120 simulated honest rounds.
    """
    # shortcut: abs_tol doubles as the agreement band between verifiers; split it out if a tolerance-class eval needs its own.
    lp = val_loss(g_r)
    limit = lp * (1 + rel_tol) + abs_tol
    ops = sorted((op for op, _ in updates), key=lambda a: int(a, 16))
    full = merge(g_r, updates, outer, m_prev)
    ln = val_loss(full.w_new)
    if ln <= limit:
        return GateResult(full.w_new, full.m_new, ops, [], False, lp, ln, [])
    loo, best = [], None
    for op in ops:
        cand = merge(g_r, [u for u in updates if u[0] != op], outer, m_prev)
        loss = val_loss(cand.w_new)
        loo.append((op, loss))
        if best is None or loss < best[1]:
            best = (op, loss, cand)
    if best is not None and best[1] <= limit:
        op, loss, cand = best
        return GateResult(cand.w_new, cand.m_new, [o for o in ops if o != op], [op], False, lp, loss, loo)
    return GateResult(g_r.copy(), m_prev, [], [], True, lp, ln, loo)
