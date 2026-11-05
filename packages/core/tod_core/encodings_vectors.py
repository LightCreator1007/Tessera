"""Builds vectors/encodings.json. Run `uv run python -m tod_core.encodings_vectors` to rewrite it."""
import json
import sys
from pathlib import Path

from eth_account import Account

from . import encodings as enc
from .hashing import k256

PATH = Path(__file__).resolve().parents[3] / "vectors" / "encodings.json"


def h(label: str) -> bytes:
    return k256(label.encode())


def hx(b: bytes) -> str:
    return "0x" + b.hex()


def num(x: int):
    # JSON numbers above 2^53 lose precision in JS and some JSON parsers, so big values travel as strings.
    return x if x < 2**53 else str(x)


def key(label: str) -> bytes:
    # Test-only keys derived from a public label; they guard nothing.
    return k256(b"tod-test/" + label.encode())


def addr(label: str) -> str:
    return Account.from_key(key(label)).address


def msg_json(primary: str, m: dict) -> dict:
    return {n: hx(m[n]) if t.startswith("bytes") else num(m[n]) if t.startswith("uint") else m[n]
            for n, t in enc.TYPES[primary]}


def typed(primary, chain_id, contract, m, signer, **extra):
    sig = enc.sign(key(signer), primary, chain_id, contract, m)
    assert enc.recover(primary, chain_id, contract, m, sig) == addr(signer)
    return {"primaryType": primary, "chainId": chain_id, "verifyingContract": contract, "message": msg_json(primary, m),
            "typeHash": hx(k256(enc._type_string(primary).encode())), "structHash": hx(enc.struct_hash(primary, m)),
            "domainSeparator": hx(enc.domain_separator(chain_id, contract)),
            "digest": hx(enc.digest(primary, chain_id, contract, m)),
            "signerRole": signer, "signer": addr(signer), "signature": hx(sig), **extra}


