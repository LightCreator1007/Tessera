"""Job spec schema accepts the MLP and CNN examples and rejects out-of-range edits."""
import copy
import json
import pathlib

import pytest
from jsonschema import Draft202012Validator

from tod_core.evidence import canonical
from tod_core.hashing import k256

V = pathlib.Path(__file__).parents[3] / "vectors"
SCHEMA = Draft202012Validator(json.loads((V / "spec.schema.json").read_text()))
EXAMPLE = json.loads((V / "spec.example.mlp.json").read_text())
CNN = json.loads((V / "spec.example.cnn.json").read_text())
# The MLP spec hash on main before device classes existed; widening the schema must not change it.
MLP_SPEC_HASH = "2c0d0aee0f3b41f382015ba0c70cb6dd95fcdbbbabc17a109625bf2e156ca16a"


def test_example_valid():
    SCHEMA.validate(EXAMPLE)


def test_cnn_example_valid():
    SCHEMA.validate(CNN)


def test_mlp_example_unchanged():
    assert k256(canonical(EXAMPLE)).hex() == MLP_SPEC_HASH


def test_cpu_class_needs_threads():
    bad = copy.deepcopy(EXAMPLE)
    del bad["device"]["threads"]
    assert not SCHEMA.is_valid(bad)


@pytest.mark.parametrize("example", [EXAMPLE, CNN], ids=["mlp", "cnn"])
@pytest.mark.parametrize("path,value", [(("train", "H"), 20), (("aggregate", "kind"), "mean"), (("verifiers",), 1),
                                        (("device", "class"), "tpu")])
def test_invalid_edits_rejected(example, path, value):
    bad = copy.deepcopy(example)
    node = bad
    for k in path[:-1]:
        node = node[k]
    node[path[-1]] = value
    assert not SCHEMA.is_valid(bad)
