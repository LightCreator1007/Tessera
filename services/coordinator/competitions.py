"""Competitions as the contract has them, read from its views and events on demand and cached a few seconds."""
import json
import threading
import time
from dataclasses import dataclass, field

from requests import HTTPError

from api import config

TTL = 5  # s; a page polls every few seconds, and there are only ever a handful of competitions
MATRIX_MAX_CLASSES = 20  # a confusion matrix past this many classes is too big to read, so only per-class rows are sent
_lock = threading.Lock()
_cache: dict = {"at": 0.0, "rows": []}
_ledger = None
_block_times: dict[int, int] = {}  # a block's timestamp never changes
_reveals: dict[tuple[int, str], bytes | None] = {}  # nor does a revealed entry's predictions
_labels: dict[int, bytes] = {}


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


@dataclass
class Log:
    """The parts of one event log the read model uses, so it can be built and tested without a chain."""
    args: dict
    block: int
    index: int
    tx: str = ""
    at: int | None = None


@dataclass
class Entrant:
    entrant: str
    commits: int = 0
    first: Log | None = None
    last: Log | None = None
    score: int | None = None
    scored: Log | None = None
    share: int = 0
    extra: dict = field(default_factory=dict)


def entrants_of(entered: list[Log], scored: list[Log], claimed: list[Log]) -> dict[str, Entrant]:
    """One record per entrant of a competition, in first-entry order. Logs must be in chain order."""
    out: dict[str, Entrant] = {}
    for e in entered:
        r = out.setdefault(e.args["entrant"], Entrant(e.args["entrant"]))
        r.commits += 1
        r.first = r.first or e
        r.last = e
    for e in scored:
        if e.args["entrant"] in out:
            out[e.args["entrant"]].score = e.args["score"]
            out[e.args["entrant"]].scored = e
    for e in claimed:
        if e.args["entrant"] in out:
            out[e.args["entrant"]].share += e.args["amount"]
    return out


def ranked(rows: dict[str, Entrant]) -> list[dict]:
    """Every entrant, scored ones first by score, ties to the earlier last commit as the contract breaks them."""
    def order(r: Entrant):
        return (r.last.block, r.last.index) if r.last else (0, 0)

    scored = sorted((r for r in rows.values() if r.score is not None), key=lambda r: (-r.score, order(r)))
    out, prev = [], None
    for i, r in enumerate(scored):
        tied = prev is not None and prev.score == r.score
        if tied:
            out[-1]["tied"] = True
        out.append({**_entrant_row(r), "rank": i + 1, "tied": tied})
        prev = r
    out += [{**_entrant_row(r), "rank": None, "tied": False} for r in rows.values() if r.score is None]
    return out


def _entrant_row(r: Entrant) -> dict:
    return {"entrant": r.entrant, "state": "scored" if r.score is not None else "committed", "score": r.score,
            "commits": r.commits, "enteredAt": r.first.at if r.first else None,
            "lastCommitAt": r.last.at if r.last else None, "scoredAt": r.scored.at if r.scored else None,
            "revealTx": r.scored.tx if r.scored else None, "share": r.share}


def assemble(cid: int, view: dict, meta: dict, created_block: int, entered: list[Log], scored: list[Log],
             claimed: list[Log], settled: dict | None, now: int) -> dict:
    """One competition's public record, from its contract view and its logs."""
    people = entrants_of(entered, scored, claimed)
    board = ranked(people)
    return {
        "id": cid, "host": view["host"], "title": str(meta.get("title") or f"Competition {cid}")[:120],
        "task": str(meta.get("task") or "")[:2000], "dataset": str(meta.get("dataset") or "")[:40],
        "prize": view["prize"], "deadline": view["deadline"],
        "revealWindow": view["revealWindow"], "items": view["items"], "labelsHash": view["labelsHash"],
        "status": status(view, now), "entries": view["entries"], "entrants": list(people), "scored": view["scored"],
        "labelsRevealedAt": view["labelsRevealedAt"] or None,
        "leaderboard": [{"entrant": r["entrant"], "score": r["score"], "rank": r["rank"], "tied": r["tied"]}
                        for r in board if r["rank"] is not None],
        "standings": board,
        "winner": view["best"] if view["scored"] else None, "bestScore": view["bestScore"] if view["scored"] else None,
        "settled": settled, "sharesPaid": sum(p.share for p in people.values()), "createdBlock": created_block,
        "now": now,
    }


def _block_time(w3, block: int) -> int:
    if block not in _block_times:
        _block_times[block] = w3.eth.get_block(block)["timestamp"]
    return _block_times[block]


def event_logs(ledger, con, event: str):
    """Keep competition scans within the network RPC's block range limit."""
    end = ledger.w3.eth.block_number
    span = max(1, ledger.net.log_span)
    for start in range(ledger.net.deploy_block, end + 1, span):
        for attempt in range(5):
            try:
                page = getattr(con.events, event)().get_logs(from_block=start, to_block=min(start + span - 1, end))
                break
            except HTTPError as e:
                if getattr(e.response, "status_code", None) != 429 or attempt == 4:
                    raise
                time.sleep(0.5 * 2 ** attempt)
        yield from page


