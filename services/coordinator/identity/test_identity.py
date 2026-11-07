"""Tests for POST /v1/identity/join: dev-mode proof, pairing-code checks, one nullifier per human, Invite signature."""
import base64
import json
import os
import sys
import tempfile
import time
from pathlib import Path

import pytest
from eth_account import Account
from tod_core import encodings as enc

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("DB_PATH", os.path.join(tempfile.mkdtemp(prefix="tod-id-"), "test.db"))


@pytest.fixture(scope="module", autouse=True)
def mods():
    # Imported at run time, not collection time: the coordinator's tests/conftest.py must set its env before
    # api.config is first imported, and pytest collects this folder before tests/.
    global config, identity, client
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from api import config
    from identity import router as identity

    app = FastAPI()
    app.include_router(identity.router)
    client = TestClient(app)


def pairing_code(operator, owner, deadline, chain_id=None):
    msg = {"owner": owner, "operator": operator.address, "consentDeadline": deadline}
    sig = enc.sign(operator.key, "Consent", chain_id or config.CHAIN_ID, config.NODE_REGISTRY, msg)
    fields = {"consentDeadline": deadline, "operator": operator.address, "owner": owner, "signature": "0x" + sig.hex()}
    body = json.dumps(fields, sort_keys=True, separators=(",", ":")).encode()
    return identity.PAIR_PREFIX + base64.urlsafe_b64encode(body).decode().rstrip("=")


def join(owner, code):
    return client.post("/v1/identity/join", json={"owner": owner, "pairingCode": code})


@pytest.fixture
def owner():
    return Account.create().address


def test_join_signs_invite_for_join(owner):
    op = Account.create()
    r = join(owner, pairing_code(op, owner, int(time.time()) + 1800))
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["operator"] == op.address and out["credential"] == "dev"
    invite = {"operator": op.address, "owner": owner, "nullifier": bytes.fromhex(out["nullifier"][2:]),
              "deadline": out["inviteDeadline"]}
    signer = enc.recover("Invite", config.CHAIN_ID, config.NODE_REGISTRY, invite, bytes.fromhex(out["inviteSig"][2:]))
    assert signer == identity.ADMITTER.address


def test_rejects_expired_wrong_owner_and_forged_codes(owner):
    op, now = Account.create(), int(time.time())
    assert join(owner, pairing_code(op, owner, now - 1)).status_code == 400
    assert join(owner, pairing_code(op, Account.create().address, now + 1800)).status_code == 400
    assert join(owner, pairing_code(op, owner, now + 1800, chain_id=1)).status_code == 400  # wrong domain
    assert join(owner, "not-a-code").status_code == 400


def test_one_nullifier_per_human_but_many_operators(owner, monkeypatch):
    now = int(time.time())
    assert join(owner, pairing_code(Account.create(), owner, now + 1800)).status_code == 200
    assert join(owner, pairing_code(Account.create(), owner, now + 1800)).status_code == 200
    # A second wallet presenting the same human (same nullifier) is refused.
    other = Account.create().address
    same_human = identity.verify_human
    monkeypatch.setattr(identity, "verify_human", lambda o, p: same_human(owner, p))
    assert join(other, pairing_code(Account.create(), other, now + 1800)).status_code == 409


def test_dev_mode_refused_off_local_chain(owner, monkeypatch):
    monkeypatch.setattr(config, "CHAIN_ID", 84532)
    assert join(owner, pairing_code(Account.create(), owner, int(time.time()) + 1800)).status_code == 403


