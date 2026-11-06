"use client";
// One address's public record for /u/[address]: the coordinator's owner route when it has one, the jobs list and competitions otherwise, and the connected wallet's own state when the address is yours.
import { useMemo } from "react";
import { isDemo } from "@/lib/api/client";
import { useJobs, useLiveCompetitions, useNodeChain, useOwnerIdentity, useOwnerRecord } from "@/lib/api/hooks";
import type { Job, OwnerEvent, OwnerIdentity } from "@/lib/api/types";
import { DEMO_OWNED_JOBS, useWallet } from "@/lib/wallet";
import { useLedger } from "./Overview";

export type AddressRecord = {
  self: boolean;
  loading: boolean;
  /** "coordinator": the owner route answered. "partial": it didn't, so node and pay counts are missing or come from this browser. */
  source: "coordinator" | "demo" | "partial";
  indexedTo: number | null;
  operators: string[];
  jobs: Job[];
  /** null: not known here (no owner route, and not your own wallet). Never shown as zero. */
  paidRounds: number | null;
  paidAmount: number | null;
  verifiedRounds: number | null;
  slashes: number | null;
  missedReveals: number | null;
  firstAt: number | null;
  hosted: number;
  entered: number;
  human: boolean | null;
  excluded: OwnerIdentity["excluded"];
  graduated: boolean;
  /** Seconds of verified work against the proving period, for your own node where the chain record is readable. */
  proving: { done: number; need: number } | null;
  recycled: number;
};

export function useAddressRecord(address: string): AddressRecord {
  const w = useWallet();
  const a = address.toLowerCase();
  const self = w.address?.toLowerCase() === a;
  const rec = useOwnerRecord(address);
  const ident = useOwnerIdentity(address);
  const jobs = useJobs();
  const comps = useLiveCompetitions();
  const ledger = useLedger();
  const op = self && w.node?.joined ? w.node.operator : "";
  const chain = useNodeChain(op, Boolean(op));

  return useMemo(() => {
    const fetched = rec.data?.data ?? null;
    // Demo has no indexer, so its record carries only posted jobs; counts come from the demo wallet or stay unknown.
    const r = isDemo ? null : fetched;
    const all = jobs.data?.data ?? [];
    const ownJob = (j: Job) => j.requester.toLowerCase() === a || (self && isDemo && DEMO_OWNED_JOBS.includes(j.id)) || (fetched?.jobs.includes(j.id) ?? false);
    const list = comps.data?.data ?? [];
    const c = chain.data?.data;
    const kind = (k: OwnerEvent["kind"]) => r?.kinds[k] ?? { count: 0, amount: 0 };
    const selfPaid = self ? ledger.rows.filter((x) => x.kind === "payout") : [];
    const operators = r && r.operators.length ? r.operators : op ? [op] : [];
    return {
      self,
      loading: rec.isPending || jobs.isPending,
      source: isDemo ? "demo" : r ? "coordinator" : "partial",
      indexedTo: r?.indexedTo ?? null,
      operators,
      jobs: all.filter(ownJob),
      paidRounds: r ? kind("paid").count : self ? selfPaid.length : null,
      paidAmount: r ? kind("paid").amount : self ? selfPaid.reduce((s, x) => s + x.amount, 0) : null,
      verifiedRounds: r ? r.rounds : c ? c.history.filter((h) => h.result === "paid").length : null,
      slashes: r ? kind("slashed").count : c ? c.penalties.filter((p) => p.kind === "Slashed").length : null,
      missedReveals: r ? kind("noReveal").count : c ? c.missedReveals : null,
      firstAt: r?.firstAt ?? (self && ledger.rows.length ? Math.min(...ledger.rows.map((x) => x.at)) : null),
      hosted: list.filter((x) => x.host.toLowerCase() === a).length + (isDemo && self ? w.hosted.length : 0),
      entered: list.filter((x) => x.entrants.some((e) => e.toLowerCase() === a)).length + (isDemo && self ? w.entries.length : 0),
      // Demo identity says joined for every address, so only the demo wallet's own proof counts there.
      human: isDemo ? (self ? w.personVerified : null) : ident.data ? Boolean(ident.data.data.verified) || ident.data.data.joined || (self && w.personVerified) : null,
      excluded: ident.data?.data.excluded ?? null,
      graduated: c?.graduated ?? false,
      proving: c && !c.graduated ? { done: c.verifiedWorkSeconds, need: c.probationSeconds } : null,
      recycled: self ? ledger.recycled : 0,
    };
  }, [rec.data, rec.isPending, ident.data, jobs.data, jobs.isPending, comps.data, chain.data, ledger.rows, ledger.recycled, self, a, op, w.hosted.length, w.entries.length, w.personVerified]);
}
