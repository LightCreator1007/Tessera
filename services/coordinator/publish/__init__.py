"""Indexes each settled job's final model on Arkiv, off the settlement path, with a SQLite queue that resumes after a restart."""
import json
import logging
import re
import sqlite3
import threading
import time

from eth_utils import keccak

from api import config

log = logging.getLogger("tod.publish")

SCHEMA = "tod.model"  # Arkiv's arkiv.schema tag; readers filter on it plus our writer address
RECORD_VERSION = 1
CONTENT_TYPE = "application/x-tod-weights"
MAX_ATTEMPTS = 8
STUCK_TX = 30  # checks 5 s apart; after that a human looks at the tx before anything is signed again

db = sqlite3.connect(config.DB_PATH, check_same_thread=False)
db.execute("""CREATE TABLE IF NOT EXISTS published (
    job INTEGER PRIMARY KEY, round INTEGER, keccak TEXT, state TEXT, arkiv_key TEXT, tx TEXT,
    tx_checks INTEGER DEFAULT 0, error TEXT, attempts INTEGER DEFAULT 0, next_try REAL DEFAULT 0, updated INTEGER,
    swarm_ref TEXT)""")
if "swarm_ref" not in [c[1] for c in db.execute("PRAGMA table_info(published)")]:  # a table from before Swarm
    db.execute("ALTER TABLE published ADD COLUMN swarm_ref TEXT")
db.commit()
_lock = threading.Lock()  # the worker thread and request threads share this connection
HASH = re.compile(r"0x[0-9a-f]{64}")


def enqueue(job: int, round_: int, aggregate_hash: str):
    """The round driver calls this once a job's last round is final. A repeat with the same hash is a no-op; a new
    hash starts over. With Arkiv off it does nothing, so the driver can call it unconditionally."""
    if not config.ARKIV_ENABLED:
        return
    h = aggregate_hash.lower()
    if not HASH.fullmatch(h):
        raise ValueError("aggregate hash must be 0x and 64 hex digits")
    with _lock:
        row = db.execute("SELECT keccak FROM published WHERE job = ?", (job,)).fetchone()
        if row and row[0] == h:
            return
        db.execute("INSERT OR REPLACE INTO published (job, round, keccak, state, updated) VALUES (?, ?, ?, 'pending', ?)",
                   (job, round_, h, int(time.time())))
        db.commit()


def status(job: int) -> dict | None:
    if not config.ARKIV_ENABLED:
        return None
    row = db.execute("SELECT round, keccak, state, arkiv_key, tx, swarm_ref FROM published WHERE job = ?",
                     (job,)).fetchone()
    if not row:
        return None
    return {"round": row[0], "keccak": row[1], "state": row[2], "arkivKey": row[3], "arkivTx": row[4],
            "swarmRef": row[5]}


def record(job: int, round_: int, h: str, size: int, spec: dict | None, swarm_ref: str | None = None) -> dict:
    """The public record. Everything in it is a hash, a size, an id or a label; never a key, token or private URL."""
    spec = spec or {}
    rec = {"version": RECORD_VERSION, "kind": SCHEMA, "chainId": config.CHAIN_ID, "jobMarket": config.JOB_MARKET.lower(),
           "job": job, "round": round_, "keccak": h, "size": size, "contentType": CONTENT_TYPE,
           "workload": spec.get("workload", {}).get("id"), "datasetHash": spec.get("data", {}).get("datasetHash"),
           "visibility": "public"}
    if config.PUBLIC_URL:
        rec["url"] = f"{config.PUBLIC_URL}/v1/models/{h}"  # public, unlike /v1/blobs which needs a BlobAccess
    if swarm_ref:
        rec["swarmRef"] = swarm_ref  # GET /bytes/<swarmRef> on any Bee node or gateway; check the keccak after
    return rec


