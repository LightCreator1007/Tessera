"use client";
// Finds the browser wallets installed here through EIP-6963 (each extension announces its name, icon and provider), so the connect dialog lists the real ones. An older wallet that only sets window.ethereum still shows up as one entry.
import type { EIP1193Provider } from "viem";

export type WalletInfo = { id: string; name: string; icon: string | null; rdns: string };
export type Found = WalletInfo & { provider: EIP1193Provider };

type Announce = CustomEvent<{ info: { uuid: string; name: string; icon: string; rdns: string }; provider: EIP1193Provider }>;
type Legacy = EIP1193Provider & { isMetaMask?: boolean; isCoinbaseWallet?: boolean; isPhantom?: boolean; isRabby?: boolean; isBraveWallet?: boolean };

let found: Found[] = [];
export type Discovery = { wallets: WalletInfo[]; settled: boolean };
let snap: Discovery = { wallets: [], settled: false };
let started = false;
const subs = new Set<() => void>();

function publish() {
  snap = { wallets: found.map(({ id, name, icon, rdns }) => ({ id, name, icon, rdns })), settled: snap.settled };
  subs.forEach((f) => f());
}

/** A wallet that predates EIP-6963, named from the flags it sets. */
function legacy(): Found | null {
  const p = (window as unknown as { ethereum?: Legacy }).ethereum;
  if (!p) return null;
  const [name, rdns] = p.isRabby ? ["Rabby", "io.rabby"] : p.isPhantom ? ["Phantom", "app.phantom"] : p.isCoinbaseWallet ? ["Coinbase Wallet", "com.coinbase.wallet"]
    : p.isBraveWallet ? ["Brave Wallet", "com.brave.wallet"] : p.isMetaMask ? ["MetaMask", "io.metamask"] : ["Browser wallet", "injected"];
  return { id: "legacy", name, icon: null, rdns, provider: p };
}

export function startDiscovery() {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("eip6963:announceProvider", (e) => {
    const { info, provider } = (e as Announce).detail;
    // One entry per wallet: an extension can announce again (on reload of its page script), and the legacy guess yields to the real announcement.
    found = [...found.filter((w) => w.rdns !== info.rdns && !(w.id === "legacy" && w.rdns === info.rdns)), { id: info.uuid, name: info.name, icon: info.icon || null, rdns: info.rdns, provider }];
    publish();
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  // Announcements arrive synchronously from installed extensions; a short wait catches slow ones before falling back to window.ethereum.
  setTimeout(() => {
    if (!found.length) { const l = legacy(); if (l) found = [l]; }
    snap = { ...snap, settled: true };
    publish();
  }, 300);
}

export function subscribeWallets(f: () => void) {
  startDiscovery();
  subs.add(f);
  return () => { subs.delete(f); };
}
export const walletsSnapshot = () => snap;
const NONE: Discovery = { wallets: [], settled: false };
export const walletsServerSnapshot = () => NONE;

export const providerFor = (rdns: string) => found.find((w) => w.rdns === rdns) ?? null;
/** Subscribe for the moment a remembered wallet announces itself. */
export function whenFound(rdns: string, f: (w: Found) => void, missing?: () => void) {
  const hit = providerFor(rdns);
  if (hit) return f(hit);
  let done = false;
  const check = () => { const w = providerFor(rdns); if (w && !done) { done = true; subs.delete(check); f(w); } };
  subs.add(check);
  // An uninstalled or disabled wallet never announces; give up so the page can stop waiting.
  setTimeout(() => { if (!done) { done = true; subs.delete(check); missing?.(); } }, 3000);
}

/** Where to get a wallet when none is installed. */
export const GET_WALLETS = [
  { name: "MetaMask", rdns: "io.metamask", href: "https://metamask.io/download/" },
  { name: "Coinbase Wallet", rdns: "com.coinbase.wallet", href: "https://www.coinbase.com/wallet/downloads" },
  { name: "Phantom", rdns: "app.phantom", href: "https://phantom.com/download" },
  { name: "Rabby", rdns: "io.rabby", href: "https://rabby.io/" },
] as const;

/** Networks the app runs on, with what a wallet needs to add one it doesn't know. */
export const NETWORKS: Record<number, { name: string; rpc: string; explorer: string | null }> = {
  84532: { name: "Base Sepolia", rpc: "https://sepolia.base.org", explorer: "https://sepolia.basescan.org" },
  8453: { name: "Base", rpc: "https://mainnet.base.org", explorer: "https://basescan.org" },
  31337: { name: "Local Anvil", rpc: "http://127.0.0.1:8545", explorer: null },
};
export const networkName = (id: number | null | undefined) => (id != null && NETWORKS[id]?.name) || (id != null ? `chain ${id}` : "the right network");
