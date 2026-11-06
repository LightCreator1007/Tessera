"""The round loop against real contracts on anvil, deployed and funded by the real scripts."""
import http.server
import json
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
from decimal import Decimal

import numpy as np
import pytest
from web3 import Web3

from tod_core import encodings as enc
from tod_core.ledger import REPO, Ledger, Network
from tod_core.txmgr import LocalSigner, TxManager, dev_key
from tod_core.blob import k256, to_blob
from tod_node.rounds import RoundLoop, RoundStore
from tod_node.trainer import Coordinator, Trainer, rounds_done, workload
from tod_workloads.runner import run_round, sampler

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
    def __init__(self, chain, label: str, units: int = 0):
        l, out, rpc, tmp = chain
        self.key = dev_key(label)
        self.address = LocalSigner(self.key).address
        # fund.py takes TOD with six decimals and defaults to 1000, so always pass the exact amount.
        script("fund.py", self.address, "--tokens", str(Decimal(units).scaleb(-6)), "--journal-dir", str(tmp / "faucet"), rpc=rpc, net=str(out))
        self.l = l.using(TxManager(l.w3, LocalSigner(self.key), tmp / "actors", poll_seconds=0.02))


def open_round(chain, tag: str, nodes: int = 3, **job):
    """Joins `nodes` operators, funds a job and opens round 1 with them, as the coordinator would."""
    l = chain[0]
    stake = l.market.minStake(BUDGET, ROUNDS, 3)
    ops = []
    for i in range(nodes):
        owner, op = Actor(chain, f"owner/{tag}/{i}", units=stake), Actor(chain, f"op/{tag}/{i}")
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
    requester = Actor(chain, f"requester/{tag}", units=BUDGET)
    requester.l.token.approve(l.net.market, BUDGET)
    requester.l.market.createJob({
        "budget": BUDGET, "stakePerNode": stake, "rounds": ROUNDS, "segments": K, "minQuorum": 3, "maxPerRound": 6,
        "shards": 8, "slashOnMismatch": True, "dataUnavailableBps": 0, "refWorkSecondsPerRound": 2,
        "windows": WINDOWS, "workloadId": h("mlp-exact/1"), "modelSpecHash": h("spec"), "datasetHash": h("dataset"),
        "shardTableHash": h("shards"), "initialWeightsHash": h("w0"), "valCommit": bytes(32), "codeHash": bytes(32),
        "specURI": "https://coordinator.example/spec", **job}, 0)
    job = max(e.args["jobId"] for e in l.events() if e.name == "JobCreated")
    Actor(chain, "coordinator").l.market.openRound(job, [o.address for o in ops], list(range(nodes)))
    return l, job, ops


def trainer(i: int):
    """Stands in for run_round: K+1 distinct hashes that start at the round's start weights."""
    return lambda st, job, rnd: [st.rounds[(job, rnd)]["startWeightsHash"]] + [h(f"{job}/{rnd}/{i}/{j}")
                                                                            for j in range(1, K + 1)]


def never_train(state, job, rnd):
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


SPEC = {"workload": {"id": "mlp-exact/1"}, "model": {"inputShape": [16], "outputs": 3, "hidden": 16, "task": "classification"},
        "train": {"H": 20, "K": K, "B": 32, "lr": "0.05"},
        "data": {"shards": [{"start": i * 250, "len": 250} for i in range(4)]}}
rng = np.random.default_rng(0)
X = rng.random((1000, 16), dtype=np.float32)
Y = X[:, :3].argmax(1).astype(np.int64)
DATA = "0x" + k256(b"synthetic").hex()


class BlobServer:
    """Stands in for the coordinator's blob routes, with the same BlobAccess check as services/coordinator."""

    def __init__(self, net):
        self.blobs, net_ = {}, net
        outer = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def _auth(self, h):
                m = {"jobId": int(self.headers["X-Job"]), "roundId": int(self.headers["X-Round"]),
                     "blobHash": bytes.fromhex(h[2:]), "method": self.command, "expiry": int(self.headers["X-Expiry"])}
                sig = bytes.fromhex(self.headers["X-Signature"][2:])
                return enc.recover("BlobAccess", net_.chain_id, net_.market, m, sig)

            def do_GET(self):
                h = self.path.rsplit("/", 1)[-1]
                self._auth(h)
                body = outer.blobs.get(h)
                self.send_response(200 if body else 404)
                self.end_headers()
                self.wfile.write(body or b"")

            def do_PUT(self):
                h = self.path.rsplit("/", 1)[-1]
                body = self.rfile.read(int(self.headers["Content-Length"]))
                assert "0x" + k256(body).hex() == h
                outer.put_signers.append(self._auth(h))
                outer.blobs[h] = body
                self.send_response(201)
                self.end_headers()

            def log_message(self, *a):
                pass

        self.put_signers = []
        self.srv = http.server.HTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{self.srv.server_port}"

    def put(self, data: bytes) -> str:
        h = "0x" + k256(data).hex()
        self.blobs[h] = data
        return h


def test_nodes_train_for_real_and_a_replay_reproduces_them(chain, tmp_path):
    l = chain[0]
    srv = BlobServer(l.net)
    spec_bytes = json.dumps(SPEC, sort_keys=True).encode()
    spec_hash = k256(spec_bytes)
    w0 = workload(SPEC).init(0)
    w0_hash = srv.put(to_blob(spec_hash, w0))
    srv.put(spec_bytes)
    l, job, ops = open_round(chain, "train", modelSpecHash=spec_hash, initialWeightsHash=bytes.fromhex(w0_hash[2:]),
                             datasetHash=bytes.fromhex(DATA[2:]), specURI=f"/v1/blobs/0x{spec_hash.hex()}")
    loops = [RoundLoop(op.l.market, op.address, l.net.chain_id, RoundStore(tmp_path / f"t{i}.json"),
                       Trainer(Coordinator(srv.url, op.key, l.net.chain_id, l.net.market), lambda d: (X, Y),
                               op.address, l.net.chain_id, l.net.market))
             for i, op in enumerate(ops)]
    for _ in range(2):  # commit, then reveal
        for loop in loops:
            loop.tick(l.rebuild())

    state, dom = l.rebuild(), enc.domain(l.net.chain_id, l.net.market)
    for i, op in enumerate(ops):
        nr = l.market.getNodeRound(job, 1, op.address)
        assert nr.revealed
        # What a verifier does: replay from the same public inputs and expect the same bytes.
        rows = sampler(dom, job, nr.shard, SPEC["data"]["shards"][nr.shard], rounds_done(state, job, 1, nr.shard), 20, 32)
        replay = run_round(workload(SPEC), w0, X, Y, rows, 20, K, spec_hash)
        assert replay[-1] == nr.updateHash
        assert "0x" + nr.updateHash.hex() in srv.blobs  # final weights uploaded under h_K
    assert {s.lower() for s in srv.put_signers} == {op.address.lower() for op in ops}
