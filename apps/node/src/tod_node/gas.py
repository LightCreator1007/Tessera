"""Signed writes to the coordinator, and asking it for gas when the operator key runs low."""
import hashlib
import json
import logging
import time
import urllib.error
import urllib.request

from eth_account import Account
from eth_account.messages import encode_defunct

log = logging.getLogger(__name__)
LOW_WEI = 5 * 10**14  # half the coordinator's default target; below this a commit and reveal may not fit


def node_post(url: str, key: bytes, path: str, body: dict | None = None) -> dict:
    """POST with the operator signature the coordinator's api.auth.node checks: METHOD, path, time, sha256(body)."""
    data = json.dumps(body).encode() if body is not None else b""
    ts, account = int(time.time()), Account.from_key(key)
    msg = f"POST\n{path}\n{ts}\n{hashlib.sha256(data).hexdigest()}"
    sig = account.sign_message(encode_defunct(text=msg)).signature
    req = urllib.request.Request(url.rstrip("/") + path, data=data, method="POST", headers={
        "Content-Type": "application/json", "X-Operator": account.address, "X-Timestamp": str(ts),
        "X-Signature": "0x" + sig.hex().removeprefix("0x")})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def ensure_gas(w3, url: str, key: bytes, emit=lambda *a, **k: None) -> None:
    """Ask for a top-up when the balance is low. Never fatal: a node with gas from elsewhere runs fine without it."""
    address = Account.from_key(key).address
    balance = w3.eth.get_balance(address)
    if balance >= LOW_WEI:
        return
    try:
        got = node_post(url, key, "/v1/identity/topup")
        emit("gas.topup", sent=got["sent"], balance=got["balance"])
    except urllib.error.HTTPError as e:
        reason = json.loads(e.read() or b"{}").get("detail", e.reason)
        emit("error", what="gas", balance=balance, reason=f"top-up refused ({e.code}): {reason}")
    except (urllib.error.URLError, OSError) as e:
        emit("error", what="gas", balance=balance, reason=f"top-up unreachable: {e}")
