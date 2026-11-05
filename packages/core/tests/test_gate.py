"""Validation gate: pass-through, single culprit excluded, revert when no single exclusion helps."""
import numpy as np

from tod_core.aggregate import Outer, gate

G = np.zeros(4, np.float32)
TARGET = np.ones(4)
A, B = "0x" + "0a" * 20, "0x" + "0b" * 20


def val_loss(w):
    return float(((w - TARGET) ** 2).sum())


def toward(k):
    return (G + k * (TARGET - G)).astype(np.float32)


def test_pass_through():
    r = gate(G, [(A, toward(0.5)), (B, toward(0.4))], Outer(), None, val_loss)
    assert not r.reverted and r.excluded == [] and r.loo == [] and r.loss_new < r.loss_prev


def test_single_poisoner_excluded():
    r = gate(G, [(A, toward(1.0)), (B, toward(-5.0))], Outer(), None, val_loss)
    assert r.excluded == [B] and r.accepted == [A] and not r.reverted
    assert r.loss_new < r.loss_prev and [op for op, _ in r.loo] == [A, B]


def test_revert_when_loo_fails():
    m_prev = np.full(4, 0.3)
    r = gate(G, [(A, toward(-2.0)), (B, toward(-3.0))], Outer(), m_prev, val_loss)
    assert r.reverted and r.accepted == [] and r.excluded == []
    assert np.array_equal(r.w_new, G) and r.m_new is m_prev and len(r.loo) == 2


def test_thresholds_from_args():
    assert not gate(G, [(A, toward(-0.1))], Outer(), None, val_loss, rel_tol=10).reverted
