"""Job spec schema accepts the MLP example and rejects out-of-range edits."""
import copy
import json
import pathlib

import pytest
from jsonschema import Draft202012Validator

V = pathlib.Path(__file__).parents[3] / "vectors"
SCHEMA = Draft202012Validator(json.loads((V / "spec.schema.json").read_text()))
EXAMPLE = json.loads((V / "spec.example.mlp.json").read_text())


def test_example_valid():
    SCHEMA.validate(EXAMPLE)


@pytest.mark.parametrize("path,value", [(("train", "H"), 20), (("aggregate", "kind"), "mean"), (("verifiers",), 1)])
def test_invalid_edits_rejected(path, value):
    bad = copy.deepcopy(EXAMPLE)
    node = bad
    for k in path[:-1]:
        node = node[k]
    node[path[-1]] = value
    assert not SCHEMA.is_valid(bad)
