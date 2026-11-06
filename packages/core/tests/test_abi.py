"""The ABIs ship with tod_core, and a failed ledger open only blames the RPC when the RPC is at fault."""
import pytest
from requests import ConnectionError as RequestsConnectionError
from tod_core.ledger import ABI_DIR, WrongChain, _load_abi, open_failure


@pytest.mark.parametrize("name", ["IJobMarket", "INodeRegistry", "Competitions"])
def test_every_runtime_abi_is_committed_and_loads(name):
    assert (ABI_DIR / f"{name}.json").is_file()
    assert any(e["type"] == "function" for e in _load_abi(name))


def test_a_dead_rpc_says_so_without_leaking_its_key():
    code, message, err, _ = open_failure("net", RequestsConnectionError("Max retries exceeded with url: /v2/SECRET (refused)"))
    assert (code, err) == (4, "rpc_unreachable")
    assert "SECRET" not in message


def test_a_full_url_is_hidden_too():
    _, message, _, _ = open_failure("net", RequestsConnectionError("405 for url: https://rpc.example/v2/SECRET"))
    assert "SECRET" not in message


def test_a_wrong_chain_is_its_own_error():
    assert open_failure("net", WrongChain("RPC is on chain 1, net is 84532"))[:1] == (2,)
    assert open_failure("net", WrongChain("x"))[2] == "wrong_chain"


def test_a_missing_file_is_not_blamed_on_the_network():
    code, message, err, hint = open_failure("net", FileNotFoundError("IJobMarket.json"))
    assert (code, err) == (1, "startup_failed")
    assert "FileNotFoundError" in message and "network" in hint
