"""Local HTTP API on :7777 for the TUI, agents and the website: health, status, events, self-test and a token-guarded stop."""
import hmac
import json
import os
import secrets
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

STALE_AFTER = 30  # seconds without a loop tick before health says 503
MAX_WAIT = 25


def web_origins() -> set[str]:
    """Sites whose pages may call this API from the visitor's browser, from TOD_WEB_ORIGINS (comma separated)."""
    return {o.strip().rstrip("/") for o in os.environ.get("TOD_WEB_ORIGINS", "").split(",") if o.strip()}


def load_token(data_dir: Path) -> str:
    """32 random bytes in data_dir/api.token (0600), made on first use. Anyone who can read the data dir may stop the node."""
    path = data_dir / "api.token"
    if not path.exists():
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as f:
            f.write(secrets.token_hex(32))
    return path.read_text().strip()


class Api:
    def __init__(self, status, events, stop, token: str, selftest=None, origins: set[str] | None = None):
        self.status, self.events, self.stop, self.token = status, events, stop, token
        self.selftest = selftest  # () -> the `selftest --json` object
        self.origins = web_origins() if origins is None else origins
        self.last_tick = time.monotonic()

    def tick(self, state=None) -> None:
        self.last_tick = time.monotonic()

    def serve(self, bind: str) -> ThreadingHTTPServer:
        host, _, port = bind.rpartition(":")
        server = ThreadingHTTPServer((host.strip("[]"), int(port)), _handler(self))
        server.daemon_threads = True
        threading.Thread(target=server.serve_forever, name="api", daemon=True).start()
        return server


def _handler(api: Api):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):  # requests are not node events; keep stderr for the node
            pass

        def _send(self, code: int, body, ctype="application/json") -> None:
            data = body if isinstance(body, bytes) else (json.dumps(body, sort_keys=True) + "\n").encode()
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self._cors()
            self.end_headers()
            self.wfile.write(data)

        def _cors(self) -> None:
            origin = self.headers.get("Origin")
            if origin in api.origins:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")

        def _allowed(self) -> bool:
            # A page on another site can reach 127.0.0.1 by DNS rebinding; it can't fake Host or drop Origin.
            # Only the name matters: Docker can publish us on another host port, and a rebound page sends its own name.
            host = self.headers.get("Host") or ""
            name = host if host.endswith("]") else host.rsplit(":", 1)[0]
            if name not in {"127.0.0.1", "localhost", "[::1]"}:
                self._send(421, {"code": "bad_host"})
                return False
            # Pages from other sites are refused; only the website named in TOD_WEB_ORIGINS may read and ask.
            origin = self.headers.get("Origin")
            if origin is not None and origin not in api.origins:
                self._send(403, {"code": "cross_origin"})
                return False
            return True

        def do_OPTIONS(self):
            # Browsers preflight a public page's call to 127.0.0.1 (Private Network Access) and any Authorization header.
            if not self._allowed():
                return
            self.send_response(204)
            self._cors()
            self.send_header("Access-Control-Allow-Methods", "GET, POST")
            self.send_header("Access-Control-Allow-Headers", "Authorization")
            self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("Access-Control-Max-Age", "600")
            self.send_header("Content-Length", "0")
            self.end_headers()

        def do_GET(self):
            url = urlparse(self.path)
            if url.path == "/v1/health":  # the Docker healthcheck sends Host as it likes, and this reveals nothing
                age = round(time.monotonic() - api.last_tick, 1)
                return self._send(200 if age < STALE_AFTER else 503, {"ok": age < STALE_AFTER, "loopAgeSeconds": age})
            if not self._allowed():
                return
            if url.path == "/v1/status":
                return self._send(200, api.status())
            if url.path == "/v1/selftest" and api.selftest:
                return self._send(200, api.selftest())
            if url.path == "/v1/events":
                q = parse_qs(url.query)
                try:
                    since = int(q.get("since", ["0"])[0])
                    wait = min(float(q.get("wait", ["0"])[0]), MAX_WAIT)
                except ValueError:
                    return self._send(400, {"code": "bad_input"})
                deadline = time.monotonic() + wait
                while not (evs := api.events.read(since)) and time.monotonic() < deadline:
                    time.sleep(0.25)
                body = "".join(json.dumps(e, sort_keys=True) + "\n" for e in evs).encode()
                return self._send(200, body, "application/x-ndjson")
            self._send(404, {"code": "not_found"})

        def do_POST(self):
            if not self._allowed():
                return
            if urlparse(self.path).path != "/v1/stop":
                return self._send(404, {"code": "not_found"})
            auth = self.headers.get("Authorization", "")
            if not hmac.compare_digest(auth.encode(), f"Bearer {api.token}".encode()):
                return self._send(401, {"code": "bad_token"})
            api.stop()
            # The daemon still finishes any reveal it owes; `node.draining` in the event stream says which.
            self._send(200, {"accepted": True})

    return Handler
