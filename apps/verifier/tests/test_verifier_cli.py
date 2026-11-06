"""Smoke test: the tod-verifier CLI starts and reports its version."""

import json
from importlib.metadata import version

from typer.testing import CliRunner

from tod_verifier.cli import app


def test_version():
    result = CliRunner().invoke(app, ["--version"])
    assert result.exit_code == 0
    assert result.output.strip() == version("tod-verifier")


def test_a_broken_install_is_not_blamed_on_the_rpc(tmp_path, monkeypatch):
    addr = '"0x' + "33" * 20 + '"'
    net = tmp_path / "net.toml"
    net.write_text(f'name = "t"\nchainId = 84532\nrpc = "http://127.0.0.1:1"\n[roles]\n[contracts]\nmarket = {addr}\n'
                   f'registry = {addr}\ntoken = {addr}\ndeployBlock = 0\n')

    def broken(*_):
        raise FileNotFoundError("IJobMarket.json")
    monkeypatch.setattr("tod_core.ledger.Ledger", broken)
    monkeypatch.setenv("TOD_VERIFIER_DATA", str(tmp_path))
    monkeypatch.setenv("VERIFIER_A_PRIVATE_KEY", "0x" + "11" * 32)
    result = CliRunner().invoke(app, ["run", "--network", str(net), "--coordinator", "http://127.0.0.1:1", "--json"])
    assert result.exit_code == 1
    assert json.loads(result.output)["code"] == "startup_failed"