def build() -> dict:
    market, registry = addr("jobMarket"), addr("nodeRegistry")
    zero_addr, z32, max64 = "0x" + "00" * 20, b"\x00" * 32, 2**64 - 1
    dom = enc.domain(84532, market)
    hs = [h(f"ckpt{i}") for i in range(5)]

    out = {"version": 1, "keccakEmpty": hx(k256(b""))}
    out["domain"] = [{"chainId": c, "jobMarket": m, "domain": hx(enc.domain(c, m))}
                     for c, m in [(84532, market), (31337, market), (0, zero_addr)]]
    out["checkpointRoot"] = [{"hashes": [hx(x) for x in xs], "root": hx(enc.checkpoint_root(xs))}
                             for xs in [hs, hs[:2], [z32, hs[1]]]]
    out["commitHash"] = [
        {"domain": hx(d), "jobId": num(j), "roundId": num(r), "operator": op, "root": hx(rt), "salt": hx(s),
         "commitHash": hx(enc.commit_hash(d, j, r, op, rt, s))}
        for d, j, r, op, rt, s in [(dom, 7, 3, addr("operator"), enc.checkpoint_root(hs), h("salt")),
                                   (dom, 0, 0, zero_addr, z32, z32),
                                   (dom, 2**256 - 1, 2**64, addr("operator"), hs[4], h("salt2"))]]
    out["taskSeed"] = [
        {"domain": hx(dom), "jobId": j, "roundId": r, "shard": s, "startWeightsHash": hx(w),
         "taskSeed": hx(enc.task_seed(dom, j, r, s, w))}
        for j, r, s, w in [(7, 3, 2, hs[0]), (0, 0, 0, z32), (7, 3, 255, hs[0])]]
    out["roundSeed"] = [
        {"blockhash": hx(b), "domain": hx(dom), "jobId": j, "roundId": r, "seed": hx(enc.round_seed(b, dom, j, r))}
        for b, j, r in [(h("block"), 7, 3), (h("block"), 7, 4), (z32, 0, 0)]]
    out["epochSeed"] = [{"domain": hx(dom), "jobId": j, "shard": s, "epoch": e,
                         "seed": hx(enc.epoch_seed(dom, j, s, e))} for j, s, e in [(7, 0, 0), (7, 0, 1), (7, 255, 0)]]
    out["permutation"] = [{"seed": hx(sd), "n": n, "perm": list(enc.permutation(sd, n))}
                          for sd, n in [(enc.epoch_seed(dom, 7, 0, 0), 1), (enc.epoch_seed(dom, 7, 0, 0), 2),
                                        (enc.epoch_seed(dom, 7, 0, 0), 10), (enc.epoch_seed(dom, 7, 1, 0), 33)]]
    # Shard of 10 rows, H=3, B=4: round 0 covers samples 0-11 (step 2 crosses into epoch 1), round 1 covers
    # 12-23 (crosses into epoch 2). B=4 over a 3-row shard puts two epoch boundaries inside one batch.
    out["batch"] = []
    for entry, H, B, done in [({"start": 100, "len": 10}, 3, 4, 0), ({"start": 100, "len": 10}, 3, 4, 1),
                              ({"start": 0, "len": 3}, 2, 4, 0)]:
        rows = enc.shard_rows(entry)
        out["batch"].append({"domain": hx(dom), "jobId": 7, "shard": 0, "entry": entry, "H": H, "B": B,
                             "roundsDone": done, "cursor": enc.cursor(done, H, B),
                             "steps": [enc.batch(dom, 7, 0, rows, done, H, B, s) for s in range(H)]})
    tables = [[{"start": 0, "len": 6000}, {"start": 6000, "len": 6000}],
              [{"start": 0, "len": 1}],
              [{"start": 0, "len": 500}, {"rowsHash": hx(h("rows")), "len": 250}]]
    out["shardTableHash"] = [{"shards": t, "hash": hx(enc.shard_table_hash(t))} for t in tables]

    payouts = sorted([(addr("operator"), 1_250_000), (addr("operator2"), 1_250_001)], key=lambda p: int(p[0], 16))
    out["payoutsHash"] = [{"payouts": [{"operator": o, "amount": a} for o, a in p], "hash": hx(enc.payouts_hash(p))}
                          for p in [payouts, []]]

    def fin(outcome, p):
        return {"jobId": 7, "roundId": 3, "outcome": outcome, "aggregateHash": h("agg") if outcome == 0 else z32,
                "flaggedBitmap": 0b101 if outcome == 0 else 0, "aggEvidenceHash": h("aggEv"),
                "payEvidenceHash": h("payEv") if outcome == 0 else z32, "payoutsHash": enc.payouts_hash(p)}

    def settlement(p):
        return {"payouts": [{"operator": o, "amount": a} for o, a in p]}

    def blob(method, expiry):
        return {"jobId": 7, "roundId": 3, "blobHash": hs[4], "method": method, "expiry": expiry}

    now = 1_800_000_000
    out["eip712"] = [
        typed("Invite", 84532, registry, {"operator": addr("operator"), "owner": addr("owner"),
                                          "nullifier": h("nullifier"), "deadline": now + 600}, "admitter"),
        typed("Consent", 84532, registry, {"owner": addr("owner"), "operator": addr("operator"),
                                           "consentDeadline": now + 1800}, "operator"),
        typed("Consent", 84532, registry, {"owner": addr("owner"), "operator": addr("operator"),
                                           "consentDeadline": max64}, "operator"),
        typed("FinalizeRound", 84532, market, fin(enc.ACCEPTED, payouts), "verifierA", settlement=settlement(payouts)),
        typed("FinalizeRound", 84532, market, fin(enc.ACCEPTED, payouts), "verifierB", settlement=settlement(payouts)),
        typed("FinalizeRound", 84532, market, fin(enc.REVERTED, []), "verifierA", settlement=settlement([])),
        # Coordinator rule: fresh means now <= expiry <= now + 300.
        typed("BlobAccess", 84532, market, blob("GET", now + 300), "operator", now=now, fresh=True),
        typed("BlobAccess", 84532, market, blob("PUT", now + 60), "operator", now=now, fresh=True),
        typed("BlobAccess", 84532, market, blob("GET", now + 120), "verifierA", now=now, fresh=True),
        typed("BlobAccess", 84532, market, blob("GET", now + 120), "requester", now=now, fresh=True),
        typed("BlobAccess", 84532, market, blob("GET", now - 1), "operator", now=now, fresh=False),
    ]
    return out


def dump(v: dict) -> str:
    return json.dumps(v, indent=1) + "\n"


if __name__ == "__main__":
    PATH.write_text(dump(build()))
    sys.stdout.write(f"wrote {PATH}\n")
