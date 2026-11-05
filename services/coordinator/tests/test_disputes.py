"""Disputes: opened by verifiers only, about a node in the round, and delivered in that node's heartbeat reply."""
import time

import pytest
from eth_account import Account

from api import app as A, config, tables as T
from api.models import Round

V, NODE, OTHER = Account.create(), Account.create(), Account.create()
H = "0x" + "11" * 32
PATH = "/v1/jobs/1/rounds/1/disputes"
BEAT = "/v1/nodes/heartbeat"
HB = {"version": "0.1.0", "busy": True}


@pytest.fixture(autouse=True)
def round_(monkeypatch):
    monkeypatch.setattr(config, "VERIFIERS", [V.address])
    monkeypatch.setitem(T.ROUNDS, 1, {1: Round(job=1, round=1, status="open", startHash=H, aggregateHash=None,
                                               roster=[{"op": NODE.address, "shard": 0}], committed=[], revealed=[],
                                               seed=None, confirmed=[], outcome=None, payouts=[])})
    monkeypatch.setattr(T, "DISPUTES", [])
    monkeypatch.setattr(A, "DISPUTES", T.DISPUTES)


def body(**changes):
    return {"operator": NODE.address, "segments": [1, 2], "deadline": int(time.time()) + 600, **changes}


def test_dispute_reaches_the_node_until_its_deadline(node_post):
    d = node_post(V, PATH, body()).json()
    assert d["verifier"] == V.address and d["job"] == 1 and d["round"] == 1 and d["segments"] == [1, 2]
    reply = node_post(NODE, BEAT, HB).json()
    assert reply["ok"] and reply["disputes"] == [d]
    assert node_post(OTHER, BEAT, HB).json()["disputes"] == []  # only the named node sees it
    T.DISPUTES[0]["deadline"] = int(time.time()) - 1
    assert node_post(NODE, BEAT, HB).json()["disputes"] == []


def test_only_verifiers_open_disputes(node_post):
    assert node_post(OTHER, PATH, body()).status_code == 403
    assert node_post(NODE, PATH, body()).status_code == 403


@pytest.mark.parametrize("path,changes,status", [
    (PATH, {"operator": OTHER.address}, 422),  # not in the roster
    (PATH, {"segments": []}, 422),
    (PATH, {"deadline": 1}, 422),
    ("/v1/jobs/1/rounds/2/disputes", {}, 404),
    ("/v1/jobs/9/rounds/1/disputes", {}, 404),
])
def test_bad_disputes_are_refused_and_not_stored(node_post, path, changes, status):
    assert node_post(V, path, body(**changes)).status_code == status
    assert T.DISPUTES == []
