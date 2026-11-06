"""Blob routes. Every PUT and GET carries a BlobAccess signature from someone with a role in that job and round."""
import re
import time

from eth_utils import keccak
from fastapi import APIRouter, Header, HTTPException, Request, Response
from fastapi.responses import JSONResponse

from store import DiskStore

from . import auth, config, tables

router = APIRouter(prefix="/v1/blobs")
store = DiskStore(config.STORE_DIR)
HASH = re.compile(r"^0x[0-9a-f]{64}$")


def allowed(job, rnd):
    """Who may read or write blobs of (job, round): its seated operators, the verifiers and the requester."""
    who = {v.lower() for v in config.VERIFIERS}
    if job in tables.JOBS:
        who.add(tables.JOBS[job].requester.lower())
    if seated := tables.ROUNDS.get(job, {}).get(rnd):
        who |= {s.op.lower() for s in seated.roster}
    return who


def authorize(h, method, job, rnd, expiry, signature):
    if not HASH.match(h):
        raise HTTPException(400, "hash must be 0x + 64 lowercase hex")
    # ponytail: wall clock, so a skewed server clock shifts the window; use the latest block time once the ledger feeds the API
    now = int(time.time())
    if not now <= expiry <= now + config.MAX_EXPIRY_AHEAD:
        raise HTTPException(401, f"expiry outside [now, now + {config.MAX_EXPIRY_AHEAD} s]")
    try:
        signer = auth.recover_blob_access(job, rnd, h, method, expiry, signature)
    except Exception:
        raise HTTPException(401, "bad signature")
    if signer.lower() not in allowed(job, rnd):
        raise HTTPException(403, "signer has no role in this job and round")


@router.put("/{h}", status_code=201)
async def put(h: str, request: Request, x_job: int = Header(), x_round: int = Header(),
              x_expiry: int = Header(), x_signature: str = Header()):
    authorize(h, "PUT", x_job, x_round, x_expiry, x_signature)
    data = await request.body()
    if len(data) > config.MAX_BLOB_BYTES:
        raise HTTPException(413, "blob too large")
    if "0x" + keccak(data).hex() != h:
        raise HTTPException(400, "keccak(body) != hash")
    store.put(data)
    return {"hash": h}


@router.get("/{h}")
def get(h: str, x_job: int = Header(), x_round: int = Header(), x_expiry: int = Header(), x_signature: str = Header()):
    authorize(h, "GET", x_job, x_round, x_expiry, x_signature)
    data = store.get(h)
    if data is None:
        # Signed, so a verifier can prove the coordinator said the blob was absent.
        return JSONResponse(auth.sign_json({"hash": h, "absent": True, "block": None}), status_code=404)
    return Response(data, media_type="application/octet-stream")


@router.head("/{h}")
def head(h: str):
    return Response(status_code=200 if HASH.match(h) and store.has(h) else 404)
