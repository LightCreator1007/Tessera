"""Job drafts: the frozen spec, the stored blobs and the createJob calldata agree with each other and the contract."""
import json
import re
import shutil
import subprocess

import jsonschema
import pytest
from eth_abi import decode
from eth_utils import keccak
from fastapi.testclient import TestClient

from api import app as A, blobs, draft
from tod_core.blob import from_blob
from tod_core.encodings import shard_table_hash
from tod_core.ledger import ABI_DIR
from tod_workloads import compute

c = TestClient(A.app)
MNIST = next(h for h, card in draft.CARDS.items() if card["x_shape"] == [28, 28])
CIFAR = next(h for h, card in draft.CARDS.items() if card["x_shape"] == [32, 32, 3])
BODY = {"workload": "mlp-exact/1", "datasetHash": MNIST, "epochs": 2}
MLP_PARAMS = 784 * 128 + 128 + 128 * 10 + 10


def post(**changes):
    return c.post("/v1/jobs/draft", json={**BODY, **changes})


def test_draft_is_self_consistent():
    r = post()
    assert r.status_code == 200, r.text
    d = r.json()
    s = d["spec"]
    jsonschema.validate(s, draft.SCHEMA)
    stored = blobs.store.get(d["modelSpecHash"])
    assert stored and json.loads(stored) == s  # the store keys blobs by keccak, so the hash matches by construction

    raw = bytes.fromhex(d["createJobCalldata"][2:])
    assert raw[:4] == keccak(text=draft.CREATE_JOB)[:4]
    p, from_balance = decode([draft.PARAMS_T, "uint256"], raw[4:])
    budget, stake, rounds, K, quorum, per_round, shards, slash, bps, ref, win, wid, spec_h, data_h, shard_h, w_h, val, code, uri = p
    assert (K, quorum, per_round, shards, slash, bps, from_balance) == (4, 3, 6, 6, True, 0, 0)
    assert budget == d["budget"] == compute.job_budget(s, rounds, quorum) == d["computeOps"] // compute.OPS_PER_UNIT
    assert d["computeOps"] == rounds * quorum * compute.round_ops(s)
    assert stake == d["minStake"] == max(15_000_000, 2 * budget // rounds // quorum)
    assert "0x" + spec_h.hex() == d["modelSpecHash"] and wid == keccak(text="mlp-exact/1")
    assert "0x" + data_h.hex() == s["data"]["datasetHash"] == MNIST
    assert shard_h == shard_table_hash(s["data"]["shards"]) and len(s["data"]["shards"]) == shards
    assert win == tuple(s["windows"][k] for k in draft.WINDOW_KEYS)
    assert ref == s["refWorkSecondsPerRound"] == compute.ref_work(s) <= s["windows"]["commit"]
    train_rows = sum(x["len"] for x in s["data"]["shards"])
    assert rounds == -(-s["train"]["epochs"] * train_rows // (quorum * s["train"]["H"] * s["train"]["B"]))
    assert uri == f"/v1/blobs/{d['modelSpecHash']}" and "0x" + w_h.hex() == d["initialWeightsHash"]
    assert from_blob(spec_h, blobs.store.get(d["initialWeightsHash"]), MLP_PARAMS).shape == (MLP_PARAMS,)


def test_draft_is_reproducible(monkeypatch):
    # The timed dry run feeds the windows, so pin it; everything else must repeat exactly.
    monkeypatch.setattr(draft, "_dry_run", lambda wl, spec: 7)
    first, second = post().json(), post().json()
    assert first == second


def test_the_demo_job_is_priced_at_one_tod_per_gop():
    d = post(epochs=1, minQuorum=3, maxPerRound=4).json()
    assert d["budget"] == 31_710_283 and d["minStake"] == 15_000_000  # 31.71 TOD
    assert d["computeOps"] == 2 * 3 * 5_285_047_200 and d["spec"]["refWorkSecondsPerRound"] == 6


def test_a_budget_is_only_accepted_if_it_is_the_price():
    price = post().json()["budget"]
    assert post(budget=price).status_code == 200
    r = post(budget=price + 1)
    assert r.status_code == 422 and str(price) in r.json()["detail"]


def test_a_job_priced_below_one_unit_a_round_is_refused(monkeypatch):
    monkeypatch.setattr(compute, "job_budget", lambda spec, rounds, quorum: rounds)
    assert post().status_code == 200
    monkeypatch.setattr(compute, "job_budget", lambda spec, rounds, quorum: rounds - 1)
    assert post().status_code == 422


def test_a_huge_model_keeps_its_commit_window_above_its_work(monkeypatch):
    monkeypatch.setattr(draft, "_dry_run", lambda wl, spec: 1)  # a machine far quicker than a reference second per Gop
    s = post(overrides={"model": {"hidden": 2048}}).json()["spec"]
    assert s["refWorkSecondsPerRound"] > draft.DEFAULT_WINDOW
    assert s["windows"]["commit"] == s["refWorkSecondsPerRound"]


def test_min_stake_matches_the_contract():
    sol = (draft.ROOT / "contracts/src/JobMarket.sol").read_text()
    assert int(re.search(r"MIN_STAKE = (\d+)e6", sol).group(1)) * 10**6 == draft.MIN_STAKE
    assert draft.min_stake(1, 1, 1) == 15_000_000 and draft.min_stake(10**9, 10, 2) == 100_000_000


def test_create_job_matches_the_generated_abi():
    path = ABI_DIR / "IJobMarket.json"
    if not path.exists():
        # The ABI is generated, not committed; build it the way scripts/deploy.py does.
        if not (shutil.which("forge") and shutil.which("node")):
            pytest.skip("needs foundry and node to generate the ABI")
        subprocess.run(["forge", "build"], cwd=draft.ROOT / "contracts", check=True, capture_output=True)
        subprocess.run(["node", str(draft.ROOT / "packages/abi/scripts/generate.mjs")], check=True, capture_output=True)
    fn = next(x for x in json.loads(path.read_text()) if x.get("name") == "createJob")

    def sig(i):
        return "(" + ",".join(sig(c) for c in i["components"]) + ")" if i["type"] == "tuple" else i["type"]
    assert f"createJob({','.join(sig(i) for i in fn['inputs'])})" == draft.CREATE_JOB


@pytest.mark.parametrize("changes,code", [
    ({"workload": "cnn-torch/1", "datasetHash": CIFAR}, 501),
    ({"datasetHash": "0x" + "11" * 32}, 422),
    ({"budget": 0}, 422),
    ({"minQuorum": 7}, 422),
    ({"budget": 600_000_000}, 422),  # a typed budget that isn't the price
    ({"overrides": {"train": {"H": 10}}}, 422),  # the schema needs H >= 50
    ({"overrides": {"nonsense": 1}}, 422),
    ({"overrides": {"workload": {"id": "cnn-torch/1"}}}, 422),
    ({"overrides": {"replay": {"class": "tolerance"}}}, 422),
    ({"overrides": {"data": {"shards": []}}}, 422),
    ({"overrides": {"model": {"outputs": 3}}}, 422),
    ({"overrides": {"refWorkSecondsPerRound": 999}}, 422),  # the spec sets this, a requester can't
    ({"overrides": {"windows": {"commit": 1}}}, 422),  # refWork above windows.commit
])
def test_bad_requests(changes, code):
    assert post(**changes).status_code == code
