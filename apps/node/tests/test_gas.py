"""ensure_gas: a low node asks the coordinator with a valid operator signature, and a refusal is logged, not fatal."""
import hashlib
import http.server
import json
import threading
from types import SimpleNamespace

import pytest
from eth_account import Account
from eth_account.messages import encode_defunct

from tod_node.gas import LOW_WEI, ensure_gas

OP = Account.create()


@pytest.fixture
def coordinator():
    calls, reply = [], {"code": 200, "body": {"sent": 7, "balance": 9}}

    class H(http.server.BaseHTTPRequestHandler):
        def do_POST(self):
            body = self.rfile.read(int(self.headers["Content-Length"]))
            msg = f"POST\n{self.path}\n{self.headers['X-Timestamp']}\n{hashlib.sha256(body).hexdigest()}"
            calls.append((self.path, Account.recover_message(encode_defunct(text=msg),
                                                             signature=self.headers["X-Signature"])))
            data = json.dumps(reply["body"]).encode()
            self.send_response(reply["code"])
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *a):
            pass

    srv = http.server.HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_port}", calls, reply
    srv.shutdown()


def w3(balance):
    return SimpleNamespace(eth=SimpleNamespace(get_balance=lambda a: balance))


def test_low_balance_asks_with_the_operator_signature(coordinator):
    url, calls, _ = coordinator
    events = []
    ensure_gas(w3(0), url, OP.key, emit=lambda t, **k: events.append((t, k)))
    assert calls == [("/v1/identity/topup", OP.address)] and events == [("gas.topup", {"sent": 7, "balance": 9})]


def test_enough_gas_sends_nothing(coordinator):
    url, calls, _ = coordinator
    ensure_gas(w3(LOW_WEI), url, OP.key)
    assert calls == []


def test_a_refusal_is_an_event_not_a_crash(coordinator):
    url, _, reply = coordinator
    reply.update(code=403, body={"detail": "the operator's owner has not joined with World ID here"})
    events = []
    ensure_gas(w3(0), url, OP.key, emit=lambda t, **k: events.append((t, k)))
    assert events[0][0] == "error" and "403" in events[0][1]["reason"] and "World ID" in events[0][1]["reason"]
    ensure_gas(w3(0), "http://127.0.0.1:9", OP.key, emit=lambda t, **k: events.append((t, k)))
    assert "unreachable" in events[1][1]["reason"]
