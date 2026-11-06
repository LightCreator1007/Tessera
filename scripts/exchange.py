"""Deploys and uses the prefunded TOD/test-USDC desk; real-money chains are refused."""
import argparse
import json
import subprocess
from decimal import Decimal
from pathlib import Path

from web3 import Web3

from deploy import artifact, creation
from faucet import send_checked
from fund import base_units, parse_amount, recipient_address
from tod_core.ledger import REPO, TOKEN_ABI, Network
from tod_core.txmgr import ANVIL_CHAIN_ID, signer_from_env

BASE_SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("action", choices=("deploy", "status", "approve", "swap", "seed"))
    ap.add_argument("--network", default="anvil")
    ap.add_argument("--rpc")
    ap.add_argument("--exchange", type=recipient_address)
    ap.add_argument("--usdc", type=recipient_address, help="quote-token address on deploy; required on Anvil")
    ap.add_argument("--asset", choices=("tod", "usdc"), default="tod", help="input token or seed inventory")
    ap.add_argument("--amount", type=parse_amount, default=Decimal(0), help="exact token amount, six decimals")
    ap.add_argument("--min-out", type=parse_amount, help="swap minimum; default equals the input amount")
    ap.add_argument("--deadline", type=int, help="absolute Unix expiry; default is latest chain timestamp + 300")
    ap.add_argument("--account", type=recipient_address, help="optional public address for status")
    ap.add_argument("--out", type=Path, help="write the deployed desk's public JSON bundle")
    ap.add_argument("--journal-dir", default=str(REPO / "runs" / "exchange"))
    ap.add_argument("--yes", action="store_true", help="skip confirmation for an authorized rehearsal")
    args = ap.parse_args()
    try:
        amount = base_units(args.amount, 6)
        minimum = amount if args.min_out is None else base_units(args.min_out, 6)
        if args.action in ("seed", "swap") and not amount:
            raise ValueError("seed and swap require a positive --amount")
        if args.action == "swap" and not 0 < minimum <= amount:
            raise ValueError("--min-out must be positive and cannot exceed the fixed demo quote")
        if args.deadline is not None and args.deadline < 0:
            raise ValueError("--deadline must be a nonnegative Unix timestamp")
    except ValueError as error:
        ap.error(str(error))
    if args.action != "deploy" and not args.exchange:
        ap.error("--exchange is required")
    if args.action == "deploy" and args.out and args.out.exists():
        ap.error("--out already exists; choose a new deployment bundle path")
    net = Network.load(args.network, args.rpc)
    if net.chain_id not in (ANVIL_CHAIN_ID, 84532):
        raise SystemExit("The demo exchange supports Anvil and Base Sepolia only. Nothing was sent.")
    w3 = Web3(Web3.HTTPProvider(net.rpc, request_kwargs={"timeout": 30}))
    if w3.eth.chain_id != net.chain_id:
        raise SystemExit("RPC chain does not match the network configuration. Nothing was sent.")
    if args.action == "deploy":
        usdc_address = args.usdc or (BASE_SEPOLIA_USDC if net.chain_id == 84532 else None)
        if not usdc_address:
            ap.error("--usdc is required for a local test-token fixture")
        subprocess.run(["forge", "build"], cwd=REPO / "contracts", check=True, capture_output=True)
    else:
        if not w3.eth.get_code(args.exchange):
            raise SystemExit("No exchange contract exists at that address. Nothing was sent.")
        desk = w3.eth.contract(address=args.exchange, abi=artifact("ToDTestExchange")["abi"])
        if desk.functions.tod().call().lower() != net.token.lower():
            raise SystemExit("Exchange TOD does not match the configured token. Nothing was sent.")
        usdc_address = desk.functions.usdc().call()
        minimum_redemption = desk.functions.MIN_REDEEM().call()
        if args.action == "swap" and args.asset == "tod" and amount < minimum_redemption:
            raise SystemExit(f"Redemption requires at least {minimum_redemption} TOD base units (10 TOD). Nothing was sent.")
    if net.chain_id == 84532 and usdc_address.lower() != BASE_SEPOLIA_USDC.lower():
        raise SystemExit("Use Circle's verified Base Sepolia test-USDC address. Nothing was sent.")
    tod = w3.eth.contract(address=net.token, abi=TOKEN_ABI)
    usdc = w3.eth.contract(address=usdc_address, abi=TOKEN_ABI)
    for token, symbol in ((tod, "TOD"), (usdc, "USDC")):
        if token.functions.decimals().call() != 6 or token.functions.symbol().call() != symbol:
            raise SystemExit(f"Expected six-decimal {symbol}. Nothing was sent.")
    if args.action == "status":
        result = {"chainId": net.chain_id, "exchange": args.exchange, "tod": net.token, "usdc": usdc_address,
                  "todInventory": tod.functions.balanceOf(args.exchange).call(),
                  "usdcInventory": usdc.functions.balanceOf(args.exchange).call(),
                  "minimumRedemption": minimum_redemption, "demoQuote": "1 TOD : 1 test USDC"}
        if args.account:
            result.update(account=args.account, todBalance=tod.functions.balanceOf(args.account).call(),
                          usdcBalance=usdc.functions.balanceOf(args.account).call())
        print(json.dumps(result))
        return

    if args.action == "deploy":
        signer = signer_from_env("DEPLOYER_PRIVATE_KEY", "deployer", net.chain_id)
        if signer.address.lower() != net.roles["deployer"].lower():
            raise SystemExit("DEPLOYER_PRIVATE_KEY does not match the configured deployer. Nothing was sent.")
        to, data = None, creation(w3, "ToDTestExchange", net.token, usdc_address)[0]
        detail = (f"Deploy TEST-ONLY exchange for TOD {net.token} and USDC {usdc_address}; "
                  "artificial 1:1 quote; minimum redemption 10 TOD")
    else:
        signer = signer_from_env("WALLET_PRIVATE_KEY", "faucet/user", net.chain_id)
        if args.account and args.account.lower() != signer.address.lower():
            raise SystemExit("--account does not match WALLET_PRIVATE_KEY. Nothing was sent.")
        input_token, output_token = (tod, usdc) if args.asset == "tod" else (usdc, tod)
        if args.action == "approve":
            current = input_token.functions.allowance(signer.address, args.exchange).call()
            if current and amount:
                raise SystemExit("Clear the existing allowance with --amount 0 before replacing it. Nothing was sent.")
            to = input_token.address
            data = input_token.encode_abi("approve", args=[args.exchange, amount])
            detail = f"Approve exactly {amount} {args.asset} ({input_token.address}) base units to {args.exchange}"
        elif args.action == "seed":
            if input_token.functions.balanceOf(signer.address).call() < amount:
                raise SystemExit("Wallet has insufficient seed inventory. Nothing was sent.")
            to = input_token.address
            data = input_token.encode_abi("transfer", args=[args.exchange, amount])
            detail = (f"Donate {amount} {args.asset} ({input_token.address}) base units to test inventory "
                      f"{args.exchange}; no LP or withdrawal claim")
        else:
            now = w3.eth.get_block("latest")["timestamp"]
            deadline = now + 300 if args.deadline is None else args.deadline
            if deadline < now:
                raise SystemExit("Swap deadline has expired. Nothing was sent.")
            if input_token.functions.balanceOf(signer.address).call() < amount:
                raise SystemExit("Wallet has insufficient input tokens. Nothing was sent.")
            if output_token.functions.balanceOf(args.exchange).call() < amount:
                raise SystemExit("Exchange output inventory is insufficient. Nothing was sent.")
            if input_token.functions.allowance(signer.address, args.exchange).call() < amount:
                raise SystemExit("Approve the exact input with the approve command first. Nothing was sent.")
            to = args.exchange
            data = desk.encode_abi("swap", args=[args.asset == "tod", amount, minimum, deadline])
            detail = (f"TEST swap {amount} {args.asset} ({input_token.address}) base units for {amount} "
                      f"output base units ({output_token.address}); "
                      f"minimum {minimum}; deadline {deadline}; recipient {signer.address}")
    receipt = send_checked(w3, net, signer, to, data, detail, args.journal_dir, args.yes)
    result = {"chainId": net.chain_id, "exchange": receipt["contractAddress"] if to is None else args.exchange,
              "tod": net.token, "usdc": usdc_address, "txHash": Web3.to_hex(receipt["transactionHash"])}
    if args.action == "deploy":
        result["deployBlock"] = receipt["blockNumber"]
        deployed = w3.eth.contract(address=result["exchange"], abi=artifact("ToDTestExchange")["abi"])
        result["minimumRedemption"] = deployed.functions.MIN_REDEEM().call()
        if args.out:
            args.out.parent.mkdir(parents=True, exist_ok=True)
            args.out.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
