// Account preferences behind the Settings modal: payout address, notification choices and the demo transaction outcome. There is no account service or notification service yet, so they live in localStorage.
import { useSyncExternalStore } from "react";

export type NotifyEvent = "matched" | "paid" | "penalised" | "offline" | "stakeLow" | "jobDone" | "refund";
export type Channel = "inApp" | "email" | "webhook";
export type TxOutcome = "confirm" | "reject" | "revert";
export type Motion = "system" | "full" | "reduced";

export type Prefs = {
  claimTo: string | null;
  notify: Record<NotifyEvent, Channel[]>;
  email: string;
  webhook: string;
  txOutcome: TxOutcome;
  motion: Motion;
  splash: boolean;
};

const KEY = "tod.prefs.v1";
const INITIAL: Prefs = {
  claimTo: null,
  notify: { matched: ["inApp"], paid: ["inApp"], penalised: ["inApp", "email"], offline: ["inApp"], stakeLow: ["inApp", "email"], jobDone: ["inApp"], refund: ["inApp"] },
  email: "",
  webhook: "",
  txOutcome: "confirm",
  motion: "system",
  splash: true,
};

let state: Prefs = INITIAL;
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

export function setPrefs(patch: Partial<Prefs> | ((p: Prefs) => Partial<Prefs>)) {
  load();
  state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
  localStorage.setItem(KEY, JSON.stringify(state));
  subs.forEach((f) => f());
}

export function usePrefs() {
  return useSyncExternalStore(
    (f) => { subs.add(f); return () => subs.delete(f); },
    () => { load(); return state; },
    () => INITIAL,
  );
}

export function applyTxOutcome(o: TxOutcome) {
  document.documentElement.dataset.txOutcome = o === "confirm" ? "" : o;
  setPrefs({ txOutcome: o });
}

/** Stored prefs read outside React, for decisions made once on mount before usePrefs has hydrated. */
export function readPrefs(): Prefs {
  load();
  return state;
}

export function applyMotion(m: Motion) {
  document.documentElement.dataset.motion = m === "system" ? "" : m;
  setPrefs({ motion: m });
}

/** Whether the mosaic should hold still: the in-app choice wins, "system" defers to the OS setting. Set early by themeScript. */
export function reducedMotion() {
  const m = document.documentElement.dataset.motion;
  if (m === "reduced") return true;
  if (m === "full") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export const isAddress = (v: string) => /^0x[0-9a-fA-F]{40}$/.test(v);
