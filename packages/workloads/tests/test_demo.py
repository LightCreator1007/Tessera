"""The demo round on synthetic data: the cheater is caught, the honest three merge, and the spec stays schema-valid."""
import json
import pathlib

import numpy as np
from jsonschema import Draft202012Validator

from tod_workloads import demo

SCHEMA = json.loads((pathlib.Path(__file__).parents[3] / "vectors" / "spec.schema.json").read_text())
rng = np.random.default_rng(0)
X = rng.integers(0, 256, (2000, 28, 28), dtype=np.uint8)
Y = (X.reshape(2000, -1)[:, :10].argmax(1)).astype(np.int64)


def test_demo_spec_is_valid():
    Draft202012Validator(SCHEMA).validate(demo.demo_spec("0x" + "11" * 32, 70000))


def test_cheater_caught_and_honest_merged():
    r = demo.run(X, Y, "0x" + "22" * 32)
    verdicts = {n["operator"]: n["verdict"] for n in r["nodes"]}
    assert verdicts[demo.CHEATER] == "ReplayMismatch"
    assert [op for op, v in verdicts.items() if v == "accepted"] == demo.NODES[:3]
    assert r["merge"]["accepted"] == demo.NODES[:3] and not r["merge"]["reverted"]
    assert all(len(n["checkpoints"]) == 5 for n in r["nodes"])


def test_same_inputs_same_hashes():
    a, b = demo.run(X, Y, "0x" + "22" * 32), demo.run(X, Y, "0x" + "22" * 32)
    assert a["merge"]["newWeightsHash"] == b["merge"]["newWeightsHash"] and a["nodes"] == b["nodes"]
