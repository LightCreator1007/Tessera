"""Canonicaliser: tabular CSV, image .npz, regression, the rejection rules, hashing, splits and row lists."""
import numpy as np
import pytest

from tod_core.blob import k256
from tod_datasets.canonical import DatasetError, canonicalise, cnn_eligible, parse_rows, row_list, split

rng = np.random.default_rng(0)


def write_csv(path, X, y, header=True):
    rows = [",".join(f"{v:.6g}" for v in r) + f",{t}" for r, t in zip(X, y)]
    path.write_text(("a," * X.shape[1] + "label\n" if header else "") + "\n".join(rows) + "\n")
    return path


def test_tabular_csv(tmp_path):
    X, y = rng.random((1200, 5)), rng.integers(0, 3, 1200)
    c = canonicalise(write_csv(tmp_path / "t.csv", X, y))
    assert c.X.dtype == np.float32 and c.X.shape == (1200, 5) and c.y.dtype == np.int64
    assert c.card.task == "classification" and c.card.classes == 3 and c.card.x_shape == (5,)
    assert sorted(c.y.tolist()) == sorted(y.tolist())


def test_csv_without_header_matches(tmp_path):
    X, y = rng.random((1000, 3)), rng.integers(0, 2, 1000)
    a = canonicalise(write_csv(tmp_path / "a.csv", X, y, header=True))
    b = canonicalise(write_csv(tmp_path / "b.csv", X, y, header=False))
    assert a.card.hash == b.card.hash


def test_image_npz_keeps_uint8_and_is_cnn_eligible(tmp_path):
    p = tmp_path / "img.npz"
    np.savez(p, X=rng.integers(0, 256, (1000, 28, 28), dtype=np.uint8), y=rng.integers(0, 10, 1000))
    c = canonicalise(p)
    assert c.X.dtype == np.uint8 and c.card.x_shape == (28, 28) and c.card.x_dtype == "uint8"
    assert cnn_eligible(c.card.x_shape) and not cnn_eligible((5,)) and cnn_eligible((32, 32, 3))
    assert not cnn_eligible((128, 128, 3)) and not cnn_eligible((32, 32, 4))


def test_regression(tmp_path):
    p = tmp_path / "r.npz"
    np.savez(p, X=rng.random((1500, 4)), y=rng.random(1500))
    c = canonicalise(p)
    assert c.card.task == "regression" and c.card.classes is None and c.y.dtype == np.float32


def test_labels_remapped_to_range(tmp_path):
    p = tmp_path / "l.npz"
    np.savez(p, X=rng.random((1000, 2)), y=np.repeat([7, 42], 500))
    assert set(canonicalise(p).y.tolist()) == {0, 1}


def test_hash_stable_and_content_sensitive(tmp_path):
    X, y = rng.random((1000, 3)).astype(np.float32), rng.integers(0, 2, 1000)
    np.savez(tmp_path / "a.npz", X=X, y=y)
    np.savez(tmp_path / "b.npz", X=X.copy(), y=y.copy())
    X2 = X.copy()
    X2[0, 0] += 1
    np.savez(tmp_path / "c.npz", X=X2, y=y)
    ha, hb, hc = (canonicalise(tmp_path / f"{n}.npz").card.hash for n in "abc")
    assert ha == hb != hc and ha.startswith("0x") and len(ha) == 66


@pytest.mark.parametrize("make", [
    lambda X, y: (np.where(np.arange(X.size).reshape(X.shape) == 3, np.nan, X), y),
    lambda X, y: (np.where(np.arange(X.size).reshape(X.shape) == 3, np.inf, X), y),
    lambda X, y: (X[:999], y[:999]),
    lambda X, y: (X, np.arange(len(y)) % 101),
])
def test_rejected(tmp_path, make):
    X, y = make(rng.random((1000, 3)), rng.integers(0, 2, 1000))
    np.savez(tmp_path / "bad.npz", X=X, y=y)
    with pytest.raises(DatasetError):
        canonicalise(tmp_path / "bad.npz", task="classification")


def test_non_numeric_csv_rejected(tmp_path):
    p = tmp_path / "s.csv"
    p.write_text("a,b\n" + "\n".join(["1,x"] * 1000) + "\n")
    with pytest.raises(DatasetError):
        canonicalise(p)


def test_oversize_rejected(tmp_path, monkeypatch):
    p = write_csv(tmp_path / "big.csv", rng.random((1000, 2)), rng.integers(0, 2, 1000))
    monkeypatch.setattr("tod_datasets.canonical.MAX_BYTES", 100)
    with pytest.raises(DatasetError):
        canonicalise(p)


def test_split_layout():
    s = split(1000, n_shards=3, val_frac=0.05, test_frac=0.1)
    assert s["train"] == (0, 850) and s["val"] == (850, 50) and s["test"] == (900, 100)
    assert s["shards"] == [{"start": 0, "len": 284}, {"start": 284, "len": 283}, {"start": 567, "len": 283}]


def test_row_list_roundtrip_and_hash():
    data, h = row_list([3, 7, 70000], train=(0, 70001))
    assert data == bytes.fromhex("00000003" "00000007" "00011170")
    assert h == "0x" + k256(data).hex()
    assert parse_rows(data, h) == [3, 7, 70000]


@pytest.mark.parametrize("rows", [[], [5, 5], [7, 3], [-1], [850]])
def test_row_list_rejects(rows):
    with pytest.raises(DatasetError):
        row_list(rows, train=(0, 850))


def test_parse_rows_rejects_wrong_hash_and_ragged_bytes():
    data, h = row_list([1, 2], train=(0, 10))
    with pytest.raises(DatasetError):
        parse_rows(data, "0x" + "00" * 32)
    with pytest.raises(DatasetError):
        parse_rows(data[:-1], "0x" + k256(data[:-1]).hex())
