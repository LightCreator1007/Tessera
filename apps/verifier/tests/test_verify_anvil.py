"""Three honest nodes and one cheat on real contracts: both verifiers replay, and only the cheat is confirmed."""
import shutil

import pytest

from tod_core.blob import k256
from tod_core.ledger import Kind
from tod_node import devnet
from tod_node.devnet import Actor, BlobServer
from tod_node.rounds import RoundLoop, RoundStore
from tod_node.trainer import Coordinator, RoundRunner, Trainer
from tod_verifier.verify import VerifierLoop, report_bytes

pytestmark = pytest.mark.skipif(not (shutil.which("anvil") and shutil.which("forge")), reason="needs foundry")


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


class Cheat(Trainer):
    """Trains honestly, then claims a different final update. Commit and reveal are still well formed."""

    def __call__(self, state, job, rnd):
        hs = super().__call__(state, job, rnd)
        return hs[:-1] + [k256(b"not what I trained")]


def test_two_verifiers_confirm_only_the_cheat(chain, tmp_path):
    l, net_file, tmp = chain
    srv = BlobServer(l.net)
    job_args, _, _, datasets = devnet.mlp_job(srv)
    job, ops = devnet.open_round(l, net_file, tmp, "verify", nodes=4, **job_args)
    net = l.net
    nodes = [RoundLoop(op.l.market, op.address, net.chain_id, RoundStore(tmp_path / f"n{i}.json"),
                       (Cheat if i == 3 else Trainer)(Coordinator(srv.url, op.key, net.chain_id, net.market), datasets,
                                                      op.address, net.chain_id, net.market))
             for i, op in enumerate(ops)]
    for _ in range(2):
        for n in nodes:
            n.tick(l.rebuild())

    verifiers = []
    for label in ("verifier/a", "verifier/b"):
        v = Actor(l, net_file, tmp, label)
        runner = RoundRunner(Coordinator(srv.url, v.key, net.chain_id, net.market), datasets, net.chain_id, net.market)
        verifiers.append(VerifierLoop(v.l.market, v.address, runner))
    for _ in range(4):  # lock seed, draw it, then each verifier attests
        for v in verifiers:
            v.tick(l.rebuild())
        l.w3.provider.make_request("anvil_mine", [hex(3)])

    confirmed = {op.address: l.market.getNodeRound(job, 1, op.address).confirmed for op in ops}
    assert confirmed[ops[3].address] == Kind.REPLAY_MISMATCH
    assert all(confirmed[op.address] == Kind.NONE for op in ops[:3])
    assert all(v.done == {(job, 1)} for v in verifiers)
    assert l.registry.getNode(ops[3].address).stake < l.registry.getNode(ops[0].address).stake  # slashed


def test_report_is_canonical():
    a = report_bytes(1, 2, "0xV", {"0xB": {"kind": None}, "0xA": {"kind": "ReplayMismatch"}})
    b = report_bytes(1, 2, "0xV", {"0xA": {"kind": "ReplayMismatch"}, "0xB": {"kind": None}})
    assert a == b and b" " not in a
