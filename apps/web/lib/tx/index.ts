"use client";
// The one transaction state machine: idle -> wallet (confirm in wallet) -> pending (hash) -> confirmed | rejected | reverted (decoded reason). Every write in the app goes through useTx; writeContract lives only here when the chain is wired.
import { useCallback, useRef, useState } from "react";

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
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fakeHash = () => "0x" + Array.from({ length: 64 }, (_, i) => "0123456789abcdef"[(Date.now() * (i + 7)) % 16]).join("");

export function useTx({ revertAs = "BadInput" }: { revertAs?: keyof typeof REVERT_COPY } = {}) {
  const [s, setS] = useState<TxState>({ phase: "idle", hash: null, reason: null });
  const busy = useRef(false);
  const run = useCallback(async (onConfirmed?: () => void) => {
    if (busy.current) return false;
    busy.current = true;
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
  return { ...s, run, reset, busy: s.phase === "wallet" || s.phase === "pending" };
}
