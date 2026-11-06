"""Arkiv client over plain JSON-RPC: encodes the execute() create, sends it, and reads entities back with arkiv_query."""
import secrets

from eth_abi import encode
from eth_account import Account
from eth_utils import keccak, to_checksum_address
from web3 import HTTPProvider, Web3
from web3.exceptions import TransactionNotFound

ARKIV = "0x4400000000000000000000000000000000000044"
EXECUTE = keccak(text="execute((uint8,bytes)[])")[:4]  # 0x49650044 per the docs; a test pins it
CREATED = "0x" + keccak(text="EntityCreated(bytes32,address,uint64,uint8)").hex()
CREATE_OP = 1
# Anyone may extend the expiry, so a public model can stay findable after its coordinator is gone. Not read-only,
# so a record made before Swarm was on can still get swarmRef patched on.
PERMISSIONLESS_EXTENSION = 0b10
INDEXED = 0x80
U64, BYTES, STR, ADDR = 3, 7, 8, 9
MAX_LIFETIME = 7_884_000  # blocks, about 182 days
GAS_FLOOR = 1_000_000  # Arkiv's guidance for a single create: max(1M, 2 x estimate)
MAX_STR = 128
MAX_BYTES = 128 * 1024

# Our attribute types; anything not listed is a non-indexed str. Ids are u64 so range queries work.
TYPES = {"chainId": U64 | INDEXED, "job": U64 | INDEXED, "round": U64 | INDEXED, "size": U64,
         "jobMarket": ADDR | INDEXED, "payload": BYTES, "arkiv.schema": STR | INDEXED, "keccak": STR | INDEXED,
         "datasetHash": STR | INDEXED, "workload": STR | INDEXED, "visibility": STR | INDEXED,
         "swarmRef": STR | INDEXED}


def _word(n: int) -> bytes:
    return n.to_bytes(32, "big")


def encode_attribute(name: str, value) -> tuple[bytes, int, bytes]:
    t = TYPES.get(name, STR)
    base = t & 0x7F
    if base == U64:
        v = _word(int(value))
    elif base == ADDR:
        v = bytes(12) + bytes.fromhex(value.removeprefix("0x"))
    elif base == BYTES:
        v = bytes(value)
        if len(v) > MAX_BYTES:
            raise ValueError(f"{name} is over Arkiv's 128 KiB bytes limit")
    else:
        v = str(value).encode()
        if len(v) > MAX_STR:
            raise ValueError(f"{name} is over Arkiv's 128-byte string limit")
    raw = name.encode("ascii")
    if len(raw) > 32:
        raise ValueError(f"attribute name {name} is over 32 bytes")
    return raw.ljust(32, b"\0"), t, v


def create_calldata(attrs: dict, lifetime_blocks: int, salt: int) -> bytes:
    """execute([(1, abi.encode(Create))]) with the attributes sorted by their padded name, as the contract requires."""
    if not 0 < lifetime_blocks <= MAX_LIFETIME:
        raise ValueError("lifetime must be between 1 block and Arkiv's 182-day maximum")
    encoded = sorted(encode_attribute(k, v) for k, v in attrs.items())
    if len(encoded) > 32:
        raise ValueError("Arkiv takes at most 32 attributes per entity")
    op = encode(["(uint128,uint64,uint64,uint8,(bytes32,uint8,bytes)[])"],
                [(salt, 0, lifetime_blocks, PERMISSIONLESS_EXTENSION, encoded)])
    return EXECUTE + encode(["(uint8,bytes)[]"], [[(CREATE_OP, op)]])


def q_str(s: str) -> str:
    return "str('" + s.replace("'", "''") + "')"


