"use client";
// Wallet state behind one interface. Demo mode simulates an owner wallet (address, network, balances, node membership) in localStorage, so every flow and edge case can be walked without a chain. wagmi replaces the demo adapter when the chain is wired; screens do not change.
import { useSyncExternalStore } from "react";

export const CHAIN_ID = 84532;
const TOD = 1_000_000;

export type DemoWallet = {
  address: string | null;
  chainId: number;
  usdc: number;
  eth: number;
  allowance: number;
  claimable: number;
  /** Node membership for this owner: pairing to stake. */
  node: { operator: string; humanVerified: boolean; joined: boolean; stake: number; running: boolean } | null;
  postedJobs: PostedJob[];
  /** Claims made from this browser, so the ledger can show them before an indexer exists. */
  claims: { amount: number; at: number }[];
  /** World ID proof made outside node setup (entering a competition). A node's humanVerified counts too. */
  personVerified: boolean;
  /** Competitions this wallet hosts and entries it made, kept here until a competition contract exists. */
  hosted: HostedCompetition[];
  entries: CompetitionEntry[];
};

export type HostedCompetition = { id: string; host: string; title: string; task: string; prize: number; budget: number; fee: number; deadline: string; labelsHash: string; labelsSeed: number | null; committedAt: number; createdAt: number; fromEarnings: number };
export type CompetitionEntry = { competition: string; predictionsHash: string; fileName: string; at: number; fromEarnings: number };

export type PostedJob = { id: number; workload: string; dataset: string; budget: number; rounds: number; stakePerNode: number; minQuorum: number; postedAt: number; fromEarnings?: number };

const KEY = "demo-wallet";
const INITIAL: DemoWallet = { address: null, chainId: CHAIN_ID, usdc: 5 * TOD, eth: 0.02, allowance: 0, claimable: 12.4 * TOD, node: null, postedJobs: [], claims: [], personVerified: false, hosted: [], entries: [] };

let state: DemoWallet = INITIAL;
let loaded = false;
const subs = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) state = { ...INITIAL, ...JSON.parse(raw) };
  } catch {
    state = INITIAL;
  }
}

export function setWallet(patch: Partial<DemoWallet> | ((w: DemoWallet) => Partial<DemoWallet>)) {
  load();
  state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
  localStorage.setItem(KEY, JSON.stringify(state));
  subs.forEach((f) => f());
}

export function resetWallet() {
  state = INITIAL;
  localStorage.removeItem(KEY);
  subs.forEach((f) => f());
}

export function useWallet() {
  const w = useSyncExternalStore(
    (f) => { subs.add(f); return () => subs.delete(f); },
    () => { load(); return state; },
    () => INITIAL,
  );
  return {
    ...w,
    connected: w.address !== null,
    wrongNetwork: w.address !== null && w.chainId !== CHAIN_ID,
    connect: () => setWallet({ address: "0x5e1f00d2c0ffee0000000000000000000000a11c" }),
    disconnect: () => setWallet({ address: null }),
    switchNetwork: () => setWallet({ chainId: CHAIN_ID }),
  };
}

/** Demo: two fixture jobs stand in for jobs this wallet posted, so the owner panel and refunds can be walked without a chain. */
export const DEMO_OWNED_JOBS = [4, 3];

/** One rule for "yours" on every page: you posted it from this wallet (or, in demo, it is a stand-in fixture). */
export function ownsJob(address: string | null, isDemo: boolean, job: { id: number; requester: string }) {
  if (!address) return false;
  return job.requester.toLowerCase() === address.toLowerCase() || (isDemo && DEMO_OWNED_JOBS.includes(job.id));
}
