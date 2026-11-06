"""Arkiv publishing: the execute() calldata, the resumable queue against a fake Arkiv, and the job and model routes."""
import json

import pytest
from eth_abi import decode
from eth_utils import keccak
from fastapi.testclient import TestClient

import publish as P
from api import app as A, auth, config, tables as T
from api.models import Job
from publish import arkiv
from store import DiskStore

MARKET = "0x" + "ab" * 20
H32 = "0x" + "11" * 32


class FakeArkiv:
    """Stands in for the network: records what was sent and answers like the node would."""

    def __init__(self):
        self.sent, self.existing, self.outcome, self.fail = [], None, ("ok", "0x" + "ee" * 32), None

    def find(self, rec):
        if self.fail:
            raise self.fail
        return self.existing

    def send_create(self, attrs, lifetime):
        if self.fail:
            raise self.fail
        self.sent.append((attrs, lifetime))
        return "0x" + "77" * 32

    def confirm(self, tx):
        return self.outcome

    def list_models(self, schema, market, limit=100):
        return [{"key": "0x" + "ee" * 32, "owner": "0x" + "cd" * 20, "expiresAt": "0x64",
                 "attributes": [{"name": "job", "type": "u64", "value": "0x7"},
                                {"name": "round", "type": "u64", "value": "0xc"},
                                {"name": "keccak", "type": "str", "value": H32},
                                {"name": "size", "type": "u64", "value": "0x10"},
                                {"name": "chainId", "type": "u64", "value": "0x14a34"},
                                {"name": "jobMarket", "type": "addr", "value": "0x" + "00" * 12 + "ab" * 20},
                                {"name": "workload", "type": "str", "value": "mlp-exact/1"}]},
                {"key": "0x" + "ff" * 32, "owner": "0x" + "cd" * 20, "expiresAt": "0x1", "attributes": []}]


@pytest.fixture
def on(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "ARKIV_ENABLED", True)
    monkeypatch.setattr(config, "JOB_MARKET", MARKET)
    P.db.execute("DELETE FROM published")
    P.db.commit()
    return DiskStore(str(tmp_path)), FakeArkiv()


def test_selector_matches_the_documented_one():
    assert arkiv.EXECUTE.hex() == "49650044"


def test_create_calldata_is_sorted_typed_and_decodes():
    attrs = {"round": 3, "arkiv.schema": "tod.model", "jobMarket": MARKET, "payload": b"{}", "job": 7, "url": "x"}
    data = arkiv.create_calldata(attrs, 1000, salt=5)
    assert data[:4] == arkiv.EXECUTE
    (ops,) = decode(["(uint8,bytes)[]"], data[4:])
    assert ops[0][0] == 1
    ((salt, expires_at, lifetime, flags, attributes),) = decode(
        ["(uint128,uint64,uint64,uint8,(bytes32,uint8,bytes)[])"], ops[0][1])
    assert (salt, expires_at, lifetime, flags) == (5, 0, 1000, 2)  # permissionless extension, not read-only
    names = [a[0].rstrip(b"\0").decode() for a in attributes]
    assert names == ["arkiv.schema", "job", "jobMarket", "payload", "round", "url"]  # strictly ascending bytes
    by = {a[0].rstrip(b"\0").decode(): a for a in attributes}
    assert by["job"][1] == 0x83 and int.from_bytes(by["job"][2], "big") == 7
    assert by["jobMarket"][1] == 0x89 and by["jobMarket"][2] == bytes(12) + bytes.fromhex("ab" * 20)
    assert by["arkiv.schema"][1] == 0x88 and by["payload"][1] == 7 and by["url"][1] == 8  # url is not indexed


def test_calldata_rejects_what_the_contract_would_revert_on():
    with pytest.raises(ValueError):
        arkiv.create_calldata({"workload": "x" * 129}, 10, 0)
    with pytest.raises(ValueError):
        arkiv.create_calldata({"job": 1}, arkiv.MAX_LIFETIME + 1, 0)
    with pytest.raises(ValueError):
        arkiv.create_calldata({f"a{i}": "x" for i in range(33)}, 10, 0)


