"""Blob format rules and the cross-language vector in vectors/kernel/blob.json."""
import json
import pathlib
import sys

import numpy as np
import pytest

from tod_core.blob import BlobError, from_blob, k256, to_blob, whash

SH = k256(b"tod-test")
VEC = pathlib.Path(__file__).parents[3] / "vectors" / "kernel" / "blob.json"


def cases():
    return {
        "empty": np.zeros(0, np.float32),
        "signed-zero": np.array([1.0, -0.0, 2.5], np.float32),
        "random-1000": np.random.default_rng(0).standard_normal(1000).astype(np.float32),
    }


def test_header_and_length():
    b = to_blob(SH, np.ones(5, np.float32))
    assert b[:32] == SH and b[32:36] == b"\x01\x00\x00\x00" and len(b) == 36 + 20


def test_roundtrip():
    w = cases()["random-1000"]
    assert np.array_equal(from_blob(SH, to_blob(SH, w), 1000), w)


def test_negative_zero_cleared():
    assert to_blob(SH, np.array([-0.0], np.float32))[36:] == b"\x00\x00\x00\x00"


@pytest.mark.parametrize("bad", [np.nan, np.inf, -np.inf])
def test_non_finite_rejected_on_write(bad):
    with pytest.raises(BlobError):
        to_blob(SH, np.array([1.0, bad], np.float32))


def test_non_finite_rejected_on_read():
    raw = SH + b"\x01\x00\x00\x00" + np.array([np.inf], "<f4").tobytes()
    with pytest.raises(BlobError):
        from_blob(SH, raw, 1)


def test_wrong_spec_hash_and_length():
    b = to_blob(SH, np.ones(3, np.float32))
    with pytest.raises(BlobError):
        from_blob(k256(b"other"), b, 3)
    with pytest.raises(BlobError):
        from_blob(SH, b, 4)


def test_vector():
    want = json.loads(VEC.read_text())
    assert want["specHash"] == SH.hex()
    for name, w in cases().items():
        assert want["cases"][name]["weights"] == w.astype("<f4").tobytes().hex()
        assert want["cases"][name]["hash"] == whash(SH, w).hex()


if __name__ == "__main__" and "--write" in sys.argv:
    VEC.write_text(json.dumps({"specHash": SH.hex(), "cases": {
        n: {"weights": w.astype("<f4").tobytes().hex(), "hash": whash(SH, w).hex()} for n, w in cases().items()}}, indent=1) + "\n")
