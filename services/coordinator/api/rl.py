"""RL competition files checked against their onchain hashes, the queue verifiers run, and the scores they sign."""
import base64
import binascii
import hashlib
import json
import time

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from tod_core import encodings

import rl_competitions as rl

from . import config
from .db import connect

router = APIRouter(prefix="/v1/rl")
MAX_BYTES = 10 * 1024 * 1024

db = connect(config.DB_PATH)
db.execute("CREATE TABLE IF NOT EXISTS rl_envs (cid INTEGER PRIMARY KEY, sha256 TEXT, data BLOB, updated INTEGER)")
db.execute("""CREATE TABLE IF NOT EXISTS rl_policies (cid INTEGER, entrant TEXT, sha256 TEXT, data BLOB, updated INTEGER,
    PRIMARY KEY (cid, entrant))""")
db.execute("""CREATE TABLE IF NOT EXISTS rl_results (cid INTEGER, entrant TEXT, verifier TEXT, policy TEXT,
    score INTEGER, returns TEXT, signature TEXT, at INTEGER, PRIMARY KEY (cid, entrant, verifier))""")
db.commit()


class FileIn(BaseModel):
    data: str  # base64


class ResultIn(BaseModel):
    verifier: str
    score: int
    returns: list[list[float]]
    signature: str


def _rows() -> list[dict]:
    if not rl.enabled():
        raise HTTPException(503, "this network has no RLCompetitions contract")
    try:
        return rl.listing()
    except Exception as e:
        raise HTTPException(502, f"chain read failed: {type(e).__name__}")


def _one(cid: int) -> dict:
    found = next((c for c in _rows() if c["id"] == cid), None)
    if found is None:
        raise HTTPException(404, "no such RL competition")
    return found


def _standing(c: dict, entrant: str) -> dict:
    found = next((s for s in c["standings"] if s["entrant"] == entrant.lower()), None)
    if found is None:
        raise HTTPException(404, "that wallet hasn't entered")
    return found


def _bytes(body: FileIn, want: str) -> tuple[bytes, str]:
    try:
        data = base64.b64decode(body.data, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(422, "data is not base64")
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "files are capped at 10 MB")
    digest = "0x" + hashlib.sha256(data).hexdigest()
    if digest != want:
        raise HTTPException(409, {"code": "hash", "message": f"this file's sha256 is {digest}, the contract has {want}"})
    return data, digest


def _uploaded(table: str, cid: int, entrant: str | None = None) -> bool:
    q = f"SELECT 1 FROM {table} WHERE cid = ?" + (" AND entrant = ?" if entrant else "")
    return db.execute(q, (cid, entrant) if entrant else (cid,)).fetchone() is not None


def _decorate(c: dict) -> dict:
    return {**c, "envUploaded": _uploaded("rl_envs", c["id"]),
            "standings": [{**s, "policyUploaded": bool(s["policy"]) and _uploaded("rl_policies", c["id"], s["entrant"]),
                           "results": _results(c["id"], s["entrant"])} for s in c["standings"]]}


@router.get("/competitions")
def competitions() -> list[dict]:
    return [_decorate(c) for c in _rows()]


@router.get("/competitions/{cid}")
def competition(cid: int) -> dict:
    return _decorate(_one(cid))


@router.post("/competitions/{cid}/env")
def put_env(cid: int, body: FileIn) -> dict:
    """Anyone may post the environment; only the file whose sha256 the host locked on chain is taken."""
    c = _one(cid)
    data, digest = _bytes(body, c["env"])
    db.execute("INSERT OR REPLACE INTO rl_envs VALUES (?, ?, ?, ?)", (cid, digest, data, int(time.time())))
    db.commit()
    return {"sha256": digest, "size": len(data)}


@router.get("/competitions/{cid}/env")
def get_env(cid: int) -> Response:
    row = db.execute("SELECT data FROM rl_envs WHERE cid = ?", (cid,)).fetchone()
    if row is None:
        raise HTTPException(404, "the host hasn't uploaded the environment yet")
    return _download(row[0], f"rl-{cid}-env")


