"""Replay judge: compare a verifier's full replay with what the node committed (exact or tolerance class)."""
import math
from dataclasses import dataclass

import numpy as np

from .aggregate import norm64
from .blob import whash


@dataclass(frozen=True)
class Verdict:
    kind: str | None  # None | "ReplayDrift" | "ReplayMismatch"
    ratio: float = 0.0


def judge(cls, spec_hash, start, replayed, claimed_hash, claimed=None, tau_drift=0.0, tau_fraud=math.inf) -> Verdict:
    if cls == "exact":
        return Verdict(None if whash(spec_hash, replayed) == claimed_hash else "ReplayMismatch")
    # The ratio is only meaningful if the claimed bytes are the ones the node committed to.
    if claimed is None or whash(spec_hash, claimed) != claimed_hash:
        return Verdict("ReplayMismatch", math.inf)
    c = claimed.astype(np.float64)
    ratio = norm64(replayed.astype(np.float64) - c) / max(norm64(c - start.astype(np.float64)), 1e-30)
    if ratio <= tau_drift:
        return Verdict(None, ratio)
    return Verdict("ReplayDrift" if ratio <= tau_fraud else "ReplayMismatch", ratio)
