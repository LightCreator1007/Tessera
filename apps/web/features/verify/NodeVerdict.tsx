"use client";
// The per-node answer a round receipt owes its reader: did this node pass, and if not, why. One result, the check that ran, the plain reason, the money effect, the evidence, then a hand-off to the full replay.
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, CircleAlert, CircleCheck, CircleDashed, CircleSlash, Hourglass, ShieldAlert } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { HashChip, Money, Pill, cx, type Tone } from "@/components/primitives";
import { Term } from "@/components/term";

export type NodeResult = "passed" | "replay-failed" | "flagged" | "missed-reveal" | "not-audited" | "fallback";
export type CheckRow = { name: string; result: "pass" | "fail" | "pending" | "absent" };
export type MoneyEffect = { kind: "held" | "forfeited" | "pending" | "none"; units: number | null };

const RESULT: Record<NodeResult, { label: string; tone: Tone; icon: LucideIcon }> = {
  passed: { label: "Passed", tone: "ok", icon: CircleCheck },
  "replay-failed": { label: "Failed replay", tone: "danger", icon: CircleAlert },
  flagged: { label: "Flagged as poison", tone: "danger", icon: ShieldAlert },
  "missed-reveal": { label: "Missed its reveal", tone: "warn", icon: CircleSlash },
  "not-audited": { label: "Not audited yet", tone: "neutral", icon: CircleDashed },
  fallback: { label: "Under fallback review", tone: "warn", icon: Hourglass },
};
const CHECK: Record<CheckRow["result"], { label: string; tone: Tone }> = {
  pass: { label: "Match", tone: "ok" },
  fail: { label: "Mismatch", tone: "danger" },
  pending: { label: "Running", tone: "pending" },
  absent: { label: "No report", tone: "neutral" },
};

export function NodeVerdict({ who, result, segment, checks, reason, money, evidence, reverify, replayHref }: {
  who: ReactNode;
  result: NodeResult;
  segment: { n: number; of: number } | null;
  checks: CheckRow[];
  reason: ReactNode;
  money: MoneyEffect;
  evidence: string | null;
  reverify?: ReactNode;
  replayHref?: string;
}) {
  const r = RESULT[result];
  return (
    <section aria-label="Node result" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <r.icon className={cx("size-5", { ok: "text-ok", danger: "text-danger", warn: "text-warn", neutral: "text-muted", pending: "text-pending", chain: "text-chain", brand: "text-brand" }[r.tone])} strokeWidth={1.5} aria-hidden />
        <span className="text-lg text-ink">{r.label}</span>
        <span className="text-sm text-muted">{who}</span>
        <span className="ml-auto"><MoneyLine money={money} /></span>
      </div>
      <p className="text-sm text-ink">{reason}</p>

      <div className="flex flex-col gap-2">
        <p className="text-xs text-muted">
          {segment ? <>Which check ran: <Term k="replay">replay</Term> of segment {segment.n} of {segment.of}</> : checks.length > 0 ? <>Which check ran: <Term k="replay">replay</Term> of a random segment</> : "No check has run on this node yet"}
        </p>
        {checks.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            {checks.map((c) => (
              <div key={c.name} className="flex items-center justify-between rounded-lg border border-rule px-3 py-2">
                <span className="text-sm text-muted">{c.name}</span>
                <Pill tone={CHECK[c.result].tone}>{CHECK[c.result].label}</Pill>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-rule pt-4">
        <span className="flex items-center gap-2 text-xs text-muted">Evidence <HashChip value={evidence} label="evidence hash" /></span>
        {reverify}
      </div>
      {replayHref && (
        <Link href={replayHref} className="inline-flex items-center gap-1 self-start text-sm text-ink hover:underline">
          Open the full replay <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      )}
    </section>
  );
}

function MoneyLine({ money }: { money: MoneyEffect }) {
  if (money.kind === "none") return <span className="text-xs text-subtle">No pay this round</span>;
  if (money.kind === "pending") return <span className="flex items-center gap-1.5 text-sm text-pending">Pending <Money units={money.units} /></span>;
  if (money.kind === "forfeited") return <span className="flex items-center gap-1.5 text-sm text-danger">Forfeited <Money units={money.units} /></span>;
  return <span className="flex items-center gap-1.5 text-sm text-ok">Held <Money units={money.units} /></span>;
}
