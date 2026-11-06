"""Builds a job draft from a preset dataset: freezes the spec and initial weights and returns createJob calldata."""
import json
import math
import time
from pathlib import Path

import jsonschema
import numpy as np
from eth_abi import encode
from eth_utils import keccak
from fastapi import HTTPException

from tod_core.blob import to_blob
from tod_core.encodings import shard_table_hash
from tod_core.evidence import canonical
from tod_datasets.canonical import split
from tod_datasets.schema import DatasetCard
from tod_workloads import base  # importing the package registers the workloads

from .models import Draft, DraftRequest

ROOT = Path(__file__).resolve().parents[3]
SCHEMA = json.loads((ROOT / "vectors/spec.schema.json").read_text())
# ponytail: preset datasets only; uploaded datasets need a store for their cards
CARDS = {c["card"]["hash"]: c["card"] for c in json.loads((ROOT / "vectors/kernel/presets.json").read_text()).values()}

DRAFTABLE = "mlp-exact/1"
VAL_FRAC, TEST_FRAC = "0.05", "0.1"
MIN_STAKE = 15_000_000  # JobMarket.MIN_STAKE in token units; test_draft reads it from the contract source
ZERO32 = b"\0" * 32
PARAMS_T = ("(uint256,uint128,uint32,uint16,uint16,uint8,uint8,bool,uint16,uint32,(uint32,uint32,uint32,uint32,uint32),"
            "bytes32,bytes32,bytes32,bytes32,bytes32,bytes32,bytes32,string)")
CREATE_JOB = f"createJob({PARAMS_T},uint256)"  # test_draft checks this against the generated ABI
WINDOW_KEYS = ("commit", "reveal", "verify", "finalize", "stall")
DEFAULT_WINDOW = 45  # s, the floor for the commit and verify windows
# A requester may tune these; workload, replay class and data stay fixed by the checks in build().
TUNABLE = {"train", "outer", "gate", "windows", "aggregate", "model", "refWorkSecondsPerRound"}


