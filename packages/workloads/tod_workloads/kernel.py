"""Fixed-order numeric kernel: matmul, column sum, exp and log that give the same bits on every CPU."""
import math

import numpy as np


def mm(A, B):
    # BLAS picks its summation order per CPU; accumulating over the inner dimension in a fixed loop does not.
    acc = np.zeros((A.shape[0], B.shape[1]), A.dtype)
    for t in range(A.shape[1]):
        acc = acc + A[:, t:t + 1] * B[t:t + 1, :]
    return acc


def colsum(A):
    acc = np.zeros(A.shape[1], A.dtype)
    for t in range(A.shape[0]):
        acc = acc + A[t]
    return acc


def rowsum(A):
    acc = A[:, 0].copy()
    for j in range(1, A.shape[1]):
        acc = acc + A[:, j]
    return acc


def rowmax(A):
    acc = A[:, 0].copy()
    for j in range(1, A.shape[1]):
        acc = np.maximum(acc, A[:, j])
    return acc


LN2_HI, LN2_LO, INV_LN2 = 6.93147180369123816490e-01, 1.90821492927058770002e-10, 1.4426950408889634
_EXPC = [1.0 / math.factorial(i) for i in range(13, -1, -1)]
_LOGC = [1.0 / k for k in range(41, 0, -2)]


def exp64(x):
    """exp for float64 x <= 0, from +, *, ldexp only, because libm's exp differs across platforms."""
    k = np.rint(x * INV_LN2)
    r = (x - k * LN2_HI) - k * LN2_LO
    p = np.full_like(r, _EXPC[0])
    for c in _EXPC[1:]:
        p = p * r + c
    return np.ldexp(p, k.astype(np.int32))


def log64(x):
    """log for float64 x > 0 via frexp and the atanh series, for the same reason as exp64."""
    m, e = np.frexp(x)
    # Shift m into [sqrt(1/2), sqrt(2)) so log(x) near 1 doesn't come from cancelling e*ln2 against log(m).
    low = m < 0.7071067811865476
    m, e = np.where(low, 2.0 * m, m), np.where(low, e - 1, e)
    s = (m - 1.0) / (m + 1.0)
    s2 = s * s
    acc = np.full_like(s, _LOGC[0])
    for c in _LOGC[1:]:
        acc = acc * s2 + c
    return e * LN2_HI + (2.0 * s * acc + e * LN2_LO)
