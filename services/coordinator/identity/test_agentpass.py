"""Agent Pass: ID token validation against a locally signed fixture, and the link → agent pair → owner approval flow."""
import base64
import json
import os
import sys
import tempfile
import time
from pathlib import Path

import pytest
from Crypto.Hash import SHA256
from Crypto.PublicKey import RSA
from Crypto.Signature import pkcs1_15
from eth_account import Account
from eth_account.messages import encode_defunct
from tod_core import encodings as enc

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("DB_PATH", os.path.join(tempfile.mkdtemp(prefix="tod-ap-"), "test.db"))

KEY = RSA.generate(2048)
ISS, AUD = "https://sandbox.auth.world.org", "client-test"


def b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


JWKS = {"keys": [{"kty": "RSA", "kid": "k1", "n": b64(KEY.n.to_bytes(256, "big")), "e": b64(KEY.e.to_bytes(3, "big"))}]}


def token(sub="sub-alice", key=KEY, kid="k1", **over):
    now = int(time.time())
    claims = {"iss": ISS, "aud": AUD, "sub": sub, "exp": now + 300, "iat": now, "auth_time": now,
              "acr": "https://world.org/oidc/acr/orb", "amr": ["pop", "iris"], **over}
    h = b64(json.dumps({"alg": "RS256", "kid": kid}).encode())
    p = b64(json.dumps(claims).encode())
    return f"{h}.{p}." + b64(pkcs1_15.new(key).sign(SHA256.new(f"{h}.{p}".encode())))


@pytest.fixture(scope="module", autouse=True)
def mods():
    # Run-time imports: the coordinator's tests/conftest.py sets its env before api.config first loads.
    global ap, identity, config, client
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from api import config
    from identity import agentpass as ap
    from identity import router as identity

    app = FastAPI()
    app.include_router(identity.router)
    client = TestClient(app)


@pytest.fixture
def issuer(monkeypatch):
    """A stub World issuer: start_device hands out codes; `approve` decides what the next poll returns."""
    monkeypatch.setattr(ap, "ISSUER", ISS)
    monkeypatch.setattr(ap, "CLIENT_ID", AUD)
    monkeypatch.setattr(ap, "_jwks", lambda http=None: JWKS)
    monkeypatch.setattr(ap, "start_device", lambda http=None: {
        "device_code": "dc", "user_code": "ABCD-EFGH", "verification_uri_complete": "https://world.example/d?c=1",
        "expires_in": 1200, "interval": 5})
    state = {"next": None}
    def poll(code, http=None):
        nxt = state["next"]
        if isinstance(nxt, Exception):
            raise nxt
        return nxt
    monkeypatch.setattr(ap, "poll_device", poll)
    return state


def test_verify_id_token_accepts_world_shaped_token(monkeypatch):
    monkeypatch.setattr(ap, "ISSUER", ISS)
    monkeypatch.setattr(ap, "CLIENT_ID", AUD)
    assert ap.verify_id_token(token(), JWKS, not_before=int(time.time()) - 5)["sub"] == "sub-alice"


@pytest.mark.parametrize("tok,why", [
    (lambda: token(key=RSA.generate(2048)), "signature"),
    (lambda: token(kid="other"), "unknown key"),
    (lambda: token(aud="someone-else"), "another issuer or client"),
    (lambda: token(iss="https://evil.example"), "another issuer or client"),
    (lambda: token(exp=int(time.time()) - 600), "expired"),
    (lambda: token(auth_time=int(time.time()) - 3600), "older than this request"),
    (lambda: token(acr=None), "missing acr"),
    (lambda: "not.a.jwt", "malformed"),
])
def test_verify_id_token_rejects(tok, why, monkeypatch):
    monkeypatch.setattr(ap, "ISSUER", ISS)
    monkeypatch.setattr(ap, "CLIENT_ID", AUD)
    with pytest.raises(ap.Blocked, match=why):
        ap.verify_id_token(tok(), JWKS, not_before=int(time.time()) - 5)


def joined_owner(monkeypatch):
    """A fresh owner who joined in dev mode (so the humans table has their nullifier)."""
    monkeypatch.setattr(identity, "MODE", "dev")
    owner = Account.create()
    op = Account.create()
    r = client.post("/v1/identity/join", json={"owner": owner.address, "pairingCode": pairing(op, owner.address)})
    assert r.status_code == 200, r.text
    return owner


