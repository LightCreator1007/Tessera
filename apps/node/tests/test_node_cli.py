"""Tests for the tod-node CLI: version, operator key, pairing code and status."""

import base64
import json
import stat
import time
from importlib.metadata import version

import pytest
from tod_core import encodings as enc
from typer.testing import CliRunner

from tod_node.cli import BAD_INPUT, NOT_ELIGIBLE, PAIR_PREFIX, PAIR_TTL, app

OWNER = "0x" + "11" * 20
REGISTRY = "0x" + "22" * 20


@pytest.fixture
def run(tmp_path, monkeypatch):
    monkeypatch.setenv("TOD_DATA", str(tmp_path))
    return lambda *args: CliRunner().invoke(app, list(args))


def test_version(run):
    result = run("--version")
    assert result.exit_code == 0
    assert result.output.strip() == version("tod-node")


def test_init_creates_private_key_once(run, tmp_path):
    first = json.loads(run("init", "--json").output)
    second = json.loads(run("init", "--json").output)
    assert first["created"] and not second["created"]
    assert first["operator"] == second["operator"]
    assert stat.S_IMODE((tmp_path / "operator.key").stat().st_mode) == 0o600


def test_pair_needs_init_and_addresses(run):
    assert run("pair", "--owner", OWNER, "--chain-id", "31337", "--registry", REGISTRY).exit_code == NOT_ELIGIBLE
    run("init")
    assert run("pair", "--owner", "nope", "--chain-id", "31337", "--registry", REGISTRY).exit_code == BAD_INPUT


def test_pair_code_is_signed_consent_with_deadline(run):
    operator = json.loads(run("init", "--json").output)["operator"]
    out = json.loads(run("pair", "--owner", OWNER, "--chain-id", "84532", "--registry", REGISTRY, "--json").output)

    assert out["code"].startswith(PAIR_PREFIX)
    body = out["code"][len(PAIR_PREFIX):]
    decoded = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
    assert decoded == {k: out[k] for k in ("consentDeadline", "operator", "owner", "signature")}
    assert abs(decoded["consentDeadline"] - (time.time() + PAIR_TTL)) < 5

    msg = {"owner": decoded["owner"], "operator": operator, "consentDeadline": decoded["consentDeadline"]}
    signer = enc.recover("Consent", 84532, REGISTRY, msg, bytes.fromhex(decoded["signature"][2:]))
    assert signer == operator


def test_status_reports_operator(run):
    assert json.loads(run("status", "--json").output)["initialized"] is False
    operator = json.loads(run("init", "--json").output)["operator"]
    assert json.loads(run("status", "--json").output)["operator"] == operator


def test_selftest_reproduces_vector(run):
    result = run("selftest", "--json")
    assert result.exit_code == 0, result.output
    out = json.loads(result.output)
    assert out["ok"] and out["got"] == out["expected"]
