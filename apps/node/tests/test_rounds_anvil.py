"""The round loop against real contracts on anvil, deployed and funded by the real scripts."""
import shutil

import pytest

from tod_core import encodings as enc
from tod_node import devnet
from tod_node.devnet import WINDOWS, BlobServer, h
from tod_node.rounds import RoundLoop, RoundStore
from tod_node.trainer import Coordinator, Trainer, rounds_done, workload
from tod_workloads.runner import run_round, sampler

pytestmark = pytest.mark.skipif(not (shutil.which("anvil") and shutil.which("forge")), reason="needs foundry")

K = 4


@pytest.fixture(scope="module")
def chain(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("chain")
    proc, rpc = devnet.start_anvil()
    try:
        ledger, net_file = devnet.deploy(rpc, tmp)
        yield ledger, net_file, tmp
    finally:
        proc.terminate()
        proc.wait()


def open_round(chain, tag: str, **job):
    ledger, net_file, tmp = chain
    job_id, ops = devnet.open_round(ledger, net_file, tmp, tag, segments=K, **job)
    return ledger, job_id, ops


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


def test_nodes_train_for_real_and_a_replay_reproduces_them(chain, tmp_path):
    srv = BlobServer(chain[0].net)
    job_args, spec, w0, datasets = devnet.mlp_job(srv, K)
    l, job, ops = open_round(chain, "train", **job_args)
    loops = [RoundLoop(op.l.market, op.address, l.net.chain_id, RoundStore(tmp_path / f"t{i}.json"),
                       Trainer(Coordinator(srv.url, op.key, l.net.chain_id, l.net.market), datasets,
                               op.address, l.net.chain_id, l.net.market))
             for i, op in enumerate(ops)]
    for _ in range(2):  # commit, then reveal
        for loop in loops:
            loop.tick(l.rebuild())

    state, dom = l.rebuild(), enc.domain(l.net.chain_id, l.net.market)
    X, Y = datasets(None)
    for op in ops:
        nr = l.market.getNodeRound(job, 1, op.address)
        assert nr.revealed
        # What a verifier does: replay from the same public inputs and expect the same bytes.
        rows = sampler(dom, job, nr.shard, spec["data"]["shards"][nr.shard], rounds_done(state, job, 1, nr.shard), 20, 32)
        replay = run_round(workload(spec), w0, X, Y, rows, 20, K, job_args["modelSpecHash"])
        assert replay[-1] == nr.updateHash
        assert "0x" + nr.updateHash.hex() in srv.blobs  # final weights uploaded under h_K
    assert {s.lower() for s in srv.put_signers} == {op.address.lower() for op in ops}
