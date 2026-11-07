"""Demo bypass: off by default, then any wallet can skip World ID once, under the same one-wallet-one-person rules."""
import os
import sys
import tempfile
from pathlib import Path

import pytest
from eth_account import Account

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("DB_PATH", os.path.join(tempfile.mkdtemp(prefix="tod-id-"), "test.db"))


@pytest.fixture
def identity(monkeypatch):
    from identity import router

    monkeypatch.setattr(router, "BYPASS", True)
    return router


@pytest.fixture
def client(identity):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    app = FastAPI()
    app.include_router(identity.router)
    return TestClient(app)


def bypass(client, owner):
    return client.post("/v1/identity/bypass", json={"owner": owner})


def test_bypass_is_off_unless_switched_on(identity, client, monkeypatch):
    monkeypatch.setattr(identity, "BYPASS", False)
    assert client.get("/v1/identity/config").json()["walletBypass"] is False
    assert bypass(client, Account.create().address).status_code == 403


def test_config_tells_the_site_when_it_is_on(client):
    assert client.get("/v1/identity/config").json()["walletBypass"] is True


def test_bypassed_wallet_reads_as_verified_and_can_repeat(client):
    owner = Account.create().address
    first = bypass(client, owner)
    assert first.status_code == 200 and first.json()["credential"] == "dev"
    status = client.get(f"/v1/identity/owners/{owner}").json()
    assert status["verified"] is True and status["credential"] == "dev"
    assert bypass(client, owner).json()["nullifier"] == first.json()["nullifier"]


def test_wallet_with_a_world_id_is_refused(identity, client):
    owner = Account.create().address
    identity.record_human(owner, "0x" + "22" * 32, "orb", joined=False)
    assert bypass(client, owner).status_code == 409


def test_bad_address_is_refused(client):
    assert bypass(client, "nope").status_code == 400
