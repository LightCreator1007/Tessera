"""Funds the roles, deploys and wires the ToD contracts, verifies them, and writes networks/<name>.toml."""
import argparse
import json
import os
import subprocess
import tomllib
from pathlib import Path
from urllib.parse import urlparse

from web3 import Web3

from tod_core.ledger import REPO
from tod_core.txmgr import ANVIL_CHAIN_ID, GAS_MARGIN, TxManager, signer_from_env

ANVIL_ETH = hex(100 * 10**18)
TRANSFER_GAS = 21_000
# setMarket can't be estimated before the registry exists; the gas report measures about 45k.
SET_MARKET_GAS = 60_000
# OP-stack chains charge an L1 data fee on top of gas; it matters most for large creation transactions.
GAS_ORACLE = "0x420000000000000000000000000000000000000F"
ORACLE_ABI = [{"type": "function", "name": "getL1FeeUpperBound", "stateMutability": "view",
               "inputs": [{"name": "", "type": "uint256"}], "outputs": [{"name": "", "type": "uint256"}]}]


def rpc_url(cfg: dict, override: str | None = None) -> str:
    url = override or os.environ.get(cfg.get("rpcEnv", ""), "") or cfg.get("rpc", "")
    if not url:
        raise SystemExit(f"RPC URL missing; set {cfg.get('rpcEnv', 'the network RPC')} or pass --rpc")
    return url


def validate_roles(cfg: dict, chain_id: int) -> None:
    if chain_id == ANVIL_CHAIN_ID:
        return
    roles = cfg["roles"]
    required = ["deployer", "coordinator", "admitter", "faucet", "tokenAdmin"]
    if "funding" in roles:
        required.append("funding")
    for role in required:
        address = roles.get(role, "")
        if not Web3.is_address(address) or int(address, 16) == 0:
            raise SystemExit(f"Set a nonzero {role} address in the network's [roles]. Nothing was sent.")
    verifiers = roles.get("verifiers", [])
    if (not verifiers or any(not Web3.is_address(v) or int(v, 16) == 0 for v in verifiers)
            or len({v.lower() for v in verifiers}) != len(verifiers)
            or not 1 <= cfg["threshold"] <= len(verifiers) <= 255):
        raise SystemExit("Set distinct verifier addresses and a valid threshold. Nothing was sent.")


def token_parameters(cfg: dict) -> tuple[str, str, int]:
    cap = cfg.get("token", {}).get("cap")
    if isinstance(cap, bool) or not isinstance(cap, int) or not 0 < cap < 2**256:
        raise SystemExit("Set token.cap to a positive uint256 in TOD base units. Nothing was sent.")
    roles = cfg["roles"]
    for role in ("tokenAdmin", "faucet"):
        address = roles.get(role, "")
        if not Web3.is_address(address) or int(address, 16) == 0:
            raise SystemExit(f"Set a nonzero {role} address. Nothing was sent.")
    return roles["tokenAdmin"], roles["faucet"], cap


def artifact(name: str) -> dict:
    return json.loads((REPO / "contracts" / "out" / f"{name}.sol" / f"{name}.json").read_text())


def creation(w3: Web3, name: str, *ctor) -> tuple[str, str]:
    """Returns the creation data and just its constructor arguments, which the explorer needs to verify."""
    art = artifact(name)
    code = art["bytecode"]["object"]
    data = w3.eth.contract(abi=art["abi"], bytecode=code).constructor(*ctor).data_in_transaction
    return data, data[len(code):]


def l1_fee(w3: Web3, size: int) -> int:
    if not w3.eth.get_code(GAS_ORACLE):
        return 0
    return w3.eth.contract(address=GAS_ORACLE, abi=ORACLE_ABI).functions.getL1FeeUpperBound(size).call()


def eth(wei: int) -> str:
    return f"{wei / 10**18:.8f} ETH"