def test_record_holds_only_public_fields(on):
    spec = {"workload": {"id": "mlp-exact/1"}, "data": {"datasetHash": H32}}
    attrs = P.attributes(P.record(7, 12, H32, 400, spec))
    assert attrs["arkiv.schema"] == "tod.model" and attrs["keccak"] == H32 and attrs["datasetHash"] == H32
    payload = json.loads(attrs["payload"])
    assert payload["visibility"] == "public" and payload["jobMarket"] == MARKET
    blob = json.dumps(payload).lower()
    assert "key" not in [k.lower() for k in payload] and "private" not in blob


def test_settled_model_ends_indexed_after_send_and_confirm(on):
    store, ark = on
    h = store.put(b"weights")
    P.enqueue(7, 12, h)
    assert P.step(7, store, ark, {}) == "pending" and len(ark.sent) == 1
    assert P.step(7, store, ark, {}) == "indexed"
    assert P.status(7)["arkivKey"] == "0x" + "ee" * 32 and len(ark.sent) == 1
    P.enqueue(7, 12, h)  # the driver calling again changes nothing
    assert P.status(7)["state"] == "indexed"


def test_corrupt_blob_is_never_indexed(on, tmp_path):
    store, ark = on
    h = store.put(b"weights")
    (tmp_path / (h[2:] + ".bin")).write_bytes(b"other")
    P.enqueue(7, 12, h)
    assert P.step(7, store, ark, {}) == "failed" and ark.sent == []


def test_restart_after_send_confirms_instead_of_sending_again(on):
    store, ark = on
    P.enqueue(7, 12, store.put(b"weights"))
    P.step(7, store, ark, {})
    ark.outcome = ("pending", None)
    assert P.step(7, store, ark, {}) == "pending"  # not mined yet
    ark.outcome = ("ok", "0x" + "ee" * 32)
    assert P.step(7, store, ark, {}) == "indexed" and len(ark.sent) == 1


def test_record_from_an_earlier_run_is_adopted(on):
    store, ark = on
    ark.existing = "0x" + "dd" * 32
    P.enqueue(7, 12, store.put(b"weights"))
    assert P.step(7, store, ark, {}) == "indexed" and ark.sent == []


def test_arkiv_down_only_delays_and_gives_up_after_max_attempts(on):
    store, ark = on
    ark.fail = ConnectionError("no route")
    P.enqueue(7, 12, store.put(b"weights"))
    states = [P.step(7, store, ark, {}) for _ in range(P.MAX_ATTEMPTS)]
    assert states[:-1] == ["pending"] * (P.MAX_ATTEMPTS - 1) and states[-1] == "failed"
    assert P.due() == []
    ark.fail = None
    assert P.retry(7) == "pending" and P.step(7, store, ark, {}) == "pending"


def test_enqueue_rejects_a_malformed_hash(on):
    with pytest.raises(ValueError):
        P.enqueue(7, 1, "0x1234' OR 1")


def test_record_url_is_the_public_route(on, monkeypatch):
    monkeypatch.setattr(config, "PUBLIC_URL", "https://coord.example")
    assert P.record(7, 1, H32, 1, None)["url"] == f"https://coord.example/v1/models/{H32}"


def test_public_route_serves_only_published_models(on):
    store, ark = on
    c = TestClient(A.app)
    h, other = store.put(b"weights"), store.put(b"private checkpoint")
    A.blobs.store, saved = store, A.blobs.store
    try:
        assert c.get(f"/v1/models/{h}").status_code == 404  # not queued, so not public
        P.enqueue(7, 12, h)
        r = c.get(f"/v1/models/{h}")
        assert r.status_code == 200 and "0x" + keccak(r.content).hex() == h
        assert c.get(f"/v1/models/{other}").status_code == 404  # other blobs stay behind BlobAccess
    finally:
        A.blobs.store = saved


def test_off_by_default_does_nothing(monkeypatch):
    monkeypatch.setattr(config, "ARKIV_ENABLED", False)
    P.enqueue(9, 1, H32)
    assert P.status(9) is None


