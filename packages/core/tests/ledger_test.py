"""ledger and txmgr against a real anvil, deployed and funded by the real scripts."""
import json
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
from decimal import Decimal

import pytest
from eth_account import Account
from requests import HTTPError, Response
from web3 import Web3
from web3.exceptions import Web3RPCError

from tod_core import encodings as enc
from tod_core.ledger import ABI_DIR, REPO, JobStatus, Kind, Ledger, Network, Outcome, Phase, Reverted, RoundStatus
from tod_core.txmgr import LocalSigner, NonceTaken, TxManager, dev_key, signer_from_env

pytestmark = pytest.mark.skipif(not (shutil.which("anvil") and shutil.which("forge")), reason="needs foundry")

ROUNDS, K, BUDGET = 3, 4, 300_000_000
WINDOWS = {"commit": 45, "reveal": 30, "verify": 45, "finalize": 60, "stall": 3600}
counter = iter(range(1, 10_000))


def h(label: str) -> bytes:
    return Web3.keccak(text=label)


def script(name: str, *args: str, rpc: str, net: str | None = None):
    target = ["--network", net or "anvil", "--rpc", rpc]
    env = {k: v for k, v in os.environ.items() if not k.endswith("_PRIVATE_KEY")}
    return subprocess.run([sys.executable, str(REPO / "scripts" / name), *target, *args],
                          check=True, capture_output=True, text=True, env=env)


def start_anvil(*flags: str) -> tuple[subprocess.Popen, str, Web3]:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    proc = subprocess.Popen(["anvil", "--port", str(port), "--silent", *flags])
    rpc = f"http://127.0.0.1:{port}"
    w3 = Web3(Web3.HTTPProvider(rpc))
    for _ in range(100):
        if w3.is_connected():
            break
        time.sleep(0.1)
    return proc, rpc, w3