def plan_deploy(w3: Web3, sender: str, roles: dict, cfg: dict) -> tuple[list[str], int, int]:
    """Live cost of the deploy: printable lines, the expected spend, and the balance the sender must start with.

    A node accepts a tx only if the sender can cover its gas limit x max fee, so the balance must cover what earlier
    transactions spent plus the largest such reservation, which is more than the spend itself.
    """
    fee_now = w3.eth.gas_price
    max_fee = 2 * w3.eth.get_block("latest")["baseFeePerGas"] + w3.eth.max_priority_fee
    # Constructors only check addresses are non-zero, so any address gives the right estimate before the real ones exist.
    stand_in = roles["coordinator"]
    items = [
        ("ToDToken", creation(w3, "ToDToken", *token_parameters(cfg))[0]),
        ("NodeRegistry", creation(w3, "NodeRegistry", stand_in, roles["admitter"], cfg["probationSeconds"])[0]),
        ("JobMarket", creation(w3, "JobMarket", stand_in, stand_in, roles["coordinator"], roles["verifiers"],
                               cfg["threshold"])[0]),
        ("Competitions", creation(w3, "Competitions", stand_in, roles["admitter"])[0]),
    ]
    lines, spend, hold = [], 0, 0
    for name, data in items:
        gas = w3.eth.estimate_gas({"from": sender, "data": data})
        l1 = l1_fee(w3, len(data) // 2)
        lines.append(f"  create {name}: {gas:,} gas, about {eth(gas * fee_now + l1)}")
        hold = max(hold, spend + int(gas * GAS_MARGIN) * max_fee + l1)
        spend += gas * fee_now + l1
    lines.append(f"  NodeRegistry.setMarket: up to {SET_MARKET_GAS:,} gas, about {eth(SET_MARKET_GAS * fee_now)}")
    hold = max(hold, spend + SET_MARKET_GAS * max_fee)
    spend += SET_MARKET_GAS * fee_now
    return lines, spend, hold


def top_ups(w3: Web3, cfg: dict, deployer: str) -> list[tuple[str, str, int]]:
    """(role, address, wei) to bring each role up to its [funding] target. Re-running sends only what is missing."""
    f, roles = cfg.get("funding", {}), cfg["roles"]
    wanted = [("deployer", deployer, f.get("deployer", 0)), ("coordinator", roles["coordinator"], f.get("coordinator", 0))]
    wanted += [(f"verifier {i}", v, f.get("verifier", 0)) for i, v in enumerate(roles["verifiers"])]
    wanted += [("faucet", roles["faucet"], f.get("faucet", 0))]
    source = roles.get("funding", roles["faucet"]).lower()
    out = []
    for role, addr, target in wanted:
        if addr.lower() == source:
            continue  # A transfer to the sender cannot increase its spendable balance.
        missing = int(target * 10**18) - w3.eth.get_balance(addr)
        if missing > 0:
            out.append((role, addr, missing))
    return out


def gate(lines: list[str], yes: bool) -> None:
    print("\n".join(lines))
    if yes:
        return
    try:
        answer = input('Type "deploy" to send these transactions: ')
    except EOFError:
        answer = ""
    if answer.strip() != "deploy":
        raise SystemExit("Stopped. Nothing was sent.")


def save_progress(path: Path, record: dict, *, first: bool = False) -> None:
    """Retain the last complete receipt record if the process is interrupted during a write."""
    if first:
        with path.open("x") as stream:
            json.dump(record, stream, indent=2)
        path.chmod(0o600)
        return
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(record, indent=2) + "\n")
    temporary.chmod(0o600)
    temporary.replace(path)


