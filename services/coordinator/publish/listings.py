"""Lists each competition on Arkiv while it runs, and records its result once settled, from our Arkiv key."""
import json
import logging
import threading
import time

from eth_utils import to_checksum_address

from api import config
from api.db import connect

from . import MAX_ATTEMPTS, RATE_LIMIT_WAIT, STUCK_TX, _broadcast, _scrub, rate_limited
from .arkiv import MAX_LIFETIME, q_str

log = logging.getLogger("tod.publish.listings")
LISTING, RESULT = "tod.competition", "tod.competition.result"
AFTER = 30 * 86400  # s a listing stays findable after its last window closes
BLOCK = 2  # s per Arkiv block

db = connect(config.DB_PATH)  # locked: the worker writes while request threads read keys()
db.execute("""CREATE TABLE IF NOT EXISTS competition_listings (
    cid INTEGER, kind TEXT, state TEXT, arkiv_key TEXT, tx TEXT, tx_checks INTEGER DEFAULT 0, error TEXT,
    attempts INTEGER DEFAULT 0, next_try REAL DEFAULT 0, updated INTEGER, PRIMARY KEY (cid, kind))""")
db.commit()


def q(sql: str, args=()) -> list:
    return db.execute(sql, args).fetchall()


def q1(sql: str, args=()):
    return db.execute(sql, args).fetchone()


def transient(e: Exception) -> bool:
    """A 429 or the network failing waits without using up a try; venue Wi-Fi drops in bursts."""
    return rate_limited(e) or isinstance(e, OSError)


def enabled() -> bool:
    return config.ARKIV_ENABLED and bool(config.COMPETITIONS)


def record(kind: str, c: dict) -> dict:
    """The public record: ids, amounts, hashes and the host's own title and task. Never a key or a private URL."""
    base = {"version": 1, "kind": kind, "chainId": config.CHAIN_ID, "competitions": config.COMPETITIONS.lower(),
            "competition": c["id"], "items": c["items"], "prize": c["prize"]}
    if kind == LISTING:
        return {**base, "host": c["host"].lower(), "title": c["title"], "task": c["task"], "deadline": c["deadline"],
                "revealWindow": c["revealWindow"], "labelsHash": c["labelsHash"]}
    s = c["settled"]
    return {**base, "to": s["to"].lower(), "refunded": s["refunded"], "score": c["bestScore"] or 0,
            "winner": (c["winner"] or "").lower() or None}


def attributes(rec: dict) -> dict:
    """Indexed fields readers filter on, plus the whole record as the payload. Task text can pass Arkiv's 128-byte
    string limit, so it only lives in the payload."""
    attrs = {"arkiv.schema": rec["kind"], "payload": json.dumps(rec, sort_keys=True, separators=(",", ":")).encode()}
    for k in ("chainId", "competitions", "competition", "items", "prize", "host", "deadline", "labelsHash", "score",
              "winner"):
        if rec.get(k) is not None:
            attrs[k] = rec[k]
    if rec.get("title"):
        attrs["title"] = rec["title"][:40]  # a short label for listings; the full title is in the payload
    return attrs


def lifetime(kind: str, c: dict, now: float) -> int:
    """A listing lasts until a month after its last reveal window; a result for the default model lifetime."""
    if kind == RESULT:
        return config.ARKIV_LIFETIME_BLOCKS
    end = c["deadline"] + 2 * c["revealWindow"] + AFTER
    return max(43_200, min(MAX_LIFETIME, int((end - now) / BLOCK)))  # at least a day


def find(client, rec: dict) -> str | None:
    """Our own live record for this competition and kind, if a run before a crash already made it."""
    qs = (f"arkiv.schema = {q_str(rec['kind'])} AND $owner = addr({client.owner}) "
          f"AND competitions = addr({to_checksum_address(rec['competitions'])}) "
          f"AND competition = u64({rec['competition']})")
    rows = client.query(qs, limit=1, attributes=False)
    return rows[0]["key"] if rows else None


ADD = "INSERT OR IGNORE INTO competition_listings (cid, kind, state, updated) VALUES (?, ?, 'pending', ?)"


def enqueue(c: dict) -> None:
    db.execute(ADD, (c["id"], LISTING, int(time.time())))
    if c["settled"]:
        db.execute(ADD, (c["id"], RESULT, int(time.time())))
    db.commit()


