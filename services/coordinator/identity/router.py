"""Pool join: check the human, the pairing code and one nullifier per human, then sign the pool Invite."""
import base64
import collections
import json
import os
import secrets
import time
import tomllib
from pathlib import Path

from eth_account import Account
from eth_account.messages import encode_defunct
from eth_utils import is_address, to_checksum_address
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from tod_core import encodings as enc
from tod_core.hashing import k256
from tod_core.ledger import REPO
from tod_core.txmgr import dev_key

from api import auth, config
from api.db import connect

from . import agentpass, topup, worldid
from .exclusions import Exclusions

PAIR_PREFIX = "tod-pair:"
INVITE_TTL = 30 * 60  # s; same lifetime as the operator's consent
PASS_TTL = 24 * 3600  # s; an EntryPass is reused for every competition the wallet enters that day
DEV_CHAIN = 31337

MODE = os.environ.get("IDENTITY_MODE", "dev")
# Same name as .env.example. On anvil the deploy script registers dev_key("admitter"), so that is the fallback;
# anywhere else a missing key would sign Invites the registry rejects.
_admitter_key = os.environ.get("ADMITTER_PRIVATE_KEY")
if not _admitter_key and config.CHAIN_ID != DEV_CHAIN:
    raise RuntimeError("ADMITTER_PRIVATE_KEY is required off the local chain")
ADMITTER = Account.from_key(_admitter_key or dev_key("admitter"))


def check_admitter(network: str | None) -> None:
    """Refuse to start with an admitter the registry doesn't know: every join would revert with BadSignature."""
    if not network:
        return
    path = Path(network) if network.endswith(".toml") else REPO / "networks" / f"{network}.toml"
    expected = tomllib.loads(path.read_text()).get("roles", {}).get("admitter")
    if expected and expected.lower() != ADMITTER.address.lower():
        raise RuntimeError(f"ADMITTER_PRIVATE_KEY is {ADMITTER.address}, but {path.name} registers {expected} as the "
                           "admitter; joins would revert with BadSignature")


check_admitter(os.environ.get("TOD_NETWORK"))

MAX_BODY = 64 * 1024  # bytes; an IDKit result is a few KB, so anything near this is not a join
RP_SIGNATURES_PER_MINUTE = int(os.environ.get("RP_SIGNATURES_PER_MINUTE", "20"))


async def small_body(request: Request) -> None:
    """413 before parsing anything large. Reading the body here caches it for the route."""
    if int(request.headers.get("content-length") or 0) > MAX_BODY or len(await request.body()) > MAX_BODY:
        raise HTTPException(413, f"request body over {MAX_BODY} bytes")


class RateLimit:
    """At most `per_minute` hits per key in any 60 s window, kept in memory."""

    def __init__(self, per_minute: int, now=time.monotonic):
        self.per_minute, self.now = per_minute, now
        self.hits: dict[str, collections.deque] = {}

    def allow(self, key: str) -> bool:
        t, q = self.now(), self.hits.setdefault(key, collections.deque())
        while q and t - q[0] >= 60:
            q.popleft()
        if len(q) >= self.per_minute:
            return False
        q.append(t)
        return True


# ponytail: keyed by the TCP peer, so behind a tunnel every caller shares one budget; key on the tunnel's
# client-IP header once one is deployed.
rp_limit = RateLimit(RP_SIGNATURES_PER_MINUTE)
verify_limit = RateLimit(RP_SIGNATURES_PER_MINUTE)  # each /verify costs a call to World, so the same cap
router = APIRouter(prefix="/v1/identity", dependencies=[Depends(small_body)])
db = connect(config.DB_PATH)
db.execute("CREATE TABLE IF NOT EXISTS humans (nullifier TEXT PRIMARY KEY, owner TEXT, credential TEXT, seen INTEGER)")
# A human can verify before pairing a node (to enter a competition, say), so joining the pool is its own flag.
if "joined" not in {c[1] for c in db.execute("PRAGMA table_info(humans)")}:
    db.execute("ALTER TABLE humans ADD COLUMN joined INTEGER NOT NULL DEFAULT 1")  # rows before this came from /join
