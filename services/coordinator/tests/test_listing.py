"""Host listing edits: only the host signs them, rules freeze on the first entry, banners must be images, environments validate."""
import base64
import hashlib
import json
import time

import pytest
from eth_account import Account
from eth_account.messages import encode_defunct
from fastapi.testclient import TestClient

import competitions as C
from api import config
from api import listing as L

HOST, OTHER = Account.create(), Account.create()
PNG = b"\x89PNG\r\n\x1a\n" + b"\0" * 32


@pytest.fixture
def comp(monkeypatch):
    state = {"now": 50, "deadline": 100, "entries": 0, "host": HOST.address}
    monkeypatch.setattr(config, "COMPETITIONS", "0x" + "c" * 40)
    monkeypatch.setattr(config, "TOD_NETWORK", "anvil")
    monkeypatch.setattr(C, "listing", lambda max_age=C.TTL: [{"id": 3, **state}])
    for t in ("competition_settings", "competition_banners", "competition_resources"):
        L.db.execute(f"DELETE FROM {t}")
    L.db.commit()
    return state


@pytest.fixture
def client():
    from api import app

    return TestClient(app.app)


def signed(acct, what, digest, cid=3):
    at = int(time.time())
    sig = acct.sign_message(encode_defunct(text=L.message(cid, what, acct.address, digest, at))).signature
    return {"host": acct.address, "signedAt": at, "signature": "0x" + bytes(sig).hex()}


def settings(acct, fields):
    payload = json.dumps(fields)
    return {"payload": payload, **signed(acct, "settings", hashlib.sha256(payload.encode()).hexdigest())}


def banner(acct, raw=PNG):
    return {"data": base64.b64encode(raw).decode(), **signed(acct, "banner", hashlib.sha256(raw).hexdigest())}


def resource(acct, spec, raw=b"PK\x03\x04env"):
    text = json.dumps(spec)
    digest = hashlib.sha256((text + "\n" + hashlib.sha256(raw).hexdigest()).encode()).hexdigest()
    return {"spec": text, "data": base64.b64encode(raw).decode(), **signed(acct, "resource", digest)}


ENV = {"name": "cartpole", "kind": "environment", "env": {"entrypoint": "CartPole-v1", "seeds": [1, 2, 3], "episodes": 5}}


def test_host_edits_settings_and_the_history_is_kept(comp, client):
    r = client.post("/v1/competitions/3/settings", json=settings(HOST, {"title": "Digits", "rules": "Accuracy", "tags": ["vision"]}))
    assert r.status_code == 201 and r.json()["version"] == 1
    client.post("/v1/competitions/3/settings", json=settings(HOST, {"title": "Digits v2", "rules": "Accuracy"}))
    got = client.get("/v1/competitions/3/settings").json()
    assert got["current"]["title"] == "Digits v2" and len(got["history"]) == 2


def test_only_the_host_and_only_valid_settings(comp, client):
    post = lambda b: client.post("/v1/competitions/3/settings", json=b).status_code  # noqa: E731
    assert post(settings(OTHER, {"title": "x"})) == 403
    assert post(settings(HOST, {"links": [{"url": "javascript:alert(1)"}]})) == 422
    assert post(settings(HOST, {"notebookRules": "always"})) == 422
    bad = settings(HOST, {"title": "x"})
    bad["payload"] = json.dumps({"title": "swapped"})
    assert post(bad) == 401
    comp["now"] = 100
    assert post(settings(HOST, {"title": "late"})) == 409


def test_rules_freeze_on_the_first_entry_but_the_title_doesnt(comp, client):
    client.post("/v1/competitions/3/settings", json=settings(HOST, {"title": "A", "rules": "Accuracy"}))
    comp["entries"] = 1
    r = client.post("/v1/competitions/3/settings", json=settings(HOST, {"title": "A", "rules": "Top-3"}))
    assert r.status_code == 409 and r.json()["detail"]["fields"] == ["rules"]
    assert client.post("/v1/competitions/3/settings", json=settings(HOST, {"title": "B", "rules": "Accuracy"})).status_code == 201


def test_banner_must_be_an_image_and_is_served_back(comp, client):
    assert client.post("/v1/competitions/3/banner", json=banner(HOST, b"<svg onload=alert(1)>")).status_code == 415
    assert client.post("/v1/competitions/3/banner", json=banner(OTHER)).status_code == 403
    assert client.post("/v1/competitions/3/banner", json=banner(HOST)).status_code == 201
    r = client.get("/v1/competitions/3/banner")
    assert r.content == PNG and r.headers["content-type"] == "image/png"
    assert L.decorate({"id": 3})["banner"]["contentType"] == "image/png"


def test_environment_validates_and_freezes(comp, client):
    assert client.post("/v1/competitions/3/resources", json=resource(HOST, {**ENV, "env": {"entrypoint": "x", "seeds": []}})).status_code == 422
    r = client.post("/v1/competitions/3/resources", json=resource(HOST, ENV))
    assert r.status_code == 201 and r.json()["env"]["metric"] == "mean-return"
    assert client.get("/v1/competitions/3/resources/cartpole").content == b"PK\x03\x04env"
    comp["entries"] = 1
    assert client.post("/v1/competitions/3/resources", json=resource(HOST, ENV, b"changed")).status_code == 409
    starter = {"name": "starter kit", "kind": "starter"}
    assert client.post("/v1/competitions/3/resources", json=resource(HOST, starter)).status_code == 201
    assert [x["name"] for x in client.get("/v1/competitions/3/resources").json()] == ["cartpole", "starter kit"]
