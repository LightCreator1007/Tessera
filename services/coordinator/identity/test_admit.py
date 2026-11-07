"""Team admission: admin only, counts as one verified person, lets that wallet join without a proof, one wallet each."""
import os
import sys
import tempfile
from pathlib import Path

import pytest
from eth_account import Account

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("DB_PATH", os.path.join(tempfile.mkdtemp(prefix="tod-id-"), "test.db"))

TOKEN = "t" * 32


@pytest.fixture
def client(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from api import auth, config
    from identity import router as identity

    monkeypatch.setattr(auth, "LOCAL_HOSTS", auth.LOCAL_HOSTS | {"testclient"})
    monkeypatch.setattr(config, "ADMIN_TOKEN", TOKEN)
    app = FastAPI()
    app.include_router(identity.router)
    return TestClient(app)


def admit(client, owner, token=TOKEN):
    return client.post("/v1/identity/admit", headers={"Authorization": f"Bearer {token}"}, json={"owner": owner})


def test_admit_needs_the_admin_token(client):
    assert admit(client, Account.create().address, token="wrong").status_code in (401, 403)


def test_admitted_wallet_reads_as_verified(client):
    owner = Account.create().address
    assert admit(client, owner).status_code == 201
    status = client.get(f"/v1/identity/owners/{owner}").json()
    assert status["verified"] is True and status["credential"] == "dev"
    assert admit(client, owner).status_code == 201  # repeating it is harmless


def test_admit_refuses_a_wallet_with_another_world_id(client):
    from identity import router as identity

    owner = Account.create().address
    identity.record_human(owner, "0x" + "11" * 32, "orb", joined=False)
    assert admit(client, owner).status_code == 409
