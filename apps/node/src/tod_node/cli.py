"""tod-node CLI: operator key, pairing code, self-test, status and doctor. The run loop comes with the node daemon."""

import base64
import json
import os
import platform
import stat
import time
import urllib.request
from importlib.metadata import version
from pathlib import Path
from typing import Annotated

import typer
from eth_account import Account
from eth_utils import is_address, to_checksum_address
from tod_core import encodings as enc
from tod_workloads.mlp_exact import selftest as mlp_selftest

# Agents and the web app branch on these exit codes, so they are part of the CLI contract.
OK, BAD_INPUT, NOT_ELIGIBLE, UNREACHABLE = 0, 2, 3, 4
# An old pairing code must be useless, so consent expires after 30 minutes.
PAIR_TTL = 30 * 60
PAIR_PREFIX = "tod-pair:"
# Repo checkout and image both hold vectors/ at the workspace root (members are installed editable).
SELFTEST_VECTOR = Path(__file__).resolve().parents[4] / "vectors" / "kernel" / "mlp_exact.json"

app = typer.Typer(no_args_is_help=True)
JsonOpt = Annotated[bool, typer.Option("--json", help="Print one JSON object instead of text.")]


def data_dir() -> Path:
    return Path(os.environ.get("TOD_DATA", Path.home() / ".tod"))


def key_path() -> Path:
    return data_dir() / "operator.key"


def emit(as_json: bool, fields: dict, text: str) -> None:
    typer.echo(json.dumps(fields, sort_keys=True) if as_json else text)


def fail(as_json: bool, code: int, message: str) -> None:
    if as_json:
        typer.echo(json.dumps({"error": message}))
    else:
        typer.echo(f"error: {message}", err=True)
    raise typer.Exit(code)


def load_operator(as_json: bool):
    if not key_path().exists():
        fail(as_json, NOT_ELIGIBLE, "not initialized; run `tod-node init`")
    return Account.from_key(key_path().read_text().strip())


def _print_version(value: bool) -> None:
    if value:
        typer.echo(version("tod-node"))
        raise typer.Exit()


@app.callback()
def main(
    _version: bool = typer.Option(
        False, "--version", callback=_print_version, is_eager=True, help="Print the version and exit."
    ),
) -> None:
    """Train ML jobs on this machine and get paid for verified work."""


@app.command()
def init(as_json: JsonOpt = False) -> None:
    """Create this node's operator key (once; later runs print the existing address)."""
    path = key_path()
    created = not path.exists()
    if created:
        path.parent.mkdir(parents=True, exist_ok=True)
        # Created 0600 in one step, so the key is never readable by others, even briefly.
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as f:
            f.write(Account.create().key.hex())
    operator = load_operator(as_json).address
    emit(as_json, {"created": created, "operator": operator}, f"operator {operator}" + (" (created)" if created else ""))


@app.command()
def pair(
    owner: Annotated[str, typer.Option("--owner", help="Owner wallet address that will run this node.")],
    chain_id: Annotated[int, typer.Option("--chain-id")],
    registry: Annotated[str, typer.Option("--registry", help="NodeRegistry contract address.")],
    as_json: JsonOpt = False,
) -> None:
    """Print a pairing code to paste into the web join page; it expires after 30 minutes."""
    if not (is_address(owner) and is_address(registry)):
        fail(as_json, BAD_INPUT, "--owner and --registry must be 0x addresses")
    account = load_operator(as_json)
    owner, registry = to_checksum_address(owner), to_checksum_address(registry)
    deadline = int(time.time()) + PAIR_TTL
    msg = {"owner": owner, "operator": account.address, "consentDeadline": deadline}
    signature = "0x" + enc.sign(account.key, "Consent", chain_id, registry, msg).hex()
    fields = {"consentDeadline": deadline, "operator": account.address, "owner": owner, "signature": signature}
    payload = json.dumps(fields, sort_keys=True, separators=(",", ":")).encode()
    code = PAIR_PREFIX + base64.urlsafe_b64encode(payload).decode().rstrip("=")
    expires = time.strftime("%Y-%m-%d %H:%M:%S %Z", time.localtime(deadline))
    emit(as_json, {**fields, "code": code}, f"{code}\nexpires {expires}")


@app.command()
def selftest(as_json: JsonOpt = False) -> None:
    """Check that this machine reproduces the mlp-exact self-test vector byte for byte."""
    vec = json.loads(SELFTEST_VECTOR.read_text())
    got = mlp_selftest()
    ok = got == vec["hash"]
    fields = {"arch": platform.machine(), "expected": vec["hash"], "got": got, "ok": ok, "workload": vec["workload"]}
    emit(as_json, fields, f"{vec['workload']} on {fields['arch']}: {'ok' if ok else 'MISMATCH'}")
    if not ok:
        raise typer.Exit(NOT_ELIGIBLE)


@app.command()
def status(as_json: JsonOpt = False) -> None:
    """Show this node's state."""
    path = key_path()
    operator = Account.from_key(path.read_text().strip()).address if path.exists() else None
    fields = {"dataDir": str(data_dir()), "initialized": operator is not None, "operator": operator}
    emit(as_json, fields, "\n".join(f"{k}: {v}" for k, v in fields.items()))


def _coordinator_check(url: str, chain_id: int | None) -> tuple[bool, str]:
    try:
        with urllib.request.urlopen(url.rstrip("/") + "/v1/health", timeout=5) as r:
            health = json.loads(r.read())
    except Exception as e:  # any network or parse failure means the node can't work with this coordinator
        return False, f"unreachable: {e}"
    if not health.get("ok"):
        return False, "health says not ok"
    if chain_id is not None and health.get("chainId") != chain_id:
        return False, f"coordinator is on chain {health.get('chainId')}, expected {chain_id}"
    return True, f"chain {health.get('chainId')}, version {health.get('version')}"


@app.command()
def doctor(
    chain_id: Annotated[int | None, typer.Option("--chain-id", help="Fail if the coordinator is on another chain.")] = None,
    as_json: JsonOpt = False,
) -> None:
    """Check that this node is ready to train: key, data folder, self-test and coordinator."""
    path, checks = key_path(), {}
    if not path.exists():
        checks["key"] = (False, "missing; run `tod-node init`")
    elif stat.S_IMODE(path.stat().st_mode) != 0o600:
        checks["key"] = (False, f"{path} must be mode 0600")
    else:
        checks["key"] = (True, str(path))
    data_dir().mkdir(parents=True, exist_ok=True)
    checks["dataDir"] = (os.access(data_dir(), os.W_OK), str(data_dir()))
    expected = json.loads(SELFTEST_VECTOR.read_text())["hash"]
    checks["selftest"] = (mlp_selftest() == expected, platform.machine())
    url = os.environ.get("TOD_COORDINATOR_URL")
    coord = _coordinator_check(url, chain_id) if url else (None, "TOD_COORDINATOR_URL not set, skipped")
    checks["coordinator"] = coord

    fields = {k: {"ok": ok, "detail": d} for k, (ok, d) in checks.items()}
    marks = {True: "ok  ", False: "FAIL", None: "skip"}
    emit(as_json, fields, "\n".join(f"{marks[ok]} {k}: {d}" for k, (ok, d) in checks.items()))
    if not all(checks[k][0] for k in ("key", "dataDir", "selftest")):
        raise typer.Exit(NOT_ELIGIBLE)
    if coord[0] is False:
        raise typer.Exit(UNREACHABLE)
