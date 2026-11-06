"""Local-chain helpers for tests and the dev stack: start anvil, fund keys, join nodes, create a job, open a round."""
import hashlib
import http.server
import json
import os
import re
import socket
import subprocess
import sys
import threading
import time
from decimal import Decimal

from web3 import Web3

from tod_core import encodings as enc
from tod_core.blob import k256
from tod_core.ledger import REPO, Ledger, Network
from tod_core.txmgr import LocalSigner, TxManager, dev_key

WINDOWS = {"commit": 45, "reveal": 30, "verify": 45, "finalize": 60, "stall": 3600}


def h(label: str) -> bytes:
    return Web3.keccak(text=label)


def script(name: str, *args: str, rpc: str, net: str = "anvil"):
    env = {k: v for k, v in os.environ.items() if not k.endswith("_PRIVATE_KEY")}
    subprocess.run([sys.executable, str(REPO / "scripts" / name), "--network", net, "--rpc", rpc, *args],
                   check=True, capture_output=True, text=True, env=env)


def start_anvil(*flags: str) -> tuple[subprocess.Popen, str]:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    proc = subprocess.Popen(["anvil", "--port", str(port), "--silent", *flags])
    rpc = f"http://127.0.0.1:{port}"
    for _ in range(100):
        if Web3(Web3.HTTPProvider(rpc)).is_connected():
            break
        time.sleep(0.1)
    return proc, rpc


def deploy(rpc: str, workdir) -> tuple[Ledger, str]:
    """Deploys with the real script and returns a read-only ledger plus the network file it wrote."""
    out = workdir / "anvil.toml"
    script("deploy.py", "--out", str(out), "--journal-dir", str(workdir / "deploy"), rpc=rpc)
    return Ledger(Network.load(out, rpc)), str(out)


class Actor:
    """One dev key with its own transaction queue, funded with gas and optionally test tokens."""

    def __init__(self, ledger: Ledger, net_file: str, workdir, label: str, units: int = 0):
        self.key = dev_key(label)
        self.address = LocalSigner(self.key).address
        # fund.py takes TOD with six decimals and defaults to 1000, so always pass the exact amount.
        script("fund.py", self.address, "--tokens", str(Decimal(units).scaleb(-6)), "--journal-dir", str(workdir / "faucet"),
               rpc=ledger.net.rpc, net=net_file)
        self.l = ledger.using(TxManager(ledger.w3, LocalSigner(self.key), workdir / "actors", poll_seconds=0.02))


def open_round(ledger: Ledger, net_file: str, workdir, tag: str, nodes: int = 3, segments: int = 4,
               budget: int = 300_000_000, rounds: int = 3, **job) -> tuple[int, list[Actor]]:
    """Joins `nodes` operators with real invites and consents, funds a job and opens round 1, as the coordinator would."""
    l = ledger
    stake = l.market.minStake(budget, rounds, 3)
    ops = []
    for i in range(nodes):
        owner = Actor(l, net_file, workdir, f"owner/{tag}/{i}", units=stake)
        op = Actor(l, net_file, workdir, f"op/{tag}/{i}")
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
    requester = Actor(l, net_file, workdir, f"requester/{tag}", units=budget)
    requester.l.token.approve(l.net.market, budget)
    requester.l.market.createJob({
        "budget": budget, "stakePerNode": stake, "rounds": rounds, "segments": segments, "minQuorum": 3,
        "maxPerRound": 6, "shards": 8, "slashOnMismatch": True, "dataUnavailableBps": 0, "refWorkSecondsPerRound": 2,
        "windows": WINDOWS, "workloadId": h("mlp-exact/1"), "modelSpecHash": h("spec"), "datasetHash": h("dataset"),
        "shardTableHash": h("shards"), "initialWeightsHash": h("w0"), "valCommit": bytes(32), "codeHash": bytes(32),
        "specURI": "https://coordinator.example/spec", **job}, 0)
    job_id = max(e.args["jobId"] for e in l.events() if e.name == "JobCreated")
    Actor(l, net_file, workdir, "coordinator").l.market.openRound(job_id, [o.address for o in ops], list(range(nodes)))
    return job_id, ops


