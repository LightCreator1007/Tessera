"""Judge: exact hash equality and tolerance bands."""
import math

import numpy as np

from tod_core.blob import k256, whash
from tod_core.judge import judge

SH = k256(b"t")
START = np.zeros(3, np.float32)
CLAIMED = np.array([1.0, 2.0, 2.0], np.float32)  # |claimed - start| = 3


def test_exact_match_and_one_ulp_mismatch():
    h = whash(SH, CLAIMED)
    assert judge("exact", SH, START, CLAIMED.copy(), h).kind is None
    off = CLAIMED.copy()
    off[0] = np.nextafter(off[0], np.float32(2))
    assert judge("exact", SH, START, off, h).kind == "ReplayMismatch"


def test_tolerance_bands():
    h = whash(SH, CLAIMED)
    kinds = []
    for err in (0.0, 0.015, 1.5):
        replayed = CLAIMED + np.array([err, 0, 0], np.float32)
        kinds.append(judge("tolerance", SH, START, replayed, h, CLAIMED, 1e-3, 0.1).kind)
    assert kinds == [None, "ReplayDrift", "ReplayMismatch"]


def test_inf_fraud_never_slashes():
    h = whash(SH, CLAIMED)
    assert judge("tolerance", SH, START, CLAIMED * 10, h, CLAIMED, 1e-3, math.inf).kind == "ReplayDrift"


def test_claimed_bytes_must_match_hash():
    h = whash(SH, CLAIMED)
    assert judge("tolerance", SH, START, CLAIMED, h, CLAIMED + 1, 1e-3, 0.1).kind == "ReplayMismatch"
