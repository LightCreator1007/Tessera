"""tod-verifier CLI: `run` replays every revealed node and attests; `replay` checks one round without sending anything."""
import json
import os
import signal
import threading
from importlib.metadata import version
from pathlib import Path
from typing import Annotated

import typer

app = typer.Typer(no_args_is_help=True)
JsonOpt = Annotated[bool, typer.Option("--json", help="Print one JSON object instead of text.")]
NetworkOpt = Annotated[str | None, typer.Option("--network", envvar="TOD_NETWORK", help="anvil, base-sepolia or a toml path.")]
CoordOpt = Annotated[str | None, typer.Option("--coordinator", envvar="TOD_COORDINATOR", help="Coordinator base URL.")]
KeyOpt = Annotated[str, typer.Option("--key-env", help="Env var holding this verifier's private key.")]
BAD_INPUT, NOT_ELIGIBLE, UNREACHABLE = 2, 3, 4
# The anvil deploy registers exactly these two verifiers; any other key name must be set explicitly.
DEV_KEYS = {"VERIFIER_A_PRIVATE_KEY": "verifier/a", "VERIFIER_B_PRIVATE_KEY": "verifier/b"}


def _print_version(value: bool) -> None:
    if value:
        typer.echo(version("tod-verifier"))
        raise typer.Exit()


@app.callback()
def main(
    _version: bool = typer.Option(
        False, "--version", callback=_print_version, is_eager=True, help="Print the version and exit."
    ),
) -> None:
    """Replay nodes' rounds and sign the verdicts."""


def data_dir() -> Path:
    return Path(os.environ.get("TOD_VERIFIER_DATA", Path.home() / ".tod-verifier"))


def fail(as_json: bool, code: int, message: str, err: str, hint: str | None = None) -> None:
    if as_json:
        typer.echo(json.dumps({k: v for k, v in {"error": message, "code": err, "hint": hint}.items() if v}))
    else:
        typer.echo(f"error: {message}" + (f"\nhint: {hint}" if hint else ""), err=True)
    raise typer.Exit(code)


def _setup(network, coordinator, key_env, as_json):
    """Ledger, runner and key from flags and env. Dev keys are refused off anvil, as in txmgr.signer_from_env."""
    if not (network and coordinator):
        fail(as_json, BAD_INPUT, "need --network and --coordinator (or TOD_NETWORK and TOD_COORDINATOR)", "bad_config")
    from tod_core.ledger import Ledger, Network, open_failure
    from tod_core.txmgr import ANVIL_CHAIN_ID, dev_key
    from tod_node.prewarm import Prewarm
    from tod_node.trainer import Coordinator, RoundRunner, dataset_cache, preset_datasets

    net = Network.load(network)
    key = os.environ.get(key_env)
    if not key:
        if net.chain_id != ANVIL_CHAIN_ID:
            fail(as_json, BAD_INPUT, f"{key_env} is not set", "bad_config")
        if key_env not in DEV_KEYS:
            fail(as_json, BAD_INPUT, f"{key_env} is not set, and only {' or '.join(DEV_KEYS)} have anvil dev keys",
                 "bad_config")
        key = dev_key(DEV_KEYS[key_env])
    key = bytes.fromhex(key.removeprefix("0x")) if isinstance(key, str) else key
    try:
        ledger = Ledger(net)
    except Exception as e:
        code, message, err, hint = open_failure(net.name, e)
        fail(as_json, code, message, err, hint)
    prewarm = Prewarm(preset_datasets(dataset_cache(data_dir() / "datasets")))
    runner = RoundRunner(Coordinator(coordinator, key, net.chain_id, net.market), prewarm.datasets,
                         net.chain_id, net.market)
    return net, ledger, runner, key, prewarm


@app.command()
def replay(
    job: Annotated[int, typer.Option("--job")],
    round_: Annotated[int, typer.Option("--round")],
    network: NetworkOpt = None,
    coordinator: CoordOpt = None,
    key_env: KeyOpt = "VERIFIER_A_PRIVATE_KEY",
    as_json: JsonOpt = False,
) -> None:
    """Replay every revealed node of one round and print the verdicts. Sends no transaction."""
    from .verify import replay_round

    _, ledger, runner, _, prewarm = _setup(network, coordinator, key_env, as_json)
    runner.datasets = prewarm.load  # a one-off replay just waits for the download
    state = ledger.rebuild()
    if (job, round_) not in state.rounds:
        fail(as_json, NOT_ELIGIBLE, f"round {job}/{round_} not found on chain", "round_not_found")
    results = replay_round(runner, state, job, round_)
    typer.echo(json.dumps(results, sort_keys=True) if as_json else
               "\n".join(f"{op}  {v['kind'] or 'ok'}" for op, v in results.items()))


@app.command()
def run(
    network: NetworkOpt = None,
    coordinator: CoordOpt = None,
    key_env: KeyOpt = "VERIFIER_A_PRIVATE_KEY",
    poll: Annotated[float, typer.Option(help="Seconds between chain polls.")] = 2.0,
    as_json: JsonOpt = False,
) -> None:
    """Run the verifier in the foreground: replay revealed nodes, draw the seed if needed, attest once per round."""
    from tod_core.txmgr import LocalSigner, TxManager
    from tod_node.daemon import run as run_daemon
    from tod_node.events import EventLog

    from .cosign import CoordinatorApi, CoSigner
    from .verify import VerifierLoop

    net, ledger, runner, key, prewarm = _setup(network, coordinator, key_env, as_json)
    signer = LocalSigner(key)
    events = EventLog(data_dir() / "events.ndjson")
    prewarm.emit = events.append
    sender = TxManager(ledger.w3, signer, data_dir() / "journal")
    market = ledger.using(sender).market
    cosigner = CoSigner(market, ledger.registry, runner, CoordinatorApi(coordinator, key), key, net.chain_id,
                        emit=events.append)
    loop = VerifierLoop(market, signer.address, runner, emit=events.append, upload=runner.c.put, cosigner=cosigner)
    stop = threading.Event()
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: stop.set())
    events.append("verifier.started", version=version("tod-verifier"), network=net.name, verifier=signer.address)
    if net.rl_competitions:
        from .evaluate import Evaluator

        rl = Evaluator(ledger, coordinator, key, data_dir() / "rl", emit=events.append)
        threading.Thread(target=rl.loop, args=(stop,), name="rl-evaluator", daemon=True).start()
    run_daemon(ledger, loop, stop, poll=poll, emit=events.append, on_tick=prewarm)
    events.append("verifier.stopped")