def min_stake(budget: int, rounds: int, quorum: int) -> int:
    """At least MIN_STAKE, and at least twice what one node can earn in a round."""
    return max(MIN_STAKE, 2 * budget // rounds // quorum)


def mlp(model: dict, lr: str):
    loss = "mse" if model["task"] == "regression" else "ce"
    return base.get(DRAFTABLE, d_in=math.prod(model["inputShape"]), n_out=model["outputs"],
                    hidden=model.get("hidden", 128), loss=loss, lr=lr)


def _dry_run(wl, spec: dict) -> int:
    """Time a few steps on this CPU, check the same bytes come out twice, and return work seconds per round."""
    B, model = spec["train"]["B"], spec["model"]
    rng = np.random.default_rng(0)
    x = rng.random((B, math.prod(model["inputShape"])), dtype=np.float32)
    y = rng.random(B, dtype=np.float32) if model["task"] == "regression" else rng.integers(0, model["outputs"], B)
    results, per_step = [], 0.0
    for _ in range(2):
        w, t0 = wl.init(0), time.perf_counter()
        for _ in range(3):
            w = wl.step(w, x, y)
        results.append(w)
        per_step = (time.perf_counter() - t0) / 3
    if not np.array_equal(results[0], results[1]):
        raise HTTPException(500, "workload is not deterministic on this machine")
    return max(1, math.ceil(spec["train"]["H"] * per_step))


def build(req: DraftRequest, store) -> Draft:
    if req.workload != DRAFTABLE:
        # The tolerance-class workloads need calibrated drift and fraud bands; none are made up here.
        raise HTTPException(501, f"only {DRAFTABLE} can be drafted until the tolerance bands are calibrated")
    if req.datasetHash not in CARDS:
        raise HTTPException(422, "unknown dataset: only the preset datasets are available")
    if not (req.budget > 0 and req.epochs >= 1 and 1 <= req.minQuorum <= req.maxPerRound <= 32):
        raise HTTPException(422, "need budget > 0, epochs >= 1 and 1 <= minQuorum <= maxPerRound <= 32")
    raw_card = CARDS[req.datasetHash]
    card = DatasetCard(**{**raw_card, "x_shape": tuple(raw_card["x_shape"])})

    model = {"inputShape": [math.prod(card.x_shape)], "outputs": card.classes or 1, "hidden": 128, "task": card.task}
    d = mlp(model, "0.05").defaults()
    sp = split(card.rows, req.maxPerRound, VAL_FRAC, TEST_FRAC)
    spec = {
        "version": 4,
        "workload": {"id": req.workload},
        "code": {"version": "0.1.0", "hash": "0x" + ZERO32.hex()},  # zero: nodes run the stock image
        "device": {"class": "cpu", "threads": 1},
        "model": model,
        "train": {"H": base.derive_h(d, sp["shards"][-1]["len"]), "K": d.K, "B": d.B, "lr": d.lr,
                  "epochs": req.epochs, "innerReset": True},
        "aggregate": {"kind": "trimmed-mean", "trim": "0.2", "clip": "median"},
        "outer": {"kind": "avg", "lr": "1", "momentum": "0"},
        "gate": {"relTol": "0.1", "absTol": "0.01"},
        "data": {"datasetHash": card.hash, "shards": sp["shards"], "valFrac": VAL_FRAC, "testFrac": TEST_FRAC},
        "replay": {"class": "exact", "coverage": "full", "tauDrift": "0", "tauFraud": "0"},
        "verifiers": 2,
        "payout": {"mode": "equal", "floorBps": 5000},
        "windows": {"commit": DEFAULT_WINDOW, "reveal": 30, "verify": DEFAULT_WINDOW, "finalize": 60, "stall": 3600},
        "refWorkSecondsPerRound": 0,
        "sandbox": None,
        "val": None,
        "detector": None,
    }
    bad = [k for k in req.overrides if k not in TUNABLE] + [k for k in req.overrides.get("model", {}) if k != "hidden"]
    if bad:
        raise HTTPException(422, f"overrides not allowed: {sorted(bad)}")
    for k, v in req.overrides.items():
        spec[k] = {**spec[k], **v} if isinstance(spec.get(k), dict) and isinstance(v, dict) else v
    wl = mlp(spec["model"], spec["train"]["lr"])
    if not wl.fits(card):
        raise HTTPException(422, f"{req.workload} does not fit this dataset")

    ref = _dry_run(wl, spec)
    if "refWorkSecondsPerRound" not in req.overrides:
        spec["refWorkSecondsPerRound"] = ref
    if "windows" not in req.overrides:
        # Verifiers replay the whole round, so commit and verify get three times the measured work.
        spec["windows"].update(commit=max(DEFAULT_WINDOW, 3 * ref), verify=max(DEFAULT_WINDOW, 3 * ref))
    try:
        jsonschema.validate(spec, SCHEMA)
    except jsonschema.ValidationError as e:
        raise HTTPException(422, f"spec: {e.message}")
    train, shards, windows = spec["train"], spec["data"]["shards"], spec["windows"]
    if spec["refWorkSecondsPerRound"] > windows["commit"]:
        raise HTTPException(422, "refWorkSecondsPerRound must not exceed windows.commit")
    # Count rounds at the smallest quorum: fewer nodes per round means more rounds to cover the epochs.
    rounds = base.rounds_for_epochs(train["epochs"], sum(s["len"] for s in shards), req.minQuorum, train["H"], train["B"])
    if len(shards) < req.minQuorum or req.budget < rounds:
        raise HTTPException(422, "need at least minQuorum shards and a budget of at least one unit per round")
    stake = min_stake(req.budget, rounds, req.minQuorum)

    spec_bytes = canonical(spec)
    spec_hash = keccak(spec_bytes)
    spec_blob = store.put(spec_bytes)
    weights_hash = store.put(to_blob(spec_hash, wl.init(int.from_bytes(spec_hash[:8], "big"))))
    params = (req.budget, stake, rounds, train["K"], req.minQuorum, req.maxPerRound, len(shards), True, 0,
              spec["refWorkSecondsPerRound"], tuple(windows[k] for k in WINDOW_KEYS),
              keccak(text=req.workload), spec_hash, bytes.fromhex(card.hash[2:]), shard_table_hash(shards),
              bytes.fromhex(weights_hash[2:]), ZERO32, bytes.fromhex(spec["code"]["hash"][2:]),
              f"/v1/blobs/{spec_blob}")
    # fromBalance is 0: the draft request has no field for paying from earnings yet.
    calldata = keccak(text=CREATE_JOB)[:4] + encode([PARAMS_T, "uint256"], [params, 0])
    return Draft(spec=spec, modelSpecHash="0x" + spec_hash.hex(), initialWeightsHash=weights_hash, windows=windows,
                 minStake=stake, createJobCalldata="0x" + calldata.hex())
