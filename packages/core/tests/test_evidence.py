"""Canonical evidence JSON: key order, no floats, f64hex, and pinned pay-evidence bytes."""
import pytest

from tod_core import evidence, payout

A, B = "0x" + "0b" * 20, "0x" + "0a" * 20


def test_canonical_sorts_keys_and_drops_whitespace():
    assert evidence.canonical({"b": [1, {"d": 2, "c": None}], "a": "x"}) == b'{"a":"x","b":[1,{"c":null,"d":2}]}'


@pytest.mark.parametrize("doc", [{"loss": 0.5}, {"xs": [1, 2.0]}, {"a": {"b": (0.1,)}}])
def test_canonical_refuses_floats_anywhere(doc):
    with pytest.raises(TypeError):
        evidence.canonical(doc)


def test_f64hex_is_the_big_endian_bit_pattern():
    assert evidence.f64hex(1.0) == "3ff0000000000000"
    assert evidence.f64hex(-0.0) == "8000000000000000"


def test_pay_evidence_bytes_are_pinned():
    grad = {A: True, B: False}
    r = payout.equal(11, [A, B], grad, pool=100)
    raw = evidence.canonical(evidence.pay_evidence(3, 7, 11, [A, B], grad, r))
    assert raw == evidence.canonical(evidence.pay_evidence(3, 7, 11, [B, A], grad, r))  # input order is irrelevant
    assert raw == (
        b'{"budget":11,"drip":10,"eligible":["0x0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a",'
        b'"0x0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b"],'
        b'"forfeits":[{"amount":6,"op":"0x0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a"}],'
        b'"graduated":["0x0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b"],"job":3,"mode":"equal",'
        b'"payouts":[{"amount":15,"op":"0x0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b"}],'
        b'"phi":null,"players":null,"round":7,"slice":null,"toPool":6,"vTable":null}'
    )
