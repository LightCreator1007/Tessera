"""tod-node CLI: operator key, pairing code, self-test, status, doctor, and the run/stop/logs daemon commands."""

import base64
import json
import os
import platform
import signal
import stat
import threading
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

from . import config

# Agents and the web app branch on these exit codes, so they are part of the CLI contract.
OK, BAD_INPUT, NOT_ELIGIBLE, UNREACHABLE = 0, 2, 3, 4
DAEMON_RUNNING = 6
TEST_CHAINS = {31337, 84532}  # anvil, Base Sepolia
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


def fail(as_json: bool, code: int, message: str, err: str | None = None, hint: str | None = None) -> None:
    """`err` is a stable snake_case code agents can branch on; `hint` is one sentence of what to do next."""
    if as_json:
        typer.echo(json.dumps({k: v for k, v in {"error": message, "code": err, "hint": hint}.items() if v}))
    else:
        typer.echo(f"error: {message}" + (f"\nhint: {hint}" if hint else ""), err=True)
    raise typer.Exit(code)


def load_operator(as_json: bool):
    if not key_path().exists():
        fail(as_json, NOT_ELIGIBLE, "not initialized", "not_initialized", "run `tod-node init`")
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
def init(
    network: Annotated[str | None, typer.Option("--network", help="Network name in networks/ or a path to its toml.")] = None,
    coordinator: Annotated[str | None, typer.Option("--coordinator", help="Coordinator base URL.")] = None,
    as_json: JsonOpt = False,
) -> None:
    """Create this node's operator key once, and save --network and --coordinator if given. Never rotates the key."""
    path = key_path()
    created = not path.exists()
    if created:
        path.parent.mkdir(parents=True, exist_ok=True)
        # Created 0600 in one step, so the key is never readable by others, even briefly.
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as f:
            f.write(Account.create().key.hex())
    if network or coordinator:
        config.write(data_dir(), {"network": network, "coordinator": coordinator})
    operator = load_operator(as_json).address
    emit(as_json, {"created": created, "operator": operator, "config": str(config.path(data_dir()))},
         f"operator {operator}" + (" (created)" if created else "") + f"\nconfig   {config.path(data_dir())}")


config_app = typer.Typer(no_args_is_help=True, help="Show this node's settings.")
app.add_typer(config_app, name="config")


@config_app.command("show")
def config_show(as_json: JsonOpt = False) -> None:
    """Print each setting with where it came from: flag, env, file or unset."""
    values = config.resolve(data_dir())
    fields = {k: {"value": v, "source": src} for k, (v, src) in values.items()}
    emit(as_json, fields, "\n".join(f"{k:<12} {v or '-'}  ({src})" for k, (v, src) in values.items()))


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


def pid_path() -> Path:
    return data_dir() / "node.pid"


def daemon_pid() -> int | None:
    """The pid of a live `run` in this data dir, or None. A stale file from a crash counts as not running."""
    try:
        pid = int(pid_path().read_text())
        os.kill(pid, 0)
        return pid
    except (OSError, ValueError):
        return None


def events_log():
    from .events import EventLog
    return EventLog(data_dir() / "events.ndjson")


@app.command()
def status(as_json: JsonOpt = False) -> None:
    """Show this node's state: key, whether the daemon is running, and its latest event."""
    path = key_path()
    operator = Account.from_key(path.read_text().strip()).address if path.exists() else None
    pid = daemon_pid()
    last = (events_log().read()[-1:] or [None])[0]
    fields = {"dataDir": str(data_dir()), "initialized": operator is not None, "operator": operator,
              "daemon": {"state": "running" if pid else "stopped", "pid": pid}, "lastEvent": last}
    from .events import render
    text = {**fields, "daemon": f"{fields['daemon']['state']}" + (f" (pid {pid})" if pid else ""),
            "lastEvent": render(last) if last else None}
    emit(as_json, fields, "\n".join(f"{k}: {v}" for k, v in text.items()))