def _set(cid, kind, **fields):
    cols = ", ".join(f"{k} = ?" for k in fields)
    db.execute(f"UPDATE competition_listings SET {cols}, updated = ? WHERE cid = ? AND kind = ?",
               (*fields.values(), int(time.time()), cid, kind))
    db.commit()


def step(cid: int, kind: str, c: dict, client, now=time.time) -> str:
    """Moves one record as far as it can go. Same rules as the model publisher: the tx hash is saved before sending,
    a mined create is found before signing another, and nothing is re-signed on its own."""
    row = q1("SELECT state, tx, tx_checks, attempts FROM competition_listings WHERE cid = ? AND kind = ?", (cid, kind))
    if not row or row[0] != "pending":
        return row[0] if row else "absent"
    _, tx, tx_checks, attempts = row
    try:
        if tx:
            outcome, key = client.confirm(tx)
            if outcome == "ok":
                _set(cid, kind, state="indexed", arkiv_key=key, error=None)
                log.info("listed competition %s (%s) on Arkiv as %s", cid, kind, key)
                return "indexed"
            if outcome == "reverted" or tx_checks + 1 >= STUCK_TX:
                _set(cid, kind, state="failed", error=f"Arkiv create {tx} {outcome}; check it before retrying")
                return "failed"
            _set(cid, kind, tx_checks=tx_checks + 1, next_try=now() + 5)
            return "pending"
        rec = record(kind, c)
        key = find(client, rec)
        if key:
            _set(cid, kind, state="indexed", arkiv_key=key, error=None)
            return "indexed"
        tx, raw = client.sign_create(attributes(rec), lifetime(kind, c, now()))
        _set(cid, kind, tx=tx, tx_checks=0, next_try=now() + 4)  # saved before anything is sent
        _broadcast(cid, raw, client)
        return "pending"
    except Exception as e:  # nothing was signed yet, so retrying is safe
        error = _scrub(f"{type(e).__name__}: {str(e)[:200]}")
        if transient(e):
            _set(cid, kind, error=error, next_try=now() + RATE_LIMIT_WAIT)
            return "pending"
        attempts += 1
        failed = attempts >= MAX_ATTEMPTS
        _set(cid, kind, error=error, attempts=attempts, next_try=now() + min(600, 5 * 2 ** attempts),
             **({"state": "failed"} if failed else {}))
        log.warning("competition %s (%s): %s (try %s)", cid, kind, error, attempts)
        return "failed" if failed else "pending"


def keys() -> dict[int, dict[str, str]]:
    """{competition id: {"listing": key, "result": key}} for the records Arkiv has confirmed."""
    out: dict[int, dict[str, str]] = {}
    for cid, kind, key in q("SELECT cid, kind, arkiv_key FROM competition_listings WHERE state = 'indexed'"):
        out.setdefault(cid, {})["listing" if kind == LISTING else "result"] = key
    return out


def worker(client, listing, stop: threading.Event, every=5.0):
    """Background loop the app starts when Arkiv and Competitions are both configured."""
    while not stop.wait(every):
        try:
            rows = {c["id"]: c for c in listing()}
        except Exception as e:  # the chain read failed; the next pass tries again
            log.warning("competition listings: %s", _scrub(str(e))[:200])
            continue
        for c in rows.values():
            enqueue(c)
        due = q("SELECT cid, kind FROM competition_listings WHERE state = 'pending' AND next_try <= ?", (time.time(),))
        for cid, kind in due:
            if cid in rows:
                try:
                    step(cid, kind, rows[cid], client)
                except Exception:  # one broken record must not stop the others
                    log.exception("competition %s (%s) crashed", cid, kind)


def list_from_arkiv(client) -> list[dict]:
    """Every live listing our writer made for this Competitions contract, newest first, read from Arkiv."""
    qs = (f"arkiv.schema = {q_str(LISTING)} AND $owner = addr({client.owner}) "
          f"AND competitions = addr({to_checksum_address(config.COMPETITIONS)}) ORDER BY competition:u64 DESC")
    out = []
    for row in client.query(qs, limit=100):
        a = {x["name"]: x["value"] for x in row.get("attributes") or []}
        try:
            raw = a["payload"]
            rec = json.loads(bytes.fromhex(raw[2:]) if isinstance(raw, str) and raw.startswith("0x") else raw)
        except (KeyError, ValueError, TypeError):
            continue
        exp = row.get("expiresAt")
        out.append({**rec, "arkivKey": row["key"], "expiresAt": int(exp, 16) if isinstance(exp, str) else exp})
    return out

