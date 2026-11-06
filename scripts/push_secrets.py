"""Copies the production keys and settings from .env to AWS Parameter Store under /tessra, printing names only."""
import json
import subprocess
import sys
from pathlib import Path

REQUIRED = ["BASE_SEPOLIA_RPC_URL", "COORDINATOR_PRIVATE_KEY", "ADMITTER_PRIVATE_KEY", "FAUCET_PRIVATE_KEY",
            "VERIFIER_A_PRIVATE_KEY", "VERIFIER_B_PRIVATE_KEY", "WORLD_ID_APP_ID", "WORLD_ID_RP_ID",
            "WORLD_ID_RP_SIGNING_KEY"]
# The deployer key stays off the host on purpose: running the network never needs it.
OPTIONAL = ["WORLD_ID_ACTION", "WORLD_ID_ENV", "WORLD_AUTH_ISSUER", "WORLD_AUTH_CLIENT_ID", "WORLD_AUTH_CLIENT_SECRET",
            "ARKIV_RPC_URL", "ARKIV_ACCESS_KEY", "ARKIV_PRIVATE_KEY", "SWARM_API_URL", "SWARM_BATCH_ID"]


def read_env(path: Path) -> dict[str, str]:
    values = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip("'\"")
    return values


def store(name: str, value: str) -> None:
    # On stdin, so a key never shows up in a process listing.
    doc = {"Name": f"/tessra/{name}", "Type": "SecureString", "Value": value, "Overwrite": True}
    done = subprocess.run(["aws", "ssm", "put-parameter", "--cli-input-json", "file:///dev/stdin", "--output", "text"],
                          input=json.dumps(doc), text=True, capture_output=True)
    if done.returncode:
        # AWS error text can quote what it was given, so it isn't printed.
        sys.exit(f"failed on {name} (aws exit {done.returncode}); check your login and region")


def main() -> None:
    env = read_env(Path(sys.argv[1] if len(sys.argv) > 1 else ".env"))
    missing = [n for n in REQUIRED if not env.get(n)]
    for name in REQUIRED + OPTIONAL:
        if env.get(name):
            store(name, env[name])
            print(f"stored {name}")
        else:
            print(f"unset  {name}")
    if missing:
        sys.exit(f"missing required: {', '.join(missing)}")


if __name__ == "__main__":
    main()