# Selfie Check's risk signal, kept so a later payout rule can ask more of a selfie than of an Orb. NULL for Orb and dev.
if "sybil_score" not in {c[1] for c in db.execute("PRAGMA table_info(humans)")}:
    db.execute("ALTER TABLE humans ADD COLUMN sybil_score INTEGER")
# Agent Pass: the owner's World account (iss, sub), and approvals waiting on the owner.
db.execute("CREATE TABLE IF NOT EXISTS agent_links (owner TEXT PRIMARY KEY, iss TEXT, sub TEXT, linked INTEGER)")
db.execute("CREATE TABLE IF NOT EXISTS agent_pending (id TEXT PRIMARY KEY, kind TEXT, owner TEXT, operator TEXT,"
           " consent TEXT, device_code TEXT, created INTEGER, expires INTEGER, state TEXT)")
LINK_SIG_TTL = 300  # s; the owner's link signature is short-lived
topups = topup.Topups(db, topup.Chain())
exclusions = Exclusions(db, topups.chain)


class JoinRequest(BaseModel):
    owner: str
    pairingCode: str
    proof: dict | None = None  # the IDKit result, forwarded unchanged; left out, reuses an earlier /verify


class VerifyRequest(BaseModel):
    owner: str
    proof: dict = {}  # the IDKit result, forwarded unchanged; ignored in dev mode


class VerifyResponse(BaseModel):
    owner: str
    nullifier: str
    credential: str
    sybilScore: int | None = None


class RpSignatureRequest(BaseModel):
    action: str


class RpSignature(BaseModel):
    """IDKit's rp_context, minus rp_id (the client has it from /v1/identity/config)."""
    sig: str
    nonce: str
    created_at: int
    expires_at: int


class IdentityConfig(BaseModel):
    mode: str
    appId: str
    rpId: str
    action: str
    environment: str


class EntryPassRequest(BaseModel):
    owner: str
    proof: dict = {}  # the IDKit result, forwarded unchanged; ignored in dev mode
    contract: str = "competitions"  # or "rl": the pass names its contract, so one for Competitions is no good elsewhere


class EntryPassResponse(BaseModel):
    """Exactly the pass arguments of Competitions.create and Competitions.enter."""
    wallet: str
    nullifier: str
    deadline: int
    signature: str
    credential: str


class JoinResponse(BaseModel):
    """Exactly the arguments of NodeRegistry.join, plus the recorded credential."""
    operator: str
    owner: str
    nullifier: str
    inviteDeadline: int
    inviteSig: str
    consentDeadline: int
    consentSig: str
    credential: str


def decode_pairing_code(code: str) -> dict:
    if not code.startswith(PAIR_PREFIX):
        raise ValueError("not a tod pairing code")
    body = code[len(PAIR_PREFIX):]
    fields = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
    if set(fields) != {"consentDeadline", "operator", "owner", "signature"}:
        raise ValueError("pairing code has the wrong fields")
    return fields


def verify_human(owner: str, proof: dict) -> tuple[str, str]:
    """Returns (nullifier hex, credential)."""
    if MODE == "dev":
        if config.CHAIN_ID != DEV_CHAIN:
            raise HTTPException(403, "IDENTITY_MODE=dev is refused off the local chain")
        return "0x" + k256(b"tod-dev" + bytes.fromhex(owner[2:])).hex(), "dev"
    try:
        return worldid.verify(proof, owner)
    except worldid.Rejected as e:
        raise HTTPException(400, str(e))


