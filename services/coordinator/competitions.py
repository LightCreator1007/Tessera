"""Competitions as the contract has them, read from its views and events on demand and cached a few seconds."""
import json
import threading
import time

from api import config

TTL = 5  # s; a page polls every few seconds, and there are only ever a handful of competitions
_lock = threading.Lock()
_cache: dict = {"at": 0.0, "rows": []}
_ledger = None


def _contract(ledger):
    from tod_core.ledger import _load_abi  # the same generated ABI the ledger's bound calls use

    return ledger.w3.eth.contract(address=ledger.net.competitions, abi=_load_abi("Competitions"))


def status(c, now: int) -> str:
    """Where a competition stands, and so who can move it next."""
    if c["settled"]:
        return "settled"
    if now < c["deadline"]:
        return "open"  # entrants commit
    if not c["labelsRevealedAt"]:
        if now < c["deadline"] + c["revealWindow"]:
            return "awaiting-labels"  # the host reveals the labels
        return "labels-hidden" if c["entries"] else "refundable"  # entrants claimShare, or the host settles a refund
    if now < c["labelsRevealedAt"] + c["revealWindow"]:
        return "scoring"  # entrants reveal and get scored
    return "ready-to-settle"  # anyone calls settle


def _meta(text: str) -> dict:
    try:
        m = json.loads(text)
        return m if isinstance(m, dict) else {}
    except ValueError:
        return {}


def build(ledger) -> list[dict]:
    con = _contract(ledger)
    start = ledger.net.deploy_block
    logs = lambda ev: getattr(con.events, ev)().get_logs(from_block=start)  # noqa: E731
    created = {e.args.id: e for e in logs("Created")}
    entered: dict[int, list[str]] = {}
    for e in logs("Entered"):
        order = entered.setdefault(e.args.id, [])
        if e.args.entrant not in order:
            order.append(e.args.entrant)
    scores: dict[int, dict[str, int]] = {}
    for e in logs("EntryScored"):
        scores.setdefault(e.args.id, {})[e.args.entrant] = e.args.score
    settled = {e.args.id: e.args for e in logs("Settled")}
    shares: dict[int, int] = {}
    for e in logs("ShareClaimed"):
        shares[e.args.id] = shares.get(e.args.id, 0) + e.args.amount
    now = ledger.w3.eth.get_block("latest")["timestamp"]
    rows = []
    for cid in sorted(created, reverse=True):
        v = con.functions.competition(cid).call()
        c = {"host": v[0], "deadline": v[1], "revealWindow": v[2], "items": v[3], "prize": v[4], "labelsHash": v[5],
             "labelsRevealedAt": v[7], "entries": v[8], "scored": v[9], "best": v[10], "bestScore": v[11],
             "settled": v[13]}
        meta = _meta(created[cid].args.meta)
        order = entered.get(cid, [])
        first = {a: i for i, a in enumerate(order)}  # ties go to the earlier entrant, as in the contract
        board = sorted(scores.get(cid, {}).items(), key=lambda kv: (-kv[1], first.get(kv[0], 0)))
        s = settled.get(cid)
        rows.append({
            "id": cid, "host": c["host"], "title": str(meta.get("title") or f"Competition {cid}")[:120],
            "task": str(meta.get("task") or "")[:2000], "dataset": str(meta.get("dataset") or "")[:40],
            "prize": c["prize"], "deadline": c["deadline"],
            "revealWindow": c["revealWindow"], "items": c["items"], "labelsHash": "0x" + bytes(c["labelsHash"]).hex(),
            "status": status(c, now), "entries": c["entries"], "entrants": order, "scored": c["scored"],
            "labelsRevealedAt": c["labelsRevealedAt"] or None,
            "leaderboard": [{"entrant": a, "score": sc} for a, sc in board],
            "winner": c["best"] if c["scored"] else None, "bestScore": c["bestScore"] if c["scored"] else None,
            "settled": {"to": s.to, "amount": s.amount, "refunded": s.refunded} if s else None,
            "sharesPaid": shares.get(cid, 0), "createdBlock": created[cid].blockNumber,
        })
    return rows


def listing() -> list[dict]:
    """Every competition, newest first. Raises if the chain can't be read and nothing is cached."""
    global _ledger
    with _lock:
        if time.time() - _cache["at"] < TTL:
            return _cache["rows"]
        from publish.chain import open_ledger

        try:
            _ledger = _ledger or open_ledger()
            rows = build(_ledger)
        except Exception:
            if _cache["rows"]:
                return _cache["rows"]  # a dropped RPC call shouldn't blank the page
            raise
        _cache.update(at=time.time(), rows=rows)
        return rows


def enabled() -> bool:
    return bool(config.TOD_NETWORK and config.COMPETITIONS)
