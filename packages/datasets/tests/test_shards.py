"""Shard files: deterministic bytes, keccak checks, the partition covering the data, and the read-only lookup."""
import json

import numpy as np
import pytest

from tod_datasets import shards as S
from tod_datasets.canonical import DatasetError, from_arrays


def dataset(rows=1200, seed=0):
    rng = np.random.default_rng(seed)
    return from_arrays(rng.integers(0, 256, (rows, 4, 4), dtype=np.uint8), rng.integers(0, 3, rows))


def test_same_data_gives_same_bytes():
    a, b = S.partition(dataset(), 3, "0.05", "0.1"), S.partition(dataset(), 3, "0.05", "0.1")
    assert [p.data for p in a] == [p.data for p in b]
    assert all(p.keccak == "0x" + S.k256(p.data).hex() for p in a)


def test_partition_covers_train_and_val():
    c = dataset()
    parts = S.partition(c, 3, "0.05", "0.1")
    train = [p for p in parts if p.part == "train"]
    assert [p.shard for p in train] == [0, 1, 2]
    assert sum(p.len for p in train) == 1200 - 60 - 120
    assert [p.part for p in parts].count("val") == 1 and "test" not in [p.part for p in parts]
    for p in parts:
        X, y = S.parse(p.data, p.keccak)
        assert np.array_equal(X, c.X[p.start:p.start + p.len]) and np.array_equal(y, c.y[p.start:p.start + p.len])


def test_parse_rejects_wrong_bytes():
    p = S.partition(dataset(), 3, "0.05", "0.1")[0]
    with pytest.raises(DatasetError):
        S.parse(p.data[:-1] + bytes([p.data[-1] ^ 1]), p.keccak)


def test_manifest_lists_every_piece():
    c = dataset()
    parts = S.partition(c, 3, "0.05", "0.1")
    m = S.manifest(c.card.hash, parts, {p.keccak: f"{i:064x}" for i, p in enumerate(parts)})
    assert m["datasetHash"] == c.card.hash and len(m["pieces"]) == 4
    assert m["pieces"][0] == {"part": "train", "shard": 0, "piece": 0, "start": 0, "len": parts[0].len, "keccak": parts[0].keccak,
                              "size": len(parts[0].data), "swarmRef": f"{0:064x}"}
    json.dumps(m)  # it goes in an Arkiv payload


def test_rows_view_takes_dataset_row_numbers():
    p = S.partition(dataset(), 3, "0.05", "0.1")[1]
    X, y = S.parse(p.data, p.keccak)
    view = S.Rows(X, p.start)
    rows = np.array([p.start, p.start + 5])
    assert np.array_equal(view[rows], X[[0, 5]])
    with pytest.raises(IndexError):
        view[np.array([p.start - 1])]


def test_fetch_finds_the_job_and_checks_the_download(monkeypatch):
    c = dataset()
    parts = S.partition(c, 3, "0.05", "0.1")
    blobs = {f"{i:064x}": p.data for i, p in enumerate(parts)}
    m = S.manifest(c.card.hash, parts, {p.keccak: f"{i:064x}" for i, p in enumerate(parts)})
    queries = []

    def rpc(url, method, params, access_key=""):
        queries.append(params[0])
        return {"data": [{"key": "0x01", "attributes": [{"name": "payload", "value": "0x" + json.dumps(m).encode().hex()}]}]}

    monkeypatch.setattr(S, "_rpc", rpc)
    monkeypatch.setattr(S, "_get", lambda url: blobs[url.rsplit("/", 1)[-1]])
    got = S.lookup("http://arkiv", "0x" + "cd" * 20, 84532, "0x" + "ab" * 20, 7)
    assert got == m
    assert "job = u64(7)" in queries[0] and "$owner = addr(" in queries[0] and "tod.shards" in queries[0]
    X, y = S.fetch(got, "train", 2, "http://bee")
    assert np.array_equal(X, c.X[parts[2].start:parts[2].start + parts[2].len])
    blobs[f"{2:064x}"] = parts[0].data  # a gateway serving the wrong bytes
    with pytest.raises(DatasetError):
        S.fetch(got, "train", 2, "http://bee")


def test_big_shards_are_cut_into_pieces_on_row_boundaries():
    c = dataset()  # 4x4 uint8 rows plus an int64 label: 24 bytes a row
    parts = S.partition(c, 3, "0.05", "0.1", max_bytes=24 * 100)
    shard0 = [p for p in parts if p.part == "train" and p.shard == 0]
    assert [p.len for p in shard0] == [100, 100, 100, 40] and [p.piece for p in shard0] == [0, 1, 2, 3]
    assert [p.start for p in shard0] == [0, 100, 200, 300]
    assert all(len(p.data) - len(S.MAGIC) - 4 <= 24 * 100 + 200 for p in parts)  # rows within the cap, plus a header
    assert parts == S.partition(c, 3, "0.05", "0.1", max_bytes=24 * 100)


def test_fetch_joins_a_shards_pieces(monkeypatch):
    c = dataset()
    parts = S.partition(c, 3, "0.05", "0.1", max_bytes=24 * 100)
    blobs = {p.keccak[2:]: p.data for p in parts}
    m = S.manifest(c.card.hash, parts, {p.keccak: p.keccak[2:] for p in parts})
    monkeypatch.setattr(S, "_get", lambda url: blobs[url.rsplit("/", 1)[-1]])
    X, y = S.fetch(m, "train", 1, "http://bee")
    lo = next(p.start for p in parts if p.shard == 1 and p.piece == 0)
    assert np.array_equal(X, c.X[lo:lo + 340]) and np.array_equal(y, c.y[lo:lo + 340])


def test_default_piece_cap_is_500_mb():
    assert S.PIECE_BYTES == 500_000_000
