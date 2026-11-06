"""Competition listings on Arkiv: one listing per competition, a result once settled, expiry after its windows."""
import json

import pytest
from eth_abi import decode

from api import config
from publish import arkiv
from publish import listings as L

COMPS = "0x" + "cd" * 20
NOW = 1_000_000


def comp(cid=1, settled=None, **over):
    return {"id": cid, "host": "0x" + "11" * 20, "title": "Read the digits", "task": "Predict the digit. " * 200,
            "prize": 20_000_000, "deadline": NOW + 600, "revealWindow": 120, "items": 1000,
            "labelsHash": "0x" + "ee" * 32, "settled": settled, "winner": None, "bestScore": None, **over}


class FakeArkiv:
    owner = "0x" + "77" * 20

    def __init__(self):
        self.sent, self.existing, self.outcome, self.fail = [], [], ("ok", "0x" + "aa" * 32), None

    def query(self, q, limit=100, attributes=True):
        if self.fail:
            raise self.fail
        return self.existing

    def sign_create(self, attrs, lifetime):
        self.sent.append((attrs, lifetime))
        arkiv.create_calldata(attrs, lifetime, 1)  # every attribute must encode, or the real client would fail here
        return "0x" + "77" * 32, "0xraw"

    def broadcast(self, raw):
        pass

    def confirm(self, tx):
        return self.outcome


@pytest.fixture
def on(monkeypatch):
    monkeypatch.setattr(config, "ARKIV_ENABLED", True)
    monkeypatch.setattr(config, "COMPETITIONS", COMPS)
    L.db.execute("DELETE FROM competition_listings")
    L.db.commit()
    return FakeArkiv()


def run(c, ark, kind=L.LISTING):
    L.enqueue(c)
    return L.step(c["id"], kind, c, ark, now=lambda: NOW)


def test_a_competition_is_listed_once_and_its_key_is_kept(on):
    ark = on
    assert run(comp(), ark) == "pending"
    (attrs, lifetime), = ark.sent
    assert attrs["arkiv.schema"] == "tod.competition" and attrs["competition"] == 1 and attrs["competitions"] == COMPS
    payload = json.loads(attrs["payload"])
    assert payload["task"].startswith("Predict the digit") and len(attrs["title"]) <= 40  # long text: payload only
    assert L.step(1, L.LISTING, comp(), ark, now=lambda: NOW) == "indexed"
    assert L.keys() == {1: {"listing": "0x" + "aa" * 32}}
    assert L.step(1, L.LISTING, comp(), ark) == "indexed" and len(ark.sent) == 1


def test_a_listing_expires_a_month_after_its_last_window(on):
    c = comp()
    want = (c["deadline"] + 2 * c["revealWindow"] + L.AFTER - NOW) // L.BLOCK
    assert L.lifetime(L.LISTING, c, NOW) == want
    assert L.lifetime(L.LISTING, comp(deadline=NOW - 10**9), NOW) == 43_200  # never under a day


def test_a_settled_competition_also_gets_a_result(on):
    ark = on
    done = comp(settled={"to": "0x" + "22" * 20, "amount": 20_000_000, "refunded": False},
                winner="0x" + "22" * 20, bestScore=887)
    L.enqueue(done)
    assert {k for _, k in L.q("SELECT cid, kind FROM competition_listings")} == {L.LISTING, L.RESULT}
    assert L.step(1, L.RESULT, done, ark, now=lambda: NOW) == "pending"
    attrs = ark.sent[-1][0]
    assert attrs["arkiv.schema"] == "tod.competition.result" and attrs["score"] == 887
    assert attrs["winner"] == "0x" + "22" * 20


def test_an_existing_record_is_reused_and_a_network_error_only_waits(on):
    ark = on
    ark.existing = [{"key": "0x" + "bb" * 32}]
    assert run(comp(), ark) == "indexed" and ark.sent == []
    ark.existing, ark.fail = [], ConnectionError("reset")
    assert run(comp(cid=2), ark) == "pending"
    assert L.q1("SELECT attempts FROM competition_listings WHERE cid = 2")[0] == 0


def test_listings_read_back_from_arkiv(on):
    ark = on
    rec = L.record(L.LISTING, comp())
    ark.existing = [{"key": "0x" + "cc" * 32, "expiresAt": "0x10",
                     "attributes": [{"name": "payload", "value": "0x" + json.dumps(rec).encode().hex()}]}]
    (got,) = L.list_from_arkiv(ark)
    assert got["title"] == "Read the digits" and got["arkivKey"] == "0x" + "cc" * 32 and got["expiresAt"] == 16


def test_attributes_encode_as_arkiv_calldata(on):
    data = arkiv.create_calldata(L.attributes(L.record(L.LISTING, comp())), 100, 7)
    (ops,) = decode(["(uint8,bytes)[]"], data[4:])
    assert ops[0][0] == arkiv.CREATE_OP


def test_a_rate_limited_lookup_does_not_stall_the_listing(on):
    import requests

    ark = on
    too_many = requests.Response()
    too_many.status_code = 429
    ark.fail = requests.HTTPError("429 Client Error: Too Many Requests", response=too_many)
    assert run(comp(), ark) == "pending" and len(ark.sent) == 1  # created without the lookup