@router.get("/config", response_model=IdentityConfig)
def identity_config():
    """What the web join page needs to open IDKit (none of it is secret)."""
    return IdentityConfig(mode=MODE, appId=worldid.APP_ID, rpId=worldid.RP_ID, action=worldid.ACTION,
                          environment=worldid.ENVIRONMENT)


@router.get("/test", response_class=HTMLResponse, include_in_schema=False)
def test_page():
    """Developer page to run a join end to end (World ID simulator in staging)."""
    return (Path(__file__).parent / "test.html").read_text()


@router.post("/rp-signature", response_model=RpSignature)
def rp_signature(req: RpSignatureRequest, request: Request):
    # Only our own action, so this route can't be used to sign requests for anything else.
    if req.action != worldid.ACTION:
        raise HTTPException(400, f"only the {worldid.ACTION!r} action is signed")
    if not worldid.RP_SIGNING_KEY:
        raise HTTPException(503, "World ID is not configured (WORLD_ID_RP_SIGNING_KEY)")
    # Only requests we would sign count: each signature opens a World ID request under our RP, so cap it per caller.
    if not rp_limit.allow(request.client.host if request.client else "?"):
        raise HTTPException(429, f"over {RP_SIGNATURES_PER_MINUTE} RP signatures a minute; wait and retry")
    return RpSignature(**worldid.sign_request(worldid.RP_SIGNING_KEY, req.action))


def credentials() -> dict[str, str]:
    """Lowercase owner -> recorded World ID credential, for the matcher (scheduler.pick)."""
    # An excluded owner has no usable credential, so the matcher seats none of its operators, old or new.
    out = exclusions.owners()
    return {owner.lower(): cred for owner, cred in db.execute("SELECT owner, credential FROM humans")
            if owner.lower() not in out}


def checked_consent(owner: str, pairing_code: str) -> tuple[str, dict, bytes]:
    """Pairing-code checks shared by /join and the agent path: (operator, consent, consent signature)."""
    try:
        code = decode_pairing_code(pairing_code)
        operator = to_checksum_address(code["operator"])
        consent = {"owner": to_checksum_address(code["owner"]), "operator": operator,
                   "consentDeadline": int(code["consentDeadline"])}
        consent_sig = bytes.fromhex(code["signature"].removeprefix("0x"))
    except (ValueError, KeyError, TypeError) as e:
        raise HTTPException(400, f"bad pairing code: {e}")
    # The cheap checks come before recovering the signature, so junk can't make each request expensive.
    if consent["owner"] != owner:
        raise HTTPException(400, "pairing code was made for a different owner")
    if consent["consentDeadline"] <= int(time.time()):
        raise HTTPException(400, "pairing code expired; run `tod-node pair` again")
    try:
        signer = enc.recover("Consent", config.CHAIN_ID, config.NODE_REGISTRY, consent, consent_sig)
    except (ValueError, TypeError) as e:
        raise HTTPException(400, f"bad pairing code: {e}")
    if signer != operator:
        raise HTTPException(400, "pairing code signature does not match its operator")
    return operator, consent, consent_sig


def signed_invite(operator: str, owner: str, nullifier: str, consent: dict, consent_sig: bytes,
                  credential: str) -> JoinResponse:
    deadline = int(time.time()) + INVITE_TTL
    invite = {"operator": operator, "owner": owner, "nullifier": bytes.fromhex(nullifier[2:]), "deadline": deadline}
    invite_sig = enc.sign(ADMITTER.key, "Invite", config.CHAIN_ID, config.NODE_REGISTRY, invite)
    return JoinResponse(operator=operator, owner=owner, nullifier=nullifier, inviteDeadline=deadline,
                        inviteSig="0x" + invite_sig.hex(), consentDeadline=consent["consentDeadline"],
                        consentSig="0x" + consent_sig.hex(), credential=credential)


def checked_owner(owner: str) -> str:
    if not is_address(owner):
        raise HTTPException(400, "owner must be a 0x address")
    return to_checksum_address(owner)