def pairing(op, owner):
    deadline = int(time.time()) + 1800
    msg = {"owner": owner, "operator": op.address, "consentDeadline": deadline}
    sig = enc.sign(op.key, "Consent", config.CHAIN_ID, config.NODE_REGISTRY, msg)
    body = json.dumps({"consentDeadline": deadline, "operator": op.address, "owner": owner, "signature": "0x" + sig.hex()},
                      sort_keys=True, separators=(",", ":")).encode()
    return identity.PAIR_PREFIX + b64(body)


def link(owner, issuer, sub="sub-alice"):
    expiry = int(time.time()) + 120
    sig = Account.sign_message(encode_defunct(text=identity.link_message(owner.address, expiry)), owner.key).signature
    r = client.post("/v1/identity/agent/link", json={"owner": owner.address, "expiry": expiry, "ownerSig": "0x" + sig.hex()})
    assert r.status_code == 200, r.text
    issuer["next"] = token(sub=sub)
    return client.post(f"/v1/identity/agent/{r.json()['pendingId']}/poll")


def test_agent_pairing_needs_the_owners_fresh_approval_and_runs_once(monkeypatch, issuer):
    owner = joined_owner(monkeypatch)
    assert link(owner, issuer).json()["status"] == "linked"

    op = Account.create()
    pend = client.post("/v1/identity/agent/pair", json={"owner": owner.address, "pairingCode": pairing(op, owner.address)})
    assert pend.status_code == 200 and pend.json()["userCode"] == "ABCD-EFGH"
    pid = pend.json()["pendingId"]
    issuer["next"] = None
    assert client.post(f"/v1/identity/agent/{pid}/poll").json()["status"] == "pending"
    issuer["next"] = token(sub="sub-alice")
    out = client.post(f"/v1/identity/agent/{pid}/poll")
    assert out.status_code == 200 and out.json()["operator"] == op.address
    invite = {"operator": op.address, "owner": owner.address, "nullifier": bytes.fromhex(out.json()["nullifier"][2:]),
              "deadline": out.json()["inviteDeadline"]}
    assert enc.recover("Invite", config.CHAIN_ID, config.NODE_REGISTRY, invite,
                       bytes.fromhex(out.json()["inviteSig"][2:])) == identity.ADMITTER.address
    assert client.post(f"/v1/identity/agent/{pid}/poll").status_code == 409  # approved once, never replayed


def test_agent_pairing_blocked_paths(monkeypatch, issuer):
    owner = joined_owner(monkeypatch)
    pend = lambda: client.post("/v1/identity/agent/pair", json={"owner": owner.address,
                                                               "pairingCode": pairing(Account.create(), owner.address)})
    assert pend().status_code == 403  # not linked yet: no agent pairing at all
    link(owner, issuer)

    pid = pend().json()["pendingId"]
    issuer["next"] = token(sub="sub-mallory")  # someone else's World ID approves
    r = client.post(f"/v1/identity/agent/{pid}/poll")
    assert r.status_code == 403 and "different World ID" in r.json()["detail"]
    assert client.post(f"/v1/identity/agent/{pid}/poll").status_code == 409  # stays blocked

    pid = pend().json()["pendingId"]
    issuer["next"] = ap.Blocked("World ID approval ended: access_denied")  # the owner taps Deny
    r = client.post(f"/v1/identity/agent/{pid}/poll")
    assert r.status_code == 403 and "access_denied" in r.json()["detail"]


def test_link_needs_owner_wallet_signature_and_one_subject(monkeypatch, issuer):
    owner = joined_owner(monkeypatch)
    expiry = int(time.time()) + 120
    forged = Account.sign_message(encode_defunct(text=identity.link_message(owner.address, expiry)), Account.create().key)
    r = client.post("/v1/identity/agent/link",
                    json={"owner": owner.address, "expiry": expiry, "ownerSig": "0x" + forged.signature.hex()})
    assert r.status_code == 403
    assert link(owner, issuer, sub="sub-a").json()["status"] == "linked"
    assert link(owner, issuer, sub="sub-b").status_code == 403  # never merge two World accounts