class BlobServer:
    """In-memory stand-in for the coordinator: blob routes with the same BlobAccess check, plus the settlement,
    evidence and signature routes a verifier co-signs through."""

    def __init__(self, net):
        self.blobs: dict[str, bytes] = {}
        self.put_signers: list[str] = []
        self.settlements: dict[tuple[int, int], dict] = {}  # (job, round) -> Settlement as finalize returns it
        self.sigs: dict[tuple[int, int], dict[str, bytes]] = {}
        outer = self

        def settlement_json(job, rnd):
            from tod_core.finalize import message
            s, x = outer.settlements[(job, rnd)], lambda b: "0x" + b.hex()
            return {"jobId": job, "roundId": rnd, "outcome": s["outcome"], "aggregateHash": x(s["aggregateHash"]),
                    "flaggedBitmap": s["flaggedBitmap"], "aggEvidenceHash": x(s["aggEvidenceHash"]),
                    "payEvidenceHash": x(s["payEvidenceHash"]),
                    "payouts": [{"op": op, "amount": a} for op, a in s["payouts"]],
                    "digest": x(enc.digest("FinalizeRound", net.chain_id, net.market, message(job, rnd, s))),
                    "collected": len(outer.sigs.get((job, rnd), {}))}

        class Handler(http.server.BaseHTTPRequestHandler):
            def _auth(self, blob_hash):
                m = {"jobId": int(self.headers["X-Job"]), "roundId": int(self.headers["X-Round"]),
                     "blobHash": bytes.fromhex(blob_hash[2:]), "method": self.command,
                     "expiry": int(self.headers["X-Expiry"])}
                return enc.recover("BlobAccess", net.chain_id, net.market, m, bytes.fromhex(self.headers["X-Signature"][2:]))

            def _json(self, code, body):
                data = json.dumps(body).encode()
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(data)

            def do_GET(self):
                if m := re.fullmatch(r"/v1/jobs/(\d+)/rounds/(\d+)/(settlement|evidence)", self.path):
                    key = (int(m[1]), int(m[2]))
                    if key not in outer.settlements:
                        return self._json(404, {"detail": "settlement not found"})
                    if m[3] == "settlement":
                        return self._json(200, settlement_json(*key))
                    h_ = "0x" + outer.settlements[key]["aggEvidenceHash"].hex()
                    return self._json(200, {"job": key[0], "round": key[1], "reports": [], "pay": None,
                                            "aggregate": {"hash": h_, "url": f"/v1/blobs/{h_}"}})
                blob_hash = self.path.rsplit("/", 1)[-1]
                self._auth(blob_hash)
                body = outer.blobs.get(blob_hash)
                self.send_response(200 if body else 404)
                self.end_headers()
                self.wfile.write(body or b"")

            def do_HEAD(self):  # unsigned, like the coordinator's: whether a blob is stored, nothing more
                self.send_response(200 if self.path.rsplit("/", 1)[-1] in outer.blobs else 404)
                self.end_headers()

            def do_POST(self):
                from eth_account import Account
                from eth_account.messages import encode_defunct
                from tod_core.finalize import message

                m = re.fullmatch(r"/v1/jobs/(\d+)/rounds/(\d+)/signatures", self.path)
                body = self.rfile.read(int(self.headers["Content-Length"]))
                msg = f"POST\n{self.path}\n{self.headers['X-Timestamp']}\n{hashlib.sha256(body).hexdigest()}"
                op = Account.recover_message(encode_defunct(text=msg), signature=self.headers["X-Signature"])
                b, key = json.loads(body), (int(m[1]), int(m[2]))
                sig = bytes.fromhex(b["signature"][2:])
                signer = enc.recover("FinalizeRound", net.chain_id, net.market,
                                     message(*key, outer.settlements[key]), sig)
                if not (op.lower() == b["verifier"].lower() == signer.lower()):
                    return self._json(422, {"detail": "signature is not over this Settlement"})
                outer.sigs.setdefault(key, {})[op.lower()] = sig
                self._json(200, {"collected": len(outer.sigs[key]), "threshold": 2})

            def do_PUT(self):
                blob_hash = self.path.rsplit("/", 1)[-1]
                body = self.rfile.read(int(self.headers["Content-Length"]))
                if "0x" + k256(body).hex() != blob_hash:
                    self.send_response(400)
                    self.end_headers()
                    return
                outer.put_signers.append(self._auth(blob_hash))
                outer.blobs[blob_hash] = body
                self.send_response(201)
                self.end_headers()

            def log_message(self, *a):
                pass

        self.srv = http.server.HTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{self.srv.server_port}"

    def put(self, data: bytes) -> str:
        blob_hash = "0x" + k256(data).hex()
        self.blobs[blob_hash] = data
        return blob_hash


def mlp_job(srv: BlobServer, segments: int = 4):
    """A small exact-MLP job on synthetic data: stores its spec and start weights, and returns
    (createJob overrides, spec, start weights, datasets loader)."""
    import numpy as np
    from tod_core.blob import to_blob

    from .trainer import workload

    spec = {"workload": {"id": "mlp-exact/1"},
            "model": {"inputShape": [16], "outputs": 3, "hidden": 16, "task": "classification"},
            "train": {"H": 20, "K": segments, "B": 32, "lr": "0.05"},
            "gate": {"relTol": "0.1", "absTol": "0.01"},
            # split(1000, 4, 0.1, 0.1) gives 800 train rows in these shards, then val 800..900 and test 900..1000.
            "data": {"shards": [{"start": i * 200, "len": 200} for i in range(4)], "valFrac": "0.1", "testFrac": "0.1"}}
    rng = np.random.default_rng(0)
    X = rng.random((1000, 16), dtype=np.float32)
    Y = X[:, :3].argmax(1).astype(np.int64)
    spec_bytes = json.dumps(spec, sort_keys=True).encode()
    spec_hash = k256(spec_bytes)
    w0 = workload(spec).init(0)
    w0_hash = srv.put(to_blob(spec_hash, w0))
    srv.put(spec_bytes)
    job = {"modelSpecHash": spec_hash, "initialWeightsHash": bytes.fromhex(w0_hash[2:]),
           "datasetHash": k256(b"synthetic"), "specURI": f"/v1/blobs/0x{spec_hash.hex()}"}
    return job, spec, w0, lambda dataset_hash: (X, Y)
