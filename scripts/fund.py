"""Distributes capped TOD and test ETH through the configured faucet after complete preflight checks."""
import argparse
from decimal import Decimal, InvalidOperation

from tod_core.ledger import REPO, Ledger, Network
from tod_core.txmgr import ANVIL_CHAIN_ID, GAS_MARGIN, TxManager, signer_from_env

TRANSFER_GAS = 21_000


def parse_amount(value: str) -> Decimal:
    try:
        return Decimal(value)
    except InvalidOperation as error:
        raise argparse.ArgumentTypeError("amount must be a decimal number") from error


def base_units(value: Decimal, decimals: int) -> int:
    if not value.is_finite() or value < 0:
        raise ValueError("amount must be finite and nonnegative")
    _, digits, exponent = value.as_tuple()
    coefficient = int("".join(str(d) for d in digits))
    if coefficient == 0:
        return 0
    shift = exponent + decimals
    if shift < 0:
        if -shift > len(digits):
            raise ValueError(f"amount cannot be represented with {decimals} decimals")
        coefficient, remainder = divmod(coefficient, 10 ** -shift)
        if remainder:
            raise ValueError(f"amount cannot be represented with {decimals} decimals")
    else:
        if len(str(coefficient)) + shift > 78:
            raise ValueError("amount exceeds uint256")
        coefficient *= 10**shift
    if coefficient >= 2**256:
        raise ValueError("amount exceeds uint256")
    return coefficient


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("addresses", nargs="+")
    ap.add_argument("--network", default="anvil", help="network name or a path to its TOML")
    ap.add_argument("--rpc", help="overrides the configured RPC")
    ap.add_argument("--eth", type=parse_amount, help="default: 10 on Anvil, zero elsewhere")
    ap.add_argument("--tokens", type=parse_amount, default=Decimal(1000), help="TOD per recipient, up to six decimals")
    ap.add_argument("--journal-dir", default=str(REPO / "runs" / "txmgr"))
    ap.add_argument("--yes", action="store_true", help="skip the send prompt for an authorized rehearsal")
    args = ap.parse_args()
    try:
        units = base_units(args.tokens, 6)
        addresses = [recipient_address(a) for a in args.addresses]
        if len(set(addresses)) != len(addresses):
            raise ValueError("recipient addresses must be distinct")
    except ValueError as error:
        ap.error(str(error))

    net = Network.load(args.network, args.rpc)
    ledger = Ledger(net)
    dev = net.chain_id == ANVIL_CHAIN_ID
    amount = args.eth if args.eth is not None else Decimal(10) if dev else Decimal(0)
    try:
        wei = base_units(amount, 18)
    except ValueError as error:
        ap.error(str(error))
    faucet = signer_from_env("FAUCET_PRIVATE_KEY", "faucet", net.chain_id)
    if faucet.address.lower() != net.roles["faucet"].lower():
        raise SystemExit("FAUCET_PRIVATE_KEY does not match the configured faucet. Nothing was sent.")
    if ledger.token.decimals() != 6 or ledger.token.symbol() != "TOD":
        raise SystemExit("Configured token is not six-decimal TOD. Nothing was sent.")
    mint_data = []
    if units:
        if not ledger.token.hasRole(ledger.token.MINTER_ROLE(), faucet.address):
            raise SystemExit("Configured faucet has no MINTER_ROLE. Nothing was sent.")
        if ledger.token.totalSupply() + units * len(addresses) > ledger.token.cap():
            raise SystemExit("Requested batch exceeds the remaining TOD cap. Nothing was sent.")
        mint_data = [ledger.token._c.encode_abi("mint", args=[address, units]) for address in addresses]
    gas_limits = []
    if not dev:
        gas_limits = [int(ledger.w3.eth.estimate_gas({"from": faucet.address, "to": net.token, "data": data}) * GAS_MARGIN)
                      for data in mint_data]
        total_gas = sum(gas_limits) + (TRANSFER_GAS * len(addresses) if wei else 0)
        max_fee = 2 * ledger.w3.eth.get_block("latest")["baseFeePerGas"] + ledger.w3.eth.max_priority_fee
        needed = wei * len(addresses) + total_gas * max_fee
        if ledger.w3.eth.get_balance(faucet.address) < needed:
            raise SystemExit("FAUCET lacks the requested ETH plus estimated transaction gas. Nothing was sent.")
        if wei or units:
            print(f"Network: {net.name} (chain {net.chain_id}); token {net.token} (TOD)")
            print(f"From FAUCET {faucet.address}; estimated gas up to {total_gas} units:")
            for address in addresses:
                print(f"  {amount} ETH ({wei} wei) and {args.tokens} TOD ({units} base units) to {address}")
            if not args.yes:
                try:
                    answer = input('Type "send" to continue: ')
                except EOFError:
                    answer = ""
                if answer.strip() != "send":
                    raise SystemExit("Stopped. Nothing was sent.")

    tm = TxManager(ledger.w3, faucet, args.journal_dir, poll_seconds=0.1 if dev else 1.0)
    for index, address in enumerate(addresses):
        if dev:
            ledger.w3.provider.make_request("anvil_setBalance", [address, hex(wei)])
        elif wei:
            tm.transact(address, "0x", value=wei, gas=TRANSFER_GAS)
        if units:
            tm.transact(net.token, mint_data[index], gas=gas_limits[index] if gas_limits else None)
        print(f"{address}: {amount} ETH, {args.tokens} TOD")


def recipient_address(value: str) -> str:
    from web3 import Web3
    if not Web3.is_address(value) or int(value, 16) == 0:
        raise ValueError("each recipient must be a nonzero EVM address")
    return Web3.to_checksum_address(value)


if __name__ == "__main__":
    main()