class Arkiv:
    def __init__(self, rpc_url: str, private_key: str, access_key: str = "", timeout: float = 20):
        # The access key goes in a header, not the URL path, because web3 puts the URL in its HTTP errors.
        # Our headers replace web3's defaults, so the JSON content type has to be restated or the node answers 415.
        headers = {"Content-Type": "application/json", **({"X-API-KEY": access_key} if access_key else {})}
        self.w3 = Web3(HTTPProvider(rpc_url, request_kwargs={"timeout": timeout, "headers": headers}))
        self.acct = Account.from_key(private_key)
        self.owner = self.acct.address

    def _rpc(self, method, params):
        res = self.w3.provider.make_request(method, params)
        if res.get("error"):
            raise RuntimeError(f"{method}: {res['error'].get('message', res['error'])}")
        return res["result"]

    def query(self, q: str, limit=100, offset=0, attributes=True) -> list[dict]:
        sel = {"key": True, "owner": True, "expiresAt": True, "attributes": attributes}
        res = self._rpc("arkiv_query", [q, {"select": sel, "limit": hex(limit), "offset": hex(offset)}])
        return res.get("data") or []

    def find(self, rec: dict) -> str | None:
        """Our own live record for this exact model, if one exists. Filters on $owner, since anyone can write any tag."""
        q = (f"arkiv.schema = {q_str(rec['kind'])} AND $owner = addr({self.owner}) "
             f"AND jobMarket = addr({to_checksum_address(rec['jobMarket'])}) AND job = u64({rec['job']}) "
             f"AND keccak = {q_str(rec['keccak'])}")
        rows = self.query(q, limit=1, attributes=False)
        return rows[0]["key"] if rows else None

    def sign_create(self, attrs: dict, lifetime_blocks: int) -> tuple[str, str]:
        """Builds and signs the create without sending it; returns (tx hash, raw signed tx), so the caller can save
        both before anything leaves this machine. Gas, nonce and price follow Arkiv's Rabdi write-safety guidance."""
        data = create_calldata(attrs, lifetime_blocks, secrets.randbits(128))
        # Rabdi serves state at the chain head only, so the nonce is read at latest; "pending" is rejected.
        tx = {"to": to_checksum_address(ARKIV), "value": 0, "data": data, "from": self.owner,
              "chainId": self.w3.eth.chain_id, "nonce": self.w3.eth.get_transaction_count(self.owner, "latest")}
        estimate = self.w3.eth.estimate_gas(tx, "latest")  # reverts here with the contract's error, before signing
        tx["gas"] = max(GAS_FLOOR, 2 * estimate)
        if tx["gas"] > self.w3.eth.get_block("latest")["gasLimit"] // 2:
            raise RuntimeError(f"create needs {tx['gas']} gas, over half a block; not signing")
        tx["gasPrice"] = self.w3.eth.gas_price
        del tx["from"]
        signed = self.acct.sign_transaction(tx)
        return "0x" + bytes(signed.hash).hex(), "0x" + bytes(signed.raw_transaction).hex()

    def broadcast(self, raw: str):
        """Sends a signed tx once. Arkiv's guidance: never resend a write automatically, even these same bytes."""
        self.w3.eth.send_raw_transaction(raw)

    def confirm(self, tx_hash: str) -> tuple[str, str | None]:
        """('pending', None) until mined; then ('ok', entity key) or ('reverted', None)."""
        try:
            r = self.w3.eth.get_transaction_receipt(tx_hash)
        except TransactionNotFound:  # unmined or dropped; a network error propagates and is retried instead
            return "pending", None
        if r["status"] != 1:
            return "reverted", None
        for log in r["logs"]:
            topics = ["0x" + bytes(t).hex() for t in log["topics"]]
            if log["address"].lower() == ARKIV and topics and topics[0] == CREATED:
                return "ok", topics[1]
        return "reverted", None

    def list_models(self, schema: str, job_market: str, limit=100) -> list[dict]:
        """Every live model record our writer published for this JobMarket, newest job first."""
        q = (f"arkiv.schema = {q_str(schema)} AND $owner = addr({self.owner}) "
             f"AND jobMarket = addr({to_checksum_address(job_market)}) ORDER BY job:u64 DESC")
        return self.query(q, limit=limit)