@pytest.fixture(scope="module")
def chain(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("chain")
    proc, rpc, _ = start_anvil()
    try:
        out = tmp / "anvil.toml"
        script("deploy.py", "--out", str(out), "--journal-dir", str(tmp / "deploy"), rpc=rpc)
        yield Ledger(Network.load(out, rpc)), out, rpc, tmp
    finally:
        proc.terminate()
        proc.wait()


@pytest.fixture
def ledger(chain):
    return chain[0]


class Actor:
    """One funded key with its own queue, in the role a teammate's process would hold it."""

    def __init__(self, chain, label: str, tokens: float = 0):
        l, out, rpc, tmp = chain
        self.key = dev_key(label)
        self.signer = LocalSigner(self.key)
        self.address = self.signer.address
        script("fund.py", self.address, "--tokens", str(tokens), "--journal-dir", str(tmp / "faucet"), rpc=rpc, net=str(out))
        self.tm = TxManager(l.w3, self.signer, tmp / "actors", poll_seconds=0.02)
        self.l = l.using(self.tm)


def actors(chain):
    tag = next(counter)
    return tag, Actor(chain, "coordinator"), Actor(chain, "verifier/a"), Actor(chain, "verifier/b")


def join(chain, tag: int, i: int, stake: int, faucet=None):
    """A paired owner and operator with `stake` deposited, through the two signatures a real join needs."""
    l = chain[0]
    owner = Actor(chain, f"owner/{tag}/{i}", tokens=0 if faucet else stake / 1e6)
    op = Actor(chain, f"op/{tag}/{i}")
    if faucet:
        claim_faucet(chain, owner, faucet)
    deadline = l.head()[1] + 1800
    nullifier = h(f"human/{tag}/{i}")
    invite = enc.sign(dev_key("admitter"), "Invite", l.net.chain_id, l.net.registry,
                      {"operator": op.address, "owner": owner.address, "nullifier": nullifier, "deadline": deadline})
    consent = enc.sign(op.key, "Consent", l.net.chain_id, l.net.registry,
                       {"owner": owner.address, "operator": op.address, "consentDeadline": deadline})
    owner.l.registry.join(op.address, nullifier, deadline, deadline, invite, consent)
    owner.l.token.approve(l.net.registry, stake)
    owner.l.registry.depositStake(op.address, stake)
    return owner, op


def create_job(chain, tag: int, rounds: int = ROUNDS, budget: int = BUDGET, faucet=None, overrides=None) -> tuple[int, Actor]:
    l = chain[0]
    requester = Actor(chain, f"requester/{tag}/{rounds}", tokens=0 if faucet else budget / 1e6)
    if faucet:
        claim_faucet(chain, requester, faucet)
    requester.l.token.approve(l.net.market, budget)
    params = {
        "budget": budget, "stakePerNode": l.market.minStake(budget, rounds, 3), "rounds": rounds, "segments": K,
        "minQuorum": 3, "maxPerRound": 6, "shards": 8, "slashOnMismatch": True, "dataUnavailableBps": 0,
        "refWorkSecondsPerRound": 2, "windows": WINDOWS, "workloadId": h("mlp-exact/1"), "modelSpecHash": h("spec"),
        "datasetHash": h("dataset"), "shardTableHash": h("shards"), "initialWeightsHash": h("w0"),
        "valCommit": bytes(32), "codeHash": bytes(32), "specURI": "https://coordinator.example/spec",
    }
    params.update(overrides or {})
    requester.l.market.createJob(params, 0)
    return max(e.args["jobId"] for e in l.events() if e.name == "JobCreated"), requester


def ckpts(start: bytes, job: int, rnd: int, i: int) -> list[bytes]:
    return [start] + [h(f"{job}/{rnd}/{i}/{j}") for j in range(1, K + 1)]


def commit_reveal(l, job: int, rnd: int, ops, reveal=None, checkpoints=None) -> None:
    start = l.market.getRound(job, rnd).startWeightsHash
    salts = {op.address: h(f"salt/{job}/{rnd}/{i}") for i, op in enumerate(ops)}
    for i, op in enumerate(ops):
        hashes = checkpoints[op.address] if checkpoints else ckpts(start, job, rnd, i)
        root = enc.checkpoint_root(hashes)
        commit = enc.commit_hash(enc.domain(l.net.chain_id, l.net.market), job, rnd, op.address, root, salts[op.address])
        assert commit == l.market.commitHashOf(job, rnd, op.address, root, salts[op.address])
        op.l.market.commit(job, rnd, commit)
    for i, op in enumerate(ops):
        if reveal is None or i in reveal:
            hashes = checkpoints[op.address] if checkpoints else ckpts(start, job, rnd, i)
            op.l.market.reveal(job, rnd, hashes, salts[op.address])


def past_reveal_deadline(l) -> None:
    l.w3.provider.make_request("evm_increaseTime", [WINDOWS["commit"] + WINDOWS["reveal"] + 1])
    l.w3.provider.make_request("anvil_mine", [hex(1)])


def draw_seed(l, coordinator: Actor, job: int, rnd: int) -> None:
    coordinator.l.market.lockSeed(job, rnd)
    l.w3.provider.make_request("anvil_mine", [hex(3)])
    coordinator.l.market.drawSeed(job, rnd)


def finalize(l, coordinator, verifiers, job: int, rnd: int, payouts, outcome=Outcome.ACCEPTED, agg=None):
    agg = agg or h(f"G/{job}/{rnd}")
    msg = {"jobId": job, "roundId": rnd, "outcome": int(outcome), "aggregateHash": agg, "flaggedBitmap": 0,
           "aggEvidenceHash": h("aggEv"), "payEvidenceHash": h("payEv"), "payoutsHash": enc.payouts_hash(payouts)}
    sigs = [enc.sign(v.key, "FinalizeRound", l.net.chain_id, l.net.market, msg) for v in verifiers]
    settlement = {"outcome": int(outcome), "aggregateHash": agg, "flaggedBitmap": 0, "aggEvidenceHash": h("aggEv"),
                  "payEvidenceHash": h("payEv"), "payouts": [{"operator": o, "amount": a} for o, a in payouts]}
    assert l.market.finalizeDigest(job, rnd, settlement) == enc.digest("FinalizeRound", l.net.chain_id, l.net.market, msg)
    return coordinator.l.market.finalizeRound(job, rnd, settlement, sigs)


def equal_split(budget: int, ops) -> list[tuple[str, int]]:
    addrs = sorted((o.address for o in ops), key=lambda a: int(a, 16))
    share, dust = divmod(budget, len(addrs))
    return [(a, share + (dust if i == 0 else 0)) for i, a in enumerate(addrs)]


def assert_rebuild_matches_views(l: Ledger) -> None:
    state = l.rebuild()
    assert state.jobs and state.rounds and state.nodes
    for job_id, job in state.jobs.items():
        params, view = l.market.getJob(job_id)
        assert job["params"] == params
        assert {k: job[k] for k in view._fields} == view._asdict(), f"job {job_id}"
    for (job_id, rnd), r in state.rounds.items():
        view = l.market.getRound(job_id, rnd)
        assert {k: r[k] for k in view._fields} == view._asdict(), f"round {job_id}/{rnd}"
        assert r["nodes"] == l.market.roundNodes(job_id, rnd)
        for op, nr in r["nodeRounds"].items():
            nv = l.market.getNodeRound(job_id, rnd, op)
            assert {k: nr[k] for k in nv._fields} == nv._asdict(), f"node {op} in {job_id}/{rnd}"
    for op, node in state.nodes.items():
        view = l.registry.getNode(op)
        assert {k: node[k] for k in view._fields} == view._asdict(), f"node {op}"
        assert (node["busyJob"] == 0) == l.registry.isIdle(op)


def round_setup(chain, nodes: int = 3, rounds: int = ROUNDS):
    l = chain[0]
    tag, coordinator, va, vb = actors(chain)
    stake = l.market.minStake(BUDGET, rounds, 3)
    pairs = [join(chain, tag, i, stake) for i in range(nodes)]
    job, requester = create_job(chain, tag, rounds)
    ops = [p[1] for p in pairs]
    coordinator.l.market.openRound(job, [o.address for o in ops], list(range(nodes)))
    return l, coordinator, [va, vb], pairs, ops, job, requester


def test_scripts_wire_the_contracts(chain):
    l = chain[0]
    assert l.registry.market() == l.net.market
    assert l.market.registry() == l.net.registry
    assert l.market.coordinator() == LocalSigner(dev_key("coordinator")).address
    assert l.market.verifiers() == [LocalSigner(dev_key(v)).address for v in ("verifier/a", "verifier/b")]
    assert l.market.threshold() == 2
    assert l.token.decimals() == 6
    # A fresh anvil and the dev deployer give the same addresses every time, so the committed file stays usable.
    committed = Network.load("anvil")
    assert (committed.market, committed.registry, committed.token, committed.roles, committed.deploy_block) == (
        l.net.market, l.net.registry, l.net.token, l.net.roles, l.net.deploy_block)


def test_full_round_pays_and_rebuilds(chain):
    l, coordinator, verifiers, pairs, ops, job, _ = round_setup(chain)
    rnd = 1
    params, job_state = l.market.getJob(job)
    assert (params.windows.finalize, params.specURI) == (WINDOWS["finalize"], "https://coordinator.example/spec")
    assert job_state.status == JobStatus.ACTIVE
    assert l.market.phase(job, rnd) == Phase.COMMIT
    assert not l.registry.isIdle(ops[0].address)
    assert_rebuild_matches_views(l)

    commit_reveal(l, job, rnd, ops)
    assert l.market.phase(job, rnd) == Phase.VERIFY
    draw_seed(l, coordinator, job, rnd)
    for v in verifiers:
        v.l.market.attestRound(job, rnd, h(f"report/{v.address}"), [])
    assert l.market.phase(job, rnd) == Phase.FINALIZE
    assert_rebuild_matches_views(l)

    payouts = equal_split(l.market.getRound(job, rnd).budget, ops)
    finalize(l, coordinator, verifiers, job, rnd, payouts)
    assert l.market.getRound(job, rnd).status == RoundStatus.SETTLED
    assert l.registry.isIdle(ops[0].address)
    assert_rebuild_matches_views(l)

    owner = pairs[0][0]
    pay = dict(payouts)[ops[0].address]
    assert l.market.claimable(owner.address) == pay
    owner.l.market.claim()
    assert l.token.balanceOf(owner.address) == pay
    assert l.market.claimable(owner.address) == 0
    assert {"Paid", "Claimed", "NodeFreed", "RoundFinalized"} <= {e.name for e in l.events()}


def claim_faucet(chain, actor, faucet):
    _, network, rpc, tmp = chain
    env = {k: v for k, v in os.environ.items() if not k.endswith("_PRIVATE_KEY")}
    env["WALLET_PRIVATE_KEY"] = actor.key.hex()
    return subprocess.run(
        [sys.executable, str(REPO / "scripts/faucet.py"), "claim", "--network", str(network), "--rpc", rpc,
         "--faucet", faucet, "--account", actor.address, "--journal-dir", str(tmp / "claims")],
        check=True, capture_output=True, text=True, env=env)


def test_faucet_to_stake_settlement_claim_and_withdrawal(chain):
    """Real trainer/replay and onchain money flow; service processes and public deployment are separate."""
    import numpy as np
    from tod_core.aggregate import Outer, gate
    from tod_core.blob import whash
    from tod_core.evidence import canonical
    from tod_datasets.canonical import from_arrays, split
    from tod_workloads.mlp_exact import MLPExact
    from tod_workloads.runner import run_round, sampler
    from jsonschema import Draft202012Validator

    l, network, rpc, tmp = chain
    tag, coordinator, va, vb = actors(chain)
    deployed = script("faucet.py", "deploy", "--out", str(tmp / "faucet.json"),
                      "--journal-dir", str(tmp / "faucet-deploy"), net=str(network), rpc=rpc)
    faucet = json.loads(deployed.stdout.splitlines()[-1])["faucet"]
    script("fund.py", faucet, "--tokens", "1000", "--journal-dir", str(tmp / "faucet"), net=str(network), rpc=rpc)
    supply = l.token.totalSupply()
    assert not l.token.hasRole(l.token.MINTER_ROLE(), faucet)

    budget = 30_000_000
    stake = l.market.minStake(budget, 1, 3)
    pairs = [join(chain, tag, i, stake, faucet=faucet) for i in range(4)]
    ops = [op for _, op in pairs]
    X = np.random.default_rng(0).random((1000, 4)).astype(np.float32)
    data = from_arrays(X, (X[:, 0] > 0.5).astype(np.int64))
    layout = split(len(data.y), 4, "0.05", "0.1")
    spec = json.loads((REPO / "vectors/spec.example.mlp.json").read_text())
    spec["model"].update(inputShape=[4], outputs=2, hidden=8)
    spec["train"].update(H=64, K=K, B=8, lr="0.05", epochs=1)
    spec["data"].update(datasetHash=data.card.hash, shards=layout["shards"], valFrac="0.05", testFrac="0.1")
    spec["refWorkSecondsPerRound"] = 2
    Draft202012Validator(json.loads((REPO / "vectors/spec.schema.json").read_text())).validate(spec)
    spec_hash = enc.k256(canonical(spec))
    workload = MLPExact(4, 2, hidden=8, lr="0.05")
    weights = workload.init(int.from_bytes(spec_hash[:8], "big"))
    job, requester = create_job(chain, tag, rounds=1, budget=budget, faucet=faucet, overrides={
        "modelSpecHash": spec_hash, "initialWeightsHash": whash(spec_hash, weights),
        "datasetHash": bytes.fromhex(data.card.hash[2:]), "shardTableHash": enc.k256(canonical(layout["shards"])),
        "workloadId": h("mlp-exact/1"), "shards": 4})
    assert l.token.balanceOf(requester.address) == 100_000_000 - budget
    assert l.token.balanceOf(faucet) == 500_000_000
    before_nonce = l.w3.eth.get_transaction_count(requester.address)
    with pytest.raises(subprocess.CalledProcessError) as blocked:
        claim_faucet(chain, requester, faucet)
    assert "Cooldown active" in blocked.value.stderr
    assert l.w3.eth.get_transaction_count(requester.address) == before_nonce

    coordinator.l.market.openRound(job, [op.address for op in ops], list(range(4)))
    domain = enc.domain(l.net.chain_id, l.net.market)

    def train(shard):
        result = {}
        hashes = run_round(workload, weights, data.X, data.y,
                           sampler(domain, job, shard, layout["shards"][shard], 0, 64, 8), 64, K, spec_hash,
                           on_checkpoint=lambda _, w: result.update(weights=w))
        return hashes, result["weights"]

    checkpoints = {op.address: train(i)[0] for i, op in enumerate(ops[1:], start=1)}
    checkpoints[ops[0].address] = [whash(spec_hash, weights)] + [
        whash(spec_hash, weights + np.float32(0.001 * k)) for k in range(1, K + 1)]
    commit_reveal(l, job, 1, ops, checkpoints=checkpoints)
    draw_seed(l, coordinator, job, 1)
    aggregates = []
    for verifier in (va, vb):
        failures, updates = [], []
        for i, op in enumerate(ops):
            replayed, final_weights = train(i)
            if replayed != checkpoints[op.address]:
                failures.append({"operator": op.address, "kind": int(Kind.REPLAY_MISMATCH), "blameFrom": False})
            else:
                updates.append((op.address, final_weights))
        assert [f["operator"] for f in failures] == [ops[0].address]
        lo, length = layout["val"]
        merged = gate(weights, updates, Outer(), None,
                      lambda w: workload.evaluate(w, data.X[lo:lo + length], data.y[lo:lo + length])[0])
        assert not merged.reverted and not merged.excluded
        aggregates.append(whash(spec_hash, merged.w_new))
        report_hash = enc.k256(canonical({"failures": failures, "aggregate": aggregates[-1].hex()}))
        verifier.l.market.attestRound(job, 1, report_hash, failures)
    assert aggregates[0] == aggregates[1]
    assert l.registry.getNode(ops[0].address).stake == 0
    round_state = l.market.getRound(job, 1)
    assert round_state.budget == budget + stake // 2
    payouts = equal_split(round_state.budget + round_state.drip, ops[1:])
    settlement_receipt = finalize(l, coordinator, [va, vb], job, 1, payouts, agg=aggregates[0])
    assert l.market.getRound(job, 1).status == RoundStatus.SETTLED
    assert l.market.claimable(pairs[0][0].address) == 0
    assert l.token.balanceOf(pairs[0][0].address) == 100_000_000 - stake
    for owner, op in pairs[1:]:
        pay = dict(payouts)[op.address]
        assert l.market.claimable(owner.address) == pay
        owner.l.market.claim()
        owner.l.registry.withdrawStake(op.address, stake)
        assert l.token.balanceOf(owner.address) == 100_000_000 + pay
        assert l.market.claimable(owner.address) == 0
        assert l.registry.getNode(op.address).stake == 0
    assert l.token.totalSupply() == supply
    assert_rebuild_matches_views(l)
    status = script("faucet.py", "status", "--faucet", faucet, "--account", requester.address,
                    net=str(network), rpc=rpc)
    assert json.loads(status.stdout)["inventory"] == 500_000_000
    print(f"Faucet {faucet}; job {job}: settled, three honest owners claimed, bad node slashed and unpaid. "
          f"Settlement {Web3.to_hex(settlement_receipt['transactionHash'])}")

    # The local fixture is never advertised as Circle USDC or deployed on a public network.
    deployer = Actor(chain, "deployer")
    usdc_art = json.loads((REPO / "contracts/out/MockUSDC.sol/MockUSDC.json").read_text())
    data = l.w3.eth.contract(abi=usdc_art["abi"], bytecode=usdc_art["bytecode"]["object"]).constructor().data_in_transaction
    usdc_address = deployer.tm.transact(None, data)["contractAddress"]
    usdc = l.w3.eth.contract(address=usdc_address, abi=usdc_art["abi"])
    desk_result = script("exchange.py", "deploy", "--usdc", usdc_address,
                         "--out", str(tmp / "exchange.json"), net=str(network), rpc=rpc)
    desk = json.loads(desk_result.stdout.splitlines()[-1])["exchange"]
    deployer.tm = TxManager(l.w3, deployer.signer, tmp / "quote-seed", poll_seconds=0.02)
    deployer.tm.transact(usdc_address, usdc.encode_abi("mint", args=[deployer.address, 20_000_000]))

    def exchange(actor, action, *flags, check=True):
        env = {k: v for k, v in os.environ.items() if not k.endswith("_PRIVATE_KEY")}
        env["WALLET_PRIVATE_KEY"] = actor.key.hex()
        return subprocess.run(
            [sys.executable, str(REPO / "scripts/exchange.py"), action, "--network", str(network), "--rpc", rpc,
             "--exchange", desk, "--journal-dir", str(tmp / "wallet-exchange"), *flags],
            check=check, capture_output=True, text=True, env=env)

    exchange(deployer, "seed", "--asset", "usdc", "--amount", "20")
    owner, op = pairs[1]
    pay = dict(payouts)[op.address]
    formatted_pay = str(Decimal(pay) / Decimal(1_000_000))
    owner_balance = l.token.balanceOf(owner.address)
    before_nonce = l.w3.eth.get_transaction_count(owner.address)
    below_minimum = exchange(owner, "swap", "--amount", "9.999999", check=False)
    assert below_minimum.returncode != 0 and "at least 10000000 TOD base units (10 TOD)" in below_minimum.stderr
    no_approval = exchange(owner, "swap", "--amount", formatted_pay, check=False)
    assert no_approval.returncode != 0 and "Approve the exact input" in no_approval.stderr
    assert l.w3.eth.get_transaction_count(owner.address) == before_nonce
    exchange(owner, "approve", "--amount", formatted_pay)
    before_nonce = l.w3.eth.get_transaction_count(owner.address)
    repeated_approval = exchange(owner, "approve", "--amount", formatted_pay, check=False)
    assert repeated_approval.returncode != 0 and "Clear the existing allowance" in repeated_approval.stderr
    too_large = exchange(owner, "swap", "--amount", "20.000001", check=False)
    assert too_large.returncode != 0 and "output inventory" in too_large.stderr
    expired = exchange(owner, "swap", "--amount", formatted_pay, "--deadline", "1", check=False)
    assert expired.returncode != 0 and "deadline has expired" in expired.stderr
    assert l.w3.eth.get_transaction_count(owner.address) == before_nonce
    assert l.token.balanceOf(owner.address) == owner_balance
    assert l.token.allowance(owner.address, desk) == pay
    swapped = exchange(owner, "swap", "--amount", formatted_pay)
    receipt = l.w3.eth.get_transaction_receipt(json.loads(swapped.stdout.splitlines()[-1])["txHash"])
    assert receipt["status"] == 1
    assert l.token.balanceOf(owner.address) == owner_balance - pay
    assert usdc.functions.balanceOf(owner.address).call() == pay
    assert l.token.allowance(owner.address, desk) == 0
    exchange(owner, "approve", "--asset", "usdc", "--amount", formatted_pay)
    exchange(owner, "swap", "--asset", "usdc", "--amount", formatted_pay)
    assert l.token.balanceOf(owner.address) == owner_balance
    assert usdc.functions.balanceOf(owner.address).call() == 0
    assert usdc.functions.balanceOf(desk).call() == 20_000_000
    assert usdc.functions.totalSupply().call() == 20_000_000
    assert l.token.totalSupply() == supply
    status = exchange(owner, "status", "--account", owner.address)
    assert json.loads(status.stdout)["todBalance"] == owner_balance
    assert json.loads(status.stdout)["minimumRedemption"] == 10_000_000
    print(f"Exchange {desk}: {formatted_pay} earned TOD converted to test USDC and back with exact balances.")


def test_rebuild_follows_slash_no_reveal_and_revert(chain):
    l, coordinator, verifiers, pairs, ops, job, _ = round_setup(chain, nodes=5)
    commit_reveal(l, job, 1, ops, reveal={0, 1, 2, 3})
    past_reveal_deadline(l)
    draw_seed(l, coordinator, job, 1)
    failure = [{"operator": ops[0].address, "kind": int(Kind.REPLAY_MISMATCH), "blameFrom": False}]
    for v in verifiers:
        v.l.market.attestRound(job, 1, h("report"), failure)
    assert l.registry.getNode(ops[0].address).stake == 0
    assert_rebuild_matches_views(l)

    coordinator.l.market.reportNoReveal(job, 1, ops[4].address)
    assert_rebuild_matches_views(l)

    finalize(l, coordinator, verifiers, job, 1, [], outcome=Outcome.REVERTED, agg=h("ignored"))
    assert l.market.getRound(job, 1).status == RoundStatus.REVERTED
    assert_rebuild_matches_views(l)


def test_rebuild_follows_void_and_job_close(chain):
    l, coordinator, verifiers, pairs, ops, job, _ = round_setup(chain, rounds=1)
    commit_reveal(l, job, 1, ops, reveal={0})
    past_reveal_deadline(l)
    coordinator.l.market.voidRound(job, 1)
    assert l.market.getRound(job, 1).status == RoundStatus.VOID
    assert l.market.getJob(job)[1].status == JobStatus.COMPLETED
    assert_rebuild_matches_views(l)


def test_tail_equals_full_rebuild(chain):
    l, coordinator, verifiers, pairs, ops, job, _ = round_setup(chain)
    state = l.rebuild()
    before = state.last_block
    commit_reveal(l, job, 1, ops)
    state.sync(l)
    assert state.last_block > before
    full = l.rebuild()
    assert state.rounds == full.rounds and state.nodes == full.nodes and state.jobs == full.jobs


def test_events_page_and_halve_on_a_refused_range(chain, monkeypatch):
    l = chain[0]
    everything = list(l.events())
    assert everything == sorted(everything, key=lambda e: (e.block, e.log_index))
    real = l.w3.eth.get_logs

    def limited(q):
        if q["toBlock"] - q["fromBlock"] > 4:
            raise Web3RPCError("query exceeds max block range")
        return real(q)

    monkeypatch.setattr(l.w3.eth, "get_logs", limited)
    assert list(l.events()) == everything


def http_error(status: int) -> HTTPError:
    response = Response()
    response.status_code = status
    return HTTPError(f"{status} error", response=response)


def test_events_halve_on_the_public_rpcs_http_413(chain, monkeypatch):
    l = chain[0]
    everything = list(l.events())
    real = l.w3.eth.get_logs

    def limited(q):
        if q["toBlock"] - q["fromBlock"] > 4:
            raise http_error(413)
        return real(q)

    monkeypatch.setattr(l.w3.eth, "get_logs", limited)
    assert list(l.events()) == everything


def test_events_raise_other_http_errors(chain, monkeypatch):
    l = chain[0]

    def down(_):
        raise http_error(503)

    monkeypatch.setattr(l.w3.eth, "get_logs", down)
    with pytest.raises(HTTPError):
        list(l.events())


def test_reverts_are_named_and_cost_no_nonce(chain):
    l = chain[0]
    a = Actor(chain, f"stranger/{next(counter)}")
    nonce = l.w3.eth.get_transaction_count(a.address)
    with pytest.raises(Reverted) as e:
        a.l.market.openRound(1, [], [])
    assert e.value.name == "NotAuthorized"
    with pytest.raises(Reverted) as e:
        a.l.registry.depositStake(a.address, 1)
    assert e.value.name in ("NotJoined", "NotAuthorized")
    with pytest.raises(Reverted) as e:
        l.market.minStake(1, 0, 0)
    assert e.value.name == "BadInput"
    assert l.w3.eth.get_transaction_count(a.address) == nonce
    assert a.tm.pending() == []
    with pytest.raises(RuntimeError, match="using"):
        l.market.claim()


def test_every_abi_function_is_reachable(ledger):
    for name, bound in (("IJobMarket", ledger.market), ("INodeRegistry", ledger.registry)):
        for e in json.loads((ABI_DIR / f"{name}.json").read_text()):
            if e["type"] == "function":
                assert callable(getattr(bound, e["name"]))
    with pytest.raises(AttributeError):
        ledger.market.nope


class Manual:
    """Blocks mined only when the test asks, so a transaction can sit in the pool."""

    def __init__(self, l):
        self.l = l

    def __enter__(self):
        self.l.w3.provider.make_request("evm_setAutomine", [False])
        return self

    def __exit__(self, *_):
        self.l.w3.provider.make_request("evm_setAutomine", [True])
        self.mine()

    def mine(self, n: int = 1):
        self.l.w3.provider.make_request("anvil_mine", [hex(n)])


class MintActor(Actor):
    """A queue-test actor explicitly authorized by the token admin to send valid mint intents."""

    def __init__(self, chain, label):
        super().__init__(chain, label)
        l, _, _, tmp = chain
        abi = json.loads((REPO / "contracts/out/ToDToken.sol/ToDToken.json").read_text())["abi"]
        token = l.w3.eth.contract(address=l.net.token, abi=abi)
        admin = TxManager(l.w3, LocalSigner(dev_key("deployer")), tmp / "admin", poll_seconds=0.02)
        admin.transact(l.net.token, token.encode_abi("grantRole", args=[enc.k256(b"MINTER_ROLE"), self.address]))


def mint_call(l, to: str, amount: int) -> tuple[str, str]:
    return l.net.token, l.token._c.encode_abi("mint", args=[to, amount])


def test_restart_with_a_pending_tx_neither_resends_nor_loses_the_nonce(chain):
    l, _, _, tmp = chain
    a = MintActor(chain, f"restart/{next(counter)}")
    to, data = mint_call(l, a.address, 7)
    with Manual(l) as m:
        first = a.tm.send(to, data, gas=200_000)
        restarted = TxManager(l.w3, a.signer, tmp / "actors", poll_seconds=0.02)
        assert [t.nonce for t in restarted.pending()] == [first.nonce]
        again = restarted.send(to, data, gas=200_000)
        assert again.nonce == first.nonce and again.hashes == first.hashes, "same intent, no second send"
        to2, data2 = mint_call(l, a.address, 11)
        second = restarted.send(to2, data2, gas=200_000)
        assert second.nonce == first.nonce + 1, "next nonce follows the journal"
        m.mine()
        restarted.wait(again)
        restarted.wait(second)
    assert l.token.balanceOf(a.address) == 18, "each intent ran exactly once"
    assert restarted.pending() == []


def test_restart_recovers_a_tx_the_pool_forgot(chain):
    l, _, _, tmp = chain
    a = MintActor(chain, f"dropped/{next(counter)}")
    to, data = mint_call(l, a.address, 5)
    with Manual(l) as m:
        tx = a.tm.send(to, data, gas=200_000)
        l.w3.provider.make_request("anvil_dropTransaction", [tx.hashes[-1]])
        assert l.w3.eth.get_transaction_count(a.address, "pending") == tx.nonce
        restarted = TxManager(l.w3, a.signer, tmp / "actors", poll_seconds=0.02)
        m.mine()
        restarted.wait(restarted.pending()[0])
    assert l.token.balanceOf(a.address) == 5


def test_restart_settles_what_was_mined_while_down(chain):
    l, _, _, tmp = chain
    a = MintActor(chain, f"mined/{next(counter)}")
    to, data = mint_call(l, a.address, 3)
    with Manual(l) as m:
        tx = a.tm.send(to, data, gas=200_000)
        m.mine()
        restarted = TxManager(l.w3, a.signer, tmp / "actors", poll_seconds=0.02)
        assert restarted.pending() == []
        to2, data2 = mint_call(l, a.address, 4)
        assert restarted.send(to2, data2, gas=200_000).nonce == tx.nonce + 1


def test_journal_from_another_chain_is_not_replayed(chain):
    l, _, _, tmp = chain
    a = MintActor(chain, f"genesis/{next(counter)}")
    to, data = mint_call(l, a.address, 9)
    with Manual(l) as m:
        tx = a.tm.send(to, data, gas=200_000)
        l.w3.provider.make_request("anvil_dropTransaction", [tx.hashes[-1]])
        path = a.tm._path
        saved = json.loads(path.read_text())
        saved["genesis"] = "00" * 32
        path.write_text(json.dumps(saved))
        restarted = TxManager(l.w3, a.signer, tmp / "actors", poll_seconds=0.02)
        assert restarted.pending() == []
        m.mine()
    assert l.token.balanceOf(a.address) == 0


def test_stuck_tx_is_replaced_at_the_same_nonce(chain):
    l = chain[0]
    a = MintActor(chain, f"stuck/{next(counter)}")
    to, data = mint_call(l, a.address, 13)
    with Manual(l) as m:
        tx = a.tm.send(to, data, gas=200_000)
        old_fee, old_hash = tx.max_fee, tx.hashes[-1]
        # A fee spike leaves the tx underpriced, so empty blocks pass over it.
        l.w3.provider.make_request("anvil_setNextBlockBaseFeePerGas", [hex(old_fee * 50)])
        m.mine(a.tm.bump_blocks)
        assert l.w3.eth.get_transaction_count(a.address) == tx.nonce, "still stuck"
        a.tm.poll()
        assert len(tx.hashes) == 2 and tx.hashes[-1] != old_hash
        assert tx.max_fee >= old_fee * 120 // 100
        a.tm.poll()
        assert len(tx.hashes) == 2, "no second bump before bump_blocks more blocks"
        m.mine()
        receipt = a.tm.wait(tx)
    assert receipt["transactionHash"].to_0x_hex() == tx.hashes[-1]
    assert l.token.balanceOf(a.address) == 13, "replaced, not doubled"
    assert l.w3.eth.get_transaction_count(a.address) == tx.nonce + 1


def test_replacement_respects_the_fee_cap(chain):
    l, _, _, tmp = chain
    a = MintActor(chain, f"cap/{next(counter)}")
    capped = TxManager(l.w3, a.signer, tmp / "capped", max_fee_cap=1, poll_seconds=0.02)
    to, data = mint_call(l, a.address, 1)
    with Manual(l) as m:
        tx = capped.send(to, data, gas=200_000)
        l.w3.provider.make_request("anvil_setNextBlockBaseFeePerGas", [hex(tx.max_fee * 50)])
        m.mine(capped.bump_blocks)
        capped.poll()
        assert len(tx.hashes) == 1


def test_a_second_sender_on_the_same_key_surfaces(chain):
    l, _, _, tmp = chain
    a = MintActor(chain, f"second/{next(counter)}")
    to, data = mint_call(l, a.address, 21)
    with Manual(l) as m:
        tx = a.tm.send(to, data, gas=200_000)
        l.w3.provider.make_request("anvil_dropTransaction", [tx.hashes[-1]])
        signed = Account.from_key(a.key).sign_transaction({
            "chainId": l.net.chain_id, "nonce": tx.nonce, "to": a.address, "value": 0, "gas": 21_000,
            "maxFeePerGas": tx.max_fee, "maxPriorityFeePerGas": tx.tip, "type": 2})
        l.w3.eth.send_raw_transaction(signed.raw_transaction)
        m.mine()
        a.tm.poll_seconds = 0
        with pytest.raises(NonceTaken):
            a.tm.wait(tx, timeout=5)


@pytest.fixture
def public(tmp_path):
    """A chain that isn't 31337, so the scripts take their public path, with the role keys held in the environment."""
    proc, rpc, w3 = start_anvil("--chain-id", "84532")
    signers = {r: LocalSigner(dev_key(f"public/{r}")) for r in ("deployer", "coordinator", "admitter", "faucet", "a", "b")}
    roles = {r: signers[r].address for r in ("deployer", "coordinator", "admitter", "faucet")}
    roles["verifiers"] = [signers["a"].address, signers["b"].address]
    roles["tokenAdmin"] = roles["deployer"]
    text = (REPO / "networks" / "anvil.toml").read_text().split("[roles]")[0]
    text = text.replace('chainId = 31337', 'chainId = 84532').replace('probationSeconds = 0', 'probationSeconds = 300')
    text += "[roles]\n"
    text += "".join(f"{k} = {json.dumps(v)}\n" for k, v in roles.items())
    text += "\n[funding]\ndeployer = 1.0\ncoordinator = 0.5\nverifier = 0.25\n"
    toml = tmp_path / "public.toml"
    toml.write_text(text)
    env = {k: v for k, v in os.environ.items() if not k.endswith("_PRIVATE_KEY") and k != "BASE_SEPOLIA_RPC_URL"}
    env |= {"DEPLOYER_PRIVATE_KEY": dev_key("public/deployer").hex(), "FAUCET_PRIVATE_KEY": dev_key("public/faucet").hex()}

    def run(*args: str):
        return subprocess.run(
            [sys.executable, str(REPO / "scripts" / "deploy.py"), "--network", str(toml), "--rpc", rpc, "--no-verify",
             "--journal-dir", str(tmp_path / "j"), "--out", str(tmp_path / "out.toml"), *args],
            capture_output=True, text=True, env=env, stdin=subprocess.DEVNULL)

    try:
        yield w3, run, roles, env, tmp_path
    finally:
        proc.terminate()
        proc.wait()


def test_txmgr_never_needs_block_zero_on_a_public_chain(public, monkeypatch):
    w3, _, _, _, tmp = public
    real = w3.eth.get_block

    def pruned(block, *a, **k):
        if block == 0:
            raise Web3RPCError("pruned history unavailable: requested 0")
        return real(block, *a, **k)

    monkeypatch.setattr(w3.eth, "get_block", pruned)
    TxManager(w3, LocalSigner(dev_key("public/deployer")), tmp / "pruned")


def test_public_deploy_stops_for_a_human_and_sends_nothing(public):
    w3, run, roles, *_ = public
    w3.provider.make_request("anvil_setBalance", [roles["faucet"], hex(10**19)])
    r = run()
    assert r.returncode != 0 and "Nothing was sent" in r.stderr
    for line in (roles["faucet"], roles["deployer"], "JobMarket", "to verifier 1"):
        assert line in r.stdout, "the prompt shows what would happen"
    assert w3.eth.get_transaction_count(roles["faucet"]) == 0
    assert w3.eth.get_transaction_count(roles["deployer"]) == 0


def test_public_deploy_refuses_when_funds_fall_short(public):
    w3, run, roles, *_ = public
    w3.provider.make_request("anvil_setBalance", [roles["faucet"], hex(10**15)])
    r = run("--yes")
    assert r.returncode != 0 and "FAUCET holds" in r.stderr and "Nothing was sent" in r.stderr
    assert w3.eth.get_transaction_count(roles["faucet"]) == 0
    r = run("--yes", "--no-fund")
    assert r.returncode != 0 and "DEPLOYER would hold" in r.stderr
    assert w3.eth.get_transaction_count(roles["deployer"]) == 0


def test_public_deploy_refuses_the_wrong_key(public):
    w3, run, roles, env, _ = public
    env["DEPLOYER_PRIVATE_KEY"] = dev_key("somebody-else").hex()
    r = run("--yes")
    assert r.returncode != 0 and "expects" in r.stderr
    del env["DEPLOYER_PRIVATE_KEY"]
    r = run("--yes")
    assert r.returncode != 0 and "refused" in r.stderr


def test_public_deploy_funds_deploys_and_wires(public):
    w3, run, roles, _, tmp = public
    w3.provider.make_request("anvil_setBalance", [roles["faucet"], hex(10**19)])
    r = run("--yes")
    assert r.returncode == 0, r.stderr
    assert w3.eth.get_balance(roles["coordinator"]) == 5 * 10**17
    assert w3.eth.get_balance(roles["verifiers"][1]) == 25 * 10**16
    l = Ledger(Network.load(tmp / "out.toml", w3.provider.endpoint_uri))
    assert l.registry.market() == l.net.market
    assert l.registry.PROBATION_SECONDS() == 300
    assert l.market.coordinator() == roles["coordinator"]
    assert l.market.verifiers() == roles["verifiers"]
    assert l.token.decimals() == 6
    spent = w3.eth.get_transaction_count(roles["faucet"])
    deployer_nonce = w3.eth.get_transaction_count(roles["deployer"])
    original_bundle = (tmp / "out.toml").read_bytes()
    blocked = run("--yes")
    assert blocked.returncode != 0 and "earlier deployment" in blocked.stderr
    assert w3.eth.get_transaction_count(roles["deployer"]) == deployer_nonce
    assert w3.eth.get_transaction_count(roles["faucet"]) == spent
    r = run("--yes", "--out", str(tmp / "fresh-bundle.toml"))
    assert r.returncode == 0, r.stderr
    assert (tmp / "out.toml").read_bytes() == original_bundle
    assert w3.eth.get_balance(roles["coordinator"]) == 5 * 10**17, "a second run only tops up what is missing"
    assert w3.eth.get_transaction_count(roles["faucet"]) - spent == 1, "just the deployer, which spent gas"


def test_public_dry_run_never_funds_creates_or_writes_a_journal(public):
    w3, run, roles, _, tmp = public
    result = run("--dry-run", "--yes")
    assert result.returncode == 0, result.stderr
    assert '"dryRun": true' in result.stdout and '"fundingFunded": false' in result.stdout
    assert "create ToDToken" in result.stdout and "Nothing was sent" in result.stdout
    for address in [roles["deployer"], roles["faucet"], roles["coordinator"], *roles["verifiers"]]:
        assert w3.eth.get_transaction_count(address) == 0
        assert w3.eth.get_balance(address) == 0
    assert not (tmp / "out.toml").exists()
    assert not (tmp / "out.toml.receipts.json").exists()
    assert not (tmp / "j").exists()


def use_deployer_for_role_funding(public):
    _, _, roles, env, tmp = public
    source = tmp / "public.toml"
    text = source.read_text().replace('[roles]\n', f'[roles]\nfunding = "{roles["deployer"]}"\n')
    source.write_text(text.replace('[funding]\n', '[funding]\nfaucet = 0.01\n'))
    env["FUNDING_PRIVATE_KEY"] = env["DEPLOYER_PRIVATE_KEY"]
    del env["FAUCET_PRIVATE_KEY"]


def test_one_funded_deployer_can_prepare_all_fresh_role_wallets(public):
    use_deployer_for_role_funding(public)
    w3, run, roles, _, tmp = public
    w3.provider.make_request("anvil_setBalance", [roles["deployer"], hex(3 * 10**18)])
    result = run("--yes")
    assert result.returncode == 0, result.stderr
    assert w3.eth.get_balance(roles["faucet"]) == 10**16
    assert w3.eth.get_balance(roles["coordinator"]) == 5 * 10**17
    assert all(w3.eth.get_balance(v) == 25 * 10**16 for v in roles["verifiers"])
    record = json.loads((tmp / "out.toml.receipts.json").read_text())
    assert record["status"] == "complete" and len(record["funding"]) == 4
    assert set(record["contracts"]) == {"ToDToken", "NodeRegistry", "JobMarket"}
    assert all(item["to"] != roles["deployer"] for item in record["funding"])
    for tx in [*record["funding"], *record["contracts"].values()]:
        assert w3.eth.get_transaction_receipt(tx["txHash"])["status"] == 1
    assert w3.eth.get_transaction_receipt(record["setMarketTxHash"])["status"] == 1
    assert w3.eth.get_transaction_count(roles["deployer"]) == 8


def test_deployer_funding_cannot_spend_its_own_deployment_reserve(public):
    use_deployer_for_role_funding(public)
    w3, run, roles, _, tmp = public
    w3.provider.make_request("anvil_setBalance", [roles["deployer"], hex(1011 * 10**15)])
    result = run("--yes")
    assert result.returncode != 0 and "DEPLOYER would hold" in result.stderr
    assert w3.eth.get_transaction_count(roles["deployer"]) == 0
    assert all(w3.eth.get_balance(a) == 0 for a in [roles["faucet"], roles["coordinator"], *roles["verifiers"]])
    assert not (tmp / "out.toml.receipts.json").exists()


def test_partial_deployment_record_blocks_blind_retry(public):
    w3, run, roles, _, tmp = public
    progress = tmp / "out.toml.receipts.json"
    progress.write_text('{"status":"in_progress","contracts":{}}')
    result = run("--yes")
    assert result.returncode != 0 and "receipt record exists" in result.stderr
    assert w3.eth.get_transaction_count(roles["deployer"]) == 0
    assert w3.eth.get_transaction_count(roles["faucet"]) == 0
    assert json.loads(progress.read_text())["status"] == "in_progress"


def test_fund_on_a_public_chain_stops_for_a_human(public):
    w3, run, roles, env, tmp = public
    w3.provider.make_request("anvil_setBalance", [roles["faucet"], hex(10**19)])
    assert run("--yes").returncode == 0
    target = LocalSigner(dev_key("public/operator")).address
    cmd = [sys.executable, str(REPO / "scripts" / "fund.py"), target, "--network", str(tmp / "out.toml"), "--rpc",
           w3.provider.endpoint_uri, "--eth", "0.5", "--tokens", "0", "--journal-dir", str(tmp / "j")]
    r = subprocess.run(cmd, capture_output=True, text=True, env=env, stdin=subprocess.DEVNULL)
    assert r.returncode != 0 and "Nothing was sent" in r.stderr and target in r.stdout
    assert w3.eth.get_balance(target) == 0
    r = subprocess.run([*cmd, "--yes"], capture_output=True, text=True, env=env)
    assert r.returncode == 0, r.stderr
    assert w3.eth.get_balance(target) == 5 * 10**17


def test_threads_sharing_a_key_get_distinct_nonces(chain):
    l = chain[0]
    a = MintActor(chain, f"threads/{next(counter)}")
    start = l.w3.eth.get_transaction_count(a.address)
    amounts = list(range(1, 9))
    txs = []

    def send(amount):
        txs.append(a.tm.send(*mint_call(l, a.address, amount), gas=200_000))

    with Manual(l) as m:
        threads = [threading.Thread(target=send, args=(x,)) for x in amounts]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        assert sorted(t.nonce for t in txs) == list(range(start, start + len(amounts)))
        m.mine()
        for tx in txs:
            a.tm.wait(tx)
    assert l.token.balanceOf(a.address) == sum(amounts)


def test_revert_after_a_clean_estimate_is_still_named(chain, monkeypatch):
    l = chain[0]
    a = MintActor(chain, f"race/{next(counter)}")
    monkeypatch.setattr(l.w3.eth, "estimate_gas", lambda *_: 200_000)
    with pytest.raises(Reverted) as e:
        a.l.market.openRound(1, [], [])
    assert e.value.name == "NotAuthorized"
    assert a.tm.pending() == [], "mined and reverted: the nonce is spent, nothing stays queued"


def test_wait_survives_an_rpc_hiccup(chain, monkeypatch):
    l = chain[0]
    a = MintActor(chain, f"hiccup/{next(counter)}")
    tx = a.tm.send(*mint_call(l, a.address, 2), gas=200_000)
    real, calls = a.tm.poll, []

    def flaky():
        calls.append(1)
        if len(calls) == 1:
            raise ConnectionError("rate limited")
        real()

    monkeypatch.setattr(a.tm, "poll", flaky)
    assert a.tm.wait(tx)["status"] == 1
    assert len(calls) >= 2


def test_dev_keys_are_refused_off_anvil(monkeypatch):
    monkeypatch.delenv("COORDINATOR_PRIVATE_KEY", raising=False)
    assert signer_from_env("COORDINATOR_PRIVATE_KEY", "coordinator", 31337).address
    with pytest.raises(RuntimeError, match="refused"):
        signer_from_env("COORDINATOR_PRIVATE_KEY", "coordinator", 84532)
    key = dev_key("from-env")
    monkeypatch.setenv("COORDINATOR_PRIVATE_KEY", key.hex())
    assert signer_from_env("COORDINATOR_PRIVATE_KEY", "x", 84532).address == LocalSigner(key).address


def funded_public(public):
    w3, run, roles, env, tmp = public
    w3.provider.make_request("anvil_setBalance", [roles["faucet"], hex(10**19)])
    result = run("--yes")
    assert result.returncode == 0, result.stderr
    return Ledger(Network.load(tmp / "out.toml", w3.provider.endpoint_uri))


def public_fund(public, addresses, *flags):
    w3, _, _, env, tmp = public
    return subprocess.run(
        [sys.executable, str(REPO / "scripts/fund.py"), *addresses,
         "--network", str(tmp / "out.toml"), "--rpc", w3.provider.endpoint_uri,
         "--journal-dir", str(tmp / "fund-journal"), *flags],
        capture_output=True, text=True, env=env, stdin=subprocess.DEVNULL)


def test_token_only_funding_requires_confirmation(public):
    l = funded_public(public)
    w3, _, roles, _, _ = public
    target = LocalSigner(dev_key("public/token-only")).address
    before = w3.eth.get_transaction_count(roles["faucet"])
    result = public_fund(public, [target], "--tokens", "1.000001", "--eth", "0")
    assert result.returncode != 0 and "Nothing was sent" in result.stderr
    assert "1000001 base units" in result.stdout and "TOD" in result.stdout
    assert w3.eth.get_transaction_count(roles["faucet"]) == before
    assert l.token.totalSupply() == 0
    assert l.token.hasRole(bytes(32), roles["tokenAdmin"])
    assert l.token.hasRole(l.token.MINTER_ROLE(), roles["faucet"])
    assert not l.token.hasRole(l.token.MINTER_ROLE(), target)
    result = public_fund(public, [target], "--tokens", "1.000001", "--eth", "0", "--yes")
    assert result.returncode == 0, result.stderr
    assert l.token.balanceOf(target) == 1000001


def test_batch_cap_preflight_sends_no_eth_or_tokens(public):
    l = funded_public(public)
    w3, _, roles, env, tmp = public
    faucet = TxManager(w3, LocalSigner(env["FAUCET_PRIVATE_KEY"]), tmp / "cap", poll_seconds=0.02)
    l.using(faucet).token.mint(roles["faucet"], l.token.cap() - 3)
    targets = [LocalSigner(dev_key(f"public/cap/{i}")).address for i in range(2)]
    before = w3.eth.get_transaction_count(roles["faucet"])
    result = public_fund(public, targets, "--tokens", "0.000002", "--eth", "0.01", "--yes")
    assert result.returncode != 0 and "remaining TOD cap" in result.stderr
    assert w3.eth.get_transaction_count(roles["faucet"]) == before
    assert l.token.totalSupply() == l.token.cap() - 3
    assert all(w3.eth.get_balance(address) == l.token.balanceOf(address) == 0 for address in targets)


def test_revoked_minter_can_still_fund_eth_only(public):
    l = funded_public(public)
    w3, _, roles, env, tmp = public
    abi = json.loads((REPO / "contracts/out/ToDToken.sol/ToDToken.json").read_text())["abi"]
    token = w3.eth.contract(address=l.net.token, abi=abi)
    admin = TxManager(w3, LocalSigner(env["DEPLOYER_PRIVATE_KEY"]), tmp / "admin", poll_seconds=0.02)
    admin.transact(l.net.token, token.encode_abi("revokeRole", args=[l.token.MINTER_ROLE(), roles["faucet"]]))
    target = LocalSigner(dev_key("public/revoked-target")).address
    before = w3.eth.get_transaction_count(roles["faucet"])
    result = public_fund(public, [target], "--tokens", "1", "--eth", "0.01", "--yes")
    assert result.returncode != 0 and "no MINTER_ROLE" in result.stderr
    assert w3.eth.get_transaction_count(roles["faucet"]) == before
    assert w3.eth.get_balance(target) == l.token.balanceOf(target) == 0
    result = public_fund(public, [target], "--tokens", "0", "--eth", "0.001", "--yes")
    assert result.returncode == 0, result.stderr
    assert w3.eth.get_balance(target) == 10**15


def test_faucet_public_deploy_and_claim_require_confirmation(public):
    w3, deploy_bundle, roles, env, tmp = public
    w3.provider.make_request("anvil_setBalance", [roles["faucet"], hex(10**19)])
    assert deploy_bundle("--yes").returncode == 0
    network = str(tmp / "out.toml")
    rpc = w3.provider.endpoint_uri

    def run_faucet(action, *args):
        return subprocess.run(
            [sys.executable, str(REPO / "scripts/faucet.py"), action, "--network", network, "--rpc", rpc,
             "--journal-dir", str(tmp / "faucet-commands"), *args],
            capture_output=True, text=True, env=env, stdin=subprocess.DEVNULL)

    nonce = w3.eth.get_transaction_count(roles["deployer"])
    stopped = run_faucet("deploy")
    assert stopped.returncode != 0 and "Nothing was sent" in stopped.stderr
    assert roles["deployer"] in stopped.stdout and "gas" in stopped.stdout
    assert w3.eth.get_transaction_count(roles["deployer"]) == nonce
    bundle = tmp / "faucet.json"
    created = run_faucet("deploy", "--yes", "--out", str(bundle))
    assert created.returncode == 0, created.stderr
    faucet = json.loads(bundle.read_text())["faucet"]
    mint = subprocess.run(
        [sys.executable, str(REPO / "scripts/fund.py"), faucet, "--network", network, "--rpc", rpc,
         "--tokens", "200", "--eth", "0", "--yes", "--journal-dir", str(tmp / "mint")],
        capture_output=True, text=True, env=env)
    assert mint.returncode == 0, mint.stderr

    env["WALLET_PRIVATE_KEY"] = dev_key("public/faucet-claimant").hex()
    claimant = LocalSigner(env["WALLET_PRIVATE_KEY"]).address
    w3.provider.make_request("anvil_setBalance", [claimant, hex(10**18)])
    refused = run_faucet("claim", "--faucet", faucet)
    assert refused.returncode != 0 and "Nothing was sent" in refused.stderr
    assert claimant in refused.stdout
    assert w3.eth.get_transaction_count(claimant) == 0
    claimed = run_faucet("claim", "--faucet", faucet, "--yes")
    assert claimed.returncode == 0, claimed.stderr
    ledger = Ledger(Network.load(network, rpc))
    assert ledger.token.balanceOf(claimant) == 100_000_000
    nonce = w3.eth.get_transaction_count(claimant)
    repeated = run_faucet("claim", "--faucet", faucet, "--yes")
    assert repeated.returncode != 0 and "Cooldown active" in repeated.stderr
    assert w3.eth.get_transaction_count(claimant) == nonce
    del env["WALLET_PRIVATE_KEY"]
    status = run_faucet("status", "--faucet", faucet, "--account", claimant)
    assert status.returncode == 0, status.stderr
    assert json.loads(status.stdout)["inventory"] == 100_000_000
