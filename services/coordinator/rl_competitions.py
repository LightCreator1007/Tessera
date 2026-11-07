"""RL competitions as RLCompetitions has them, read from its views and events on demand and cached a few seconds."""
import threading
import time

from api import config
from competitions import _block_time, _meta, event_logs

TTL = 5
_lock = threading.Lock()
_cache: dict = {"at": 0.0, "rows": []}
_ledger = None
_set: dict = {}


def enabled() -> bool:
    return bool(config.TOD_NETWORK and config.RL_COMPETITIONS)


def _contract(ledger):
    from tod_core.ledger import _load_abi

    return ledger.w3.eth.contract(address=ledger.net.rl_competitions, abi=_load_abi("RLCompetitions"))


def status(c: dict, now: int) -> str:
    """Where it stands, and so who moves it next."""
    if c["settled"]:
        return "settled"
    if now < c["deadline"]:
        return "open"  # entrants commit a policy
    if not c["seedsRevealedAt"]:
        if now < c["deadline"] + c["revealWindow"]:
            return "awaiting-seeds"  # the host reveals the seeds
        return "seeds-hidden" if c["entries"] else "refundable"
    if now < c["seedsRevealedAt"] + c["revealWindow"]:
        return "revealing"  # entrants reveal their policy and upload it; verifiers start running them
    if now < c["seedsRevealedAt"] + 2 * c["revealWindow"]:
        return "scoring"  # verifiers finish; anyone posts their signed scores
    return "ready-to-settle"


def ranked(entrants: list[dict]) -> list[dict]:
    """Best score first; a tie goes to the earlier last commit, as the contract breaks it."""
    scored = sorted((e for e in entrants if e["score"] is not None), key=lambda e: (-e["score"], e["seq"]))
    for i, e in enumerate(scored):
        e["rank"] = i + 1
        e["tied"] = any(o is not e and o["score"] == e["score"] for o in scored)
    return scored + [e for e in entrants if e["score"] is None]


def build(ledger) -> list[dict]:
    con, w3 = _contract(ledger), ledger.w3

    def logs(ev):
        found = event_logs(ledger, con, ev)
        return sorted(found, key=lambda e: (e.blockNumber, e.logIndex))

    created = {e.args["id"]: e for e in logs("Created")}
    entered, revealed, scored, settled = logs("Entered"), logs("PolicyRevealed"), logs("EntryScored"), logs("Settled")
    claimed = logs("ShareClaimed")
    now = w3.eth.get_block("latest")["timestamp"]
    rows = []
    for cid in sorted(created, reverse=True):
        v = con.functions.competition(cid).call()
        c = {"id": cid, "host": v[0], "deadline": v[1], "revealWindow": v[2], "episodes": v[3], "maxSteps": v[4],
             "prize": v[5], "env": "0x" + bytes(v[6]).hex(), "seedsHash": "0x" + bytes(v[7]).hex(),
             "seedsRevealedAt": v[9], "entries": v[10], "scored": v[11], "best": v[12] if v[11] else None,
             "bestScore": v[13] if v[11] else None, "settled": v[15]}
        c["seeds"] = list(con.functions.seedsOf(cid).call()) if c["seedsRevealedAt"] else None
        people: dict[str, dict] = {}
        for e in (x for x in entered if x.args["id"] == cid):
            p = people.setdefault(e.args["entrant"].lower(), {"entrant": e.args["entrant"].lower(), "commits": 0,
                                                             "enteredAt": _block_time(w3, e.blockNumber)})
            p["commits"] += 1
            p["lastCommitAt"] = _block_time(w3, e.blockNumber)
        for p in people.values():
            ev = con.functions.entry(cid, w3.to_checksum_address(p["entrant"])).call()
            p.update(seq=ev[1], policy="0x" + bytes(ev[2]).hex() if ev[2] != b"\x00" * 32 else None, score=None,
                     rank=None, tied=False, share=0)
        for e in (x for x in scored if x.args["id"] == cid):
            people[e.args["entrant"].lower()]["score"] = e.args["score"]
        for e in (x for x in claimed if x.args["id"] == cid):
            people[e.args["entrant"].lower()]["share"] = e.args["amount"]
        s = next((x.args for x in settled if x.args["id"] == cid), None)
        meta = _meta(created[cid].args["meta"])
        rows.append({**c, "title": meta.get("title") or f"RL competition {cid}", "task": meta.get("task", ""),
                     "createdBlock": created[cid].blockNumber, "status": status(c, now), "now": now,
                     "policyReveals": sum(1 for x in revealed if x.args["id"] == cid),
                     "standings": ranked(list(people.values())),
                     "settledTo": {"to": s["to"], "amount": s["amount"], "refunded": s["refunded"]} if s else None})
    return rows


def listing(max_age: float = TTL) -> list[dict]:
    """Every RL competition, newest first. Raises if the chain can't be read and nothing is cached."""
    global _ledger
    with _lock:
        if time.time() - _cache["at"] < max_age:
            return _cache["rows"]
        from publish.chain import open_ledger

        try:
            _ledger = _ledger or open_ledger()
            rows = build(_ledger)
        except Exception:
            if _cache["rows"]:
                return _cache["rows"]
            raise
        _cache.update(at=time.time(), rows=rows)
        return rows


def verifiers() -> list[str]:
    """The contract's verifier set, which never changes once deployed."""
    if not _set:
        listing()
        con = _contract(_ledger)
        _set.update(verifiers=[a.lower() for a in con.functions.verifiers().call()],
                    threshold=con.functions.threshold().call())
    return _set["verifiers"]


def threshold() -> int:
    verifiers()
    return _set["threshold"]


def address() -> str:
    listing()
    return _ledger.net.rl_competitions
