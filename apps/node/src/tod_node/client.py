"""Signed writes to the coordinator: the operator signature its api.auth.node checks."""
import hashlib
import json
import time
import urllib.request

from eth_account import Account
from eth_account.messages import encode_defunct


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