def attributes(rec: dict) -> dict:
    """The record as Arkiv attributes: the indexed fields readers filter on, plus the whole record as the payload."""
    attrs = {"arkiv.schema": rec["kind"], "payload": json.dumps(rec, sort_keys=True, separators=(",", ":")).encode()}
    for k in ("chainId", "jobMarket", "job", "round", "keccak", "size", "contentType", "workload", "datasetHash",
              "visibility", "swarmRef"):
        if rec.get(k) is not None:
            attrs[k] = rec[k]
    if rec.get("url") and len(rec["url"].encode()) <= 128:
        attrs["url"] = rec["url"]
    return attrs


def _set(job, **fields):
    cols = ", ".join(f"{k} = ?" for k in fields)
    with _lock:
        db.execute(f"UPDATE published SET {cols}, updated = ? WHERE job = ?", (*fields.values(), int(time.time()), job))
        db.commit()


def is_published(h: str) -> bool:
    """True if this hash is a final model we chose to make public. Only those are served without a BlobAccess."""
    return config.ARKIV_ENABLED and db.execute("SELECT 1 FROM published WHERE keccak = ? AND state != 'failed'",
                                                (h.lower(),)).fetchone() is not None


def swarm_ref_of(h: str) -> str | None:
    """The Swarm reference holding a published model's bytes, if Swarm has a copy."""
    row = db.execute("SELECT swarm_ref FROM published WHERE keccak = ? AND state != 'failed' AND swarm_ref IS NOT NULL",
                     (h.lower(),)).fetchone()
    return row[0] if row else None


def step(job: int, store, client, specs: dict) -> str:
    """Moves one job as far as it can go and returns its state. Safe to call again after a crash at any line."""
    row = db.execute("SELECT round, keccak, state, attempts, tx, tx_checks, swarm_ref FROM published WHERE job = ?",
                     (job,)).fetchone()
    if not row or row[2] != "pending":
        return row[2] if row else "absent"
    round_, h, _, attempts, tx, tx_checks, ref = row
    try:
        if tx:  # signed before, maybe before a crash: settle that transaction, never sign a second one
            return _settle(job, round_, tx, tx_checks, client)
        blob = store.get(h)
        if blob is None:
            return _retry(job, attempts, "model blob is not in the store yet")
        if "0x" + keccak(blob).hex() != h:
            # The store names files by keccak, so this is a corrupt file. Never index bytes the chain did not record.
            _set(job, state="failed", error="stored blob does not hash to the aggregate hash")
            return "failed"
        if config.SWARM_ENABLED and not ref:
            # Before the Arkiv create, so the record carries swarmRef from its first version. Saved straight away so
            # a crash after this never uploads again; a Swarm outage retries here like an Arkiv one.
            ref = swarm_client().put(blob, h)
            _set(job, swarm_ref=ref)
        rec = record(job, round_, h, len(blob), json.loads(specs[job]) if job in specs else None, ref)
        key = client.find(rec)  # a record from an earlier run that crashed after it was mined
        if key:
            return _indexed(job, round_, key, None)
        tx, raw = client.sign_create(attributes(rec), config.ARKIV_LIFETIME_BLOCKS)
        # The hash is saved before sending, so an unknown send outcome is settled by its receipt, never a resend.
        _set(job, tx=tx, tx_checks=0, next_try=time.time() + 4)  # one Arkiv block is 2 s
        _broadcast(job, raw, client)
        return "pending"
    except Exception as e:  # nothing was signed yet, so retrying is safe; settlement never waits on any of this
        return _retry(job, attempts, f"{type(e).__name__}: {str(e)[:200]}")


def _broadcast(job, raw, client):
    try:
        client.broadcast(raw)
    except Exception as e:  # "already known", a timeout or a lost reply: the receipt decides, not this error
        log.warning("publish job %s: send returned %s; waiting for the receipt", job,
                    _scrub(f"{type(e).__name__}: {str(e)[:200]}"))