@app.command()
def run(
    poll: Annotated[float, typer.Option(help="Seconds between chain polls.")] = 2.0,
    mode: Annotated[str, typer.Option("--mode", envvar="TOD_MODE",
                                      help="honest, or fake:lazy to claim work without training (test chains only).")] = "honest",
    as_json: JsonOpt = False,
) -> None:
    """Run the node in the foreground: watch the chain, train, commit and reveal. Docker restarts it; it never forks."""
    account = load_operator(as_json)
    network = config.resolve(data_dir())["network"][0]
    if not network:
        fail(as_json, BAD_INPUT, "no network set", "bad_config", "run `tod-node init --network anvil` or set TOD_NETWORK")
    # Imported here so the one-shot commands start fast and work without web3 loaded.
    from filelock import FileLock, Timeout
    from tod_core.ledger import Ledger, Network
    from tod_core.txmgr import LocalSigner, TxManager

    from .daemon import run as run_daemon
    from .rounds import RoundLoop, RoundStore

    lock = FileLock(data_dir() / "node.lock")
    try:
        lock.acquire(timeout=0)
    except Timeout:
        fail(as_json, DAEMON_RUNNING, f"already running (pid {daemon_pid()})", "daemon_running")
    try:
        net = Network.load(network)
    except (OSError, RuntimeError) as e:
        fail(as_json, BAD_INPUT, f"network {network}: {e}", "bad_config")
    if mode not in ("honest", "fake:lazy"):
        fail(as_json, BAD_INPUT, f"unknown mode {mode}", "bad_config", "use honest or fake:lazy")
    # A fake node loses its stake by design; never let one near a chain with real money.
    if mode != "honest" and net.chain_id not in TEST_CHAINS:
        fail(as_json, BAD_INPUT, f"{mode} is only allowed on test chains", "bad_config")
    try:
        ledger = Ledger(net)
        sender = TxManager(ledger.w3, LocalSigner(account.key), data_dir() / "journal")
    except Exception as e:  # RPC down or on the wrong chain: nothing this node can do until that is fixed
        fail(as_json, UNREACHABLE, f"chain {net.name}: {e}", "rpc_unreachable")
    pid_path().write_text(str(os.getpid()))
    events = events_log()

    coordinator = config.resolve(data_dir())["coordinator"][0]
    if coordinator:
        from .trainer import Coordinator, LazyTrainer, Trainer, preset_datasets
        train = (LazyTrainer if mode == "fake:lazy" else Trainer)(Coordinator(coordinator, account.key, net.chain_id, net.market),
                        preset_datasets(data_dir() / "datasets"), account.address, net.chain_id, net.market)
    else:
        def train(state, job, rnd):
            raise RuntimeError("no coordinator set, so no spec or start weights to train from")

    loop = RoundLoop(ledger.using(sender).market, account.address, net.chain_id, RoundStore(data_dir() / "rounds.json"),
                     train, emit=events.append)
    stop = threading.Event()

    def on_signal(signum, frame):
        if stop.is_set():
            os._exit(130)  # second Ctrl+C: everything that matters is already on disk
        events.append("node.stopping", signal=signal.Signals(signum).name)
        stop.set()

    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, on_signal)
    events.append("node.started", version=version("tod-node"), network=net.name, chainId=net.chain_id,
                  operator=account.address, mode=mode)
    try:
        run_daemon(ledger, loop, stop, poll=poll, emit=events.append)
    finally:
        events.append("node.stopped")
        pid_path().unlink(missing_ok=True)
        lock.release()


@app.command()
def stop(
    wait: Annotated[bool, typer.Option("--wait", help="Block until the daemon has exited.")] = False,
    as_json: JsonOpt = False,
) -> None:
    """Ask the daemon to stop. It finishes any reveal it owes first, so stopping never costs stake."""
    pid = daemon_pid()
    if pid is None:
        fail(as_json, NOT_ELIGIBLE, "the daemon is not running", "daemon_not_running")
    os.kill(pid, signal.SIGTERM)
    while wait and daemon_pid() == pid:
        time.sleep(0.5)
    emit(as_json, {"pid": pid, "stopped": wait}, f"stop sent to pid {pid}" + (", exited" if wait else ""))


@app.command()
def logs(
    follow: Annotated[bool, typer.Option("--follow", "-f", help="Keep printing new events.")] = False,
    since: Annotated[int, typer.Option("--since", help="Only events after this seq.")] = 0,
    as_json: JsonOpt = False,
) -> None:
    """Print the node's event log. With --json, one event per line."""
    from .events import render
    log_ = events_log()
    while True:
        for ev in log_.read(since):
            typer.echo(json.dumps(ev, sort_keys=True) if as_json else render(ev))
            since = ev["seq"]
        if not follow:
            return
        time.sleep(1)


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
    url = config.resolve(data_dir())["coordinator"][0]
    coord = _coordinator_check(url, chain_id) if url else (None, "no coordinator set (init --coordinator), skipped")
    checks["coordinator"] = coord

    fields = {k: {"ok": ok, "detail": d} for k, (ok, d) in checks.items()}
    marks = {True: "ok  ", False: "FAIL", None: "skip"}
    emit(as_json, fields, "\n".join(f"{marks[ok]} {k}: {d}" for k, (ok, d) in checks.items()))
    if not all(checks[k][0] for k in ("key", "dataDir", "selftest")):
        raise typer.Exit(NOT_ELIGIBLE)
    if coord[0] is False:
        raise typer.Exit(UNREACHABLE)
