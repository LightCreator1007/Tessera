"""Entrants' notebooks for a competition: signed by the entrant's wallet, sealed until the deadline, public after."""
import hashlib
import json
import time

from eth_account import Account
from eth_account.messages import encode_defunct
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import competitions

from . import config
from .db import connect

router = APIRouter(prefix="/v1/competitions")
MAX_BYTES = 2 * 1024 * 1024
KINDS = {".ipynb": "ipynb", ".md": "markdown", ".py": "python"}
FRESH = 600  # s a signature stays good, so a leaked one can't be replayed later

db = connect(config.DB_PATH)
db.execute("""CREATE TABLE IF NOT EXISTS competition_notebooks (
    cid INTEGER, entrant TEXT, title TEXT, name TEXT, kind TEXT, size INTEGER, sha256 TEXT, signature TEXT,
    signed_at INTEGER, revisions INTEGER, updated INTEGER, content BLOB, PRIMARY KEY (cid, entrant))""")
db.commit()


class NotebookIn(BaseModel):
    entrant: str
    name: str
    title: str = ""
    content: str
    signedAt: int
    signature: str


def message(cid: int, entrant: str, name: str, sha256: str, signed_at: int) -> str:
    """The text the entrant's wallet signs. It names the file by hash, so the signature covers its exact bytes."""
    return (f"Attach a notebook to competition {cid}\nWallet: {entrant.lower()}\nFile: {name}\n"
            f"sha256: {sha256}\nSigned at: {signed_at}")


def _kind(name: str) -> str:
    for ext, kind in KINDS.items():
        if name.lower().endswith(ext):
            return kind
    raise HTTPException(415, "a notebook must be .ipynb, .md or .py")


def _competition(cid: int, max_age: float = competitions.TTL) -> dict:
    if not competitions.enabled():
        raise HTTPException(503, "this network has no Competitions contract")
    try:
        found = next((c for c in competitions.listing(max_age) if c["id"] == cid), None)
    except Exception as e:
        raise HTTPException(502, f"chain read failed: {type(e).__name__}")
    if found is None:
        raise HTTPException(404, "no such competition")
    return found


def _sealed(c: dict) -> bool:
    return c["now"] < c["deadline"]


@router.post("/{cid}/notebooks", status_code=201)
def attach(cid: int, body: NotebookIn):
    """Attach or replace the caller's notebook while the competition is open."""
    data = body.content.encode()
    if len(data) > MAX_BYTES:
        raise HTTPException(413, f"a notebook can be at most {MAX_BYTES // (1024 * 1024)} MB")
    name = body.name.strip()[:120]
    kind = _kind(name)
    if kind == "ipynb":
        try:
            cells = json.loads(body.content).get("cells")
        except (ValueError, AttributeError):
            cells = None
        if not isinstance(cells, list):
            raise HTTPException(422, "this .ipynb has no cells list")
    if abs(time.time() - body.signedAt) > FRESH:
        raise HTTPException(401, "signature is too old or from the future; sign again")
    digest = hashlib.sha256(data).hexdigest()
    try:
        signer = Account.recover_message(encode_defunct(text=message(cid, body.entrant, name, digest, body.signedAt)),
                                         signature=body.signature)
    except Exception:
        raise HTTPException(401, "signature doesn't decode")
    if signer.lower() != body.entrant.lower():
        raise HTTPException(401, "signature is not from this wallet")
    c = _competition(cid)
    if body.entrant.lower() not in {a.lower() for a in c["entrants"]}:
        c = _competition(cid, max_age=0)  # they may have entered seconds ago, inside the cache window
    if body.entrant.lower() not in {a.lower() for a in c["entrants"]}:
        raise HTTPException(403, "only an entrant can attach a notebook; enter first")
    if not _sealed(c):
        raise HTTPException(409, "the deadline has passed, so notebooks can't change")
    prior = db.execute("SELECT revisions FROM competition_notebooks WHERE cid = ? AND entrant = ?",
                       (cid, body.entrant.lower())).fetchone()
    revisions = (prior[0] if prior else 0) + 1
    db.execute("INSERT OR REPLACE INTO competition_notebooks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
               (cid, body.entrant.lower(), (body.title.strip() or name)[:120], name, kind, len(data), digest,
                body.signature, body.signedAt, revisions, int(time.time()), data))
    db.commit()
    return {"competition": cid, "entrant": body.entrant.lower(), "sha256": digest, "size": len(data),
            "revisions": revisions, "opensAt": c["deadline"]}


COLS = "entrant, title, name, kind, size, sha256, signature, signed_at, revisions, updated"


def _row(r) -> dict:
    return {"entrant": r[0], "title": r[1], "name": r[2], "kind": r[3], "size": r[4], "sha256": r[5],
            "signature": r[6], "signedAt": r[7], "revisions": r[8], "updatedAt": r[9]}


@router.get("/{cid}/notebooks")
def index(cid: int):
    """Only how many there are until the deadline, so nobody reads the leader's approach while entries are open."""
    c = _competition(cid)
    if _sealed(c):
        n = db.execute("SELECT COUNT(*) FROM competition_notebooks WHERE cid = ?", (cid,)).fetchone()[0]
        return {"sealed": True, "count": n, "opensAt": c["deadline"], "notebooks": []}
    rows = db.execute(f"SELECT {COLS} FROM competition_notebooks WHERE cid = ? ORDER BY updated", (cid,)).fetchall()
    return {"sealed": False, "count": len(rows), "opensAt": c["deadline"], "notebooks": [_row(r) for r in rows]}


@router.get("/{cid}/notebooks/{entrant}")
def one(cid: int, entrant: str):
    """One notebook with its signature, so anyone can check the entrant signed exactly these bytes."""
    c = _competition(cid)
    if _sealed(c):
        raise HTTPException(403, {"code": "sealed", "opensAt": c["deadline"]})
    r = db.execute(f"SELECT {COLS}, content FROM competition_notebooks WHERE cid = ? AND entrant = ?",
                   (cid, entrant.lower())).fetchone()
    if r is None:
        raise HTTPException(404, "this entrant attached no notebook")
    return {**_row(r), "competition": cid, "content": bytes(r[10]).decode(),
            "message": message(cid, r[0], r[2], r[5], r[7])}
