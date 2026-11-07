"""A competition's host-edited listing: settings, a banner and downloadable resources such as RL environments, each signed by the host."""
import base64
import hashlib
import json
import re
import time

from eth_account import Account
from eth_account.messages import encode_defunct
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

import competitions

from . import config
from .db import connect

router = APIRouter(prefix="/v1/competitions")
FRESH = 600  # s a signature stays good
BANNER_MAX = 1024 * 1024
RESOURCE_MAX = 10 * 1024 * 1024
MAX_RESOURCES = 8
NOTEBOOK_RULES = {"optional", "required", "off"}
# What entrants agreed to when they entered: these stop changing once anyone has.
FROZEN_ON_ENTRY = ("rules", "classNames", "notebookRules")

db = connect(config.DB_PATH)
db.execute("""CREATE TABLE IF NOT EXISTS competition_settings (
    cid INTEGER, version INTEGER, payload TEXT, sha256 TEXT, signature TEXT, signed_at INTEGER, updated INTEGER,
    PRIMARY KEY (cid, version))""")
db.execute("""CREATE TABLE IF NOT EXISTS competition_banners (
    cid INTEGER PRIMARY KEY, content_type TEXT, sha256 TEXT, signature TEXT, signed_at INTEGER, updated INTEGER, data BLOB)""")
db.execute("""CREATE TABLE IF NOT EXISTS competition_resources (
    cid INTEGER, name TEXT, kind TEXT, spec TEXT, sha256 TEXT, size INTEGER, signature TEXT, signed_at INTEGER,
    updated INTEGER, data BLOB, PRIMARY KEY (cid, name))""")
db.commit()


def message(cid: int, what: str, host: str, sha256: str, signed_at: int) -> str:
    """The text the host's wallet signs for any listing change; the hash pins the exact bytes."""
    return f"Update competition {cid} {what}\nWallet: {host.lower()}\nsha256: {sha256}\nSigned at: {signed_at}"


def _competition(cid: int) -> dict:
    if not competitions.enabled():
        raise HTTPException(503, "this network has no Competitions contract")
    try:
        found = next((c for c in competitions.listing() if c["id"] == cid), None)
    except Exception as e:
        raise HTTPException(502, f"chain read failed: {type(e).__name__}")
    if found is None:
        raise HTTPException(404, "no such competition")
    return found


def _authorize(cid: int, what: str, host: str, digest: str, signed_at: int, signature: str) -> dict:
    """The competition, once the signer is shown to be its host and it is still before the deadline."""
    if abs(time.time() - signed_at) > FRESH:
        raise HTTPException(401, "signature is too old or from the future; sign again")
    try:
        signer = Account.recover_message(encode_defunct(text=message(cid, what, host, digest, signed_at)), signature=signature)
    except Exception:
        raise HTTPException(401, "signature doesn't decode")
    if signer.lower() != host.lower():
        raise HTTPException(401, "signature is not from this wallet")
    c = _competition(cid)
    if c["host"].lower() != host.lower():
        raise HTTPException(403, "only the host can change this competition's listing")
    if c["now"] >= c["deadline"]:
        raise HTTPException(409, "the deadline has passed, so the listing can't change")
    return c


def _clean_settings(raw: dict) -> dict:
    def text(k, cap):
        v = raw.get(k, "")
        if not isinstance(v, str) or len(v) > cap:
            raise HTTPException(422, f"{k} must be text of at most {cap} characters")
        return v.strip()

    def strings(k, n, cap):
        v = raw.get(k, [])
        if not isinstance(v, list) or len(v) > n or any(not isinstance(x, str) or len(x) > cap for x in v):
            raise HTTPException(422, f"{k} must be at most {n} items of at most {cap} characters")
        return [x.strip() for x in v if x.strip()]

    links = raw.get("links", [])
    if not isinstance(links, list) or len(links) > 8:
        raise HTTPException(422, "links must be at most 8")
    for link in links:
        if not isinstance(link, dict) or not re.fullmatch(r"https?://\S{1,300}", str(link.get("url", ""))) or len(str(link.get("label", ""))) > 60:
            raise HTTPException(422, "each link needs an http(s) url and a label of at most 60 characters")
    rules = raw.get("notebookRules", "optional")
    if rules not in NOTEBOOK_RULES:
        raise HTTPException(422, f"notebookRules must be one of {sorted(NOTEBOOK_RULES)}")
    out = {"title": text("title", 120), "summary": text("summary", 4000), "rules": text("rules", 4000),
           "links": [{"label": str(x.get("label", "")).strip() or x["url"], "url": x["url"]} for x in links],
           "tags": strings("tags", 8, 24), "classNames": strings("classNames", 256, 40), "notebookRules": rules}
    return out