def test_worldid_mode_records_credential_and_rejects_bad_proofs(owner, monkeypatch):
    from identity import worldid

    monkeypatch.setattr(identity, "MODE", "worldid")
    monkeypatch.setattr(worldid, "verify", lambda proof, o: ("0x" + "77" * 32, "selfie"))
    code = pairing_code(Account.create(), owner, int(time.time()) + 1800)
    r = client.post("/v1/identity/join", json={"owner": owner, "pairingCode": code, "proof": {"x": 1}})
    assert r.status_code == 200 and r.json()["credential"] == "selfie"
    assert identity.credentials()[owner.lower()] == "selfie"

    def rejected(proof, o):
        raise worldid.Rejected("World ID proof was made for a different wallet")
    monkeypatch.setattr(worldid, "verify", rejected)
    r = client.post("/v1/identity/join", json={"owner": owner, "pairingCode": code, "proof": {}})
    assert r.status_code == 400 and "different wallet" in r.json()["detail"]


def test_rp_signature_only_for_our_action(monkeypatch):
    from identity import worldid

    assert client.post("/v1/identity/rp-signature", json={"action": worldid.ACTION}).status_code == 503  # no key
    monkeypatch.setattr(worldid, "RP_SIGNING_KEY", "0x" + "ab" * 32)
    assert client.post("/v1/identity/rp-signature", json={"action": "something-else"}).status_code == 400
    out = client.post("/v1/identity/rp-signature", json={"action": worldid.ACTION}).json()
    assert set(out) == {"sig", "nonce", "created_at", "expires_at"} and out["expires_at"] - out["created_at"] == 300


def test_admitter_key_required_off_local_chain(tmp_path):
    import subprocess

    cwd = Path(__file__).resolve().parents[1]
    code = "from identity import router as r; print(r.ADMITTER.address)"
    base = {**os.environ, "CHAIN_ID": "84532", "DB_PATH": str(tmp_path / "t.db")}
    base.pop("ADMITTER_PRIVATE_KEY", None)
    missing = subprocess.run([sys.executable, "-c", code], cwd=cwd, env=base, capture_output=True, text=True)
    assert missing.returncode != 0 and "ADMITTER_PRIVATE_KEY is required" in missing.stderr
    key = Account.create()
    ok = subprocess.run([sys.executable, "-c", code], cwd=cwd, env={**base, "ADMITTER_PRIVATE_KEY": key.key.hex()},
                        capture_output=True, text=True)
    assert ok.returncode == 0 and ok.stdout.strip() == key.address


def test_dev_chain_falls_back_to_the_admitter_anvil_registers():
    from tod_core.txmgr import dev_key
    if not os.environ.get("ADMITTER_PRIVATE_KEY"):
        assert identity.ADMITTER.address == Account.from_key(dev_key("admitter")).address


def test_an_admitter_the_network_does_not_register_is_refused(tmp_path):
    net = tmp_path / "net.toml"
    net.write_text(f'[roles]\nadmitter = "{Account.create().address}"\n')
    with pytest.raises(RuntimeError, match="joins would revert with BadSignature"):
        identity.check_admitter(str(net))
    net.write_text(f'[roles]\nadmitter = "{identity.ADMITTER.address.lower()}"\n')
    identity.check_admitter(str(net))
    identity.check_admitter(None)


def test_rp_signatures_are_rate_limited(monkeypatch):
    from identity import worldid
    monkeypatch.setattr(worldid, "RP_SIGNING_KEY", "0x" + "ab" * 32)
    monkeypatch.setattr(identity, "rp_limit", identity.RateLimit(3))
    assert client.post("/v1/identity/rp-signature", json={"action": "other"}).status_code == 400  # uses no budget
    codes = [client.post("/v1/identity/rp-signature", json={"action": worldid.ACTION}).status_code for _ in range(4)]
    assert codes == [200, 200, 200, 429]


def test_rate_limit_window_slides():
    t = [0.0]
    lim = identity.RateLimit(2, now=lambda: t[0])
    assert [lim.allow("a"), lim.allow("a"), lim.allow("a"), lim.allow("b")] == [True, True, False, True]
    t[0] = 60
    assert lim.allow("a")