def stored_human(owner: str) -> tuple[str, str] | None:
    return db.execute("SELECT nullifier, credential FROM humans WHERE owner = ?", (owner,)).fetchone()


def record_human(owner: str, nullifier: str, credential: str, joined: bool, sybil_score: int | None = None) -> None:
    """One wallet per human and one human per wallet. A repeat by the same pair keeps its first-seen time."""
    exclusions.refuse(owner, nullifier)  # the same human behind a fresh wallet
    row = db.execute("SELECT owner FROM humans WHERE nullifier = ?", (nullifier,)).fetchone()
    if row and row[0] != owner:
        raise HTTPException(409, f"this World ID is already linked to {row[0][:6]}...{row[0][-4:]}")
    mine = stored_human(owner)
    if mine and mine[0] != nullifier:
        raise HTTPException(409, "this wallet is already linked to a different World ID")
    db.execute("INSERT INTO humans (nullifier, owner, credential, seen, joined, sybil_score) VALUES (?, ?, ?, ?, ?, ?) "
               "ON CONFLICT(nullifier) DO UPDATE SET credential = excluded.credential, "
               "joined = MAX(humans.joined, excluded.joined), sybil_score = COALESCE(excluded.sybil_score, humans.sybil_score)",
               (nullifier, owner, credential, int(time.time()), int(joined), sybil_score))
    db.commit()


@router.post("/verify", response_model=VerifyResponse)
def verify(req: VerifyRequest, request: Request):
    """Prove one human behind this wallet, without a node. Joining later reuses it, so World ID runs once."""
    owner = checked_owner(req.owner)
    exclusions.refuse(owner)
    if not verify_limit.allow(request.client.host if request.client else "?"):
        raise HTTPException(429, f"over {RP_SIGNATURES_PER_MINUTE} verifications a minute; wait and retry")
    nullifier, credential = verify_human(owner, req.proof)
    score = worldid.sybil_score(req.proof) if credential == "selfie" else None
    record_human(owner, nullifier, credential, joined=False, sybil_score=score)
    return VerifyResponse(owner=owner, nullifier=nullifier, credential=credential, sybilScore=score)


@router.post("/entry-pass", response_model=EntryPassResponse)
def entry_pass(req: EntryPassRequest):
    """One person, one wallet, one entry per competition: the admitter vouches for this wallet's human after World ID.
    Hosts need one too, which is how the contract stops a host entering their own competition."""
    rl = req.contract == "rl"
    target = config.RL_COMPETITIONS if rl else config.COMPETITIONS
    if not target:
        raise HTTPException(503, f"this network has no {'RLCompetitions' if rl else 'Competitions'} contract")
    owner = checked_owner(req.owner)
    exclusions.refuse(owner)
    # World ID 4.0 proofs are one per person per action, so a wallet verified at sign-up reuses that record.
    stored = stored_human(owner)
    score = None
    if req.proof or not stored:
        nullifier, credential = verify_human(owner, req.proof)
        score = worldid.sybil_score(req.proof) if credential == "selfie" else None
    else:
        nullifier, credential = stored
    # One wallet per person, the same rule as joining the pool.
    record_human(owner, nullifier, credential, joined=False, sybil_score=score)
    deadline = int(time.time()) + PASS_TTL
    sig = enc.sign(ADMITTER.key, "EntryPass", config.CHAIN_ID, target,
                   {"wallet": owner, "nullifier": bytes.fromhex(nullifier[2:]), "deadline": deadline})
    return EntryPassResponse(wallet=owner, nullifier=nullifier, deadline=deadline, signature="0x" + sig.hex(),
                             credential=credential)


