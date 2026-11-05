"""Funds the roles, deploys MockUSDC, NodeRegistry and JobMarket, wires and verifies them, writes networks/<name>.toml."""
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
        ("MockUSDC", creation(w3, "MockUSDC")[0]),
        ("NodeRegistry", creation(w3, "NodeRegistry", stand_in, roles["admitter"], cfg["probationSeconds"])[0]),
        ("JobMarket", creation(w3, "JobMarket", stand_in, stand_in, roles["coordinator"], roles["verifiers"],
                               cfg["threshold"])[0]),
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
    out = []
    for role, addr, target in wanted:
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


def verify(cfg: dict, chain_id: int, name: str, addr: str, ctor_args: str) -> bool:
    """Tries the explorer, then Sourcify: Blockscout's free API rate-limits a run of verifications, retries included."""
    base = ["forge", "verify-contract", addr, f"src/{name}.sol:{name}", "--chain", str(chain_id), "--watch"]
    if ctor_args:
        base += ["--constructor-args", ctor_args]
    for how in (["--verifier", "blockscout", "--verifier-url", cfg["verifierUrl"], "--retries", "3", "--delay", "20"],
                ["--verifier", "sourcify"]):
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
    ap.add_argument("--yes", action="store_true", help="skip the prompt (CI and rehearsals)")
    args = ap.parse_args()

    src = Path(args.network) if args.network.endswith(".toml") else REPO / "networks" / f"{args.network}.toml"
    text = src.read_text()
    cfg = tomllib.loads(text)
    rpc = args.rpc or os.environ.get(cfg.get("rpcEnv", ""), "") or cfg["rpc"]
    w3 = Web3(Web3.HTTPProvider(rpc, request_kwargs={"timeout": 60}))
    chain_id = w3.eth.chain_id
    if chain_id != cfg["chainId"]:
        raise SystemExit(f"RPC is on chain {chain_id}, {src.name} says {cfg['chainId']}")
    dev = chain_id == ANVIL_CHAIN_ID

    deployer = signer_from_env("DEPLOYER_PRIVATE_KEY", "deployer", chain_id)
    roles = cfg["roles"]
    if roles.get("deployer", deployer.address) != deployer.address:
        raise SystemExit(f"DEPLOYER_PRIVATE_KEY is {deployer.address}, {src.name} expects {roles['deployer']}")
    subprocess.run(["forge", "build"], cwd=REPO / "contracts", check=True, capture_output=True)
    subprocess.run(["node", str(REPO / "packages/abi/scripts/generate.mjs")], check=True, capture_output=True)

    if dev:
        for addr in (deployer.address, roles["coordinator"], roles["admitter"], roles["faucet"], *roles["verifiers"]):
            w3.provider.make_request("anvil_setBalance", [addr, ANVIL_ETH])
    else:
        plan, spend, hold = plan_deploy(w3, deployer.address, roles, cfg)
        fund = [] if args.no_fund else top_ups(w3, cfg, deployer.address)
        have = w3.eth.get_balance(deployer.address)
        after = have + sum(wei for role, _, wei in fund if role == "deployer")
        if after < hold:
            raise SystemExit(f"DEPLOYER would hold {eth(after)}, and this deploy needs {eth(hold)} at today's fees. "
                             "Nothing was sent.")
        lines = [f"Network: {cfg['name']} (chain {chain_id}) via {urlparse(rpc).hostname}",
                 f"From DEPLOYER {deployer.address}, balance {eth(have)}:", *plan,
                 f"  Expected spend {eth(spend)}; must hold {eth(hold)}"]
        if fund:
            faucet = signer_from_env("FAUCET_PRIVATE_KEY", "faucet", chain_id)
            if faucet.address != roles["faucet"]:
                raise SystemExit(f"FAUCET_PRIVATE_KEY is {faucet.address}, {src.name} expects {roles['faucet']}")
            gas = TRANSFER_GAS * len(fund) * (2 * w3.eth.get_block("latest")["baseFeePerGas"] + w3.eth.max_priority_fee)
            total, balance = sum(wei for _, _, wei in fund), w3.eth.get_balance(faucet.address)
            if balance < total + gas:
                raise SystemExit(f"FAUCET holds {eth(balance)} and needs {eth(total + gas)} for the [funding] targets. "
                                 "Get more test ETH, or lower the targets. Nothing was sent.")
            lines += [f"From FAUCET {faucet.address}, balance {eth(balance)}, gas up to {eth(gas)}:"]
            lines += [f"  {eth(wei)} to {role} {addr}" for role, addr, wei in fund]
        gate(lines, args.yes)
        if fund:
            sender = TxManager(w3, faucet, args.journal_dir, poll_seconds=1.0)
            for _, addr, wei in fund:
                sender.transact(addr, "0x", value=wei, gas=TRANSFER_GAS)

    tm = TxManager(w3, deployer, args.journal_dir, poll_seconds=0.1 if dev else 1.0)

    # ponytail: not resumable; a crash midway means re-running, which redeploys and costs only test gas.
    def create(name: str, *ctor) -> dict:
        data, ctor_args = creation(w3, name, *ctor)
        receipt = tm.transact(None, data, timeout=300)
        print(f"{name}: {receipt['contractAddress']}", flush=True)
        created[name] = (receipt["contractAddress"], ctor_args)
        return receipt

    created: dict[str, tuple[str, str]] = {}
    usdc = create("MockUSDC")
    token = usdc["contractAddress"]
    registry = create("NodeRegistry", token, roles["admitter"], cfg["probationSeconds"])["contractAddress"]
    market = create("JobMarket", token, registry, roles["coordinator"], roles["verifiers"], cfg["threshold"])["contractAddress"]
    reg = w3.eth.contract(address=registry, abi=json.loads((REPO / "packages/abi/json/INodeRegistry.json").read_text()))
    tm.transact(registry, reg.encode_abi("setMarket", args=[market]), timeout=300)

    out = Path(args.out) if args.out else src
    # [contracts] is always the file's last section, so everything above it survives a redeploy.
    head = text.split("[contracts]")[0].rstrip()
    out.write_text(f'{head}\n\n[contracts]\ntoken = "{token}"\nregistry = "{registry}"\nmarket = "{market}"\n'
                   f'deployBlock = {usdc["blockNumber"]}\n')

    verified = None
    if cfg.get("verifierUrl") and not args.no_verify:
        verified = {n: verify(cfg, chain_id, n, a, c) for n, (a, c) in created.items()}
    print(json.dumps({"token": token, "registry": registry, "market": market, "out": str(out), "verified": verified}))


if __name__ == "__main__":
    main()
