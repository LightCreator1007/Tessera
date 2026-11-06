"""Dev-only deploy step for docker/compose.dev.yml: keep a deployment that is still on the chain, else deploy fresh."""
import os
import subprocess
import sys
import tomllib
from pathlib import Path

from web3 import Web3

out = Path(os.environ["TOD_NETWORK"])
w3 = Web3(Web3.HTTPProvider("http://127.0.0.1:8545"))
if out.exists():
    registry = tomllib.loads(out.read_text()).get("contracts", {}).get("registry")
    if registry and w3.eth.get_code(registry):
        print(f"contracts already on chain (registry {registry}); keeping them", flush=True)
        sys.exit(0)
    # anvil started without its saved state, so the recorded addresses are empty: drop the record and redeploy
    out.unlink()
    out.with_suffix(out.suffix + ".receipts.json").unlink(missing_ok=True)
sys.exit(subprocess.run([sys.executable, "scripts/deploy.py", "--out", str(out),
                         "--journal-dir", str(out.parent / "deploy")]).returncode)
