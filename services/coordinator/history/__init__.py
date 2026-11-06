"""Indexes the chain events that move an owner's money (pay, claims, slashes, stake, budgets) into SQLite, so the
app can show each owner's history without a chain indexer and a restart doesn't lose it."""
import json
import logging
import sqlite3
import threading

from tod_core.ledger import Kind
from tod_core.settle import KIND_NAMES

from api import config

log = logging.getLogger("tod.history")
PAGES_PER_PASS = 20
# Events that touch an owner's balance or standing. NodeJoined gives the operator -> owner map the rest need.
NAMES = ["NodeJoined", "Paid", "Claimed", "LeftoverClaimed", "ForfeitedToPool", "Slashed", "FailureConfirmed",
         "NoRevealReported", "StakeDeposited", "StakeWithdrawn", "JobCreated", "RefundWithdrawn"]

_lock = threading.Lock()
db = sqlite3.connect(config.DB_PATH, check_same_thread=False)
db.executescript("""
CREATE TABLE IF NOT EXISTS history_cursor (market TEXT PRIMARY KEY, next_block INTEGER);
CREATE TABLE IF NOT EXISTS operators (op TEXT PRIMARY KEY, owner TEXT);
CREATE TABLE IF NOT EXISTS owner_events (
    owner TEXT, kind TEXT, job INTEGER, round INTEGER, op TEXT, amount INTEGER, detail TEXT,
    block INTEGER, log_index INTEGER, tx TEXT, at INTEGER,
    PRIMARY KEY (block, log_index, owner));
CREATE INDEX IF NOT EXISTS owner_events_by_owner ON owner_events (owner, block DESC, log_index DESC);
""")
db.commit()


def _key(net) -> str:
    return f"{net.chain_id}:{net.market.lower()}"


def cursor(net) -> int:
    with _lock:
        row = db.execute("SELECT next_block FROM history_cursor WHERE market = ?", (_key(net),)).fetchone()
    return row[0] if row else net.deploy_block


def _owner_of(ledger, op: str) -> str:
    with _lock:
        row = db.execute("SELECT owner FROM operators WHERE op = ?", (op.lower(),)).fetchone()
    if row:
        return row[0]
    owner = ledger.registry.getNode(op).owner.lower()  # joined before the cursor's deploy block; only on a bad config
    with _lock:
        db.execute("INSERT OR REPLACE INTO operators VALUES (?, ?)", (op.lower(), owner))
    return owner


def rows(ledger, ev) -> list[tuple]:
    """The owner_events rows one event makes: (owner, kind, job, round, op, amount, detail)."""
    a, name = ev.args, ev.name
    job, rnd = a.get("jobId"), a.get("roundId")
    op = a.get("operator", "").lower() or None
    match name:
        case "NodeJoined":
            with _lock:
                db.execute("INSERT OR REPLACE INTO operators VALUES (?, ?)", (op, a["owner"].lower()))
            return [(a["owner"], "joined", None, None, op, None, None)]
        case "Paid":
            return [(a["owner"], "paid", job, rnd, op, a["amount"], None)]
        case "Claimed":
            return [(a["owner"], "claimed", None, None, None, a["amount"], None)]
        case "LeftoverClaimed":
            return [(a["owner"], "leftover", job, None, op, a["amount"], None)]
        case "ForfeitedToPool":
            return [(a["owner"], "forfeited", job, rnd, None, a["amount"], None)]
        case "Slashed":
            detail = {"toPot": a["toPot"], "burned": a["burned"]}
            return [(_owner_of(ledger, op), "slashed", job, rnd, op, a["taken"], detail)]
        case "FailureConfirmed":
            return [(_owner_of(ledger, op), "failure", job, rnd, op, None, {"kind": KIND_NAMES.get(Kind(a["kind"]), Kind(a["kind"]).name)})]
        case "NoRevealReported":
            detail = {"missed": a["missed"]}
            return [(_owner_of(ledger, op), "noReveal", job, rnd, op, a["penalty"], detail)]
        case "StakeDeposited":
            return [(_owner_of(ledger, op), "staked", None, None, op, a["amount"], {"stake": a["newStake"]})]
        case "StakeWithdrawn":
            return [(a["owner"], "unstaked", None, None, op, a["amount"], {"stake": a["newStake"]})]
        case "JobCreated":
            return [(a["requester"], "budget", job, None, None, a["budget"], {"fromBalance": a["fromBalance"]})]
        case "RefundWithdrawn":
            return [(a["requester"], "refund", job, None, None, a["amount"], None)]
    return []