def settings_of(cid: int) -> dict | None:
    r = db.execute("SELECT version, payload, sha256, signature, signed_at, updated FROM competition_settings "
                   "WHERE cid = ? ORDER BY version DESC LIMIT 1", (cid,)).fetchone()
    if r is None:
        return None
    return {**json.loads(r[1]), "version": r[0], "sha256": r[2], "signature": r[3], "signedAt": r[4], "updatedAt": r[5]}


class Signed(BaseModel):
    host: str
    signedAt: int
    signature: str


class SettingsIn(Signed):
    payload: str  # the exact JSON text the host signed, so nobody has to agree on how to re-serialise it


@router.post("/{cid}/settings", status_code=201)
def put_settings(cid: int, body: SettingsIn):
    """Replace the listing's settings. Fields entrants agreed to freeze once the first entry lands."""
    data = body.payload.encode()
    if len(data) > 64 * 1024:
        raise HTTPException(413, "settings can be at most 64 KB")
    digest = hashlib.sha256(data).hexdigest()
    c = _authorize(cid, "settings", body.host, digest, body.signedAt, body.signature)
    try:
        raw = json.loads(body.payload)
    except ValueError:
        raise HTTPException(422, "payload must be JSON")
    if not isinstance(raw, dict):
        raise HTTPException(422, "payload must be a JSON object")
    new = _clean_settings(raw)
    prior = settings_of(cid)
    if c["entries"] > 0:
        before = {k: (prior or {}).get(k, _clean_settings({})[k]) for k in FROZEN_ON_ENTRY}
        changed = [k for k in FROZEN_ON_ENTRY if new[k] != before[k]]
        if changed:
            raise HTTPException(409, {"code": "frozen", "fields": changed,
                                      "message": f"{', '.join(changed)} can't change once someone has entered"})
    version = (prior["version"] if prior else 0) + 1
    db.execute("INSERT INTO competition_settings VALUES (?, ?, ?, ?, ?, ?, ?)",
               (cid, version, json.dumps(new), digest, body.signature, body.signedAt, int(time.time())))
    db.commit()
    return {**new, "version": version}


@router.get("/{cid}/settings")
def get_settings(cid: int):
    """The listing's current settings plus every earlier version, so entrants can see what changed and when."""
    _competition(cid)
    rows = db.execute("SELECT version, payload, sha256, signature, signed_at, updated FROM competition_settings "
                      "WHERE cid = ? ORDER BY version DESC", (cid,)).fetchall()
    history = [{**json.loads(r[1]), "version": r[0], "sha256": r[2], "signature": r[3], "signedAt": r[4], "updatedAt": r[5]}
               for r in rows]
    return {"current": history[0] if history else None, "history": history, "frozen": list(FROZEN_ON_ENTRY)}


class FileIn(Signed):
    data: str  # base64


def _decode(b64: str, cap: int) -> bytes:
    try:
        raw = base64.b64decode(b64, validate=True)
    except ValueError:
        raise HTTPException(422, "data must be base64")
    if len(raw) > cap:
        raise HTTPException(413, f"at most {cap // (1024 * 1024)} MB")
    if not raw:
        raise HTTPException(422, "the file is empty")
    return raw


def _image_type(raw: bytes) -> str:
    if raw.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if raw.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return "image/webp"
    raise HTTPException(415, "a banner must be a PNG, JPEG or WebP image")


@router.post("/{cid}/banner", status_code=201)
def put_banner(cid: int, body: FileIn):
    raw = _decode(body.data, BANNER_MAX)
    kind = _image_type(raw)  # by its bytes, not a claimed type, so nothing else is served as an image
    digest = hashlib.sha256(raw).hexdigest()
    _authorize(cid, "banner", body.host, digest, body.signedAt, body.signature)
    db.execute("INSERT OR REPLACE INTO competition_banners VALUES (?, ?, ?, ?, ?, ?, ?)",
               (cid, kind, digest, body.signature, body.signedAt, int(time.time()), raw))
    db.commit()
    return {"contentType": kind, "sha256": digest, "size": len(raw)}


def banner_of(cid: int) -> dict | None:
    r = db.execute("SELECT content_type, sha256, updated FROM competition_banners WHERE cid = ?", (cid,)).fetchone()
    return {"contentType": r[0], "sha256": r[1], "updatedAt": r[2]} if r else None


@router.get("/{cid}/banner")
def get_banner(cid: int):
    r = db.execute("SELECT content_type, sha256, data FROM competition_banners WHERE cid = ?", (cid,)).fetchone()
    if r is None:
        raise HTTPException(404, "this competition has no banner")
    return Response(bytes(r[2]), media_type=r[0], headers={"cache-control": "public, max-age=60",
                                                          "x-content-type-options": "nosniff"})