def _settle(job, round_, tx, tx_checks, client):
    """Follows one signed create to its receipt. Arkiv's guidance is zero automatic re-signs, so a revert or a tx
    that never confirms stops at 'failed' for a human, who checks the explorer before the admin retry."""
    outcome, key = client.confirm(tx)
    if outcome == "ok":
        return _indexed(job, round_, key, tx)
    if outcome == "reverted":
        _set(job, state="failed", error=f"Arkiv create {tx} reverted")
        return "failed"
    if tx_checks + 1 >= STUCK_TX:
        _set(job, state="failed", error=f"Arkiv create {tx} not confirmed; check the explorer before retrying")
        return "failed"
    _set(job, tx_checks=tx_checks + 1, next_try=time.time() + 5)
    return "pending"


def _indexed(job, round_, key, tx):
    _set(job, state="indexed", arkiv_key=key, error=None, **({"tx": tx} if tx else {}))
    log.info("indexed job %s round %s on Arkiv as %s", job, round_, key)
    return "indexed"


def _scrub(text):
    """Backstop: the access key never reaches the log or the table, whatever an error message carries."""
    return text.replace(config.ARKIV_ACCESS_KEY, "<access key>") if config.ARKIV_ACCESS_KEY else text


def _retry(job, attempts, error):
    error = _scrub(error)
    attempts += 1
    if attempts >= MAX_ATTEMPTS:
        _set(job, state="failed", error=error, attempts=attempts)
        log.error("publish job %s failed for good: %s", job, error)
        return "failed"
    _set(job, error=error, attempts=attempts, next_try=time.time() + min(600, 5 * 2 ** attempts))
    log.warning("publish job %s: %s (try %s)", job, error, attempts)
    return "pending"


def retry(job: int) -> str | None:
    """Admin reset of a failed job back to pending."""
    row = status(job)
    if row is None:
        return None
    if row["state"] == "failed":
        # A human chose this. The next step looks for an existing record first, then signs a fresh create.
        _set(job, state="pending", attempts=0, next_try=0, error=None, tx=None, tx_checks=0)
    return status(job)["state"]


def due(now=None) -> list[int]:
    now = time.time() if now is None else now
    return [r[0] for r in db.execute("SELECT job FROM published WHERE state = 'pending' AND next_try <= ?", (now,))]


def run_due(store, client, specs) -> dict[int, str]:
    out = {}
    for job in due():
        try:
            out[job] = step(job, store, client, specs)
        except Exception:  # a bug in one job must not stop the others from being indexed
            log.exception("publish job %s crashed", job)
    return out


_client = None


def client():
    """The Arkiv client, built on first use so an app with publishing off never touches web3 or the key."""
    global _client
    if _client is None and config.ARKIV_ENABLED:
        from .arkiv import Arkiv
        _client = Arkiv(config.ARKIV_RPC_URL, config.ARKIV_PRIVATE_KEY, config.ARKIV_ACCESS_KEY)
    return _client


_swarm = None


def swarm_client():
    global _swarm
    if _swarm is None and config.SWARM_ENABLED:
        from .swarm import Swarm
        _swarm = Swarm(config.SWARM_API_URL, config.SWARM_BATCH_ID)
    return _swarm


def _int(v):
    return int(v, 16) if isinstance(v, str) else int(v)


def from_arkiv(row: dict) -> dict | None:
    """One arkiv_query row as a model record, or None if it is not a well-formed record of ours."""
    a = {x["name"]: x["value"] for x in row.get("attributes") or []}
    try:
        return {"arkivKey": row["key"], "owner": row["owner"], "expiresAt": _int(row["expiresAt"]),
                "job": _int(a["job"]), "round": _int(a["round"]), "keccak": a["keccak"], "size": _int(a["size"]),
                "chainId": _int(a["chainId"]), "jobMarket": "0x" + a["jobMarket"].removeprefix("0x")[-40:],
                "workload": a.get("workload"), "datasetHash": a.get("datasetHash"), "url": a.get("url"),
                "swarmRef": a.get("swarmRef")}
    except (KeyError, ValueError, TypeError):
        return None


def worker(store, client, specs, stop: threading.Event, every=2.0):
    """Background loop the app starts when Arkiv is configured."""
    while not stop.wait(every):
        run_due(store, client, specs)
