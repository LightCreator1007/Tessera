"""Notebook uploads: who may attach one, what's accepted, and that they stay sealed until the deadline."""
import hashlib
import json
import time

import pytest
from eth_account import Account
from eth_account.messages import encode_defunct
from fastapi.testclient import TestClient

import competitions as C
from api import config
from api import notebooks as N

ALICE, BOB = Account.create(), Account.create()
NB = json.dumps({"cells": [{"cell_type": "markdown", "source": ["# How I did it"]}]})


@pytest.fixture
def comp(monkeypatch):
    state = {"now": 50, "deadline": 100, "entrants": [ALICE.address]}
    row = lambda: {"id": 7, **state}  # noqa: E731
    monkeypatch.setattr(config, "COMPETITIONS", "0x" + "c" * 40)
    monkeypatch.setattr(config, "TOD_NETWORK", "anvil")
    monkeypatch.setattr(C, "listing", lambda max_age=C.TTL: [row()])
    N.db.execute("DELETE FROM competition_notebooks")
    N.db.commit()
    return state


@pytest.fixture
def client():
    from api import app

    return TestClient(app.app)


def body(acct, content=NB, name="approach.ipynb", cid=7, signed_at=None, signer=None):
    at = signed_at or int(time.time())
    digest = hashlib.sha256(content.encode()).hexdigest()
    sig = (signer or acct).sign_message(encode_defunct(text=N.message(cid, acct.address, name, digest, at))).signature
    return {"entrant": acct.address, "name": name, "title": "Approach", "content": content, "signedAt": at,
            "signature": "0x" + bytes(sig).hex()}


def test_an_entrant_attaches_and_replaces_while_open(comp, client):
    r = client.post("/v1/competitions/7/notebooks", json=body(ALICE))
    assert r.status_code == 201 and r.json()["revisions"] == 1
    r = client.post("/v1/competitions/7/notebooks", json=body(ALICE, content="print('v2')", name="v2.py"))
    assert r.json()["revisions"] == 2


def test_who_and_what_is_refused(comp, client):
    post = lambda b: client.post("/v1/competitions/7/notebooks", json=b).status_code  # noqa: E731
    assert post(body(BOB)) == 403  # not an entrant
    assert post(body(ALICE, signer=BOB)) == 401  # someone else signed
    assert post(body(ALICE, signed_at=int(time.time()) - N.FRESH - 5)) == 401
    assert post(body(ALICE, name="model.pkl")) == 415
    assert post(body(ALICE, content='{"no": "cells"}')) == 422
    assert post(body(ALICE, content="x" * (N.MAX_BYTES + 1), name="big.md")) == 413
    tampered = body(ALICE)
    tampered["content"] = NB.replace("did", "copied")
    assert post(tampered) == 401  # the signature covers the bytes
    assert client.post("/v1/competitions/9/notebooks", json=body(ALICE, cid=9)).status_code == 404
    comp["now"] = 100
    assert post(body(ALICE)) == 409  # past the deadline


def test_sealed_until_the_deadline_then_public(comp, client):
    client.post("/v1/competitions/7/notebooks", json=body(ALICE))
    sealed = client.get("/v1/competitions/7/notebooks").json()
    assert sealed == {"sealed": True, "count": 1, "opensAt": 100, "notebooks": []}
    r = client.get(f"/v1/competitions/7/notebooks/{ALICE.address}")
    assert r.status_code == 403 and r.json()["detail"]["code"] == "sealed"

    comp["now"] = 101
    listed = client.get("/v1/competitions/7/notebooks").json()
    assert not listed["sealed"] and listed["notebooks"][0]["entrant"] == ALICE.address.lower()
    nb = client.get(f"/v1/competitions/7/notebooks/{ALICE.address}").json()
    assert nb["content"] == NB and nb["kind"] == "ipynb"
    signer = Account.recover_message(encode_defunct(text=nb["message"]), signature=nb["signature"])
    assert signer == ALICE.address  # anyone can check the entrant signed these bytes
    assert client.get(f"/v1/competitions/7/notebooks/{BOB.address}").status_code == 404


def test_off_when_there_is_no_contract(client, monkeypatch):
    monkeypatch.setattr(config, "COMPETITIONS", "")
    assert client.get("/v1/competitions/7/notebooks").status_code == 503
