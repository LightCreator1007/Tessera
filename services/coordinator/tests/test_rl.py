"""RL competition routes: files must match their onchain hashes, the queue, and verifier-signed scores."""
import base64
import hashlib

import pytest
from eth_account import Account
from fastapi.testclient import TestClient
from tod_core import encodings

import rl_competitions as R
from api import config
from api import rl as A

CONTRACT = "0x" + "e" * 40
V1, V2, STRANGER = Account.create(), Account.create(), Account.create()
ALICE = "0x" + "a" * 40
ENV, POLICY = b"class Env: pass\n", b"def act(obs):\n    return 0\n"
sha = lambda b: "0x" + hashlib.sha256(b).hexdigest()  # noqa: E731


@pytest.fixture
def comp(monkeypatch):
    state = {"status": "revealing", "policy": sha(POLICY), "score": None}

    def row():
        return {"id": 3, "env": sha(ENV), "status": state["status"], "seeds": [7, 11], "episodes": 2, "maxSteps": 50,
                "standings": [{"entrant": ALICE, "policy": state["policy"], "score": state["score"]}]}

    monkeypatch.setattr(config, "RL_COMPETITIONS", CONTRACT)
    monkeypatch.setattr(config, "TOD_NETWORK", "anvil")
    monkeypatch.setattr(R, "listing", lambda max_age=R.TTL: [row()])
    monkeypatch.setattr(R, "address", lambda: CONTRACT)
    monkeypatch.setattr(R, "_set", {"verifiers": [V1.address.lower(), V2.address.lower()], "threshold": 2})
    for t in ("rl_envs", "rl_policies", "rl_results"):
        A.db.execute(f"DELETE FROM {t}")
    A.db.commit()
    return state


@pytest.fixture
def client():
    from api import app

    return TestClient(app.app)


def b64(b: bytes) -> dict:
    return {"data": base64.b64encode(b).decode()}


def result(acct, score=195_500, policy=None):
    msg = {"competition": 3, "entrant": ALICE, "policy": policy or sha(POLICY), "score": score}
    sig = encodings.sign(acct.key, "EvalResult", config.CHAIN_ID, CONTRACT, msg)
    return {"verifier": acct.address, "score": score, "returns": [[195.0, 196.0]], "signature": "0x" + sig.hex()}


def test_only_the_onchain_env_is_taken(comp, client):
    r = client.post("/v1/rl/competitions/3/env", json=b64(b"something else"))
    assert r.status_code == 409 and r.json()["detail"]["code"] == "hash"
    assert client.get("/v1/rl/competitions/3/env").status_code == 404
    assert client.post("/v1/rl/competitions/3/env", json=b64(ENV)).status_code == 200
    assert client.get("/v1/rl/competitions/3/env").content == ENV
    assert client.get("/v1/rl/competitions/3").json()["envUploaded"] is True


def test_policy_waits_for_its_onchain_reveal(comp, client):
    comp["policy"] = None
    r = client.post(f"/v1/rl/competitions/3/policies/{ALICE}", json=b64(POLICY))
    assert r.status_code == 409 and r.json()["detail"]["code"] == "unrevealed"
    comp["policy"] = sha(POLICY)
    assert client.post(f"/v1/rl/competitions/3/policies/{ALICE}", json=b64(b"other")).status_code == 409
    assert client.post(f"/v1/rl/competitions/3/policies/{ALICE}", json=b64(POLICY)).status_code == 200
    assert client.get(f"/v1/rl/competitions/3/policies/{ALICE}").content == POLICY
    assert client.post(f"/v1/rl/competitions/3/policies/{'0x' + 'b' * 40}", json=b64(POLICY)).status_code == 404


def test_queue_lists_revealed_uploaded_unscored_policies(comp, client):
    assert client.get("/v1/rl/evaluations").json() == []
    client.post("/v1/rl/competitions/3/env", json=b64(ENV))
    assert client.get("/v1/rl/evaluations").json() == []  # no policy file yet
    client.post(f"/v1/rl/competitions/3/policies/{ALICE}", json=b64(POLICY))
    [task] = client.get("/v1/rl/evaluations").json()
    assert task == {"competition": 3, "entrant": ALICE, "policy": sha(POLICY), "env": sha(ENV), "seeds": [7, 11],
                    "episodes": 2, "maxSteps": 50}
    comp["score"] = 195_500
    assert client.get("/v1/rl/evaluations").json() == []
    comp.update(score=None, status="ready-to-settle")
    assert client.get("/v1/rl/evaluations").json() == []


def test_scores_need_a_verifier_and_a_threshold(comp, client):
    path = f"/v1/rl/competitions/3/evaluations/{ALICE}"
    assert client.post(path, json=result(STRANGER)).status_code == 403
    forged = {**result(STRANGER), "verifier": V1.address}
    assert client.post(path, json=forged).status_code == 403
    assert client.post(path, json=result(V1, policy=sha(b"old policy"))).status_code == 403  # signed another policy
    r = client.post(path, json=result(V1)).json()
    assert r["ready"] is None and len(r["results"]) == 1
    r = client.post(path, json=result(V2, score=1)).json()
    assert r["agreed"] is False and r["ready"] is None
    r = client.post(path, json=result(V2)).json()  # V2 reruns and agrees; its earlier result is replaced
    assert r["agreed"] is True
    assert r["ready"]["score"] == 195_500 and len(r["ready"]["signatures"]) == 2
