"""Signature checks for blob access, node writes and admin routes, plus coordinator-signed JSON."""
import hashlib
import hmac
import json
import time

from eth_account import Account
from eth_account.messages import encode_defunct, encode_typed_data
from fastapi import Header, HTTPException, Request

from tod_core import encodings

from . import config

LOCAL_HOSTS = {"127.0.0.1", "::1"}


def blob_access_signable(job, rnd, blob_hash, method, expiry):
    """The EIP-712 BlobAccess message a node, verifier or requester signs to read or write a blob."""
    msg = {"jobId": job, "roundId": rnd, "blobHash": bytes.fromhex(blob_hash.removeprefix("0x")),
           "method": method, "expiry": expiry}
    # BlobAccess is checked here, off chain, but names JobMarket as its contract because job ids live there.
    return encode_typed_data(full_message=encodings.typed_data("BlobAccess", config.CHAIN_ID, config.JOB_MARKET, msg))


def recover_blob_access(job, rnd, blob_hash, method, expiry, signature):
    return Account.recover_message(blob_access_signable(job, rnd, blob_hash, method, expiry), signature=signature)


def sign_json(doc):
    """Attach the coordinator's EIP-191 signature over the document's compact sorted-key bytes."""
    raw = json.dumps(doc, sort_keys=True, separators=(",", ":")).encode()
    sig = Account.sign_message(encode_defunct(raw), config.COORDINATOR_KEY).signature
    return {**doc, "signature": "0x" + sig.hex().removeprefix("0x")}


async def node(request: Request, x_operator: str = Header(), x_timestamp: int = Header(),
               x_signature: str = Header()) -> str:
    """FastAPI dependency: the operator that signed this write.

    The node signs "METHOD\\nPATH\\nTIMESTAMP\\nsha256(body)" with EIP-191; the timestamp bounds replays.
    """
    # ponytail: wall clock, so a skewed server clock shifts the window; use the latest block time once the ledger feeds the API
    if abs(time.time() - x_timestamp) > config.CLOCK_SKEW:
        raise HTTPException(401, f"timestamp more than {config.CLOCK_SKEW} s off")
    body = await request.body()
    msg = f"{request.method}\n{request.url.path}\n{x_timestamp}\n{hashlib.sha256(body).hexdigest()}"
    try:
        signer = Account.recover_message(encode_defunct(text=msg), signature=x_signature)
    except Exception:
        raise HTTPException(401, "bad signature")
    if signer.lower() != x_operator.lower():
        raise HTTPException(401, "signature is not from X-Operator")
    return signer


def admin(request: Request, authorization: str = Header("")):
    """FastAPI dependency: admin routes need localhost and the bearer token.

    Behind a tunnel every request arrives from localhost, so the token is the real gate and the
    tunnel must not route /v1/admin.
    """
    if request.client.host not in LOCAL_HOSTS:
        raise HTTPException(403, "admin is localhost only")
    if not config.ADMIN_TOKEN or not hmac.compare_digest(authorization, "Bearer " + config.ADMIN_TOKEN):
        raise HTTPException(403, "bad admin token")
