"""Coordinator settings, read once from the environment."""
import os

from eth_account import Account

VERSION = "0.1.0"
ZERO = "0x" + "00" * 20
LOCAL_CHAIN_ID = 31337  # anvil

CHAIN_ID = int(os.environ.get("CHAIN_ID", str(LOCAL_CHAIN_ID)))
JOB_MARKET = os.environ.get("JOB_MARKET", ZERO)
NODE_REGISTRY = os.environ.get("NODE_REGISTRY", ZERO)
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
