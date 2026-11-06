"""Coordinator settings, read once from the environment."""
import os

from eth_account import Account

VERSION = "0.1.0"
ZERO = "0x" + "00" * 20
LOCAL_CHAIN_ID = 31337  # anvil

CHAIN_ID = int(os.environ.get("CHAIN_ID", str(LOCAL_CHAIN_ID)))
JOB_MARKET = os.environ.get("JOB_MARKET", ZERO)
NODE_REGISTRY = os.environ.get("NODE_REGISTRY", ZERO)
COMPETITIONS = os.environ.get("COMPETITIONS", "")  # empty: this network has no Competitions contract
TOKEN = os.environ.get("TOKEN", ZERO)
# A throwaway key is only acceptable on a local chain; on any other chain the key must be set.
COORDINATOR_KEY = os.environ.get("COORDINATOR_PRIVATE_KEY") or (
    Account.create().key.hex() if CHAIN_ID == LOCAL_CHAIN_ID else None)
COORDINATOR = Account.from_key(COORDINATOR_KEY).address if COORDINATOR_KEY else None
VERIFIERS = [v for v in os.environ.get("VERIFIERS", "").split(",") if v]
THRESHOLD = int(os.environ.get("VERIFIER_THRESHOLD", "2"))

STORE_DIR = os.environ.get("STORE_DIR", "store")
MAX_BLOB_BYTES = int(os.environ.get("MAX_BLOB_BYTES", str(64 * 2**20)))
MAX_EXPIRY_AHEAD = 300  # s; a BlobAccess signature may be valid for at most five minutes
DB_PATH = os.environ.get("DB_PATH", "coordinator.db")
ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "")  # empty disables the admin routes
CLOCK_SKEW = 30  # s allowed between a node's request timestamp and ours
ONLINE_WITHIN = 60  # s since the last heartbeat for a node to count as online

# Arkiv indexing of finished models. Both unset means publishing is off and the API leaves `published` out.
ARKIV_RPC_URL = os.environ.get("ARKIV_RPC_URL", "")
ARKIV_ACCESS_KEY = os.environ.get("ARKIV_ACCESS_KEY", "")  # sent as X-API-KEY; without it the public RPC rate-limits
ARKIV_PRIVATE_KEY = os.environ.get("ARKIV_PRIVATE_KEY", "")  # a writer key of its own, holding test tGLM only
if ARKIV_PRIVATE_KEY and COORDINATOR_KEY and         ARKIV_PRIVATE_KEY.removeprefix("0x").lower() == COORDINATOR_KEY.removeprefix("0x").lower():
    raise RuntimeError("ARKIV_PRIVATE_KEY must not be the coordinator's key")
ARKIV_ENABLED = bool(ARKIV_RPC_URL and ARKIV_PRIVATE_KEY)
# Arkiv counts in 2 s blocks and caps a lifetime at 7,884,000 of them (about 182 days)
ARKIV_LIFETIME_BLOCKS = min(7_884_000, max(1, int(float(os.environ.get("ARKIV_LIFETIME_DAYS", "30")) * 86400 / 2)))
# Swarm keeps a copy of each published model's bytes, referenced from its Arkiv record. Empty turns it off. The
# public gateway (https://api.gateway.ethswarm.org) needs no batch and is fine for demos; our own Bee node needs one.
SWARM_API_URL = os.environ.get("SWARM_API_URL", "").rstrip("/")
SWARM_BATCH_ID = os.environ.get("SWARM_BATCH_ID", "")
SWARM_ENABLED = bool(SWARM_API_URL)
PUBLIC_URL = os.environ.get("PUBLIC_URL", "").rstrip("/")  # the coordinator's public base URL, put in each record
# The chain watched for finished jobs, a networks/*.toml name. Unset off the local chain means only the admin route
# queues models. Blocks this far behind the head are treated as final, so a reorg cannot publish a job twice.
TOD_NETWORK = os.environ.get("TOD_NETWORK") or ("anvil" if CHAIN_ID == LOCAL_CHAIN_ID else "")
CHAIN_CONFIRMATIONS = int(os.environ.get("CHAIN_CONFIRMATIONS", "0" if CHAIN_ID == LOCAL_CHAIN_ID else "10"))
