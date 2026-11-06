"""World ID 4.0 for pool join: the RP request signature (docs.world.org/world-id/idkit/signatures) and backend proof verification."""
import json
import os
import time
import urllib.error
import urllib.request

from eth_account import Account
from eth_account.messages import encode_defunct
from tod_core.hashing import k256

APP_ID = os.environ.get("WORLD_ID_APP_ID", "")
RP_ID = os.environ.get("WORLD_ID_RP_ID", "")
RP_SIGNING_KEY = os.environ.get("WORLD_ID_RP_SIGNING_KEY", "")
ACTION = os.environ.get("WORLD_ID_ACTION", "tod-pool-join")
# staging uses World's simulator; switch to production for real humans.
ENVIRONMENT = os.environ.get("WORLD_ID_ENV", "staging")
VERIFY_URL = os.environ.get("WORLD_ID_VERIFY_URL", "https://developer.world.org/api/v4/verify/{rp_id}")
RP_TTL = 300  # s, World's default

# Credential the matcher sees, by IDKit response identifier (scheduler.CREDENTIAL_RANK).
CREDENTIALS = {"proof_of_human": "orb", "orb": "orb", "selfie": "selfie"}  # "orb": legacy 3.0 fallback


class Rejected(Exception):
    """A proof we refuse; the message is safe to show the user."""


def hash_to_field(b: bytes) -> bytes:
    # World's field mapping: keccak-256 shifted right one byte, so it fits the proof system's field.
    return (int.from_bytes(k256(b), "big") >> 8).to_bytes(32, "big")


def field(x: str) -> int:
    # 4.0 responses carry decimal strings, legacy 3.0 ones 0x hex (idkit-core index.d.ts ResponseItemV4 / V3).
    return int(x, 16) if x.startswith("0x") else int(x)


def signal_for(owner: str) -> str:
    # Not 0x-prefixed: IDKit would hash a hex string as raw bytes, plain text as UTF-8 (hashing.js hashSignal).
    return "tod-owner:" + owner.lower()


def rp_message(nonce: bytes, created_at: int, expires_at: int, action: str | None) -> bytes:
    m = b"\x01" + nonce + created_at.to_bytes(8, "big") + expires_at.to_bytes(8, "big")
    return m + hash_to_field(action.encode()) if action is not None else m


def sign_request(key: str, action: str | None, now: int | None = None, rand: bytes | None = None) -> dict:
    """Python port of idkit-core's signRequest; checked against World's test vectors."""
    nonce = hash_to_field(rand if rand is not None else os.urandom(32))
    created = int(time.time()) if now is None else now
    msg = rp_message(nonce, created, created + RP_TTL, action)
    sig = Account.sign_message(encode_defunct(primitive=msg), key).signature
    return {"sig": "0x" + bytes(sig).hex(), "nonce": "0x" + nonce.hex(), "created_at": created,
            "expires_at": created + RP_TTL}


def _json(raw: bytes) -> dict:
    try:
        return json.loads(raw or b"{}")
    except ValueError:  # e.g. a plain-text edge error page
        return {}


def post_verify(result: dict) -> tuple[int, dict]:
    # World's edge blocks Python's default User-Agent with a plain-text 403 (Cloudflare 1010), so name ours.
    headers = {"content-type": "application/json", "user-agent": "tod-coordinator/0.1"}
    req = urllib.request.Request(VERIFY_URL.format(rp_id=RP_ID), data=json.dumps(result).encode(),
                                 headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, _json(r.read())
    except urllib.error.HTTPError as e:
        return e.code, _json(e.read())


def verify(result: dict, owner: str, post=post_verify) -> tuple[str, str]:
    """Check an IDKit result for this owner; returns (nullifier as 0x bytes32, credential)."""
    if result.get("environment") != ENVIRONMENT:
        raise Rejected(f"World ID proof is for {result.get('environment')!r}, expected {ENVIRONMENT!r}")
    if result.get("action") != ACTION:
        raise Rejected("World ID proof is for a different action")
    responses = [r for r in result.get("responses", []) if r.get("identifier") in CREDENTIALS]
    if len(responses) != 1:
        raise Rejected("expected exactly one Proof of Human or Selfie Check credential")
    resp = responses[0]
    # Bind the proof to this wallet, so a proof can't be replayed to join another owner.
    if field(resp.get("signal_hash", "0x0")) != int.from_bytes(hash_to_field(signal_for(owner).encode()), "big"):
        raise Rejected("World ID proof was made for a different wallet")
    # Forwarded exactly as IDKit returned it (World's guide: never re-encode the proof); the environment is checked above.
    status, body = post(result)
    if status != 200 or body.get("success") is not True or body.get("environment", ENVIRONMENT) != ENVIRONMENT:
        raise Rejected(f"World ID verification failed: {body.get('code') or status}")
    nullifier = field(resp["nullifier"])
    return "0x" + nullifier.to_bytes(32, "big").hex(), CREDENTIALS[resp["identifier"]]


def sybil_score(result: dict) -> int | None:
    """Selfie Check's risk signal (an integer z-score signed by the issuer); None for an Orb proof. Read only after verify()."""
    for r in result.get("responses", []):
        if r.get("identifier") == "selfie" and isinstance(r.get("sybil_score"), int):
            return r["sybil_score"]
    return None
