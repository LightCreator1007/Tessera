"""Gas top-up: only a joined operator of a World ID owner, only up to the target, with a cooldown and a per-human cap."""
import hashlib
import os
import sqlite3
import sys
import tempfile
import time
from pathlib import Path

import pytest
from eth_account import Account
from eth_account.messages import encode_defunct

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("DB_PATH", os.path.join(tempfile.mkdtemp(prefix="tod-id-"), "test.db"))

OWNER, OTHER = Account.create().address, Account.create().address


class FakeChain:
    def __init__(self):
        self.nodes, self.balances, self.sent = {}, {}, []

    def node(self, op):
        return self.nodes.get(op, (False, "0x" + "00" * 20))

    def balance(self, op):
        return self.balances.get(op, 0)

    def send(self, op, wei):
        self.sent.append((op, wei))
        self.balances[op] = self.balance(op) + wei
        return "0x" + "ab" * 32


@pytest.fixture
def setup():
    from identity import topup
    db = sqlite3.connect(":memory:", check_same_thread=False)  # the route runs in a worker thread
    db.execute("CREATE TABLE humans (nullifier TEXT PRIMARY KEY, owner TEXT, credential TEXT, seen INTEGER)")
    db.execute("INSERT INTO humans VALUES ('0x01', ?, 'orb', 0)", (OWNER,))
    clock = [1_000_000.0]
    chain = FakeChain()
    return topup, chain, topup.Topups(db, chain, now=lambda: clock[0]), clock


def operator_of(chain, owner):
    op = Account.create().address
    chain.nodes[op] = (True, owner)
    return op


def test_tops_up_to_the_target_once_then_waits(setup):
    topup, chain, t, clock = setup
    op = operator_of(chain, OWNER)
    chain.balances[op] = 10**14
    assert t.grant(op)["sent"] == topup.TARGET_WEI - 10**14
    assert t.grant(op)["sent"] == 0  # funded now, so nothing more is sent
    chain.balances[op] = 0
    with pytest.raises(topup.Refused) as e:
        t.grant(op)
    assert e.value.status == 429
    clock[0] += topup.COOLDOWN
    assert t.grant(op)["sent"] == topup.TARGET_WEI


def test_the_cap_is_per_human_not_per_operator(setup):
    topup, chain, t, clock = setup
    for _ in range(topup.CAP_WEI // topup.TARGET_WEI):
        t.grant(operator_of(chain, OWNER))
        clock[0] += topup.COOLDOWN
    with pytest.raises(topup.Refused, match="allowance is used up"):
        t.grant(operator_of(chain, OWNER))
    assert sum(w for _, w in chain.sent) == topup.CAP_WEI


def test_only_joined_operators_of_verified_owners(setup):
    topup, chain, t, _ = setup
    with pytest.raises(topup.Refused, match="not joined the registry"):
        t.grant(Account.create().address)
    with pytest.raises(topup.Refused, match="World ID"):
        t.grant(operator_of(chain, OTHER))
    assert chain.sent == []


def test_route_needs_the_operator_signature(setup, monkeypatch):
    topup, chain, t, _ = setup
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from identity import router as identity
    app = FastAPI()
    app.include_router(identity.router)
    client = TestClient(app)
    monkeypatch.setattr(identity, "topups", t)
    op = Account.create()
    chain.nodes[op.address] = (True, OWNER)

    def headers(signer, ts=None):
        ts = ts or int(time.time())
        msg = f"POST\n/v1/identity/topup\n{ts}\n{hashlib.sha256(b'').hexdigest()}"
        sig = signer.sign_message(encode_defunct(text=msg)).signature
        return {"X-Operator": op.address, "X-Timestamp": str(ts), "X-Signature": "0x" + sig.hex().removeprefix("0x")}

    assert client.post("/v1/identity/topup", headers=headers(Account.create())).status_code == 401
    r = client.post("/v1/identity/topup", headers=headers(op))
    assert r.status_code == 200 and r.json()["sent"] == topup.TARGET_WEI
    assert client.post("/v1/identity/topup", headers=headers(op)).json()["sent"] == 0
