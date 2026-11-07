"use client";
// An address's competitions on its profile: what it won and claimed, and every competition it hosted or entered.
import Link from "next/link";
import { useMemo } from "react";
import { RotateCw } from "lucide-react";
import { Button, Card, Counter, Money, Null, Pill, SectionTitle, Skeleton, TD, TH, THead, ROW, type Tone } from "@/components/primitives";
import { ApiError, isDemo } from "@/lib/api/client";
import { useOwnerCompetitions } from "@/lib/api/hooks";
import type { OwnerCompetitions as Record_ } from "@/lib/api/types";
import { ITEMS, scoreOf } from "@/lib/learn/competition";
import { useCompetitions } from "./model";

const STAGE: Record<string, [string, Tone]> = {
  open: ["Open", "ok"], "awaiting-labels": ["Closed", "neutral"], scoring: ["Scoring", "pending"], "ready-to-settle": ["Scored", "neutral"],
  settled: ["Finished", "neutral"], "labels-hidden": ["Labels not revealed", "danger"], refundable: ["Closed", "neutral"],
  closed: ["Closed", "neutral"], finished: ["Finished", "neutral"], unrevealed: ["Labels not revealed", "danger"],
};
const stage = (s: string) => STAGE[s] ?? [s, "neutral" as Tone];

/** Demo mode has no coordinator, so the record comes from the examples, scored in the browser. */
function useDemoRecord(address: string): Record_ {
  const { list } = useCompetitions();
  return useMemo(() => {
    const a = address.toLowerCase();
    const hosted = list.filter((c) => c.host.toLowerCase() === a).map((c) => ({ id: c.id, title: c.title, status: c.status, prize: c.prize, deadline: Date.parse(c.deadline) / 1000, entries: c.entries.length, refunded: 0 }));
    const entered = list.flatMap((c) => {
      const ranked = [...c.entries].sort((x, y) => scoreOf(c, y) - scoreOf(c, x));
      const i = ranked.findIndex((e) => e.op.toLowerCase() === a);
      if (i < 0) return [];
      const done = c.status === "finished";
      const items = c.items ?? ITEMS;
      return [{
        id: c.id, title: c.title, status: c.status, prize: c.prize, deadline: Date.parse(c.deadline) / 1000, entries: c.entries.length, items,
        state: done ? "scored" as const : "committed" as const, score: done ? Math.round(scoreOf(c, ranked[i]) * items) : null,
        rank: done ? i + 1 : null, tied: false, won: done && i === 0 ? c.prize : 0, share: 0, commits: 1,
      }];
    });
    return { owner: a, hosted, entered, won: entered.reduce((s, e) => s + e.won, 0), shares: 0, wins: entered.filter((e) => e.won > 0).length, refunded: 0 };
  }, [list, address]);
}

export function OwnerCompetitions({ address, self }: { address: string; self: boolean }) {
  const q = useOwnerCompetitions(address, !isDemo);
  const demo = useDemoRecord(address);
  const r = isDemo ? demo : q.data?.data ?? null;

  if (!isDemo && q.isError && !r) {
    if (q.error instanceof ApiError && (q.error.kind === "off" || q.error.kind === "not_found")) return null;
    return (
      <section className="flex flex-col gap-3">
        <SectionTitle title="Competitions" />
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted">Couldn&apos;t read this address&apos;s competitions.<Button variant="ghost" icon={RotateCw} onClick={() => void q.refetch()}>Try again</Button></p>
      </section>
    );
  }
  if (!r) return <section className="flex flex-col gap-3"><SectionTitle title="Competitions" /><Skeleton className="h-24 w-full rounded-xl" /></section>;
  if (r.hosted.length === 0 && r.entered.length === 0) {
    if (!self) return null;
    return (
      <section className="flex flex-col gap-3">
        <SectionTitle title="Competitions" />
        <p className="text-sm text-muted">You haven&apos;t hosted or entered a competition. <Link href="/competitions" className="text-ink underline decoration-subtle underline-offset-4">See what&apos;s open</Link></p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <SectionTitle title="Competitions" sub={isDemo ? "demo data, from the example competitions" : "from the Competitions contract"} />
      <Card className="grid grid-cols-2 gap-x-6 gap-y-5 p-4 md:grid-cols-4">
        <Counter value={r.won > 0 ? <Money units={r.won} /> : "0"} label={`won in ${r.wins} ${r.wins === 1 ? "competition" : "competitions"}`} />
        <Counter value={r.shares > 0 ? <Money units={r.shares} /> : "0"} label="shares claimed" />
        <Counter value={r.entered.length} label="entered" />
        <Counter value={r.hosted.length} label="hosted" />
      </Card>
      {r.entered.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-rule">
          <table className="w-full text-sm">
            <THead>
              <TH>Entered</TH>
              <TH>Status</TH>
              <TH className="text-right">Rank</TH>
              <TH className="text-right">Accuracy</TH>
              <TH className="text-right">Won</TH>
            </THead>
            <tbody>
              {r.entered.map((e) => {
                const [label, tone] = stage(e.status);
                return (
                  <tr key={e.id} className={ROW}>
                    <TD><Link href={`/competitions/${e.id}/entries/${address}`} title={e.title} className="block max-w-64 truncate text-ink underline decoration-subtle underline-offset-4">{e.title}</Link></TD>
                    <TD><Pill tone={tone}>{label}</Pill></TD>
                    <TD className="text-right tabular text-ink">{e.rank ? `${e.rank} of ${e.entries}` : <Null>{e.state === "scored" ? "Scored" : "Not scored"}</Null>}</TD>
                    <TD className="text-right font-mono tabular text-ink">{e.score !== null ? `${((e.score / e.items) * 100).toFixed(1)}%` : <Null>-</Null>}</TD>
                    <TD className="text-right">{e.won > 0 ? <Money units={e.won} /> : e.share > 0 ? <span className="inline-flex items-center gap-1"><Money units={e.share} /><span className="text-xs text-muted">share</span></span> : <Null>-</Null>}</TD>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {r.hosted.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-rule">
          <table className="w-full text-sm">
            <THead>
              <TH>Hosted</TH>
              <TH>Status</TH>
              <TH className="text-right">Entries</TH>
              <TH className="text-right">Prize</TH>
            </THead>
            <tbody>
              {r.hosted.map((h) => {
                const [label, tone] = stage(h.status);
                return (
                  <tr key={h.id} className={ROW}>
                    <TD><Link href={`/competitions/${h.id}`} title={h.title} className="block max-w-64 truncate text-ink underline decoration-subtle underline-offset-4">{h.title}</Link></TD>
                    <TD><Pill tone={tone}>{label}</Pill></TD>
                    <TD className="text-right tabular text-ink">{h.entries}</TD>
                    <TD className="text-right"><Money units={h.prize} />{h.refunded > 0 && <span className="ml-1 text-xs text-muted">refunded</span>}</TD>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