def test_oversized_bodies_are_refused_before_parsing(owner):
    big = {"owner": owner, "pairingCode": "x", "proof": {"pad": "a" * identity.MAX_BODY}}
    assert client.post("/v1/identity/join", json=big).status_code == 413


def test_owner_mismatch_is_refused_without_checking_the_signature(owner):
    body = json.dumps({"consentDeadline": int(time.time()) + 60, "operator": Account.create().address,
                       "owner": Account.create().address, "signature": "0x" + "11" * 65}).encode()
    code = identity.PAIR_PREFIX + base64.urlsafe_b64encode(body).decode().rstrip("=")
    r = join(owner, code)
    assert r.status_code == 400 and "different owner" in r.json()["detail"]


def test_entry_pass_is_signed_for_this_wallet_and_competitions(owner, monkeypatch):
    comps = "0x" + "cc" * 20
    assert client.post("/v1/identity/entry-pass", json={"owner": owner}).status_code == 503  # no contract here
    monkeypatch.setattr(config, "COMPETITIONS", comps)
    r = client.post("/v1/identity/entry-pass", json={"owner": owner})
    assert r.status_code == 200, r.text
    out = r.json()
    msg = {"wallet": owner, "nullifier": bytes.fromhex(out["nullifier"][2:]), "deadline": out["deadline"]}
    assert enc.recover("EntryPass", config.CHAIN_ID, comps, msg, bytes.fromhex(out["signature"][2:])) == \
        identity.ADMITTER.address
    again = client.post("/v1/identity/entry-pass", json={"owner": owner}).json()
    assert again["nullifier"] == out["nullifier"]  # the same person, so the contract sees one entrant


def test_entry_pass_for_rl_competitions_names_that_contract(owner, monkeypatch):
    rl = "0x" + "dd" * 20
    monkeypatch.setattr(config, "COMPETITIONS", "0x" + "cc" * 20)
    assert client.post("/v1/identity/entry-pass", json={"owner": owner, "contract": "rl"}).status_code == 503
    monkeypatch.setattr(config, "RL_COMPETITIONS", rl)
    out = client.post("/v1/identity/entry-pass", json={"owner": owner, "contract": "rl"}).json()
    msg = {"wallet": owner, "nullifier": bytes.fromhex(out["nullifier"][2:]), "deadline": out["deadline"]}
    assert enc.recover("EntryPass", config.CHAIN_ID, rl, msg, bytes.fromhex(out["signature"][2:])) ==         identity.ADMITTER.address


def test_entry_pass_keeps_one_wallet_per_person(owner, monkeypatch):
    monkeypatch.setattr(config, "COMPETITIONS", "0x" + "cc" * 20)
    other = Account.create().address
    monkeypatch.setattr(identity, "verify_human", lambda o, p: ("0x" + "ab" * 32, "orb"))
    assert client.post("/v1/identity/entry-pass", json={"owner": owner}).status_code == 200
    assert client.post("/v1/identity/entry-pass", json={"owner": other}).status_code == 409


def verify(owner, proof=None):
    return client.post("/v1/identity/verify", json={"owner": owner, "proof": proof or {}})


def test_verify_without_a_node_then_join_reuses_it(owner, monkeypatch):
    from identity import worldid

    monkeypatch.setattr(identity, "MODE", "worldid")
    calls = []
    monkeypatch.setattr(worldid, "verify", lambda proof, o: calls.append(o) or ("0x" + "a1" * 32, "orb"))
    r = verify(owner, {"x": 1})
    assert r.status_code == 200 and r.json()["credential"] == "orb"
    s = client.get(f"/v1/identity/owners/{owner}").json()
    assert s["verified"] and not s["joined"] and s["credential"] == "orb" and s["verifiedAt"]
    # Joining later sends no proof, so World ID is not asked again.
    code = pairing_code(Account.create(), owner, int(time.time()) + 1800)
    r = client.post("/v1/identity/join", json={"owner": owner, "pairingCode": code})
    assert r.status_code == 200 and r.json()["nullifier"] == "0x" + "a1" * 32 and len(calls) == 1
    assert client.get(f"/v1/identity/owners/{owner}").json()["joined"]


