"""Merge: trimming counts, outlier handling, determinism, outer step."""
import random

import numpy as np

from tod_core.aggregate import Outer, merge
from tod_core.blob import k256, whash

G = np.zeros(4, np.float32)


def ops(n):
    return ["0x" + f"{i + 1:040x}" for i in range(n)]


def test_no_updates_returns_start():
    r = merge(G, [])
    assert np.array_equal(r.w_new, G) and r.trim == 0


def test_one_and_two_updates_no_trim():
    a, b = np.full(4, 1.0, np.float32), np.full(4, 3.0, np.float32)
    assert merge(G, [(ops(1)[0], a)]).trim == 0
    r = merge(G, list(zip(ops(2), [a, b])))
    # Median of norms 2 and 6 is 4, so b is clipped to norm 4 (value 2): mean of 1 and 2.
    assert r.trim == 0 and np.allclose(r.w_new, 1.5)


def test_trim_counts():
    w = np.ones(4, np.float32)
    assert [merge(G, [(o, w) for o in ops(n)]).trim for n in (3, 6, 10)] == [1, 1, 2]


def test_outlier_trimmed():
    ups = [(o, np.ones(4, np.float32)) for o in ops(5)] + [(ops(6)[5], np.full(4, 1000.0, np.float32))]
    assert np.allclose(merge(G, ups).w_new, 1.0, atol=1e-6)


def test_order_independent_bytes():
    rng = np.random.default_rng(1)
    ups = [(o, rng.standard_normal(4).astype(np.float32)) for o in ops(7)]
    sh = k256(b"t")
    shuffled = ups[:]
    random.Random(2).shuffle(shuffled)
    assert whash(sh, merge(G, ups).w_new) == whash(sh, merge(G, shuffled).w_new)


def test_nesterov_matches_formula():
    ups = [(o, np.array([1.0, 2.0, 3.0, 4.0], np.float32)) for o in ops(2)]
    m_prev = np.full(4, 0.5)
    r = merge(G, ups, Outer("nesterov", lr=0.7, momentum=0.9), m_prev)
    delta = np.array([1.0, 2.0, 3.0, 4.0])
    m = 0.9 * m_prev + delta
    assert np.array_equal(r.m_new, m)
    assert np.array_equal(r.w_new, (0.7 * (0.9 * m + delta)).astype(np.float32))
