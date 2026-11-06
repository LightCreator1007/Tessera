"""Admin job controls and node re-arms survive a restart, and a paused job can be resumed."""
from fastapi.testclient import TestClient

from api import app as A, auth, persist, tables as T

OK = {"Authorization": "Bearer test-token"}
OP = "0x" + "12" * 20
c = TestClient(A.app)


def test_pause_mode_and_rearm_come_back_after_a_restart(monkeypatch):
    monkeypatch.setattr(auth, "LOCAL_HOSTS", {"testclient"})
    monkeypatch.setattr(T, "CONTROL", {})
    monkeypatch.setattr(T, "REARMED", {})
    c.post("/v1/admin/jobs/7/pause", headers=OK)
    c.post("/v1/admin/jobs/8/mode", json={"auto": False}, headers=OK)
    c.post(f"/v1/admin/nodes/{OP}/rearm", headers=OK)
    rearmed_at = T.REARMED[OP]
    monkeypatch.setattr(T, "CONTROL", {})  # the restart
    monkeypatch.setattr(T, "REARMED", {})
    persist.load()
    assert T.CONTROL == {7: {"auto": True, "paused": True}, 8: {"auto": False, "paused": False}}
    assert T.REARMED == {OP: rearmed_at}
    assert c.post("/v1/admin/jobs/7/resume", headers=OK).json() == {"auto": True, "paused": False}
    monkeypatch.setattr(T, "CONTROL", {})
    persist.load()
    assert T.CONTROL[7]["paused"] is False