@router.post("/competitions/{cid}/policies/{entrant}")
def put_policy(cid: int, entrant: str, body: FileIn) -> dict:
    """Taken only once the policy is revealed on chain, and only the file it hashes to, so nothing is public early."""
    s = _standing(_one(cid), entrant)
    if not s["policy"]:
        raise HTTPException(409, {"code": "unrevealed", "message": "reveal the policy on chain first"})
    data, digest = _bytes(body, s["policy"])
    db.execute("INSERT OR REPLACE INTO rl_policies VALUES (?, ?, ?, ?, ?)",
               (cid, entrant.lower(), digest, data, int(time.time())))
    db.commit()
    return {"sha256": digest, "size": len(data)}


@router.get("/competitions/{cid}/policies/{entrant}")
def get_policy(cid: int, entrant: str) -> Response:
    row = db.execute("SELECT data FROM rl_policies WHERE cid = ? AND entrant = ?", (cid, entrant.lower())).fetchone()
    if row is None:
        raise HTTPException(404, "no policy uploaded for that entrant")
    return _download(row[0], f"rl-{cid}-policy-{entrant.lower()}")


def _download(data: bytes, name: str) -> Response:
    return Response(data, media_type="application/octet-stream",
                    headers={"content-disposition": f'attachment; filename="{name}"', "x-content-type-options": "nosniff"})


@router.get("/evaluations")
def evaluations() -> list[dict]:
    """What verifiers should run now. Verifiers re-read every input from the chain before signing."""
    out = []
    for c in _rows():
        if c["status"] not in ("revealing", "scoring") or not _uploaded("rl_envs", c["id"]):
            continue
        for s in c["standings"]:
            if s["policy"] and s["score"] is None and _uploaded("rl_policies", c["id"], s["entrant"]):
                out.append({"competition": c["id"], "entrant": s["entrant"], "policy": s["policy"], "env": c["env"],
                            "seeds": c["seeds"], "episodes": c["episodes"], "maxSteps": c["maxSteps"]})
    return out


@router.post("/competitions/{cid}/evaluations/{entrant}")
def put_result(cid: int, entrant: str, body: ResultIn) -> dict:
    s = _standing(_one(cid), entrant)
    if not s["policy"]:
        raise HTTPException(409, {"code": "unrevealed", "message": "that policy isn't revealed"})
    msg = {"competition": cid, "entrant": entrant.lower(), "policy": s["policy"], "score": body.score}
    try:
        signer = encodings.recover("EvalResult", config.CHAIN_ID, rl.address(), msg, bytes.fromhex(body.signature.removeprefix("0x")))
    except Exception:
        raise HTTPException(422, "signature doesn't decode")
    if signer.lower() != body.verifier.lower() or signer.lower() not in rl.verifiers():
        raise HTTPException(403, "not signed by one of the contract's verifiers")
    db.execute("INSERT OR REPLACE INTO rl_results VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
               (cid, entrant.lower(), signer.lower(), s["policy"], body.score, json.dumps(body.returns),
                body.signature, int(time.time())))
    db.commit()
    return _results(cid, entrant)


def _results(cid: int, entrant: str) -> dict:
    """Every verifier's result, and the score with the most signatures once it has the contract's threshold."""
    rows = db.execute("SELECT verifier, policy, score, returns, signature FROM rl_results WHERE cid = ? AND entrant = ?",
                      (cid, entrant.lower())).fetchall()
    results = [{"verifier": v, "policy": p, "score": sc, "returns": json.loads(r), "signature": sig}
               for v, p, sc, r, sig in rows]
    by_score: dict[int, list[str]] = {}
    for r in results:
        by_score.setdefault(r["score"], []).append(r["signature"])
    best = max(by_score.items(), key=lambda kv: len(kv[1]), default=None)
    ready = best and len(best[1]) >= rl.threshold()
    return {"results": results, "agreed": len(set(by_score)) <= 1,
            "ready": {"score": best[0], "signatures": best[1]} if ready else None}


@router.get("/competitions/{cid}/evaluations/{entrant}")
def get_results(cid: int, entrant: str) -> dict:
    return _results(cid, entrant)
