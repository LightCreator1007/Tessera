"""Asking the coordinator for gas when tod-node run starts."""
import json
import urllib.error

from .client import node_post


def ensure_gas(url: str, key: bytes, emit=lambda *a, **k: None) -> None:
    """Ask for a top-up on start. The coordinator sends nothing to a funded operator, so it alone decides what "low"
    means. Never fatal: a node with gas from elsewhere runs fine without it."""
    try:
        got = node_post(url, key, "/v1/identity/topup")
        if got["sent"]:
            emit("gas.topup", sent=got["sent"], balance=got["balance"])
    except urllib.error.HTTPError as e:
        reason = json.loads(e.read() or b"{}").get("detail", e.reason)
        emit("error", what="gas", reason=f"top-up refused ({e.code}): {reason}")
    except (urllib.error.URLError, OSError) as e:
        emit("error", what="gas", reason=f"top-up unreachable: {e}")
