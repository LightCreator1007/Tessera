"""Dev-only coordinator start for docker/compose.dev.yml: read addresses and roles from the deployed network file, then serve."""
import os
import sys
import tomllib

from eth_account import Account
from tod_core.txmgr import ANVIL_CHAIN_ID, dev_key

with open(os.environ["TOD_NETWORK"], "rb") as f:
    net = tomllib.load(f)
if net["chainId"] != ANVIL_CHAIN_ID:
    sys.exit("docker/dev/coordinator.py is for the local chain only; it uses public dev keys")
key = Account.from_key(dev_key("coordinator"))
if key.address != net["roles"]["coordinator"]:
    sys.exit(f"dev coordinator key is {key.address}, but the deploy made {net['roles']['coordinator']} the coordinator")
c = net["contracts"]
os.environ.update(CHAIN_ID=str(net["chainId"]), JOB_MARKET=c["market"], NODE_REGISTRY=c["registry"], TOKEN=c["token"],
                  VERIFIERS=",".join(net["roles"]["verifiers"]), COORDINATOR_PRIVATE_KEY="0x" + bytes(key.key).hex())
# ponytail: API only. Rounds open once the coordinator's round driver lands; then this execs its entrypoint instead.
os.execvp("uvicorn", ["uvicorn", "api.app:app", "--app-dir", "/app/services/coordinator", "--host", "0.0.0.0",
                      "--port", "8000"])
