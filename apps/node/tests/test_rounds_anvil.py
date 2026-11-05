"""The round loop against real contracts on anvil, deployed and funded by the real scripts."""
import os
import shutil
import socket
import subprocess
import sys
import time

import pytest
from web3 import Web3

from tod_core import encodings as enc
from tod_core.ledger import REPO, Ledger, Network
from tod_core.txmgr import LocalSigner, TxManager, dev_key
from tod_node.rounds import RoundLoop, RoundStore

pytestmark = pytest.mark.skipif(not (shutil.which("anvil") and shutil.which("forge")), reason="needs foundry")

K, BUDGET, ROUNDS = 4, 300_000_000, 3
WINDOWS = {"commit": 45, "reveal": 30, "verify": 45, "finalize": 60, "stall": 3600}


def h(label: str) -> bytes:
    return Web3.keccak(text=label)


def script(name: str, *args: str, rpc: str, net: str = "anvil"):
    env = {k: v for k, v in os.environ.items() if not k.endswith("_PRIVATE_KEY")}
    subprocess.run([sys.executable, str(REPO / "scripts" / name), "--network", net, "--rpc", rpc, *args],
                   check=True, capture_output=True, text=True, env=env)


@pytest.fixture(scope="module")
def chain(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("chain")
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    proc = subprocess.Popen(["anvil", "--port", str(port), "--silent"])
    rpc = f"http://127.0.0.1:{port}"
    try:
        for _ in range(100):
            if Web3(Web3.HTTPProvider(rpc)).is_connected():
                break
            time.sleep(0.1)
        out = tmp / "anvil.toml"
        script("deploy.py", "--out", str(out), "--journal-dir", str(tmp / "deploy"), rpc=rpc)
        yield Ledger(Network.load(out, rpc)), out, rpc, tmp
    finally:
        proc.terminate()
        proc.wait()


class Actor:
    def __init__(self, chain, label: str, usdc: float = 0):
        l, out, rpc, tmp = chain
        self.key = dev_key(label)
        self.address = LocalSigner(self.key).address
        script("fund.py", self.address, "--usdc", str(usdc), "--journal-dir", str(tmp / "faucet"), rpc=rpc, net=str(out))
        self.l = l.using(TxManager(l.w3, LocalSigner(self.key), tmp / "actors", poll_seconds=0.02))


def open_round(chain, tag: str, nodes: int = 3):
    """Joins `nodes` operators, funds a job and opens round 1 with them, as the coordinator would."""
    l = chain[0]
    stake = l.market.minStake(BUDGET, ROUNDS, 3)
    ops = []
    for i in range(nodes):
        owner, op = Actor(chain, f"owner/{tag}/{i}", usdc=stake / 1e6), Actor(chain, f"op/{tag}/{i}")
        deadline = l.head()[1] + 1800
        nullifier = h(f"human/{tag}/{i}")
        invite = enc.sign(dev_key("admitter"), "Invite", l.net.chain_id, l.net.registry,
                          {"operator": op.address, "owner": owner.address, "nullifier": nullifier, "deadline": deadline})
        consent = enc.sign(op.key, "Consent", l.net.chain_id, l.net.registry,
                           {"owner": owner.address, "operator": op.address, "consentDeadline": deadline})
        owner.l.registry.join(op.address, nullifier, deadline, deadline, invite, consent)
        owner.l.token.approve(l.net.registry, stake)
        owner.l.registry.depositStake(op.address, stake)
        ops.append(op)
    requester = Actor(chain, f"requester/{tag}", usdc=BUDGET / 1e6)
    requester.l.token.approve(l.net.market, BUDGET)
    requester.l.market.createJob({
        "budget": BUDGET, "stakePerNode": stake, "rounds": ROUNDS, "segments": K, "minQuorum": 3, "maxPerRound": 6,
        "shards": 8, "slashOnMismatch": True, "dataUnavailableBps": 0, "refWorkSecondsPerRound": 2,
        "windows": WINDOWS, "workloadId": h("mlp-exact/1"), "modelSpecHash": h("spec"), "datasetHash": h("dataset"),
        "shardTableHash": h("shards"), "initialWeightsHash": h("w0"), "valCommit": bytes(32), "codeHash": bytes(32),
        "specURI": "https://coordinator.example/spec"}, 0)
    job = max(e.args["jobId"] for e in l.events() if e.name == "JobCreated")
    Actor(chain, "coordinator").l.market.openRound(job, [o.address for o in ops], list(range(nodes)))
    return l, job, ops


def trainer(i: int):
    """Stands in for run_round: K+1 distinct hashes that start at the round's start weights."""
    return lambda job, rnd, r: [r["startWeightsHash"]] + [h(f"{job}/{rnd}/{i}/{j}") for j in range(1, K + 1)]


def never_train(job, rnd, r):
    raise AssertionError("a restarted node must reveal from disk, not retrain")


def test_three_nodes_commit_and_reveal_on_chain(chain, tmp_path):
    l, job, ops = open_round(chain, "happy")
    loops = [RoundLoop(op.l.market, op.address, l.net.chain_id, RoundStore(tmp_path / f"n{i}.json"), trainer(i))
             for i, op in enumerate(ops)]
    for loop in loops:
        loop.tick(l.rebuild())
    assert all(l.market.getNodeRound(job, 1, op.address).committed for op in ops)

    # Node 0 restarts between commit and reveal: a new process with the same data dir.
    loops[0] = RoundLoop(ops[0].l.market, ops[0].address, l.net.chain_id, RoundStore(tmp_path / "n0.json"), never_train)
    for loop in loops:  # every node committed, so the contract opens reveal without waiting for the deadline
        loop.tick(l.rebuild())
    for i, op in enumerate(ops):
        nr = l.market.getNodeRound(job, 1, op.address)
        assert nr.revealed and nr.updateHash == h(f"{job}/1/{i}/{K}")


def test_a_late_node_does_not_commit_after_the_window(chain, tmp_path):
    l, job, ops = open_round(chain, "late")
    l.w3.provider.make_request("evm_increaseTime", [WINDOWS["commit"] + 1])
    l.w3.provider.make_request("anvil_mine", [hex(1)])
    store = RoundStore(tmp_path / "late.json")
    RoundLoop(ops[0].l.market, ops[0].address, l.net.chain_id, store, never_train).tick(l.rebuild())
    assert not l.market.getNodeRound(job, 1, ops[0].address).committed and store.get(job, 1) is None
