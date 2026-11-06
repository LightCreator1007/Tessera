"""Owner exclusion: only on verifier-confirmed failures, out of rosters and admission, kept across restarts, liftable."""
import os
import sys
import tempfile
from pathlib import Path

import pytest
from eth_account import Account

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("DB_PATH", os.path.join(tempfile.mkdtemp(prefix="tod-id-"), "test.db"))

CHEAT, HONEST = Account.create().address, Account.create().address
OP_CHEAT, OP_NEW, OP_HONEST = (Account.create().address for _ in range(3))
TOKEN = "t" * 32


class FakeChain:
    nodes = {OP_CHEAT: (True, CHEAT), OP_NEW: (True, CHEAT), OP_HONEST: (True, HONEST)}
    confirmations = {(1, 2, OP_CHEAT): 3}  # ReplayMismatch confirmed by both verifiers

    def node(self, op):
        return self.nodes.get(op, (False, "0x" + "00" * 20))

    def confirmed(self, job, rnd, op):
        return self.confirmations.get((job, rnd, op), 0)


@pytest.fixture
def api(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from api import auth, config
    from identity import router as identity
    from identity.exclusions import Exclusions

    monkeypatch.setattr(auth, "LOCAL_HOSTS", auth.LOCAL_HOSTS | {"testclient"})
    monkeypatch.setattr(config, "ADMIN_TOKEN", TOKEN)
    identity.db.execute("DELETE FROM exclusions")  # the router made the table on import
    for owner, n in ((CHEAT, "0xc0"), (HONEST, "0xh0")):
        identity.db.execute("INSERT OR REPLACE INTO humans VALUES (?, ?, 'orb', 0)", (n, owner))
    monkeypatch.setattr(identity, "exclusions", Exclusions(identity.db, FakeChain()))
    app = FastAPI()
    app.include_router(identity.router)
    return identity, TestClient(app)


def exclude(client, evidence, token=TOKEN):
    return client.post("/v1/identity/exclusions", headers={"Authorization": f"Bearer {token}"},
                       json={"owner": CHEAT, "reason": "replayed different weights twice", "evidence": evidence})


def test_an_unconfirmed_accusation_excludes_nobody(api):
    identity, client = api
    r = exclude(client, [{"job": 1, "round": 3, "operator": OP_CHEAT}])
    assert r.status_code == 422 and "accusation alone" in r.json()["detail"]
    assert exclude(client, [{"job": 1, "round": 2, "operator": OP_HONEST}]).status_code == 422  # not CHEAT's operator
    assert exclude(client, []).status_code == 422
    assert CHEAT.lower() in identity.credentials()


def test_confirmed_cheater_is_out_of_rosters_and_admission(api):
    identity, client = api
    assert exclude(client, [{"job": 1, "round": 2, "operator": OP_CHEAT}], token="wrong").status_code == 403
    r = exclude(client, [{"job": 1, "round": 2, "operator": OP_CHEAT}])
    assert r.status_code == 201 and r.json()["evidence"][0]["kind"] == "ReplayMismatch"

    creds = identity.credentials()
    assert CHEAT.lower() not in creds and creds[HONEST.lower()] == "orb"  # the honest owner stays eligible
    join = client.post("/v1/identity/join", json={"owner": CHEAT, "pairingCode": "tod-pair:x"})
    assert join.status_code == 403 and "excluded" in join.json()["detail"]  # any operator key, new or old
    with pytest.raises(Exception, match="excluded"):
        identity.exclusions.refuse(Account.create().address, "0xc0")  # the same human behind a fresh wallet

    status = client.get(f"/v1/identity/owners/{CHEAT}").json()
    assert status["excluded"]["reason"] == "replayed different weights twice"
    assert client.get(f"/v1/identity/owners/{HONEST}").json()["excluded"] is None


def test_exclusion_survives_a_restart_and_can_be_lifted(api):
    identity, client = api
    from identity.exclusions import Exclusions
    exclude(client, [{"job": 1, "round": 2, "operator": OP_CHEAT}])
    assert CHEAT.lower() in Exclusions(identity.db, FakeChain()).owners()  # a fresh instance reads the same table

    auth = {"Authorization": f"Bearer {TOKEN}"}
    assert client.delete(f"/v1/identity/exclusions/{CHEAT}", headers=auth).status_code == 200
    assert CHEAT.lower() in identity.credentials()
    assert client.delete(f"/v1/identity/exclusions/{CHEAT}", headers=auth).status_code == 404
