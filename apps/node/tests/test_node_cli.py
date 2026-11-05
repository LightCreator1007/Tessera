"""Tests for the tod-node CLI: version, operator key, pairing code, status and doctor."""

import base64
import http.server
import json
import stat
import threading
import time
from importlib.metadata import version

import pytest
from tod_core import encodings as enc
from typer.testing import CliRunner

from tod_node.cli import BAD_INPUT, NOT_ELIGIBLE, PAIR_PREFIX, PAIR_TTL, UNREACHABLE, app

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


@pytest.fixture
def health_server():
    """A local stand-in for the coordinator's /v1/health that answers with the given body."""
    servers = []

    def start(body: dict):
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                data = json.dumps(body).encode()
                self.send_response(200 if self.path == "/v1/health" else 404)
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, *args):
                pass

        srv = http.server.HTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        servers.append(srv)
        return f"http://127.0.0.1:{srv.server_port}"

    yield start
    for srv in servers:
        srv.shutdown()


def test_doctor_needs_a_key(run, monkeypatch):
    monkeypatch.delenv("TOD_COORDINATOR_URL", raising=False)
    result = run("doctor", "--json")
    assert result.exit_code == NOT_ELIGIBLE
    out = json.loads(result.output)
    assert out["key"]["ok"] is False and out["selftest"]["ok"] is True
    assert out["coordinator"]["ok"] is None


def test_doctor_rejects_a_readable_key(run, tmp_path, monkeypatch):
    monkeypatch.delenv("TOD_COORDINATOR_URL", raising=False)
    run("init")
    (tmp_path / "operator.key").chmod(0o644)
    assert run("doctor").exit_code == NOT_ELIGIBLE


def test_doctor_checks_coordinator_chain(run, monkeypatch, health_server):
    run("init")
    monkeypatch.setenv("TOD_COORDINATOR_URL", health_server({"ok": True, "chainId": 31337, "version": "0.1.0"}))
    assert run("doctor", "--chain-id", "31337").exit_code == 0
    result = run("doctor", "--chain-id", "84532", "--json")
    assert result.exit_code == UNREACHABLE
    assert "expected 84532" in json.loads(result.output)["coordinator"]["detail"]


def test_doctor_reports_unreachable_coordinator(run, monkeypatch):
    run("init")
    monkeypatch.setenv("TOD_COORDINATOR_URL", "http://127.0.0.1:9")
    assert run("doctor").exit_code == UNREACHABLE
