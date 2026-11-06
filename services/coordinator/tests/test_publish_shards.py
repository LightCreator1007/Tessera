"""Publishing a job's shards: Swarm uploads saved as they go, one Arkiv record per job, and resuming after a crash."""
import json

import numpy as np
import pytest

from api import config
from publish import shards as PS
from tod_datasets import shards as S
from tod_datasets.canonical import from_arrays

MARKET = "0x" + "ab" * 20


def dataset():
    rng = np.random.default_rng(0)
    return from_arrays(rng.integers(0, 256, (1200, 4, 4), dtype=np.uint8), rng.integers(0, 3, 1200))


DATA = dataset()


def spec(n=3):
    from tod_datasets.canonical import split
    return {"data": {"datasetHash": DATA.card.hash, "shards": split(1200, n, "0.05", "0.1")["shards"],
                     "valFrac": "0.05", "testFrac": "0.1"}}


class FakeSwarm:
    def __init__(self):
        self.blobs, self.uploads, self.fail_after = {}, 0, None

    def put(self, data, h):
        if self.fail_after is not None and self.uploads >= self.fail_after:
            raise OSError("bee is down")
        self.uploads += 1
        ref = h[2:]  # any 64-hex reference will do here
        self.blobs[ref] = data
        return ref


class FakeArkiv:
    def __init__(self):
        self.sent, self.existing, self.outcome = [], None, ("ok", "0x" + "ee" * 32)

    def find(self, rec):
        return self.existing

    def sign_create(self, attrs, lifetime):
        self.sent.append(attrs)
        return "0x" + "77" * 32, "0xraw"

    def broadcast(self, raw):
        pass

    def confirm(self, tx):
        return self.outcome


@pytest.fixture
def on(monkeypatch):
    monkeypatch.setattr(config, "ARKIV_ENABLED", True)
    monkeypatch.setattr(config, "SWARM_ENABLED", True)
    monkeypatch.setattr(config, "JOB_MARKET", MARKET)
    PS.db.execute("DELETE FROM shard_sets")
    PS.db.commit()
    return FakeSwarm(), FakeArkiv(), {DATA.card.hash: DATA}.__getitem__


def test_publishes_every_piece_and_one_record(on):
    swarm, arkiv, datasets = on
    PS.enqueue(7, spec())
    assert PS.step(7, arkiv, swarm, datasets) == "pending"
    assert swarm.uploads == 4  # three train shards and the validation slice
    (attrs,) = arkiv.sent
    assert attrs["arkiv.schema"] == "tod.shards" and attrs["job"] == 7 and attrs["jobMarket"] == MARKET
    m = json.loads(attrs["payload"])
    assert [(p["part"], p["shard"]) for p in m["pieces"]] == [("train", 0), ("train", 1), ("train", 2), ("val", None)]
    # A node reading the record gets back bytes that match what anyone can rebuild from the dataset.
    X, y = S.parse(swarm.blobs[m["pieces"][1]["swarmRef"]], m["pieces"][1]["keccak"])
    assert np.array_equal(X, DATA.X[m["pieces"][1]["start"]:][:m["pieces"][1]["len"]])
    assert PS.step(7, arkiv, swarm, datasets) == "indexed"
    assert PS.status(7)["arkivKey"] == "0x" + "ee" * 32


def test_resume_does_not_upload_again(on):
    swarm, arkiv, datasets = on
    PS.enqueue(7, spec())
    swarm.fail_after = 2
    assert PS.step(7, arkiv, swarm, datasets) == "pending" and not arkiv.sent
    PS.db.execute("UPDATE shard_sets SET next_try = 0")
    swarm.fail_after = None
    PS.step(7, arkiv, swarm, datasets)
    assert swarm.uploads == 4 and len(arkiv.sent) == 1


def test_a_flaky_gateway_only_fails_a_set_that_stops_moving(on, monkeypatch):
    swarm, arkiv, datasets = on
    monkeypatch.setattr(PS, "MAX_ATTEMPTS", 2)
    PS.enqueue(7, spec())
    for n in (1, 2, 3):  # one piece lands, then the next fails: progress each time, so never failed for good
        swarm.fail_after = n
        assert PS.step(7, arkiv, swarm, datasets) == "pending"
    # Stuck on the same piece: the failure after the last upload was try 1, so this one is the second in a row.
    assert PS.step(7, arkiv, swarm, datasets) == "failed" and not arkiv.sent


def test_existing_record_is_reused(on):
    swarm, arkiv, datasets = on
    arkiv.existing = "0x" + "aa" * 32
    PS.enqueue(7, spec())
    assert PS.step(7, arkiv, swarm, datasets) == "indexed" and not arkiv.sent


def test_spec_that_does_not_match_the_partition_fails(on):
    swarm, arkiv, datasets = on
    bad = spec()
    bad["data"]["shards"][0]["len"] -= 1
    PS.enqueue(7, bad)
    assert PS.step(7, arkiv, swarm, datasets) == "failed" and swarm.uploads == 0


def test_reverted_create_stops_for_a_human(on):
    swarm, arkiv, datasets = on
    arkiv.outcome = ("reverted", None)
    PS.enqueue(7, spec())
    PS.step(7, arkiv, swarm, datasets)
    assert PS.step(7, arkiv, swarm, datasets) == "failed" and len(arkiv.sent) == 1


def test_off_without_swarm(on, monkeypatch):
    monkeypatch.setattr(config, "SWARM_ENABLED", False)
    PS.enqueue(7, spec())
    assert PS.status(7) is None


def test_record_encodes_as_arkiv_calldata(on):
    from publish import arkiv
    pieces = S.partition(DATA, 3, "0.05", "0.1")
    rec = PS.record(7, S.manifest(DATA.card.hash, pieces, {p.keccak: p.keccak[2:] for p in pieces}))
    assert arkiv.create_calldata(PS.attributes(rec), 1000, salt=1)[:4] == arkiv.EXECUTE