def verify(cfg: dict, chain_id: int, name: str, addr: str, ctor_args: str) -> bool:
    """Tries the explorer, then Sourcify: Blockscout's free API rate-limits a run of verifications, retries included."""
    base = ["forge", "verify-contract", addr, f"src/{name}.sol:{name}", "--chain", str(chain_id), "--watch"]
    if ctor_args:
        base += ["--constructor-args", ctor_args]
    attempts = []
    if cfg.get("verifierUrl"):
        attempts.append(["--verifier", "blockscout", "--verifier-url", cfg["verifierUrl"], "--retries", "3", "--delay", "20"])
    attempts.append(["--verifier", "sourcify"])
    for how in attempts:
        r = subprocess.run(base + how, cwd=REPO / "contracts", capture_output=True, text=True)
        if r.returncode == 0:
            return True
        print(f"verify {name} via {how[1]} failed: {(r.stderr or r.stdout).strip()[-200:]}")
    return False


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--network", default="anvil", help="name in networks/, or a path to a .toml")
    ap.add_argument("--rpc", help="overrides the toml's rpc")
    ap.add_argument("--out", help="write here instead of over the network file")
    ap.add_argument("--journal-dir", default=str(REPO / "runs" / "txmgr"))
    ap.add_argument("--no-fund", action="store_true", help="skip the [funding] top-ups")
    ap.add_argument("--no-verify", action="store_true", help="skip the explorer step")
    ap.add_argument("--dry-run", action="store_true", help="print the live transaction plan and send nothing")
    ap.add_argument("--yes", action="store_true", help="skip the prompt (CI and rehearsals)")
    args = ap.parse_args()

    src = Path(args.network) if args.network.endswith(".toml") else REPO / "networks" / f"{args.network}.toml"
    text = src.read_text()
    cfg = tomllib.loads(text)
    token_parameters(cfg)
    rpc = rpc_url(cfg, args.rpc)
    w3 = Web3(Web3.HTTPProvider(rpc, request_kwargs={"timeout": 60}))
    chain_id = w3.eth.chain_id
    if chain_id != cfg["chainId"]:
        raise SystemExit(f"RPC is on chain {chain_id}, {src.name} says {cfg['chainId']}")
    validate_roles(cfg, chain_id)
    dev = chain_id == ANVIL_CHAIN_ID
    out = Path(args.out) if args.out else src
    progress = out.with_suffix(out.suffix + ".receipts.json")
    if not dev and not args.dry_run:
        prior = tomllib.loads(out.read_text()).get("contracts", {}) if out.exists() else {}
        if prior.get("token") or progress.exists():
            raise SystemExit("An earlier deployment or receipt record exists at this output. Inspect its receipts; "
                             "choose a new --out only for an intentional fresh deployment. Nothing was sent.")

    deployer = signer_from_env("DEPLOYER_PRIVATE_KEY", "deployer", chain_id)
    roles = cfg["roles"]
    if roles.get("deployer", deployer.address) != deployer.address:
        raise SystemExit(f"DEPLOYER_PRIVATE_KEY is {deployer.address}, {src.name} expects {roles['deployer']}")
    subprocess.run(["forge", "build"], cwd=REPO / "contracts", check=True, capture_output=True)
    subprocess.run(["node", str(REPO / "packages/abi/scripts/generate.mjs")], check=True, capture_output=True)

    if dev and not args.dry_run:
        for addr in (deployer.address, roles["coordinator"], roles["admitter"], roles["faucet"], roles["tokenAdmin"], *roles["verifiers"]):
            w3.provider.make_request("anvil_setBalance", [addr, ANVIL_ETH])
    else:
        plan, spend, hold = plan_deploy(w3, deployer.address, roles, cfg)
        fund = [] if args.no_fund else top_ups(w3, cfg, deployer.address)
        have = w3.eth.get_balance(deployer.address)
        after = have + sum(wei for role, _, wei in fund if role == "deployer")
        lines = [f"Network: {cfg['name']} (chain {chain_id}) via {urlparse(rpc).hostname}",
                 f"From DEPLOYER {deployer.address}, balance {eth(have)}:", *plan,
                 f"  Expected spend {eth(spend)}; must hold {eth(hold)}"]
        if fund:
            explicit = "funding" in roles
            source_role = "funding" if explicit else "faucet"
            variable = "FUNDING_PRIVATE_KEY" if explicit else "FAUCET_PRIVATE_KEY"
            faucet = signer_from_env(variable, source_role, chain_id)
            if faucet.address.lower() != roles[source_role].lower():
                raise SystemExit(f"{variable} does not match the configured {source_role}. Nothing was sent.")
            priority_fee = w3.eth.max_priority_fee
            max_fee = 2 * w3.eth.get_block("latest")["baseFeePerGas"] + priority_fee
            gas = TRANSFER_GAS * len(fund) * max_fee
            nonce = w3.eth.get_transaction_count(faucet.address, "pending")
            for index, (_, recipient, value) in enumerate(fund):
                raw = faucet.sign({"chainId":chain_id, "nonce":nonce + index, "to":recipient, "value":value,
                                   "gas":TRANSFER_GAS, "maxFeePerGas":max_fee,
                                   "maxPriorityFeePerGas":priority_fee, "type":2})
                gas += l1_fee(w3, len(raw))
            total, balance = sum(wei for _, _, wei in fund), w3.eth.get_balance(faucet.address)
            source_label = "FUNDING" if explicit else "FAUCET"
            if faucet.address.lower() == deployer.address.lower():
                after -= total + gas
            lines += [f"From {source_label} {faucet.address}, balance {eth(balance)}, gas up to {eth(gas)}:"]
            lines += [f"  {eth(wei)} to {role} {addr}" for role, addr, wei in fund]
            if balance < total + gas and not args.dry_run:
                raise SystemExit(f"{source_label} holds {eth(balance)} and needs {eth(total + gas)} for the [funding] targets. "
                                 "Get more test ETH, or lower the targets. Nothing was sent.")
        if args.dry_run:
            print("\n".join(lines))
            print(f"Deployer balance after planned funding/gas reserve: {eth(after)}; required {eth(hold)}")
            print(json.dumps({"dryRun": True, "deployerFunded": after >= hold,
                              "fundingFunded": not fund or balance >= total + gas}))
            print("Dry run complete. Nothing was sent; no sender journal or deployment receipt was created.")
            return
        if after < hold:
            raise SystemExit(f"DEPLOYER would hold {eth(after)}, and this deploy needs {eth(hold)} at today's fees. "
                             "Nothing was sent.")
        gate(lines, args.yes)
        record = {"chainId":chain_id, "sender":deployer.address, "status":"in_progress", "funding":[], "contracts":{},
                  "startNonce":w3.eth.get_transaction_count(deployer.address, "pending")}
        progress.parent.mkdir(parents=True, exist_ok=True)
        save_progress(progress, record, first=True)
        if fund:
            sender = TxManager(w3, faucet, args.journal_dir, poll_seconds=1.0)
            for _, addr, wei in fund:
                receipt = sender.transact(addr, "0x", value=wei, gas=TRANSFER_GAS)
                record["funding"].append({"to":addr,"wei":wei,"txHash":Web3.to_hex(receipt["transactionHash"])})
                save_progress(progress, record)
            if w3.eth.get_balance(deployer.address) < hold:
                raise SystemExit("Role funding completed, but the deployer no longer covers the deployment reserve. "
                                 "Inspect funding receipts before continuing; no contracts were created.")

    tm = TxManager(w3, deployer, args.journal_dir, poll_seconds=0.1 if dev else 1.0)

    # ponytail: not resumable; a crash midway means re-running, which redeploys and costs only test gas.
    def create(name: str, *ctor) -> dict:
        data, ctor_args = creation(w3, name, *ctor)
        receipt = tm.transact(None, data, timeout=300)
        print(f"{name}: {receipt['contractAddress']}", flush=True)
        created[name] = (receipt["contractAddress"], ctor_args)
        if not dev:
            record["contracts"][name] = {"address":receipt["contractAddress"], "constructorArgs":ctor_args,
                                          "txHash":Web3.to_hex(receipt["transactionHash"]), "block":receipt["blockNumber"]}
            save_progress(progress, record)
        return receipt

    created: dict[str, tuple[str, str]] = {}
    token_receipt = create("ToDToken", *token_parameters(cfg))
    token = token_receipt["contractAddress"]
    registry = create("NodeRegistry", token, roles["admitter"], cfg["probationSeconds"])["contractAddress"]
    market = create("JobMarket", token, registry, roles["coordinator"], roles["verifiers"], cfg["threshold"])["contractAddress"]
    reg = w3.eth.contract(address=registry, abi=json.loads((REPO / "packages/abi/json/INodeRegistry.json").read_text()))
    wire = tm.transact(registry, reg.encode_abi("setMarket", args=[market]), timeout=300)
    # Last, so the earlier contracts keep the addresses they have on a fresh Anvil.
    competitions = create("Competitions", token, roles["admitter"])["contractAddress"]
    if not dev:
        record.update(status="deployed", setMarketTxHash=Web3.to_hex(wire["transactionHash"]))
        save_progress(progress, record)

    # [contracts] is always the file's last section, so everything above it survives a redeploy.
    head = text.split("[contracts]")[0].rstrip()
    out.write_text(f'{head}\n\n[contracts]\ntoken = "{token}"\nregistry = "{registry}"\nmarket = "{market}"\n'
                   f'competitions = "{competitions}"\ndeployBlock = {token_receipt["blockNumber"]}\n')

    verified = None
    if not dev and not args.no_verify:
        verified = {n: verify(cfg, chain_id, n, a, c) for n, (a, c) in created.items()}
    if not dev:
        record.update(status="complete", verification=verified)
        save_progress(progress, record)
    print(json.dumps({"token": token, "registry": registry, "market": market, "competitions": competitions, "out": str(out),
                      "verified": verified}))


if __name__ == "__main__":
    main()
