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
    monkeypatch.setenv("TOD_SANDBOX", "off")  # test_sandbox covers the Docker path
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
    monkeypatch.delenv("TOD_COORDINATOR", raising=False)
    result = run("doctor", "--json")
    assert result.exit_code == NOT_ELIGIBLE
    out = json.loads(result.output)
    assert out["key"]["ok"] is False and out["selftest"]["ok"] is True
    assert out["coordinator"]["ok"] is None


def test_doctor_rejects_a_readable_key(run, tmp_path, monkeypatch):
    monkeypatch.delenv("TOD_COORDINATOR", raising=False)
    run("init")
    (tmp_path / "operator.key").chmod(0o644)
    assert run("doctor").exit_code == NOT_ELIGIBLE


def test_doctor_checks_coordinator_chain(run, monkeypatch, health_server):
    run("init")
    monkeypatch.setenv("TOD_COORDINATOR", health_server({"ok": True, "chainId": 31337, "version": "0.1.0"}))
    assert run("doctor", "--chain-id", "31337").exit_code == 0
    result = run("doctor", "--chain-id", "84532", "--json")
    assert result.exit_code == UNREACHABLE
    assert "expected 84532" in json.loads(result.output)["coordinator"]["detail"]


def test_doctor_reports_unreachable_coordinator(run, monkeypatch):
    run("init")
    monkeypatch.setenv("TOD_COORDINATOR", "http://127.0.0.1:9")
    assert run("doctor").exit_code == UNREACHABLE


def test_init_saves_config_and_keeps_the_key(run, monkeypatch):
    monkeypatch.delenv("TOD_NETWORK", raising=False)
    monkeypatch.delenv("TOD_COORDINATOR", raising=False)
    first = json.loads(run("init", "--network", "anvil", "--json").output)
    second = json.loads(run("init", "--coordinator", "http://127.0.0.1:8000", "--json").output)
    assert first["operator"] == second["operator"] and not second["created"]
    shown = json.loads(run("config", "show", "--json").output)
    assert shown["network"] == {"value": "anvil", "source": "file"}
    assert shown["coordinator"] == {"value": "http://127.0.0.1:8000", "source": "file"}
    monkeypatch.setenv("TOD_NETWORK", "base-sepolia")
    assert json.loads(run("config", "show", "--json").output)["network"] == {"value": "base-sepolia", "source": "env"}


def test_doctor_uses_the_saved_coordinator(run, monkeypatch, health_server):
    monkeypatch.delenv("TOD_COORDINATOR", raising=False)
    url = health_server({"ok": True, "chainId": 31337, "version": "0.1.0"})
    run("init", "--coordinator", url)
    out = json.loads(run("doctor", "--json").output)
    assert out["coordinator"]["ok"] is True


def test_events_seq_survives_a_restart(tmp_path):
    from tod_node.events import EventLog
    log = EventLog(tmp_path / "events.ndjson")
    log.append("node.started")
    log.append("round.committed", job=1, round=2, commitHash="0xab")
    with (tmp_path / "events.ndjson").open("a") as f:
        f.write('{"seq": 3, "half')  # a crash mid-write
    again = EventLog(tmp_path / "events.ndjson")
    assert again.append("node.stopped")["seq"] == 3
    assert [e["seq"] for e in again.read(since=1)] == [2, 3]  # the half line is gone, not glued to seq 3


def test_logs_and_status_read_the_event_log(run, tmp_path):
    from tod_node.events import EventLog
    EventLog(tmp_path / "events.ndjson").append("round.revealed", job=7, round=12, updateHash="0x01")
    lines = run("logs", "--json").output.strip().splitlines()
    assert json.loads(lines[-1])["type"] == "round.revealed"
    assert "j7 r12" in run("logs").output
    out = json.loads(run("status", "--json").output)
    assert out["daemon"] == {"state": "stopped", "pid": None} and out["lastEvent"]["round"] == 12


def test_stop_without_a_daemon_says_so(run):
    result = run("stop", "--json")
    assert result.exit_code == NOT_ELIGIBLE and json.loads(result.output)["code"] == "daemon_not_running"


def test_run_needs_a_network(run, monkeypatch):
    monkeypatch.delenv("TOD_NETWORK", raising=False)
    run("init")
    result = run("run", "--json")
    assert result.exit_code == BAD_INPUT and json.loads(result.output)["code"] == "bad_config"


def test_fake_mode_is_refused_off_test_chains(run, monkeypatch, tmp_path):
    toml = tmp_path / "main.toml"
    toml.write_text('name = "mainnet"\nchainId = 1\nrpc = "http://127.0.0.1:9"\nlogSpan = 2000\nroles = {}\n'
                    '[contracts]\ntoken = "0x0"\nregistry = "0x0"\nmarket = "0x0"\ndeployBlock = 1\n')
    monkeypatch.setenv("TOD_NETWORK", str(toml))
    run("init")
    result = run("run", "--mode", "fake:lazy", "--json")
    assert result.exit_code == BAD_INPUT and "test chains" in json.loads(result.output)["error"]


def test_tui_says_how_to_install_it_when_missing(run, monkeypatch):
    monkeypatch.setattr("tod_node.cli.shutil.which", lambda name: None)
    result = run("tui")
    assert result.exit_code == NOT_ELIGIBLE and "uv tool install ./apps/tui" in result.output


def test_tui_points_the_screen_at_this_node_and_its_coordinator(run, monkeypatch):
    calls = []
    monkeypatch.setattr("tod_node.cli.shutil.which", lambda name: "/bin/tod-tui")
    monkeypatch.setattr("tod_node.cli.subprocess.call", lambda args: calls.append(args) or 0)
    monkeypatch.setenv("TOD_API_BIND", "127.0.0.1:7778")
    monkeypatch.setenv("TOD_COORDINATOR", "http://127.0.0.1:8000")
    assert run("tui").exit_code == 0
    assert calls == [["/bin/tod-tui", "--node", "http://127.0.0.1:7778", "--coordinator", "http://127.0.0.1:8000"]]
