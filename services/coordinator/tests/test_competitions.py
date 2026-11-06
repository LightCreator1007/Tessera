"""Competition lifecycle, entrant standings, per-class breakdowns and the entry and owner read routes."""
from fastapi.testclient import TestClient

import competitions as C

BASE = {"settled": False, "deadline": 100, "revealWindow": 50, "labelsRevealedAt": 0, "entries": 2}
A, B, D = "0x" + "a" * 40, "0x" + "b" * 40, "0x" + "d" * 40
HOST = "0x" + "1" * 40


def at(now, **over):
    return C.status({**BASE, **over}, now)


def test_status_walks_the_lifecycle():
    assert at(99) == "open"
    assert at(100) == "awaiting-labels"
    assert at(150) == "labels-hidden"  # the host missed the window: entrants share the prize
    assert at(150, entries=0) == "refundable"
    assert at(160, labelsRevealedAt=120) == "scoring"
    assert at(170, labelsRevealedAt=120) == "ready-to-settle"
    assert at(999, labelsRevealedAt=120, settled=True) == "settled"


def test_meta_is_forgiving():
    assert C._meta('{"title": "digits"}') == {"title": "digits"}
    assert C._meta("not json") == {} and C._meta("[1]") == {}


def entered(who, block, index=0, at=None):
    return C.Log({"id": 1, "entrant": who}, block, index, at=at)


def scored(who, score, block=50, tx="0xfeed"):
    return C.Log({"id": 1, "entrant": who, "score": score}, block, 0, tx, at=900)


def test_ties_go_to_the_earlier_last_commit_like_the_contract():
    # A entered first but replaced the entry last, so B's latest commit is earlier and B wins the tie.
    people = C.entrants_of([entered(A, 1), entered(B, 2), entered(A, 3)], [scored(A, 7), scored(B, 7)], [])
    board = C.ranked(people)
    assert [r["entrant"] for r in board] == [B, A]
    assert [r["rank"] for r in board] == [1, 2]
    assert all(r["tied"] for r in board)
    assert people[A].commits == 2 and list(people) == [A, B]  # first-entry order is kept for the entrants list


def test_unrevealed_entrants_stay_in_the_standings_without_a_rank():
    board = C.ranked(C.entrants_of([entered(A, 1), entered(B, 2)], [scored(B, 3)], []))
    assert board[0]["entrant"] == B and board[0]["rank"] == 1 and not board[0]["tied"]
    assert board[1] == {**board[1], "entrant": A, "rank": None, "state": "committed", "score": None}


def test_shares_add_up_per_entrant():
    claimed = [C.Log({"id": 1, "entrant": A, "amount": 5}, 9, 0), C.Log({"id": 1, "entrant": B, "amount": 5}, 9, 1)]
    people = C.entrants_of([entered(A, 1), entered(B, 2)], [], claimed)
    assert people[A].share == 5 and people[B].share == 5


def view(**over):
    return {"host": HOST, "deadline": 100, "revealWindow": 50, "items": 4, "prize": 10_000_000, "labelsHash": "0x00",
            "labelsRevealedAt": 120, "entries": 2, "scored": 1, "best": B, "bestScore": 3, "settled": False, **over}


def row(**over):
    return C.assemble(1, view(**over), {"title": "Digits"}, 7, [entered(A, 1, at=10), entered(B, 2, at=20)],
                      [scored(B, 3)], [], over.pop("settled_log", None), 200)


def test_assemble_keeps_the_old_fields_and_adds_standings():
    r = row()
    assert r["leaderboard"] == [{"entrant": B, "score": 3, "rank": 1, "tied": False}]
    assert r["entrants"] == [A, B] and r["status"] == "ready-to-settle" and r["winner"] == B
    assert [s["entrant"] for s in r["standings"]] == [B, A]
    assert r["standings"][1]["enteredAt"] == 10 and r["standings"][0]["revealTx"] == "0xfeed"


def test_breakdown_counts_hits_per_class_and_the_confusion_cells():
    b = C.breakdown(bytes([0, 0, 1, 2]), bytes([0, 1, 1, 1]))
    assert b["correct"] == 2 and b["items"] == 4
    assert b["perClass"] == [{"label": 0, "count": 2, "correct": 1}, {"label": 1, "count": 1, "correct": 1},
                             {"label": 2, "count": 1, "correct": 0}]
    assert {"label": 2, "predicted": 1, "count": 1} in b["confusion"]


def test_breakdown_drops_the_matrix_when_there_are_too_many_classes():
    many = bytes(range(C.MATRIX_MAX_CLASSES + 1))
    assert C.breakdown(many, many)["confusion"] is None


def settled_row():
    r = row()
    r["settled"] = {"to": B, "amount": 10_000_000, "refunded": False}
    return r


def test_owner_record_counts_wins_and_hosting(monkeypatch):
    monkeypatch.setattr(C, "listing", lambda: [settled_row()])
    b = C.of_owner(B.upper().replace("0X", "0x"))
    assert b["won"] == 10_000_000 and b["wins"] == 1 and b["entered"][0]["rank"] == 1
    a = C.of_owner(A)
    assert a["won"] == 0 and a["entered"][0]["state"] == "committed" and a["entered"][0]["rank"] is None
    h = C.of_owner(HOST)
    assert h["hosted"][0]["refunded"] == 0 and h["entered"] == []
    assert C.of_owner(D) == {"owner": D, "hosted": [], "entered": [], "won": 0, "shares": 0, "wins": 0, "refunded": 0}


def test_entry_route(monkeypatch):
    from api import app as A_
    from api import config

    client = TestClient(A_.app)
    monkeypatch.setattr(config, "COMPETITIONS", "")
    assert client.get(f"/v1/competitions/1/entries/{A}").status_code == 503
    monkeypatch.setattr(config, "COMPETITIONS", "0x" + "c" * 40)
    monkeypatch.setattr(config, "TOD_NETWORK", "anvil")
    monkeypatch.setattr(C, "listing", lambda: [row()])
    monkeypatch.setattr(C, "_contract", lambda ledger: None)
    monkeypatch.setattr(C, "_revealed_predictions", lambda con, cid, who, tx: bytes([0, 1, 1, 2]))
    monkeypatch.setitem(C._labels, 1, bytes([0, 1, 1, 1]))

    assert client.get("/v1/competitions/1/entries/nope").status_code == 400
    assert client.get(f"/v1/competitions/9/entries/{A}").status_code == 404
    unscored = client.get(f"/v1/competitions/1/entries/{A}").json()
    assert unscored["entered"] and unscored["state"] == "committed" and unscored["breakdown"] is None
    stranger = client.get(f"/v1/competitions/1/entries/{D}").json()
    assert stranger["entered"] is False and stranger["of"] == 2
    best = client.get(f"/v1/competitions/1/entries/{B}").json()
    assert best["rank"] == 1 and best["predictions"] == "0x00010102" and best["breakdown"]["correct"] == 3

    monkeypatch.setattr(C, "_revealed_predictions", lambda con, cid, who, tx: None)
    assert "another contract" in client.get(f"/v1/competitions/1/entries/{B}").json()["unavailable"]

    def broken():
        raise ConnectionError("rpc down")

    monkeypatch.setattr(C, "listing", broken)
    assert client.get(f"/v1/owners/{B}/competitions").status_code == 502
