"""World ID Agent Pass (auth.world.org OIDC): device-flow approval by the owner, and ID token validation (RS256 via JWKS)."""
import base64
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

from Crypto.Hash import SHA256
from Crypto.PublicKey import RSA
from Crypto.Signature import pkcs1_15

ISSUER = os.environ.get("WORLD_AUTH_ISSUER", "https://sandbox.auth.world.org")  # https://auth.world.org in production
CLIENT_ID = os.environ.get("WORLD_AUTH_CLIENT_ID", "")
CLIENT_SECRET = os.environ.get("WORLD_AUTH_CLIENT_SECRET", "")
UA = "tod-coordinator/0.1"  # World's edge rejects Python's default User-Agent
CLOCK_SKEW = 30  # s


class Blocked(Exception):
    """The approval failed or was refused; the action stays blocked. The message is safe to show."""


def _b64d(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _request(url: str, form: dict | None = None) -> tuple[int, dict]:
    data = urllib.parse.urlencode(form).encode() if form is not None else None
    headers = {"user-agent": UA, "accept": "application/json"}
    if form is not None:
        headers["content-type"] = "application/x-www-form-urlencoded"
    req = urllib.request.Request(url, data=data, headers=headers, method="POST" if form is not None else "GET")
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b"{}")
        except ValueError:
            return e.code, {}


_cache: dict = {}


def _discovery(http=_request) -> dict:
    if "discovery" not in _cache:
        status, doc = http(ISSUER + "/.well-known/openid-configuration")
        if status != 200:
            raise Blocked(f"World ID issuer unavailable ({status})")
        _cache["discovery"] = doc
    return _cache["discovery"]


def _jwks(http=_request) -> dict:
    if "jwks" not in _cache or _cache["jwks_at"] < time.time() - 3600:
        status, keys = http(_discovery(http)["jwks_uri"])
        if status != 200:
            raise Blocked(f"World ID signing keys unavailable ({status})")
        _cache.update(jwks=keys, jwks_at=time.time())
    return _cache["jwks"]


def _client() -> dict:
    if not (CLIENT_ID and CLIENT_SECRET):
        raise Blocked("Agent Pass is not configured (WORLD_AUTH_CLIENT_ID / WORLD_AUTH_CLIENT_SECRET)")
    return {"client_id": CLIENT_ID, "client_secret": CLIENT_SECRET}


def start_device(http=_request) -> dict:
    """Begin a device authorization; returns World's response (device_code stays server-side)."""
    status, body = http(_discovery(http)["device_authorization_endpoint"], {**_client(), "scope": "openid"})
    if status != 200 or "device_code" not in body:
        raise Blocked(f"could not start World ID approval: {body.get('error') or status}")
    return body


def poll_device(device_code: str, http=_request) -> str | None:
    """Returns the ID token once approved, None while pending; raises Blocked when the attempt is over."""
    status, body = http(_discovery(http)["token_endpoint"], {
        **_client(), "grant_type": "urn:ietf:params:oauth:grant-type:device_code", "device_code": device_code})
    if status == 200 and body.get("id_token"):
        return body["id_token"]
    if body.get("error") in ("authorization_pending", "slow_down"):
        return None
    raise Blocked(f"World ID approval ended: {body.get('error') or status}")  # denied, expired, 503, ...


def verify_id_token(token: str, jwks: dict, not_before: int, now: int | None = None) -> dict:
    """World's ID token rules: RS256 by kid, exact iss, our aud, unexpired, fresh auth_time, acr and amr present."""
    now = int(time.time()) if now is None else now
    try:
        h64, p64, s64 = token.split(".")
        header, claims = json.loads(_b64d(h64)), json.loads(_b64d(p64))
    except ValueError:
        raise Blocked("malformed ID token")
    if header.get("alg") != "RS256":
        raise Blocked("ID token is not RS256")
    key = next((k for k in jwks.get("keys", []) if k.get("kid") == header.get("kid") and k.get("kty") == "RSA"), None)
    if key is None:
        raise Blocked("ID token signed with an unknown key")
    pub = RSA.construct((int.from_bytes(_b64d(key["n"]), "big"), int.from_bytes(_b64d(key["e"]), "big")))
    try:
        pkcs1_15.new(pub).verify(SHA256.new(f"{h64}.{p64}".encode()), _b64d(s64))
    except ValueError:
        raise Blocked("ID token signature is invalid")
    aud = claims.get("aud")
    if claims.get("iss") != ISSUER or CLIENT_ID not in (aud if isinstance(aud, list) else [aud]):
        raise Blocked("ID token is for another issuer or client")
    if claims.get("exp", 0) <= now - CLOCK_SKEW:
        raise Blocked("ID token expired")
    # auth_time, not iat: a new token can reuse an older login. The proof must postdate this request.
    if claims.get("auth_time", 0) < not_before - CLOCK_SKEW:
        raise Blocked("World ID authentication is older than this request")
    if not claims.get("acr") or not claims.get("amr") or not claims.get("sub"):
        raise Blocked("ID token is missing acr, amr or sub")
    return claims