class ResourceIn(FileIn):
    spec: str  # JSON text: name, kind and, for an RL environment, how it is run


def _clean_spec(text: str) -> dict:
    try:
        s = json.loads(text)
    except ValueError:
        raise HTTPException(422, "spec must be JSON")
    if not isinstance(s, dict):
        raise HTTPException(422, "spec must be a JSON object")
    name = str(s.get("name", "")).strip()
    if not re.fullmatch(r"[\w.\- ]{1,80}", name):
        raise HTTPException(422, "name must be 1 to 80 letters, digits, spaces, dots, dashes or underscores")
    kind = s.get("kind")
    if kind not in ("environment", "starter", "data"):
        raise HTTPException(422, "kind must be environment, starter or data")
    out = {"name": name, "kind": kind, "description": str(s.get("description", ""))[:2000]}
    if kind == "environment":
        env = s.get("env", {})
        seeds = env.get("seeds", [])
        if (not isinstance(env.get("entrypoint"), str) or not 1 <= len(env["entrypoint"]) <= 200
                or not isinstance(seeds, list) or not 1 <= len(seeds) <= 64 or any(not isinstance(x, int) for x in seeds)):
            raise HTTPException(422, "an environment needs an entrypoint and 1 to 64 integer seeds")
        episodes, steps = env.get("episodes", 1), env.get("maxSteps", 1000)
        if not (isinstance(episodes, int) and 1 <= episodes <= 100 and isinstance(steps, int) and 1 <= steps <= 1_000_000):
            raise HTTPException(422, "episodes must be 1 to 100 and maxSteps 1 to 1,000,000")
        out["env"] = {"framework": "gymnasium", "entrypoint": env["entrypoint"], "seeds": seeds, "episodes": episodes,
                      "maxSteps": steps, "metric": "mean-return"}
    return out


@router.post("/{cid}/resources", status_code=201)
def put_resource(cid: int, body: ResourceIn):
    """Attach or replace a downloadable file. An environment is part of the rules, so it freezes on the first entry."""
    raw = _decode(body.data, RESOURCE_MAX)
    spec = _clean_spec(body.spec)
    file_hash = hashlib.sha256(raw).hexdigest()
    digest = hashlib.sha256((body.spec + "\n" + file_hash).encode()).hexdigest()
    c = _authorize(cid, "resource", body.host, digest, body.signedAt, body.signature)
    prior = db.execute("SELECT kind FROM competition_resources WHERE cid = ? AND name = ?", (cid, spec["name"])).fetchone()
    if c["entries"] > 0 and (spec["kind"] == "environment" or (prior and prior[0] == "environment")):
        raise HTTPException(409, {"code": "frozen", "fields": ["environment"],
                                  "message": "the environment can't change once someone has entered"})
    count = db.execute("SELECT COUNT(*) FROM competition_resources WHERE cid = ?", (cid,)).fetchone()[0]
    if not prior and count >= MAX_RESOURCES:
        raise HTTPException(409, f"a competition can have at most {MAX_RESOURCES} files")
    db.execute("INSERT OR REPLACE INTO competition_resources VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
               (cid, spec["name"], spec["kind"], json.dumps(spec), file_hash, len(raw), body.signature, body.signedAt,
                int(time.time()), raw))
    db.commit()
    return {**spec, "sha256": file_hash, "size": len(raw)}


def resources_of(cid: int) -> list[dict]:
    rows = db.execute("SELECT spec, sha256, size, updated FROM competition_resources WHERE cid = ? ORDER BY name", (cid,)).fetchall()
    return [{**json.loads(r[0]), "sha256": r[1], "size": r[2], "updatedAt": r[3]} for r in rows]


@router.get("/{cid}/resources")
def list_resources(cid: int):
    _competition(cid)
    return resources_of(cid)


@router.get("/{cid}/resources/{name}")
def get_resource(cid: int, name: str):
    r = db.execute("SELECT data FROM competition_resources WHERE cid = ? AND name = ?", (cid, name)).fetchone()
    if r is None:
        raise HTTPException(404, "no such file")
    safe = re.sub(r"[^\w.\-]", "_", name)
    return Response(bytes(r[0]), media_type="application/octet-stream",
                    headers={"content-disposition": f'attachment; filename="{safe}"', "x-content-type-options": "nosniff"})


def decorate(row: dict) -> dict:
    """A competition row with its listing: the host's settings, whether it has a banner, and its files."""
    return {**row, "listing": settings_of(row["id"]), "banner": banner_of(row["id"]), "resources": resources_of(row["id"])}
