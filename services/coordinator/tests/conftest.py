"""Test environment: coordinator on the import path, a temp store and database, one verifier and an admin token."""
import hashlib
import json
import os
import sys
import tempfile
import time
from pathlib import Path

import pytest
from eth_account import Account
from eth_account.messages import encode_defunct

# CI runs pytest from the repo root, where the coordinator folder is not on the import path.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# These must be set before anything imports api.config.
VERIFIER = Account.create()
os.environ["STORE_DIR"] = tempfile.mkdtemp(prefix="tod-store-")
os.environ["VERIFIERS"] = VERIFIER.address
os.environ["DB_PATH"] = os.path.join(os.environ["STORE_DIR"], "test.db")
os.environ["ADMIN_TOKEN"] = "test-token"


@pytest.fixture
def verifier():
    return VERIFIER


@pytest.fixture
def node_post():
    """POST signed the way a node signs writes: EIP-191 over method, path, timestamp and the body's sha256."""
    from fastapi.testclient import TestClient

    from api import app

    client = TestClient(app.app)

    def post(acct, path, body, ts=None, as_op=None):
        raw = json.dumps(body).encode()
        ts = ts or int(time.time())
        msg = f"POST\n{path}\n{ts}\n{hashlib.sha256(raw).hexdigest()}"
        sig = acct.sign_message(encode_defunct(text=msg)).signature
        headers = {"X-Operator": (as_op or acct).address, "X-Timestamp": str(ts), "X-Signature": "0x" + sig.hex(),
                   "Content-Type": "application/json"}
        return client.post(path, content=raw, headers=headers)

    return post