def scan(ledger, confirmations: int) -> bool:
    """One pass over confirmed blocks not indexed yet. True once caught up. Rows are keyed by (block, log index,
    owner) and the cursor moves only after the pass is written, so a crash halfway just redoes the pass."""
    net = ledger.net
    start, head = cursor(net), ledger.w3.eth.block_number - confirmations
    if head < start:
        return True
    end = min(head, start + net.log_span * PAGES_PER_PASS - 1)
    times: dict[int, int] = {}
    out = []
    for ev in ledger.events(start, end, names=NAMES):
        if ev.block not in times:
            times[ev.block] = ev.timestamp or ledger.w3.eth.get_block(ev.block)["timestamp"]
        for owner, kind, job, rnd, op, amount, detail in rows(ledger, ev):
            out.append((owner.lower(), kind, job, rnd, op, amount, json.dumps(detail) if detail else None,
                        ev.block, ev.log_index, ev.tx_hash, times[ev.block]))
    with _lock:
        db.executemany("INSERT OR REPLACE INTO owner_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", out)
        db.execute("INSERT OR REPLACE INTO history_cursor VALUES (?, ?)", (_key(net), end + 1))
        db.commit()
    return end == head


def events(owner: str, limit: int, before: tuple[int, int] | None = None) -> list[dict]:
    """An owner's history, newest first. `before` is the (block, logIndex) of the last row of the previous page."""
    q = "SELECT kind, job, round, op, amount, detail, block, log_index, tx, at FROM owner_events WHERE owner = ?"
    args: list = [owner.lower()]
    if before:
        q += " AND (block < ? OR (block = ? AND log_index < ?))"
        args += [before[0], before[0], before[1]]
    q += " ORDER BY block DESC, log_index DESC LIMIT ?"
    with _lock:
        found = db.execute(q, (*args, limit)).fetchall()
    return [{"kind": k, "job": j, "round": r, "op": op, "amount": amt, "detail": json.loads(d) if d else None,
             "block": b, "logIndex": li, "tx": tx, "at": at} for k, j, r, op, amt, d, b, li, tx, at in found]


def operators(owner: str) -> list[str]:
    with _lock:
        return [r[0] for r in db.execute("SELECT op FROM operators WHERE owner = ? ORDER BY op", (owner.lower(),))]


def tally(owner: str) -> dict:
    """Per kind, how many events and their summed amount, plus the first event's time: the owner's record in one read."""
    with _lock:
        found = db.execute("SELECT kind, count(*), coalesce(sum(amount), 0), min(at) FROM owner_events WHERE owner = ? GROUP BY kind",
                           (owner.lower(),)).fetchall()
    first = min((r[3] for r in found if r[3] is not None), default=None)
    return {"kinds": {k: {"count": n, "amount": amt} for k, n, amt, _ in found}, "firstAt": first}


def indexed_to() -> int | None:
    """The last block indexed, or None before the first pass."""
    with _lock:
        row = db.execute("SELECT max(next_block) FROM history_cursor").fetchone()
    return row[0] - 1 if row and row[0] is not None else None


def watch(stop: threading.Event, opener=None, every: float = 15.0):
    """Background loop the app starts when TOD_NETWORK is set. Retries RPC failures; stops on a bad setting."""
    from publish.chain import Misconfigured, _scrub, open_ledger

    if not config.TOD_NETWORK:
        return
    ledger = None
    while not stop.wait(every):
        try:
            ledger = ledger or (opener or open_ledger)()
            while not scan(ledger, config.CHAIN_CONFIRMATIONS) and not stop.is_set():
                pass  # backfilling
        except Misconfigured as e:
            log.error("not indexing owner history: %s", _scrub(str(e)))
            return
        except Exception as e:  # RPC down or rate limited: the cursor did not move, so the next tick redoes it
            log.warning("owner history: %s: %s", type(e).__name__, _scrub(str(e))[:200])
