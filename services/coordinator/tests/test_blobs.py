"""Blob routes: BlobAccess signatures, roles, expiry, the signed 404, and the store's boot self-test."""
import time

import pytest
from eth_account import Account
from eth_account.messages import encode_defunct
from eth_utils import keccak
from fastapi.testclient import TestClient

from api import app as A, auth, blobs, config, tables as T
from api.models import Job, Round

OP, REQ, STRANGER = Account.create(), Account.create(), Account.create()
DATA = b"weights" * 100
H = "0x" + keccak(DATA).hex()
URL = f"/v1/blobs/{H}"
c = TestClient(A.app)


@pytest.fixture(autouse=True)
def job(monkeypatch):
    monkeypatch.setitem(T.JOBS, 1, Job(id=1, status="running", workload="mlp-exact/1", requester=REQ.address,
                                       budget=100, remaining=100, rounds=10, currentRound=0,
                                       stakePerNode=15_000_000, modelSpecHash=H))
    monkeypatch.setitem(T.ROUNDS, 1, {1: Round(job=1, round=1, status="open", startHash=H, aggregateHash=None,
                                               roster=[{"op": OP.address, "shard": 0}], committed=[], revealed=[],
                                               seed=None, confirmed=[], outcome=None, payouts=[])})


def access(acct, h, method, expiry=None, job=1, rnd=1):
    """Headers for a request signed by `acct`."""
    expiry = expiry or int(time.time()) + 60
    sig = acct.sign_message(auth.blob_access_signable(job, rnd, h, method, expiry)).signature
    return {"X-Job": str(job), "X-Round": str(rnd), "X-Expiry": str(expiry), "X-Signature": "0x" + sig.hex()}


def test_put_then_every_role_can_read(verifier):
    assert c.head(URL).status_code == 404
    assert c.put(URL, content=DATA, headers=access(OP, H, "PUT")).status_code == 201
    assert c.head(URL).status_code == 200
    for who in (OP, REQ, verifier):
        r = c.get(URL, headers=access(who, H, "GET"))
        assert r.status_code == 200 and keccak(r.content).hex() == H[2:]


def test_put_rejections():
    now = int(time.time())
    assert c.put(URL, content=DATA + b"x", headers=access(OP, H, "PUT")).status_code == 400  # body does not hash to H
    assert c.head("/v1/blobs/0x" + keccak(DATA + b"x").hex()).status_code == 404  # and nothing was written
    assert c.put(URL, content=DATA, headers=access(STRANGER, H, "PUT")).status_code == 403  # no role in the job
    assert c.put(URL, content=DATA, headers=access(OP, H, "GET")).status_code == 403  # signed for another method
    assert c.put(URL, content=DATA, headers=access(OP, H, "PUT", rnd=2)).status_code == 403  # round 2 has no roster
    assert c.put(URL, content=DATA, headers=access(OP, H, "PUT", expiry=now - 1)).status_code == 401
    assert c.put(URL, content=DATA, headers=access(OP, H, "PUT", expiry=now + 3600)).status_code == 401
    forged = dict(access(OP, H, "PUT"), **{"X-Signature": "0x" + "00" * 65})
    assert c.put(URL, content=DATA, headers=forged).status_code == 401
    assert c.put(URL, content=DATA, headers={}).status_code == 422


def test_put_too_large(monkeypatch):
    monkeypatch.setattr(config, "MAX_BLOB_BYTES", 10)
    assert c.put(URL, content=DATA, headers=access(OP, H, "PUT")).status_code == 413


def test_get_needs_a_role_and_a_missing_blob_gets_a_signed_404():
    missing = "0x" + "ab" * 32
    assert c.get(f"/v1/blobs/{missing}", headers=access(STRANGER, missing, "GET")).status_code == 403
    r = c.get(f"/v1/blobs/{missing}", headers=access(OP, missing, "GET"))
    assert r.status_code == 404
    body = r.json()
    sig = body.pop("signature")
    raw = b'{"absent":true,"block":null,"hash":"%s"}' % missing.encode()
    assert Account.recover_message(encode_defunct(raw), signature=sig) == config.COORDINATOR


def test_store_self_test_runs_at_startup():
    blobs.store.self_test()
    with TestClient(A.app) as client:  # entering the client runs the lifespan boot check
        assert client.get("/v1/health").json()["storeOk"]
