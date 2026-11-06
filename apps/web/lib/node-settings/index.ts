// Node settings as the laptop holds them, plus the state of a remote change (UX-PHASE-2 §4.5). The heartbeat fields, matcher filters and signed-settings relay (C1 to C5) don't exist yet, so demo mode keeps all of it in localStorage in the shape the heartbeat will carry.
import { useSyncExternalStore } from "react";
import { preset, type RoundPhase, type Week } from "./logic";

export * from "./logic";

export type Mode = "always" | "schedule" | "manual";

export type NodeSettings = {
  mode: Mode;
  week: Week;
  threads: number;
  ramGb: number;
  diskGb: number;
  maxHoursDay: number | null;
  minPay: number | null;
  workloads: string[];
};

/** Requested: signed, waiting for the next heartbeat. Applied: the heartbeat echoed the settings hash. Rejected: the laptop's local lock is on. */
export type Sync =
  | { phase: "applied"; at: number; by: "web" | "laptop" }
  | { phase: "signing" }
  | { phase: "requested"; at: number; next: NodeSettings }
  | { phase: "rejected"; at: number; reason: string };

export type Pause =
  | { kind: "none" }
  | { kind: "draining"; until: number | null; settlesAt: number }
  | { kind: "paused"; until: number | null; at: number };

export type Laptop = { cores: number; ramGb: number; zone: string; localLock: boolean; phase: RoundPhase; missesInRow: number };

type Store = { applied: NodeSettings; sync: Sync; pause: Pause; laptop: Laptop };

const KEY = "tod.node-settings.v1";
const DEMO_LAPTOP: Laptop = { cores: 8, ramGb: 16, zone: "Asia/Kolkata", localLock: false, phase: "idle", missesInRow: 0 };
export const DEFAULTS: NodeSettings = {
  mode: "always",
  week: preset("nights"),
  threads: DEMO_LAPTOP.cores / 2,
  ramGb: DEMO_LAPTOP.ramGb / 2,
  diskGb: 5,
  maxHoursDay: null,
  minPay: null,
  workloads: ["mlp-exact", "cnn-torch"],
};
const INITIAL: Store = { applied: DEFAULTS, sync: { phase: "applied", at: 0, by: "laptop" }, pause: { kind: "none" }, laptop: DEMO_LAPTOP };

let state: Store = INITIAL;
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

function set(patch: Partial<Store> | ((s: Store) => Partial<Store>)) {
  load();
  state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
  localStorage.setItem(KEY, JSON.stringify(state));
  subs.forEach((f) => f());
}

export function useNodeSettings() {
  return useSyncExternalStore(
    (f) => { subs.add(f); return () => subs.delete(f); },
    () => { load(); return state; },
    () => INITIAL,
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Owner signs NodeSettings in the wallet; the coordinator relays it on the laptop's next heartbeat. */
export async function sendSettings(next: NodeSettings) {
  set({ sync: { phase: "signing" } });
  await sleep(900);
  set({ sync: { phase: "requested", at: Date.now(), next } });
}

/** One heartbeat from the laptop: applies a waiting request, or rejects it when the laptop has local lock on. */
export function heartbeat() {
  const s = state;
  if (s.sync.phase !== "requested") return;
  if (s.laptop.localLock) set({ sync: { phase: "rejected", at: Date.now(), reason: "Local lock is on at the laptop, so it ignores changes from the web." } });
  else set({ applied: s.sync.next, sync: { phase: "applied", at: Date.now(), by: "web" } });
}

export function cancelRequest() {
  set({ sync: { phase: "applied", at: Date.now(), by: "web" } });
}

export function setPause(p: Pause) {
  set({ pause: p });
}

export function setLaptop(patch: Partial<Laptop>) {
  set((s) => ({ laptop: { ...s.laptop, ...patch } }));
}

export function resetNodeSettings() {
  state = INITIAL;
  localStorage.removeItem(KEY);
  subs.forEach((f) => f());
}
