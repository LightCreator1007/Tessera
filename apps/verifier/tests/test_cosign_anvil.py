"""A full round on real contracts: train, attest, refuse a doctored Settlement, co-sign the honest one, finalizeRound."""
import shutil

import pytest

from tod_core.blob import k256
from tod_core.finalize import ACCEPTED
from tod_core.ledger import Kind, RoundStatus
from tod_node import devnet
from tod_node.devnet import Actor, BlobServer
from tod_node.rounds import RoundLoop, RoundStore
from tod_node.trainer import Coordinator, RoundRunner, Trainer
from tod_verifier.cosign import CoordinatorApi, CoSigner, recompute
from tod_verifier.verify import VerifierLoop

pytestmark = pytest.mark.skipif(not (shutil.which("anvil") and shutil.which("forge")), reason="needs foundry")


class Cheat(Trainer):
    def __call__(self, state, job, rnd):
        return super().__call__(state, job, rnd)[:-1] + [k256(b"not what I trained")]


def test_verifiers_cosign_only_the_settlement_they_recompute(tmp_path):
    proc, rpc = devnet.start_anvil()
    try:
        _run(tmp_path, *devnet.deploy(rpc, tmp_path))
    finally:
        proc.terminate()
        proc.wait()


def _run(tmp, l, net_file):
    net, srv = l.net, BlobServer(l.net)
    job_args, _, _, datasets = devnet.mlp_job(srv)
    job, ops = devnet.open_round(l, net_file, tmp, "cosign", nodes=4, **job_args)
    nodes = [RoundLoop(op.l.market, op.address, net.chain_id, RoundStore(tmp / f"n{i}.json"),
                       (Cheat if i == 3 else Trainer)(Coordinator(srv.url, op.key, net.chain_id, net.market), datasets,
                                                      op.address, net.chain_id, net.market))
             for i, op in enumerate(ops)]
    for _ in range(2):
        for n in nodes:
            n.tick(l.rebuild())

    events, verifiers = [], []
    for label in ("verifier/a", "verifier/b"):
        v = Actor(l, net_file, tmp, label)
        runner = RoundRunner(Coordinator(srv.url, v.key, net.chain_id, net.market), datasets, net.chain_id, net.market)
        cosigner = CoSigner(v.l.market, v.l.registry, runner, CoordinatorApi(srv.url, v.key), v.key, net.chain_id,
                            emit=lambda t, **k: events.append(t))
        verifiers.append(VerifierLoop(v.l.market, v.address, runner, cosigner=cosigner))

    def tick_verifiers(n):
        for _ in range(n):
            for v in verifiers:
                v.tick(l.rebuild())
            l.w3.provider.make_request("anvil_mine", [hex(3)])

    tick_verifiers(4)  # lock and draw the seed, then both attest; the round is now in Finalize
    state = l.rebuild()
    assert state.rounds[(job, 1)]["nodeRounds"][ops[3].address]["confirmed"] == Kind.REPLAY_MISMATCH

    # The coordinator's side: settle with the shared builder and publish the evidence.
    coord = RoundRunner(Coordinator(srv.url, b"\1" * 32, net.chain_id, net.market), datasets, net.chain_id, net.market)
    f = recompute(coord, l.registry, l.market, state, job, 1, {"by": "devnet"})
    srv.put(f.agg_evidence)
    srv.put(f.pay_evidence)
    honest = f.settlement
    assert honest["outcome"] == ACCEPTED and len(honest["payouts"]) == 3

    # A Settlement that quietly moves pay between nodes is refused by both verifiers.
    (a, x), (b, y), rest = honest["payouts"][0], honest["payouts"][1], honest["payouts"][2:]
    srv.settlements[(job, 1)] = {**honest, "payouts": [(a, x + 1), (b, y - 1), *rest]}
    tick_verifiers(1)
    assert events.count("settlement.refused") == 2 and not srv.sigs.get((job, 1))

    srv.settlements[(job, 1)] = honest
    tick_verifiers(1)
    assert events.count("round.cosigned") == 2 and len(srv.sigs[(job, 1)]) == 2

    coordinator = Actor(l, net_file, tmp, "coordinator")
    coordinator.l.market.finalizeRound(job, 1, {
        "outcome": honest["outcome"], "aggregateHash": honest["aggregateHash"], "flaggedBitmap": honest["flaggedBitmap"],
        "aggEvidenceHash": honest["aggEvidenceHash"], "payEvidenceHash": honest["payEvidenceHash"],
        "payouts": [{"operator": op, "amount": amt} for op, amt in honest["payouts"]]}, list(srv.sigs[(job, 1)].values()))
    r = l.rebuild().rounds[(job, 1)]
    assert r["status"] == RoundStatus.SETTLED and r["aggregateHash"] == honest["aggregateHash"]
    assert r["aggEvidenceHash"] == k256(f.agg_evidence)
