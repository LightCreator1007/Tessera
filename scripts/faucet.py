"""Deploys, inspects and claims a prefunded test TOD faucet without a server-held signing key."""
import argparse
import json
import subprocess
from decimal import Decimal
from pathlib import Path

from web3 import Web3

from deploy import artifact, creation, l1_fee
from fund import base_units, parse_amount, recipient_address
from tod_core.ledger import REPO, TOKEN_ABI, Network
from tod_core.txmgr import ANVIL_CHAIN_ID, GAS_MARGIN, TxManager, signer_from_env


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("action", choices=("deploy", "status", "claim"))
    ap.add_argument("--network", default="anvil")
    ap.add_argument("--rpc")
    ap.add_argument("--faucet", type=recipient_address)
    ap.add_argument("--account", type=recipient_address, help="optional claimant address for status")
    ap.add_argument("--allocation", type=parse_amount, default=Decimal(100), help="TOD per claim on deploy")
    ap.add_argument("--cooldown", type=int, default=86400, help="seconds, from 1 to 2592000, on deploy")
    ap.add_argument("--out", type=Path, help="write the deployed faucet's public JSON bundle")
    ap.add_argument("--journal-dir", default=str(REPO / "runs" / "faucet"))
    ap.add_argument("--yes", action="store_true", help="skip confirmation for an authorized rehearsal")
    args = ap.parse_args()
    try:
        allocation = base_units(args.allocation, 6)
        if not allocation or not 1 <= args.cooldown <= 30 * 86400:
            raise ValueError("use a positive allocation and a cooldown between 1 and 2592000 seconds")
    except ValueError as error:
        ap.error(str(error))
    if args.action != "deploy" and not args.faucet:
        ap.error("--faucet is required for status or claim")
    if args.action == "deploy" and args.out and args.out.exists():
        ap.error("--out already exists; choose a new bundle path to retain earlier deployment receipts")

    net = Network.load(args.network, args.rpc)
    if net.chain_id not in (ANVIL_CHAIN_ID, 84532):
        raise SystemExit("This test faucet supports Anvil and Base Sepolia only. Nothing was sent.")
    w3 = Web3(Web3.HTTPProvider(net.rpc, request_kwargs={"timeout": 30}))
    if w3.eth.chain_id != net.chain_id:
        raise SystemExit("RPC chain does not match the network configuration. Nothing was sent.")
    token = w3.eth.contract(address=net.token, abi=TOKEN_ABI)
    if token.functions.decimals().call() != 6 or token.functions.symbol().call() != "TOD":
        raise SystemExit("Configured token is not six-decimal TOD. Nothing was sent.")

    if args.action == "deploy":
        subprocess.run(["forge", "build"], cwd=REPO / "contracts", check=True, capture_output=True)
        signer = signer_from_env("DEPLOYER_PRIVATE_KEY", "deployer", net.chain_id)
        if signer.address.lower() != net.roles["deployer"].lower():
            raise SystemExit("DEPLOYER_PRIVATE_KEY does not match the configured deployer. Nothing was sent.")
        to, data = None, creation(w3, "ToDFaucet", net.token, allocation, args.cooldown)[0]
        detail = f"Deploy faucet: {allocation} TOD base units per claim, cooldown {args.cooldown}s"
    else:
        if not w3.eth.get_code(args.faucet):
            raise SystemExit("No faucet contract exists at that address. Nothing was sent.")
        faucet = w3.eth.contract(address=args.faucet, abi=artifact("ToDFaucet")["abi"])
        if faucet.functions.token().call().lower() != net.token.lower():
            raise SystemExit("Faucet token does not match the configured TOD. Nothing was sent.")
        allocation = faucet.functions.allocation().call()
        status = {"chainId": net.chain_id, "token": net.token, "faucet": args.faucet,
                  "allocation": allocation, "cooldown": faucet.functions.cooldown().call(),
                  "inventory": token.functions.balanceOf(args.faucet).call()}
        if args.account:
            status.update(account=args.account, nextClaimAt=faucet.functions.nextClaimAt(args.account).call())
        if args.action == "status":
            print(json.dumps(status))
            return
        signer = signer_from_env("WALLET_PRIVATE_KEY", "faucet/user", net.chain_id)
        if args.account and args.account.lower() != signer.address.lower():
            raise SystemExit("--account does not match WALLET_PRIVATE_KEY. Nothing was sent.")
        next_claim = faucet.functions.nextClaimAt(signer.address).call()
        if w3.eth.get_block("latest")["timestamp"] < next_claim:
            raise SystemExit(f"Cooldown active until Unix timestamp {next_claim}. Nothing was sent.")
        if status["inventory"] < allocation:
            raise SystemExit("Faucet inventory exhausted; ask the operator to refill it. Nothing was sent.")
        to, data = args.faucet, faucet.encode_abi("claim")
        detail = f"Claim {allocation} TOD base units from {args.faucet} to {signer.address}"

    tx = {"from": signer.address, "data": data}
    if to:
        tx["to"] = to
    gas = int(w3.eth.estimate_gas(tx) * GAS_MARGIN)
    fee = 2 * w3.eth.get_block("latest")["baseFeePerGas"] + w3.eth.max_priority_fee
    required = gas * fee + l1_fee(w3, len(data.removeprefix("0x")) // 2)
    if w3.eth.get_balance(signer.address) < required:
        raise SystemExit(f"Sender needs up to {required} wei for gas. Nothing was sent.")
    print(f"Chain {net.chain_id}; TOD {net.token}; sender {signer.address}")
    print(f"{detail}; estimated gas limit {gas}, up to {required} wei including the data fee")
    if net.chain_id != ANVIL_CHAIN_ID and not args.yes:
        try:
            answer = input('Type "send" to continue: ')
        except EOFError:
            answer = ""
        if answer.strip() != "send":
            raise SystemExit("Stopped. Nothing was sent.")
    receipt = TxManager(w3, signer, args.journal_dir, poll_seconds=0.1).transact(to, data, gas=gas)
    result = {"chainId": net.chain_id, "token": net.token, "faucet": receipt["contractAddress"] if to is None else to,
              "allocation": allocation, "txHash": Web3.to_hex(receipt["transactionHash"])}
    if args.action == "deploy":
        result.update(cooldown=args.cooldown, deployBlock=receipt["blockNumber"])
        if args.out:
            args.out.parent.mkdir(parents=True, exist_ok=True)
            args.out.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