@router.post("/join", response_model=JoinResponse)
def join(req: JoinRequest):
    owner = checked_owner(req.owner)
    exclusions.refuse(owner)
    operator, consent, consent_sig = checked_consent(owner, req.pairingCode)
    stored = stored_human(owner)
    if req.proof is not None or not stored:
        nullifier, credential = verify_human(owner, req.proof or {})
    else:
        nullifier, credential = stored  # verified earlier through /verify
    record_human(owner, nullifier, credential, joined=True)
    return signed_invite(operator, owner, nullifier, consent, consent_sig, credential)


class AgentLinkRequest(BaseModel):
    owner: str
    expiry: int
    ownerSig: str  # EIP-191 by the owner over link_message(owner, expiry)


class AgentPairRequest(BaseModel):
    owner: str
    pairingCode: str


class AgentPending(BaseModel):
    pendingId: str
    userCode: str
    verificationUriComplete: str
    expiresIn: int
    interval: int


class AgentPoll(BaseModel):
    status: str  # "pending" or "linked"; a pairing returns the JoinResponse instead
    owner: str


def link_message(owner: str, expiry: int) -> str:
    return f"tod agent-pass link\nowner:{owner.lower()}\nexpiry:{expiry}"


def _joined(owner: str) -> tuple[str, str]:
    row = db.execute("SELECT nullifier, credential FROM humans WHERE owner = ?", (owner,)).fetchone()
    if not row:
        raise HTTPException(403, "owner has not joined the pool with World ID yet")
    return row


def _start(kind: str, owner: str, operator: str = "", consent: str = "") -> AgentPending:
    try:
        dev = agentpass.start_device()
    except agentpass.Blocked as e:
        raise HTTPException(503, str(e))
    pid, now = secrets.token_hex(16), int(time.time())
    db.execute("INSERT INTO agent_pending VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')",
               (pid, kind, owner, operator, consent, dev["device_code"], now, now + int(dev["expires_in"])))
    db.commit()
    return AgentPending(pendingId=pid, userCode=dev["user_code"], verificationUriComplete=dev["verification_uri_complete"],
                        expiresIn=int(dev["expires_in"]), interval=int(dev.get("interval", 5)))


@router.post("/agent/link", response_model=AgentPending)
def agent_link(req: AgentLinkRequest):
    """Owner, present with their wallet, links their World account so later agent requests can be approved."""
    owner = checked_owner(req.owner)
    now = int(time.time())
    if not now < req.expiry <= now + LINK_SIG_TTL:
        raise HTTPException(400, "link signature expired or too far ahead")
    try:
        signer = Account.recover_message(encode_defunct(text=link_message(owner, req.expiry)), signature=req.ownerSig)
    except (ValueError, TypeError):
        signer = None
    if signer != owner:
        raise HTTPException(403, "link must be signed by the owner wallet")
    _joined(owner)
    return _start("link", owner)


@router.post("/agent/pair", response_model=AgentPending)
def agent_pair(req: AgentPairRequest):
    """An agent asks to pair a node for this owner; nothing is signed until the owner approves in World App."""
    owner = checked_owner(req.owner)
    exclusions.refuse(owner)
    operator, consent, consent_sig = checked_consent(owner, req.pairingCode)
    _joined(owner)
    if not db.execute("SELECT 1 FROM agent_links WHERE owner = ?", (owner,)).fetchone():
        raise HTTPException(403, "owner has not linked World ID for agent approvals")
    return _start("pair", owner, operator, json.dumps({**consent, "sig": "0x" + consent_sig.hex()}))


