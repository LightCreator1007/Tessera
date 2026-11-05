"""The local API: host and origin checks, status, event long-poll, health staleness and the token on stop."""
import http.client
import json
import socket
import stat
import threading
import time

import pytest

from tod_node import api as api_mod
from tod_node.api import Api, load_token
from tod_node.events import EventLog


@pytest.fixture
def node(tmp_path):
    events = EventLog(tmp_path / "events.ndjson")
    stopped = threading.Event()
    api = Api(lambda: {"daemon": {"state": "running"}}, events, stopped.set, load_token(tmp_path))
    server = api.serve("127.0.0.1:0")
    yield api, events, stopped, server.server_address[1]
    server.shutdown()


def call(port, method, path, host=None, headers=None):
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    c.request(method, path, headers={"Host": host or f"127.0.0.1:{port}", **(headers or {})})
    r = c.getresponse()
    return r.status, r.read().decode()


def test_token_file_is_private_and_stable(tmp_path):
    t = load_token(tmp_path)
    assert len(t) == 64 and load_token(tmp_path) == t
    assert stat.S_IMODE((tmp_path / "api.token").stat().st_mode) == 0o600


def test_reads_refuse_foreign_hosts_and_any_origin(node):
    _, _, _, port = node
    assert call(port, "GET", "/v1/status")[0] == 200
    assert call(port, "GET", "/v1/status", host=f"localhost:{port}")[0] == 200
    assert call(port, "GET", "/v1/status", host="evil.example:7777")[0] == 421
    assert call(port, "GET", "/v1/status", headers={"Origin": "http://evil.example"})[0] == 403
    assert json.loads(call(port, "GET", "/v1/status")[1]) == {"daemon": {"state": "running"}}


def test_events_replay_then_long_poll(node):
    _, events, _, port = node
    events.append("node.started")
    events.append("round.committed", 1, 1)
    code, body = call(port, "GET", "/v1/events?since=1")
    assert code == 200 and [json.loads(line)["type"] for line in body.splitlines()] == ["round.committed"]

    threading.Timer(0.5, events.append, ("round.revealed", 1, 1)).start()
    t = time.monotonic()
    _, body = call(port, "GET", "/v1/events?since=2&wait=5")
    assert json.loads(body)["type"] == "round.revealed" and time.monotonic() - t < 4
    assert call(port, "GET", "/v1/events?since=x")[0] == 400


def test_health_goes_503_when_the_loop_stalls(node, monkeypatch):
    api, _, _, port = node
    api.tick()
    assert call(port, "GET", "/v1/health")[0] == 200
    monkeypatch.setattr(api_mod, "STALE_AFTER", 0)
    code, body = call(port, "GET", "/v1/health")
    assert code == 503 and json.loads(body)["ok"] is False


def test_stop_needs_the_token(node):
    api, _, stopped, port = node
    assert call(port, "POST", "/v1/stop")[0] == 401
    assert call(port, "POST", "/v1/stop", headers={"Authorization": "Bearer nope"})[0] == 401
    assert not stopped.is_set()
    code, body = call(port, "POST", "/v1/stop", headers={"Authorization": f"Bearer {api.token}"})
    assert code == 200 and json.loads(body) == {"accepted": True} and stopped.is_set()


def test_run_keeps_going_when_the_port_is_taken(tmp_path, monkeypatch):
    from tod_node.cli import _start_api
    monkeypatch.setenv("TOD_DATA", str(tmp_path))
    events, stop = EventLog(tmp_path / "events.ndjson"), threading.Event()
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        s.listen()
        monkeypatch.setenv("TOD_API_BIND", f"127.0.0.1:{s.getsockname()[1]}")
        _, server = _start_api(events, stop)
    assert server is None and events.read()[-1]["type"] == "error"

    monkeypatch.setenv("TOD_API_BIND", "off")
    assert _start_api(events, stop)[1] is None
