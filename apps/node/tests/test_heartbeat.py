"""Heartbeat: signed, spaced by INTERVAL, profile and self-test once, busy from chain, outages logged once."""
import hashlib
import http.server
import json
import threading
from types import SimpleNamespace

import pytest
from eth_account import Account
from eth_account.messages import encode_defunct

from tod_node.heartbeat import INTERVAL, Heartbeat

OP = Account.create()
SELFTEST = {"mlp-exact/1": {"hash": "0xab", "seconds": 0.1, "ok": True}}


@pytest.fixture
def coordinator():
    got, state = [], {"code": 200}

    class H(http.server.BaseHTTPRequestHandler):
        def do_POST(self):
            body = self.rfile.read(int(self.headers["Content-Length"]))
            msg = f"POST\n{self.path}\n{self.headers['X-Timestamp']}\n{hashlib.sha256(body).hexdigest()}"
            signer = Account.recover_message(encode_defunct(text=msg), signature=self.headers["X-Signature"])
            got.append((self.path, signer, json.loads(body)))
            data = b'{"ok": true, "disputes": []}'
            self.send_response(state["code"])
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *a):
            pass

    srv = http.server.HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_port}", got, state
    srv.shutdown()


def chain(busy_job=0):
    return SimpleNamespace(nodes={OP.address: {"busyJob": busy_job}})


def test_first_beat_carries_profile_and_selftest_then_beats_are_spaced(coordinator):
    url, got, _ = coordinator
    clock = [0.0]
    hb = Heartbeat(url, OP.key, OP.address, "0.0.1", SELFTEST, now=lambda: clock[0])
    hb(chain())
    hb(chain())  # same instant: nothing sent
    clock[0] += INTERVAL
    hb(chain(busy_job=4))
    assert [(p, s) for p, s, _ in got] == [("/v1/nodes/heartbeat", OP.address)] * 2
    first, second = got[0][2], got[1][2]
    assert first["selftest"] == SELFTEST and first["profile"]["arch"] and first["busy"] is False
    assert "selftest" not in second and second["busy"] is True and second["job"] == 4


def test_an_outage_is_logged_once_and_the_profile_is_resent(coordinator):
    url, got, state = coordinator
    clock, events = [0.0], []
    hb = Heartbeat(url, OP.key, OP.address, "0.0.1", SELFTEST, emit=lambda t, **k: events.append(t),
                   now=lambda: clock[0])
    state["code"] = 503
    for _ in range(3):
        hb(chain())
        clock[0] += INTERVAL
    assert events == ["error"]  # once for the whole outage
    state["code"] = 200
    hb(chain())
    assert events == ["error", "heartbeat.restored"] and "selftest" in got[-1][2]  # never got through before
