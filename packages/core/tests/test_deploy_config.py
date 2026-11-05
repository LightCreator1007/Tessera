"""Checks RPC selection and public role configuration before any transaction is constructed."""
import importlib.util
from pathlib import Path

import pytest

from tod_core.ledger import Network

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location("deploy_config_under_test", ROOT / "scripts/deploy.py")
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


def config():
    roles = {name: "0x" + f"{i:040x}" for i, name in enumerate(
        ["deployer", "coordinator", "admitter", "faucet", "tokenAdmin"], 1)}
    roles["verifiers"] = ["0x" + "11" * 20, "0x" + "22" * 20]
    return {"roles": roles, "threshold": 2}


def test_public_template_requires_an_explicit_rpc(monkeypatch):
    monkeypatch.delenv("BASE_SEPOLIA_RPC_URL", raising=False)
    with pytest.raises(SystemExit, match="BASE_SEPOLIA_RPC_URL"):
        deploy.rpc_url({"rpc": "", "rpcEnv": "BASE_SEPOLIA_RPC_URL"})


def test_rpc_override_takes_precedence(monkeypatch):
    monkeypatch.setenv("BASE_SEPOLIA_RPC_URL", "https://configured.example/test-only")
    assert deploy.rpc_url({"rpc": "", "rpcEnv": "BASE_SEPOLIA_RPC_URL"}, "http://127.0.0.1:1234") == "http://127.0.0.1:1234"


@pytest.mark.parametrize("role", ["deployer", "coordinator", "admitter", "faucet", "tokenAdmin"])
def test_missing_public_role_is_rejected(role):
    cfg = config()
    cfg["roles"][role] = ""
    with pytest.raises(SystemExit, match=role):
        deploy.validate_roles(cfg, 84532)


def test_duplicate_verifiers_are_rejected():
    cfg = config()
    cfg["roles"]["verifiers"] *= 2
    with pytest.raises(SystemExit, match="distinct verifier"):
        deploy.validate_roles(cfg, 84532)


def test_threshold_cannot_exceed_verifier_count():
    cfg = config()
    cfg["threshold"] = 3
    with pytest.raises(SystemExit, match="threshold"):
        deploy.validate_roles(cfg, 84532)


def test_missing_rpc_is_rejected_by_ledger_configuration(tmp_path, monkeypatch):
    monkeypatch.delenv("ANVIL_RPC_URL", raising=False)
    path = tmp_path / "empty-rpc.toml"
    text = (ROOT / "networks/anvil.toml").read_text().replace('rpc = "http://127.0.0.1:8545"', 'rpc = ""')
    path.write_text(text)
    with pytest.raises(RuntimeError, match="RPC URL missing"):
        Network.load(path)


@pytest.mark.parametrize("cap", [0, -1, True, 1.5, "100", 2**256])
def test_invalid_token_cap_stops_before_rpc(cap):
    cfg = config()
    cfg["token"] = {"cap": cap}
    with pytest.raises(SystemExit, match="token.cap"):
        deploy.token_parameters(cfg)


def test_token_constructor_parameters_use_explicit_roles():
    cfg = config()
    cfg["token"] = {"cap": 10**12}
    assert deploy.token_parameters(cfg) == (cfg["roles"]["tokenAdmin"], cfg["roles"]["faucet"], 10**12)