@router.post("/agent/{pid}/poll")
def agent_poll(pid: str):
    row = db.execute("SELECT kind, owner, operator, consent, device_code, created, expires, state FROM agent_pending"
                     " WHERE id = ?", (pid,)).fetchone()
    if not row:
        raise HTTPException(404, "no such approval")
    kind, owner, operator, consent, device_code, created, expires, state = row
    if state != "pending":
        raise HTTPException(409, f"this approval is already {state}")  # an approved action runs once

    def block(msg: str):
        db.execute("UPDATE agent_pending SET state = 'blocked' WHERE id = ?", (pid,))
        db.commit()
        raise HTTPException(403, msg)

    if int(time.time()) > expires:
        block("approval expired; the pairing stays blocked")
    try:
        token = agentpass.poll_device(device_code)
        if token is None:
            return AgentPoll(status="pending", owner=owner)
        claims = agentpass.verify_id_token(token, agentpass._jwks(), not_before=created)
    except agentpass.Blocked as e:
        block(f"{e}; the pairing stays blocked" if kind == "pair" else str(e))

    link = db.execute("SELECT iss, sub FROM agent_links WHERE owner = ?", (owner,)).fetchone()
    if kind == "link":
        if link and tuple(link) != (claims["iss"], claims["sub"]):
            block("this wallet is already linked to a different World ID")  # never merge subjects
        db.execute("INSERT OR REPLACE INTO agent_links VALUES (?, ?, ?, ?)",
                   (owner, claims["iss"], claims["sub"], int(time.time())))
        db.execute("UPDATE agent_pending SET state = 'done' WHERE id = ?", (pid,))
        db.commit()
        return AgentPoll(status="linked", owner=owner)
    if not link or tuple(link) != (claims["iss"], claims["sub"]):
        block("approved by a different World ID than the owner's; the pairing stays blocked")
    c = json.loads(consent)
    if c["consentDeadline"] <= int(time.time()):
        block("pairing code expired while waiting; run `tod-node pair` again")
    db.execute("UPDATE agent_pending SET state = 'done' WHERE id = ?", (pid,))
    db.commit()
    nullifier, credential = _joined(owner)
    if exclusions.get(owner, nullifier):
        block("this owner was excluded from the pool while the approval was pending")
    consent_fields = {k: c[k] for k in ("owner", "operator", "consentDeadline")}
    return signed_invite(operator, owner, nullifier, consent_fields, bytes.fromhex(c["sig"][2:]), credential)


class TopupResponse(BaseModel):
    sent: int  # wei
    balance: int  # wei, the operator's balance after this top-up
    tx: str | None = None


@router.post("/topup", response_model=TopupResponse)
def gas_topup(operator: str = Depends(auth.node)):
    """Sends a joined operator of a World ID-verified owner enough gas for its rounds, within a per-human cap."""
    try:
        return topups.grant(operator)
    except topup.Refused as e:
        raise HTTPException(e.status, str(e))


class Evidence(BaseModel):
    job: int
    round: int
    operator: str


class ExclusionRequest(BaseModel):
    owner: str
    reason: str  # shown to the owner and in status; link the confirmed rounds here
    evidence: list[Evidence]


@router.post("/exclusions", status_code=201, dependencies=[Depends(auth.admin)])
def exclude(req: ExclusionRequest):
    """Team action: keep an owner with verifier-confirmed failures out of future rosters and admission."""
    return exclusions.add(checked_owner(req.owner), req.reason, [e.model_dump() for e in req.evidence])


@router.delete("/exclusions/{owner}", dependencies=[Depends(auth.admin)])
def lift_exclusion(owner: str):
    if not exclusions.remove(checked_owner(owner)):
        raise HTTPException(404, "owner is not excluded")
    return {"owner": checked_owner(owner), "excluded": False}


@router.get("/owners/{owner}")
def owner_status(owner: str):
    """What the pool knows about an owner: verified with World ID, joined the pool, and any exclusion with its evidence."""
    owner = checked_owner(owner)
    row = db.execute("SELECT credential, joined, seen, sybil_score FROM humans WHERE owner = ?", (owner,)).fetchone()
    ex = exclusions.get(owner)
    return {"owner": owner, "verified": row is not None, "joined": bool(row and row[1]),
            "credential": row[0] if row else None, "verifiedAt": row[2] if row else None,
            "sybilScore": row[3] if row else None,
            "excluded": {k: ex[k] for k in ("reason", "evidence", "at")} if ex else None}