def test_join_without_a_proof_or_a_verification_still_checks_one(owner, monkeypatch):
    from identity import worldid

    monkeypatch.setattr(identity, "MODE", "worldid")

    def rejected(proof, o):
        raise worldid.Rejected("expected exactly one Proof of Human or Selfie Check credential")
    monkeypatch.setattr(worldid, "verify", rejected)
    code = pairing_code(Account.create(), owner, int(time.time()) + 1800)
    assert client.post("/v1/identity/join", json={"owner": owner, "pairingCode": code}).status_code == 400


def test_verify_keeps_one_wallet_per_human_and_one_human_per_wallet(owner, monkeypatch):
    from identity import worldid

    monkeypatch.setattr(identity, "MODE", "worldid")
    monkeypatch.setattr(worldid, "verify", lambda proof, o: ("0x" + "b2" * 32, "orb"))
    assert verify(owner).status_code == 200
    assert verify(owner).status_code == 200  # the same person again is fine
    other = Account.create().address
    r = verify(other)
    assert r.status_code == 409 and owner[:6] in r.json()["detail"]
    monkeypatch.setattr(worldid, "verify", lambda proof, o: ("0x" + "c3" * 32, "orb"))
    r = verify(owner)
    assert r.status_code == 409 and "different World ID" in r.json()["detail"]


def test_unknown_owner_is_neither_verified_nor_joined(owner):
    s = client.get(f"/v1/identity/owners/{owner}").json()
    assert not s["verified"] and not s["joined"] and s["credential"] is None


def test_verify_is_rate_limited(owner, monkeypatch):
    monkeypatch.setattr(identity, "verify_limit", identity.RateLimit(1))
    assert verify(owner).status_code == 200
    assert verify(owner).status_code == 429


def test_entry_pass_reuses_the_sign_up_verification(owner, monkeypatch):
    from identity import worldid

    monkeypatch.setattr(config, "COMPETITIONS", "0x" + "cc" * 20)
    monkeypatch.setattr(identity, "MODE", "worldid")
    calls = []
    monkeypatch.setattr(worldid, "verify", lambda proof, o: calls.append(o) or ("0x" + "f6" * 32, "selfie"))
    assert verify(owner, {"x": 1}).status_code == 200
    # World ID 4.0 gives one proof per person per action, so the pass must not ask for a second one.
    r = client.post("/v1/identity/entry-pass", json={"owner": owner})
    assert r.status_code == 200 and r.json()["nullifier"] == "0x" + "f6" * 32 and len(calls) == 1
    assert not client.get(f"/v1/identity/owners/{owner}").json()["joined"]


def test_selfie_verify_keeps_its_sybil_score_and_orb_has_none(owner, monkeypatch):
    from identity import worldid

    monkeypatch.setattr(identity, "MODE", "worldid")
    monkeypatch.setattr(worldid, "verify", lambda proof, o: ("0x" + "d4" * 32, "selfie"))
    selfie = {"responses": [{"identifier": "selfie", "sybil_score": 3}]}
    r = verify(owner, selfie)
    assert r.status_code == 200 and r.json()["credential"] == "selfie" and r.json()["sybilScore"] == 3
    s = client.get(f"/v1/identity/owners/{owner}").json()
    assert s["credential"] == "selfie" and s["sybilScore"] == 3
    other = Account.create().address
    monkeypatch.setattr(worldid, "verify", lambda proof, o: ("0x" + "e5" * 32, "orb"))
    assert verify(other, {"responses": [{"identifier": "proof_of_human"}]}).json()["sybilScore"] is None
    assert client.get(f"/v1/identity/owners/{other}").json()["sybilScore"] is None
