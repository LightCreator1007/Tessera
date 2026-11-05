"""Node request signing, heartbeats, the fleet and pool views, and the admin routes."""
import time

from eth_account import Account
from eth_account.messages import encode_defunct
from fastapi.testclient import TestClient

from api import app as A, auth, tables as T

c = TestClient(A.app)
OP = Account.create()
BEAT = "/v1/nodes/heartbeat"
FIRST = {"version": "0.1.0", "busy": False, "profile": {"arch": "arm64", "cores": 8},
         "selftest": {"mlp-exact/1": {"hash": "0x00", "seconds": 1.2, "ok": True},
                      "cnn-torch/1": {"hash": "0x00", "seconds": 9.0, "ok": False}}}


def test_heartbeat_then_fleet_and_pool(node_post):
    assert node_post(OP, BEAT, FIRST).status_code == 200
    later = {"version": "0.1.0", "busy": True, "job": 1, "prewarm": {"image": "sha256:ab", "datasets": ["0x01"]}}
    assert node_post(OP, BEAT, later).status_code == 200
    me = next(n for n in c.get("/v1/nodes").json() if n["op"] == OP.address)
    assert me["arch"] == "arm64" and me["workloads"] == ["mlp-exact/1"]  # kept from the first heartbeat
    assert me["online"] and not me["idle"] and me["prewarm"]["image"] == "sha256:ab"
    pool = c.get("/v1/pool").json()
    assert pool["online"] >= 1 and pool["busy"] >= 1


def test_unsigned_stale_or_mismatched_writes_are_refused(node_post):
    assert node_post(OP, BEAT, FIRST, ts=int(time.time()) - 31).status_code == 401  # stale timestamp
    assert node_post(OP, BEAT, FIRST, as_op=Account.create()).status_code == 401  # signer is not X-Operator
    assert c.post(BEAT, json=FIRST).status_code == 422  # no signature headers
    ts = int(time.time())
    sig = OP.sign_message(encode_defunct(text=f"POST\n{BEAT}\n{ts}\n{'0' * 64}")).signature  # over another body
    headers = {"X-Operator": OP.address, "X-Timestamp": str(ts), "X-Signature": "0x" + sig.hex()}
    assert c.post(BEAT, json=FIRST, headers=headers).status_code == 401


def test_admin_needs_localhost_and_the_token(monkeypatch):
    ok = {"Authorization": "Bearer test-token"}
    assert c.post("/v1/admin/jobs/1/pause", headers=ok).status_code == 403  # TestClient is not localhost
    monkeypatch.setattr(auth, "LOCAL_HOSTS", {"testclient"})
    assert c.post("/v1/admin/jobs/1/pause", headers={"Authorization": "Bearer nope"}).status_code == 403
    assert c.post("/v1/admin/jobs/1/pause", headers=ok).json() == {"auto": True, "paused": True}
    assert c.post("/v1/admin/jobs/1/mode", json={"auto": False}, headers=ok).json()["auto"] is False
    monkeypatch.setitem(T.MISSED, OP.address.lower(), 2)
    c.post(f"/v1/admin/nodes/{OP.address}/rearm", headers=ok)
    assert OP.address.lower() not in T.MISSED
    assert c.get("/v1/admin/txs", headers=ok).json() == []
    monkeypatch.setattr(auth.config, "ADMIN_TOKEN", "")
    assert c.get("/v1/admin/txs", headers={"Authorization": "Bearer "}).status_code == 403  # no token, no admin
