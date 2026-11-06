"""System, workload and job routes, a stable OpenAPI export, and the evidence schema against example documents."""
import json
import pathlib

import jsonschema
from fastapi.testclient import TestClient

from api import app as A, tables as T
from api.export import render
from api.models import Job, ProviderCompute, Round, Workload

c = TestClient(A.app)
H = "0x" + "11" * 32
OP = "0x" + "aa" * 20


def test_health_and_config():
    h = c.get("/v1/health").json()
    assert h["ok"] and h["chainId"] == 31337 and h["block"] is None
    assert c.get("/v1/config").json()["threshold"] == 2


def test_unknown_job_is_404():
    assert c.get("/v1/jobs/99").status_code == 404
    assert c.get("/v1/jobs/99/rounds/0").status_code == 404


def test_job_routes_return_their_shapes(monkeypatch):
    job = Job(id=1, status="running", workload="mlp-exact/1", requester=OP, budget=100, remaining=90,
              rounds=10, currentRound=0, stakePerNode=15_000_000, modelSpecHash=H)
    rnd = Round(job=1, round=1, status="finalized", startHash=H, aggregateHash=H, roster=[{"op": OP, "shard": 0}],
                committed=[OP], revealed=[OP], seed=H, confirmed=[], outcome="Accepted",
                payouts=[{"op": OP, "amount": 10}])
    monkeypatch.setitem(T.JOBS, 1, job)
    monkeypatch.setitem(T.ROUNDS, 1, {1: rnd})
    monkeypatch.setitem(T.SPECS, 1, b'{"version":4}')
    monkeypatch.setitem(T.MODELS, 1, H)
    monkeypatch.setitem(T.WORKLOADS, "mlp-exact/1",
                        Workload(id="mlp-exact/1", replayClass="exact", defaults={"H": 200}, tier="core"))
    assert c.get("/v1/jobs").json()[0]["trust"] == "chain"
    assert [j["id"] for j in c.get("/v1/jobs", params={"requester": OP.upper().replace("0X", "0x")}).json()] == [1]
    assert c.get("/v1/jobs", params={"requester": "0x" + "00" * 20}).json() == []
    assert c.get("/v1/jobs/1/spec").content == b'{"version":4}'
    assert c.get("/v1/jobs/1/rounds").json() == [{"round": 1, "status": "finalized", "startHash": H, "aggregateHash": H}]
    assert c.get("/v1/jobs/1/rounds/1").json()["outcome"] == "Accepted"
    assert [c.get(f"/v1/jobs/1/rounds/{r}").status_code for r in (0, 2)] == [404, 404]  # round ids start at 1
    assert c.get("/v1/jobs/1/model", follow_redirects=False).headers["location"] == f"/v1/blobs/{H}"
    assert c.get("/v1/workloads/mlp-exact/1").json()["replayClass"] == "exact"


def test_provider_compute_is_zero_until_work_is_credited(monkeypatch):
    assert c.get(f"/v1/providers/{OP}/compute").json() == {"owner": OP, "rounds": 0, "ops": 0, "trust": "chain"}
    monkeypatch.setitem(T.PROVIDERS, OP, ProviderCompute(owner=OP, rounds=2, ops=10_570_094_400))
    assert c.get(f"/v1/providers/{OP.upper().replace('0X', '0x')}/compute").json()["ops"] == 10_570_094_400


# The routes clients are built against; the exported schema must keep every one.
ROUTES = """
GET /v1/health                                  GET /v1/config
GET /v1/workloads                               GET /v1/workloads/{wid}
GET /v1/workloads/{wid}/selftest                POST /v1/jobs/draft
GET /v1/jobs                                    GET /v1/jobs/{job}
GET /v1/jobs/{job}/spec                         GET /v1/jobs/{job}/state
GET /v1/jobs/{job}/model                        GET /v1/jobs/{job}/rounds
GET /v1/jobs/{job}/rounds/{r}                   GET /v1/jobs/{job}/rounds/{r}/evidence
POST /v1/jobs/{job}/rounds/{r}/disputes         GET /v1/jobs/{job}/rounds/{r}/settlement
POST /v1/jobs/{job}/rounds/{r}/signatures       GET /v1/blobs/{h}
PUT /v1/blobs/{h}                               HEAD /v1/blobs/{h}
POST /v1/nodes/heartbeat                        GET /v1/nodes
GET /v1/pool                                    POST /v1/admin/jobs/{job}/mode
POST /v1/admin/jobs/{job}/pause                 POST /v1/admin/nodes/{op}/rearm
GET /v1/admin/txs                               GET /v1/models
POST /v1/admin/jobs/{job}/publish               GET /v1/providers/{owner}/compute
"""


def test_openapi_export_keeps_every_client_route():
    doc = json.loads(render())
    exported = {(m.upper(), p) for p, ops in doc["paths"].items() for m in ops}
    words = ROUTES.split()
    assert set(zip(words[::2], words[1::2])) <= exported


def test_evidence_schema_accepts_examples():
    schema = json.loads((pathlib.Path(__file__).parents[3] / "vectors/evidence.schema.json").read_text())
    jsonschema.Draft202012Validator.check_schema(schema)
    f = "3ff0000000000000"
    pay = {"job": 3, "round": 7, "mode": "equal", "budget": 11, "eligible": [OP], "graduated": [OP],
           "payouts": [{"op": OP, "amount": 11}], "forfeits": [], "toPool": 0, "drip": 0,
           "players": None, "vTable": None, "phi": None, "slice": None}
    report = {"kind": "verifierReport", "job": 3, "round": 7, "verifier": OP, "start": H, "kernel": "exact/1",
              "numpy": "2.1.0", "platform": "linux/arm64",
              "nodes": [{"op": OP, "shard": 0, "committed": H, "replayHash": H, "match": True, "err": f, "upd": f,
                         "verdict": "pass", "fetch": "not-needed"}]}
    agg = {"kind": "aggregateEvidence", "job": 3, "round": 7, "start": H, "revealed": [{"op": OP, "hash": H}],
           "confirmed": [], "matcher": {"inputs": {}, "roster": [{"op": OP, "shard": 0}]},
           "merge": {"accepted": [OP], "clipNorm": f, "trimPerSide": 0},
           "gate": {"valBefore": f, "valAfter": f, "band": f, "result": "pass", "leaveOneOut": [], "dropped": None},
           "outer": {"kind": "avg"}, "aggregate": H, "outcome": "Accepted",
           "features": None, "handoffs": None, "detector": None}
    v = jsonschema.Draft202012Validator(schema)
    for doc in (pay, report, agg):
        v.validate(doc)
    assert not v.is_valid(dict(pay, budget=1.5))
