"""The coordinator uses COORDINATOR_PRIVATE_KEY, and off the local chain it refuses to start without one."""
import os
import subprocess
import sys
from pathlib import Path

from eth_account import Account

CODE = "from api import app, config; print(config.COORDINATOR)"


def start(tmp_path, **env):
    clean = {k: v for k, v in os.environ.items() if k not in ("COORDINATOR_PRIVATE_KEY", "ADMITTER_PRIVATE_KEY")}
    clean.update(DB_PATH=str(tmp_path / "t.db"), STORE_DIR=str(tmp_path / "store"), **env)
    return subprocess.run([sys.executable, "-c", CODE], cwd=Path(__file__).resolve().parents[1], env=clean,
                          capture_output=True, text=True)


def test_off_the_local_chain_a_missing_key_stops_startup(tmp_path):
    key = Account.create()
    public = {"CHAIN_ID": "84532", "ADMITTER_PRIVATE_KEY": Account.create().key.hex()}
    missing = start(tmp_path, **public)
    assert missing.returncode != 0 and "COORDINATOR_PRIVATE_KEY is required" in missing.stderr
    ok = start(tmp_path, COORDINATOR_PRIVATE_KEY=key.key.hex(), **public)
    assert ok.returncode == 0 and ok.stdout.strip() == key.address


def test_on_the_local_chain_the_env_key_wins_else_a_throwaway(tmp_path):
    key = Account.create()
    assert start(tmp_path, COORDINATOR_PRIVATE_KEY=key.key.hex()).stdout.strip() == key.address
    assert start(tmp_path).returncode == 0