def build(ledger) -> list[dict]:
    con = _contract(ledger)
    w3 = ledger.w3

    def logs(ev, timed=False) -> list[Log]:
        found = sorted(event_logs(ledger, con, ev), key=lambda e: (e.blockNumber, e.logIndex))
        return [Log(dict(e.args), e.blockNumber, e.logIndex, "0x" + bytes(e.transactionHash).hex(),
                    _block_time(w3, e.blockNumber) if timed else None) for e in found]

    by_id = lambda found: {cid: [e for e in found if e.args["id"] == cid] for cid in {e.args["id"] for e in found}}  # noqa: E731
    created = {e.args["id"]: e for e in logs("Created")}
    entered, scored, claimed = by_id(logs("Entered", True)), by_id(logs("EntryScored", True)), by_id(logs("ShareClaimed"))
    settled = {e.args["id"]: e.args for e in logs("Settled")}
    now = w3.eth.get_block("latest")["timestamp"]
    rows = []
    for cid in sorted(created, reverse=True):
        v = con.functions.competition(cid).call()
        view = {"host": v[0], "deadline": v[1], "revealWindow": v[2], "items": v[3], "prize": v[4],
                "labelsHash": "0x" + bytes(v[5]).hex(), "labelsRevealedAt": v[7], "entries": v[8], "scored": v[9],
                "best": v[10], "bestScore": v[11], "settled": v[13]}
        s = settled.get(cid)
        rows.append(assemble(cid, view, _meta(created[cid].args["meta"]), created[cid].block, entered.get(cid, []),
                             scored.get(cid, []), claimed.get(cid, []),
                             {"to": s["to"], "amount": s["amount"], "refunded": s["refunded"]} if s else None, now))
    return rows


def listing(max_age: float = TTL) -> list[dict]:
    """Every competition, newest first. Raises if the chain can't be read and nothing is cached."""
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
                return _cache["rows"]  # a dropped RPC call shouldn't blank the page
            raise
        _cache.update(at=time.time(), rows=rows)
        return rows


def breakdown(labels: bytes, predictions: bytes) -> dict:
    """How one entry did per class: counts and hits for each true label, and the confusion cells when they are few."""
    per: dict[int, list[int]] = {}
    cells: dict[tuple[int, int], int] = {}
    for t, p in zip(labels, predictions):
        row = per.setdefault(t, [0, 0])
        row[0] += 1
        row[1] += t == p
        cells[(t, p)] = cells.get((t, p), 0) + 1
    classes = sorted(set(labels) | set(predictions))
    return {
        "correct": sum(h for _, h in per.values()), "items": len(labels),
        "perClass": [{"label": k, "count": n, "correct": h} for k, (n, h) in sorted(per.items())],
        "classes": classes,
        "confusion": ([{"label": t, "predicted": p, "count": n} for (t, p), n in sorted(cells.items())]
                      if len(classes) <= MATRIX_MAX_CLASSES else None),
    }


def _revealed_predictions(con, cid: int, entrant: str, tx: str) -> bytes | None:
    """The predictions an entry was scored on, from the revealEntry call that scored it. None when a contract made that call."""
    key = (cid, entrant.lower())
    if key not in _reveals:
        raw = con.w3.eth.get_transaction(tx)
        try:
            fn, args = con.decode_function_input(raw["input"])
        except (ValueError, KeyError):  # not a call this ABI knows, such as a multicall
            fn, args = None, {}
        ok = fn is not None and fn.fn_name == "revealEntry" and args["id"] == cid and args["entrant"].lower() == key[1]
        _reveals[key] = bytes(args["predictions"]) if ok else None
    return _reveals[key]


def entry(cid: int, entrant: str) -> dict | None:
    """One entrant's standing in one competition, with what they predicted once it was revealed and scored."""
    row = next((c for c in listing() if c["id"] == cid), None)
    if row is None:
        return None
    me = next((s for s in row["standings"] if s["entrant"].lower() == entrant.lower()), None)
    out = {"competition": cid, "entrant": entrant, "status": row["status"], "items": row["items"], "entered": me is not None,
           **(me or {}), "of": len(row["standings"]), "scoredCount": len(row["leaderboard"]),
           "predictions": None, "breakdown": None, "unavailable": None}
    if not me or me["state"] != "scored":
        return out
    con = _contract(_ledger)
    preds = _revealed_predictions(con, cid, me["entrant"], me["revealTx"])
    if preds is None:
        out["unavailable"] = "This entry was revealed through another contract, so its predictions aren't read here."
        return out
    if cid not in _labels:
        _labels[cid] = bytes(con.functions.labelsOf(cid).call())
    out["predictions"] = "0x" + preds.hex()
    out["breakdown"] = breakdown(_labels[cid], preds)
    return out


def of_owner(owner: str) -> dict:
    """Every competition an address hosted or entered, with what it won or got back."""
    o = owner.lower()
    hosted, entered = [], []
    for c in listing():
        base = {"id": c["id"], "title": c["title"], "status": c["status"], "prize": c["prize"], "deadline": c["deadline"],
                "entries": c["entries"]}
        s = c["settled"]
        if c["host"].lower() == o:
            hosted.append({**base, "refunded": s["amount"] if s and s["refunded"] else 0})
        me = next((r for r in c["standings"] if r["entrant"].lower() == o), None)
        if me:
            won = s["amount"] if s and not s["refunded"] and s["to"].lower() == o else 0
            entered.append({**base, "state": me["state"], "score": me["score"], "rank": me["rank"], "tied": me["tied"],
                            "items": c["items"], "won": won, "share": me["share"], "commits": me["commits"]})
    return {"owner": o, "hosted": hosted, "entered": entered,
            "won": sum(e["won"] for e in entered), "shares": sum(e["share"] for e in entered),
            "wins": sum(1 for e in entered if e["won"]), "refunded": sum(h["refunded"] for h in hosted)}


def enabled() -> bool:
    return bool(config.TOD_NETWORK and config.COMPETITIONS)
