"use client";
// The one transaction state machine: idle -> wallet (confirm in wallet) -> pending (hash) -> confirmed | rejected | reverted (decoded reason). Every write in the app goes through useTx. In live mode a write with a call goes to the chain through lib/chain; demo mode and writes with no contract yet are simulated.
import { useCallback, useRef, useState } from "react";
import { isDemo } from "@/lib/api/client";
import { Refused, Rejected, send, type Call } from "@/lib/chain";

export type TxPhase = "idle" | "wallet" | "pending" | "confirmed" | "rejected" | "reverted";
export type TxState = { phase: TxPhase; hash: string | null; reason: string | null };

/** Dev dial: force the next demo tx outcome to walk the failure paths. */
export type DemoOutcome = "confirm" | "reject" | "revert";
export function demoOutcome(): DemoOutcome {
  if (typeof document === "undefined") return "confirm";
  const v = document.documentElement.dataset.txOutcome;
  return v === "reject" || v === "revert" ? v : "confirm";
}

/** Custom errors from JobMarket and NodeRegistry, in the words the user sees. */
export const REVERT_COPY: Record<string, string> = {
  StakeTooLow: "The stake is below the minimum for this job.",
  NodeIsBusy: "The node is in a round. Withdraw after the round ends.",
  NothingToClaim: "There is nothing to claim yet.",
  Expired: "The pairing code expired. Run pair again for a fresh one.",
  AlreadyJoined: "This laptop is already a node.",
  NullifierUsed: "This World ID already runs a node. One person, one node.",
  BadInput: "One of the values was rejected by the contract.",
  WrongState: "The job is not in a state that allows this right now.",
  NotAuthorized: "This wallet is not allowed to do that.",
  AlreadyEntered: "This World ID already has an entry here. One person, one entry.",
  HostCannotEnter: "The host's World ID can't enter its own competition.",
  DeadlinePassed: "The deadline passed while you were signing. Entries are closed.",
  InsufficientBalance: "Your earnings balance is smaller than the amount used.",
  TooEarly: "It's too early for this. The job's window hasn't closed yet.",
  NotJoined: "This operator hasn't joined the network yet.",
  CooldownActive: "The faucet sent you test TOD recently. Wait for its cooldown and try again.",
  EmptyFaucet: "The faucet is out of test TOD. Ask the team to top it up.",
  BadPass: "The entry pass expired or is for another wallet. Try again for a fresh one.",
  NotOpen: "There's no competition with that id.",
  Closed: "Entries are closed. The deadline has passed.",
  NotYet: "It's too early for this step. Wait for the window to open.",
  TooLate: "The window for this step has closed.",
  NotEntered: "This wallet has no entry in this competition.",
  WrongReveal: "The file and salt don't hash to the commitment. Use the reveal file saved when you committed.",
  AlreadyDone: "This was already done.",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fakeHash = () => "0x" + Array.from({ length: 64 }, (_, i) => "0123456789abcdef"[(Date.now() * (i + 7)) % 16]).join("");

export function useTx({ revertAs = "BadInput" }: { revertAs?: keyof typeof REVERT_COPY } = {}) {
  const [s, setS] = useState<TxState>({ phase: "idle", hash: null, reason: null });
  const busy = useRef(false);
  const run = useCallback(async (onConfirmed?: () => void, call?: () => Promise<Call>) => {
    if (busy.current) return false;
    busy.current = true;
    if (!isDemo && call) {
      const ok = await live(call, setS);
      busy.current = false;
      if (ok) onConfirmed?.();
      return ok;
    }
    const outcome = demoOutcome();
    setS({ phase: "wallet", hash: null, reason: null });
    await sleep(900);
    if (outcome === "reject") {
      setS({ phase: "rejected", hash: null, reason: "You rejected the request in your wallet. Nothing was sent." });
      busy.current = false;
      return false;
    }
    const hash = fakeHash();
    setS({ phase: "pending", hash, reason: null });
    await sleep(1400);
    if (outcome === "revert") {
      setS({ phase: "reverted", hash, reason: `${revertAs}: ${REVERT_COPY[revertAs]}` });
      busy.current = false;
      return false;
    }
    setS({ phase: "confirmed", hash, reason: null });
    busy.current = false;
    onConfirmed?.();
    return true;
  }, [revertAs]);
  const reset = useCallback(() => setS({ phase: "idle", hash: null, reason: null }), []);
  /** A chain write: sent for real in live mode, simulated in demo. */
  const send = useCallback((call: () => Promise<Call>, onConfirmed?: () => void) => run(onConfirmed, call), [run]);
  return { ...s, run, send, reset, busy: s.phase === "wallet" || s.phase === "pending" };
}

async function live(call: () => Promise<Call>, setS: (s: TxState) => void): Promise<boolean> {
  setS({ phase: "wallet", hash: null, reason: null });
  try {
    const r = await send(call, (hash) => setS({ phase: "pending", hash, reason: null }));
    setS(r);
    return r.phase === "confirmed";
  } catch (e) {
    if (e instanceof Rejected) setS({ phase: "rejected", hash: null, reason: "You rejected the request in your wallet. Nothing was sent." });
    else if (e instanceof Refused) setS({ phase: "reverted", hash: null, reason: e.errorName ? `${e.errorName}: ${REVERT_COPY[e.errorName] ?? e.message}` : e.message });
    else setS({ phase: "reverted", hash: null, reason: e instanceof Error ? e.message.split("\n")[0] : "Something went wrong sending this." });
    return false;
  }
}