def test_job_route_shows_published_and_models_reads_arkiv(on, monkeypatch):
    store, ark = on
    monkeypatch.setattr(P, "_client", ark)
    monkeypatch.setattr(A, "_models_cache", {"at": 0.0, "rows": []})
    c = TestClient(A.app)
    T.JOBS[7] = Job(id=7, status="completed", workload="mlp-exact/1", requester="0x" + "aa" * 20, budget=1,
                    remaining=0, rounds=12, currentRound=None, stakePerNode=1, modelSpecHash=H32)
    try:
        assert c.get("/v1/jobs/7").json()["published"] is None
        P.enqueue(7, 12, H32)
        assert c.get("/v1/jobs/7").json()["published"]["state"] == "pending"
        models = c.get("/v1/models").json()
        assert len(models) == 1  # the malformed row is dropped
        assert models[0]["job"] == 7 and models[0]["round"] == 12 and models[0]["jobMarket"] == MARKET
        assert models[0]["chainId"] == 84532
    finally:
        T.JOBS.pop(7)


def test_models_is_503_when_off(monkeypatch):
    monkeypatch.setattr(config, "ARKIV_ENABLED", False)
    assert TestClient(A.app).get("/v1/models").status_code == 503


def test_admin_publish_queues_the_latest_model(on, monkeypatch):
    monkeypatch.setattr(auth, "LOCAL_HOSTS", {"testclient"})
    c = TestClient(A.app)
    ok = {"Authorization": "Bearer test-token"}
    assert c.post("/v1/admin/jobs/8/publish", headers=ok).status_code == 404
    T.MODELS[8] = H32
    try:
        r = c.post("/v1/admin/jobs/8/publish", headers=ok)
        assert r.status_code == 200 and r.json()["state"] == "pending" and r.json()["keccak"] == H32
    finally:
        T.MODELS.pop(8)


def test_access_key_never_reaches_the_log_or_table(on, monkeypatch, caplog):
    store, ark = on
    monkeypatch.setattr(config, "ARKIV_ACCESS_KEY", "sekret123")
    ark.fail = ConnectionError("POST https://rpc.example/sekret123 failed")
    P.enqueue(7, 12, store.put(b"weights"))
    P.step(7, store, ark, {})
    row = P.db.execute("SELECT error FROM published WHERE job = 7").fetchone()[0]
    assert "sekret123" not in row and "sekret123" not in caplog.text and "<access key>" in row


def test_client_sends_the_access_key_as_a_header_not_in_the_url():
    c = arkiv.Arkiv("https://rpc.example", "0x" + "01" * 32, access_key="sekret123")
    assert c.w3.provider.endpoint_uri == "https://rpc.example"
    headers = c.w3.provider.get_request_kwargs()["headers"]
    assert headers["X-API-KEY"] == "sekret123" and headers["Content-Type"] == "application/json"
    assert arkiv.Arkiv("https://rpc.example", "0x" + "01" * 32).w3.provider.get_request_kwargs()["headers"] == {
        "Content-Type": "application/json"}


def test_only_an_unknown_tx_counts_as_pending():
    from web3.exceptions import TransactionNotFound

    c = arkiv.Arkiv("https://rpc.example", "0x" + "01" * 32)

    class Eth:
        def __init__(self, exc):
            self.exc = exc

        def get_transaction_receipt(self, _):
            raise self.exc

    c.w3 = type("W3", (), {"eth": Eth(TransactionNotFound("not yet"))})()
    assert c.confirm("0x" + "77" * 32) == ("pending", None)
    c.w3.eth = Eth(ConnectionError("down"))
    with pytest.raises(ConnectionError):  # an outage is retried with backoff, not mistaken for a dropped tx
        c.confirm("0x" + "77" * 32)


def test_refuses_to_start_with_the_coordinator_key_as_the_arkiv_key(tmp_path):
    import os
    import subprocess
    import sys
    from pathlib import Path

    from eth_account import Account

    key = Account.create().key.hex()
    env = {**os.environ, "DB_PATH": str(tmp_path / "t.db"), "COORDINATOR_PRIVATE_KEY": key, "ARKIV_PRIVATE_KEY": key}
    run = subprocess.run([sys.executable, "-c", "import api.config"], cwd=Path(__file__).resolve().parents[1], env=env,
                         capture_output=True, text=True)
    assert run.returncode != 0 and "must not be the coordinator's key" in run.stderr
