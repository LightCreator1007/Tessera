"""Owner history: chain events become per-owner rows once, survive a re-scan, page newest first, and reach the route."""
from types import SimpleNamespace as NS

import pytest
from fastapi.testclient import TestClient

import history
from api import app as A
from tod_core.ledger import Event, Kind

OWNER, OTHER, REQ = "0x" + "aa" * 20, "0x" + "bb" * 20, "0x" + "cc" * 20
OP = "0x" + "11" * 20
TX = "0x" + "ee" * 32


def ev(name, block, i, **args):
    return Event(name, args, block, i, TX, None)


EVENTS = [
    ev("NodeJoined", 10, 0, operator=OP, owner=OWNER, nullifier=b"\0" * 32),
    ev("StakeDeposited", 10, 1, operator=OP, amount=15, newStake=15),
    ev("JobCreated", 11, 0, jobId=1, requester=REQ, budget=60, fromBalance=0),
    ev("Paid", 12, 0, jobId=1, roundId=1, operator=OP, owner=OWNER, amount=5),
    ev("FailureConfirmed", 13, 0, jobId=1, roundId=2, operator=OP, kind=int(Kind.REPLAY_MISMATCH)),
    ev("Slashed", 13, 1, jobId=1, roundId=2, operator=OP, taken=15, toPot=7, burned=8),
    ev("Claimed", 14, 0, owner=OWNER, amount=5),
    ev("Claimed", 14, 1, owner=OTHER, amount=9),
]


class Ledger:
    def __init__(self, events, head=20):
        self.net = NS(chain_id=31337, market="0x" + "99" * 20, deploy_block=1, log_span=100)
        self.w3 = NS(eth=NS(block_number=head, get_block=lambda n: {"timestamp": 1000 + n}))
        self.registry = NS(getNode=lambda op: NS(owner=OWNER))
        self._events = events

    def events(self, start, end, names=None):
        return [e for e in self._events if start <= e.block <= end and (names is None or e.name in names)]


@pytest.fixture(autouse=True)
def empty():
    with history._lock:
        for t in ("owner_events", "operators", "history_cursor"):
            history.db.execute(f"DELETE FROM {t}")
        history.db.commit()


def test_events_become_owner_rows_with_reasons():
    assert history.scan(Ledger(EVENTS), 0)
    got = history.events(OWNER, 50)
    assert [e["kind"] for e in got] == ["claimed", "slashed", "failure", "paid", "staked", "joined"]
    slashed = got[1]
    assert (slashed["amount"], slashed["detail"], slashed["job"], slashed["round"]) == (15, {"toPot": 7, "burned": 8}, 1, 2)
    assert got[2]["detail"] == {"kind": "ReplayMismatch"} and got[0]["at"] == 1014
    assert [e["kind"] for e in history.events(REQ, 50)] == ["budget"]
    assert history.operators(OWNER) == [OP] and history.indexed_to() == 20


def test_a_rescan_does_not_duplicate_and_new_blocks_are_picked_up():
    led = Ledger(EVENTS, head=12)
    history.scan(led, 0)
    with history._lock:
        history.db.execute("DELETE FROM history_cursor")  # as if the cursor write was lost in a crash
    led.w3.eth.block_number = 20
    history.scan(led, 0)
    assert len(history.events(OWNER, 50)) == 6


def test_confirmations_hold_back_recent_blocks():
    history.scan(Ledger(EVENTS, head=14), 2)
    assert [e["kind"] for e in history.events(OWNER, 50)][0] == "paid" and history.indexed_to() == 12


def test_an_operator_joined_before_the_cursor_is_looked_up_on_chain():
    history.scan(Ledger([e for e in EVENTS if e.name == "Slashed"]), 0)
    assert history.events(OWNER, 50)[0]["kind"] == "slashed"


def test_route_pages_newest_first():
    history.scan(Ledger(EVENTS), 0)
    c = TestClient(A.app)
    first = c.get(f"/v1/owners/{OWNER}/history", params={"limit": 4}).json()
    assert [e["kind"] for e in first["events"]] == ["claimed", "slashed", "failure", "paid"]
    assert first["next"] == "12:0" and first["operators"] == [OP] and first["indexedTo"] == 20
    rest = c.get(f"/v1/owners/{OWNER.upper().replace('0X', '0x')}/history",
                 params={"limit": 4, "before": first["next"]}).json()
    assert [e["kind"] for e in rest["events"]] == ["staked", "joined"] and rest["next"] is None
    assert c.get("/v1/owners/0x12/history").status_code == 400
    assert c.get(f"/v1/owners/{OWNER}/history", params={"before": "x"}).status_code == 400


def test_record_tallies_one_owner():
    history.scan(Ledger(EVENTS), 0)
    c = TestClient(A.app)
    r = c.get(f"/v1/owners/{OWNER}").json()
    assert r["operators"] == [OP] and r["indexedTo"] == 20 and r["firstAt"] == 1010
    assert r["kinds"]["paid"] == {"count": 1, "amount": 5} and r["kinds"]["slashed"]["amount"] == 15
    assert "budget" not in r["kinds"]
    assert c.get(f"/v1/owners/{REQ}").json()["kinds"]["budget"] == {"count": 1, "amount": 60}
    assert c.get("/v1/owners/0x12").status_code == 400
