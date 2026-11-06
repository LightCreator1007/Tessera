"""Team-run exclusion of owners with verifier-confirmed cheating: out of future rosters and refused at admission.

This is coordinator policy, not an onchain ban. It keys on the owner and the World ID nullifier behind it, so a
fresh operator key or a fresh wallet for the same human stays out, but it can't stop someone holding a second
World ID. Open rounds are untouched: settlement never reads this table.
"""
import json
import time

from fastapi import HTTPException

KINDS = {1: "ReplayDrift", 2: "DataUnavailable", 3: "ReplayMismatch"}


class Exclusions:
    def __init__(self, db, chain):
        self.db, self.chain = db, chain
        db.execute("CREATE TABLE IF NOT EXISTS exclusions (owner TEXT PRIMARY KEY, nullifier TEXT, reason TEXT,"
                   " evidence TEXT, at INTEGER)")

    def add(self, owner: str, reason: str, evidence: list[dict]) -> dict:
        """Excludes `owner` once every evidence item is a failure the verifiers confirmed onchain for its operator."""
        if not reason.strip() or not evidence:
            raise HTTPException(422, "need a reason and at least one confirmed failure")
        checked = []
        for e in evidence:
            job, rnd, op = int(e["job"]), int(e["round"]), e["operator"]
            joined, op_owner = self.chain.node(op)
            if not joined or op_owner.lower() != owner.lower():
                raise HTTPException(422, f"{op} is not an operator of {owner}")
            kind = self.chain.confirmed(job, rnd, op)
            if kind == 0:
                raise HTTPException(422, f"{op} has no confirmed failure in job {job} round {rnd}; an accusation alone "
                                         "excludes nobody")
            checked.append({"job": job, "round": rnd, "operator": op, "kind": KINDS.get(kind, str(kind))})
        row = self.db.execute("SELECT nullifier FROM humans WHERE owner = ?", (owner,)).fetchone()
        rec = {"owner": owner, "nullifier": row[0] if row else None, "reason": reason.strip(), "evidence": checked,
               "at": int(time.time())}
        self.db.execute("INSERT OR REPLACE INTO exclusions VALUES (?, ?, ?, ?, ?)",
                        (owner, rec["nullifier"], rec["reason"], json.dumps(checked), rec["at"]))
        self.db.commit()
        return rec

    def remove(self, owner: str) -> bool:
        n = self.db.execute("DELETE FROM exclusions WHERE owner = ?", (owner,)).rowcount
        self.db.commit()
        return n > 0

    def get(self, owner: str | None = None, nullifier: str | None = None) -> dict | None:
        row = self.db.execute("SELECT owner, nullifier, reason, evidence, at FROM exclusions WHERE owner = ?"
                              " OR (nullifier IS NOT NULL AND nullifier = ?)", (owner, nullifier)).fetchone()
        if not row:
            return None
        return {"owner": row[0], "nullifier": row[1], "reason": row[2], "evidence": json.loads(row[3]), "at": row[4]}

    def owners(self) -> set[str]:
        return {o.lower() for (o,) in self.db.execute("SELECT owner FROM exclusions")}

    def refuse(self, owner: str, nullifier: str | None = None) -> None:
        if ex := self.get(owner, nullifier):
            raise HTTPException(403, f"this owner is excluded from the pool: {ex['reason']}")
