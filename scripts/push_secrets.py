"""Copies the production keys and settings from a .env file to AWS Parameter Store under /tessera, printing names only."""
import argparse
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
REQUIRED = ["BASE_SEPOLIA_RPC_URL", "COORDINATOR_PRIVATE_KEY", "ADMITTER_PRIVATE_KEY", "FAUCET_PRIVATE_KEY",
            "VERIFIER_A_PRIVATE_KEY", "VERIFIER_B_PRIVATE_KEY", "WORLD_ID_APP_ID", "WORLD_ID_RP_ID",
            "WORLD_ID_RP_SIGNING_KEY"]
# The deployer key stays off the host on purpose: running the network never needs it.
OPTIONAL = ["WORLD_ID_ACTION", "WORLD_ID_ENV", "WORLD_AUTH_ISSUER", "WORLD_AUTH_CLIENT_ID", "WORLD_AUTH_CLIENT_SECRET",
            "ARKIV_RPC_URL", "ARKIV_ACCESS_KEY", "ARKIV_PRIVATE_KEY", "SWARM_API_URL", "SWARM_BATCH_ID"]


def read_env(path: Path) -> dict[str, str]:
    values = {}
    for line in path.read_text().splitlines():
        line = line.strip().removeprefix("export ").strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        if value[:1] in ("'", '"'):
            end = value.find(value[0], 1)
            value = value[1:end] if end > 0 else value[1:]
        else:
            # .env.example puts comments after values, and after empty values too.
            value = re.split(r"(?:^|\s+)#", value, maxsplit=1)[0]
        values[key.strip()] = value
    return values


def store(name: str, value: str) -> None:
    doc = {"Name": f"/tessera/{name}", "Type": "SecureString", "Value": value, "Overwrite": True}
    # A private temp file, so a key never shows up in a process listing. The CLI can't read JSON from /dev/stdin.
    with tempfile.NamedTemporaryFile("w", suffix=".json") as f:
        json.dump(doc, f)
        f.flush()
        done = subprocess.run(["aws", "ssm", "put-parameter", "--cli-input-json", f"file://{f.name}", "--output", "text"],
                              text=True, capture_output=True)
    if done.returncode:
        sys.exit(f"failed on {name}: {done.stderr.replace(value, '<hidden>').strip()}")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("env_file", nargs="?", type=Path, default=REPO / ".env")
    p.add_argument("--dry-run", action="store_true", help="only say which names are set; send nothing")
    args = p.parse_args()
    if not args.env_file.is_file():
        sys.exit(f"no env file at {args.env_file}. Pass its path: python3 scripts/push_secrets.py /path/to/.env")
    env = read_env(args.env_file)
    missing = [n for n in REQUIRED if not env.get(n)]
    if missing and not args.dry_run:
        sys.exit(f"nothing sent, missing required: {', '.join(missing)}")
    for name in REQUIRED + OPTIONAL:
        if not env.get(name):
            print(f"unset  {name}")
        elif args.dry_run:
            print(f"set    {name}")
        else:
            store(name, env[name])
            print(f"stored {name}")
    if missing:
        sys.exit(f"missing required: {', '.join(missing)}")


if __name__ == "__main__":
    main()
