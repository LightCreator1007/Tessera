#!/bin/sh
# Starts docker/compose.prod.yml on an Ubuntu host: installs Docker, writes each service's env file from Parameter Store, then builds and runs. Safe to rerun.
set -eu
SITE="${1:?usage: docker/prod-up.sh <public host name>}"
ENV_DIR="${TESSRA_ENV:-/etc/tessra}"
cd "$(dirname "$0")/.."

if ! command -v docker >/dev/null; then
  apt-get update -qq
  apt-get install -y -qq docker.io docker-compose-v2 docker-buildx
fi
command -v aws >/dev/null || snap install aws-cli --classic

WRITE_ENV='
import json, os, secrets, sys
out = sys.argv[1]
params = {p["Name"].rsplit("/", 1)[1]: p["Value"] for p in json.load(sys.stdin)["Parameters"]}

def write(name, values):
    # Single quotes stop compose expanding a dollar sign in a value, so a quote inside one would break the file.
    bad = [k for k, v in values.items() if chr(39) in v]
    if bad:
        sys.exit(f"single quote in {bad}")
    with open(f"{out}/{name}", "w") as f:
        f.writelines(f"{k}={chr(39)}{v}{chr(39)}\n" for k, v in values.items())

rpc = {"BASE_SEPOLIA_RPC_URL": params["BASE_SEPOLIA_RPC_URL"]}
write("verifier-a.env", {**rpc, "VERIFIER_A_PRIVATE_KEY": params["VERIFIER_A_PRIVATE_KEY"]})
write("verifier-b.env", {**rpc, "VERIFIER_B_PRIVATE_KEY": params["VERIFIER_B_PRIVATE_KEY"]})
token = f"{out}/admin-token"
if not os.path.exists(token):
    open(token, "w").write(secrets.token_hex(32))
write("coordinator.env", {**{k: v for k, v in params.items() if not k.startswith("VERIFIER_")},
                          "ADMIN_TOKEN": open(token).read()})
'
# A subshell, so the tight umask covers the secrets and not the image build.
(
  umask 077
  mkdir -p "$ENV_DIR"
  aws ssm get-parameters-by-path --region "${AWS_REGION:-ap-south-1}" --path /tessra --with-decryption --output json \
    | python3 -c "$WRITE_ENV" "$ENV_DIR"
  printf 'SITE=%s\nTESSRA_ENV=%s\n' "$SITE" "$ENV_DIR" > "$ENV_DIR/compose.env"
)
docker compose --env-file "$ENV_DIR/compose.env" -f docker/compose.prod.yml up -d --build
