"""Tops up addresses with test ETH and MockUSDC from the faucet key: free on anvil, behind a prompt on public chains."""
import argparse

from tod_core.ledger import REPO, Ledger, Network
from tod_core.txmgr import ANVIL_CHAIN_ID, TxManager, signer_from_env

TRANSFER_GAS = 21_000


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("addresses", nargs="+")
    ap.add_argument("--network", default="anvil", help="name in networks/, or a path to a .toml")
    ap.add_argument("--rpc", help="overrides the toml's rpc")
    ap.add_argument("--eth", type=float, help="default: 10 on anvil, none on public chains")
    ap.add_argument("--usdc", type=float, default=1000.0, help="MockUSDC to mint, which has no value")
    ap.add_argument("--journal-dir", default=str(REPO / "runs" / "txmgr"))
    ap.add_argument("--yes", action="store_true", help="skip the prompt")
    args = ap.parse_args()

    net = Network.load(args.network, args.rpc)
    ledger = Ledger(net)
    dev = net.chain_id == ANVIL_CHAIN_ID
    faucet = signer_from_env("FAUCET_PRIVATE_KEY", "faucet", net.chain_id)
    amount = args.eth if args.eth is not None else 10.0 if dev else 0.0
    wei = int(amount * 10**18)

    if not dev and wei:
        balance = ledger.w3.eth.get_balance(faucet.address)
        print(f"From FAUCET {faucet.address}, balance {balance / 10**18:.8f} ETH, on {net.name}:")
        for addr in args.addresses:
            print(f"  {amount} ETH to {ledger.w3.to_checksum_address(addr)}")
        if not args.yes:
            try:
                answer = input('Type "send" to continue: ')
            except EOFError:
                answer = ""
            if answer.strip() != "send":
                raise SystemExit("Stopped. Nothing was sent.")

    tm = TxManager(ledger.w3, faucet, args.journal_dir, poll_seconds=0.1 if dev else 1.0)
    token = ledger.using(tm).token
    for addr in args.addresses:
        if dev:
            ledger.w3.provider.make_request("anvil_setBalance", [addr, hex(wei)])
        elif wei:
            tm.transact(addr, "0x", value=wei, gas=TRANSFER_GAS)
        if args.usdc:
            token.mint(addr, int(args.usdc * 10**6))
        print(f"{addr}: {amount} ETH, {args.usdc} MockUSDC")


if __name__ == "__main__":
    main()
