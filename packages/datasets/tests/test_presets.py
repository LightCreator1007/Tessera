"""Preset parsers on synthetic IDX and CIFAR binary bytes, and the pinned vector file."""
import gzip
import io
import json
import pathlib
import tarfile

import numpy as np
import pytest

from tod_datasets import presets
from tod_datasets.canonical import DatasetError

VEC = pathlib.Path(__file__).parents[3] / "vectors" / "kernel" / "presets.json"
rng = np.random.default_rng(0)


def idx(a: np.ndarray) -> bytes:
    head = b"\x00\x00\x08" + bytes([a.ndim]) + b"".join(d.to_bytes(4, "big") for d in a.shape)
    return head + a.astype(np.uint8).tobytes()


def test_parse_idx_roundtrip_and_rejects_bad_header():
    a = rng.integers(0, 256, (5, 28, 28), dtype=np.uint8)
    assert np.array_equal(presets.parse_idx(idx(a)), a)
    with pytest.raises(DatasetError):
        presets.parse_idx(b"\x00\x00\x0d\x01" + (5).to_bytes(4, "big") + b"\x00" * 20)
    with pytest.raises(DatasetError):
        presets.parse_idx(idx(a)[:-1])


def test_parse_cifar_bin_layout():
    img = rng.integers(0, 256, (2, 3, 32, 32), dtype=np.uint8)
    raw = b"".join(bytes([lab]) + im.tobytes() for lab, im in zip([3, 7], img))
    X, y = presets.parse_cifar_bin(raw)
    assert X.shape == (2, 32, 32, 3) and y.tolist() == [3, 7]
    assert np.array_equal(X[1, :, :, 2], img[1, 2])


def test_mnist_from_synthetic_files(tmp_path):
    files = {}
    for name, n in [("train", 800), ("t10k", 200)]:
        for kind, arr in [("images-idx3", rng.integers(0, 256, (n, 28, 28))), ("labels-idx1", np.arange(n) % 10)]:
            p = tmp_path / f"{name}-{kind}-ubyte.gz"
            p.write_bytes(gzip.compress(idx(arr)))
            files[p.name] = p
    c = presets.mnist(files)
    assert c.card.rows == 1000 and c.card.x_shape == (28, 28) and c.card.classes == 10


def test_cifar_from_synthetic_archive(tmp_path):
    def batch(n):
        return b"".join(bytes([i % 10]) + rng.integers(0, 256, 3072, dtype=np.uint8).tobytes() for i in range(n))
    p = tmp_path / "cifar-10-binary.tar.gz"
    with tarfile.open(p, "w:gz") as tar:
        for name in [f"data_batch_{i}.bin" for i in range(1, 6)] + ["test_batch.bin"]:
            data = batch(200)
            info = tarfile.TarInfo(f"cifar-10-batches-bin/{name}")
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    c = presets.cifar10({p.name: p})
    assert c.card.rows == 1200 and c.card.x_shape == (32, 32, 3) and c.card.x_dtype == "uint8"


def test_sources_are_pinned():
    vec = json.loads(VEC.read_text())
    for name, srcs in presets.SOURCES.items():
        assert all(v is not None for v in srcs.values()), f"{name}: unpinned source"
        assert vec[name]["sources"] == {u.rsplit("/", 1)[1]: h for u, h in srcs.items()}


def test_fetch_downloads_once_and_checks_sha(tmp_path, monkeypatch):
    src = tmp_path / "src.bin"
    src.write_bytes(b"data")
    good = presets.hashlib.sha256(b"data").hexdigest()
    monkeypatch.setitem(presets.SOURCES, "fake", {src.as_uri(): good})
    got = presets.fetch("fake", tmp_path / "cache")
    assert got["src.bin"].read_bytes() == b"data" and not list((tmp_path / "cache").glob("*.part"))
    monkeypatch.setitem(presets.SOURCES, "fake", {src.as_uri(): "00" * 32})
    with pytest.raises(DatasetError):
        presets.fetch("fake", tmp_path / "cache")
