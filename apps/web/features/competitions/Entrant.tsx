"use client";
// One entrant's entry in one competition: rank, accuracy per class, the confusion matrix, their commits and their notebook.
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Download, RotateCw, Trophy, UserRound } from "lucide-react";
import { AddressChip, Button, ButtonLink, Crumbs, EmptyState, Eyebrow, HashChip, KpiCard, PageHeader, Pill, Skeleton, cx, short } from "@/components/primitives";
import { ApiError } from "@/lib/api/client";
import { useCompetitionEntry } from "@/lib/api/hooks";
import type { CompetitionEntry, EntryBreakdown } from "@/lib/api/types";
import { CLASSES, ITEMS, labelBytes, predictionBytes, scoreOf, seedOf, type Competition } from "@/lib/learn/competition";
import { useCompetition } from "./model";
import { EntrantNotebook } from "./Notebooks";

const MATRIX_MAX = 20;
const pct = (n: number, of: number) => (of === 0 ? "-" : `${((n / of) * 100).toFixed(1)}%`);
const at = (unix: number | null | undefined) =>
  unix ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(new Date(unix * 1000)) + " UTC" : null;

/** The same per-class counts the coordinator sends, for demo examples whose labels the browser can rebuild. */
export function breakdownOf(labels: Uint8Array, preds: Uint8Array): EntryBreakdown {
  const per = new Map<number, [number, number]>();
  const cells = new Map<string, number>();
  labels.forEach((t, i) => {
    const p = preds[i];
    const row = per.get(t) ?? [0, 0];
    row[0]++;
    if (t === p) row[1]++;
    per.set(t, row);
    const k = `${t}:${p}`;
    cells.set(k, cells.has(k) ? cells.get(k)! + 1 : 1);
  });
  const classes = [...new Set([...labels, ...preds])].sort((a, b) => a - b);
  const perClass = [...per.entries()].sort(([a], [b]) => a - b).map(([label, [count, correct]]) => ({ label, count, correct }));
  return {
    correct: perClass.reduce((s, r) => s + r.correct, 0), items: labels.length, classes, perClass,
    confusion: classes.length <= MATRIX_MAX ? [...cells.entries()].map(([k, count]) => { const [label, predicted] = k.split(":").map(Number); return { label, predicted, count }; }) : null,
  };
}

/** A demo example's entry, worked out in the browser from its seeded labels and predictions. */
function demoEntry(c: Competition, who: string): CompetitionEntry {
  const ranked = [...c.entries].map((e) => ({ e, s: scoreOf(c, e) })).sort((a, b) => b.s - a.s);
  const i = ranked.findIndex((r) => r.e.op.toLowerCase() === who.toLowerCase());
  const base = { competition: c.id, entrant: who, status: "settled" as const, items: c.items ?? ITEMS, of: c.entries.length, scoredCount: c.status === "finished" ? c.entries.length : 0, predictions: null, unavailable: null };
  if (i < 0) return { ...base, entered: false, breakdown: null };
  const e = ranked[i].e;
  if (c.status !== "finished" || c.labelsSeed === null) return { ...base, entered: true, state: "committed", rank: null, score: null, commits: 1, breakdown: null };
  const labels = labelBytes(seedOf(c));
  const b = breakdownOf(labels, predictionBytes(labels, e.seed, e.skill));
  return { ...base, entered: true, state: "scored", rank: i + 1, tied: false, score: b.correct, commits: 1, breakdown: b };
}

function StateLine({ c, e }: { c: Competition; e: CompetitionEntry }) {
  if (e.state === "scored") return null;
  const text: Record<string, string> = {
    open: "Entries are open. This entry is committed; its predictions stay hidden until the deadline.",
    "awaiting-labels": "Entries are closed. The host is revealing the labels; then each entry is revealed and scored.",
    scoring: "The labels are out. This entry hasn't been revealed yet, so it has no score.",
    "ready-to-settle": "The reveal window closed before this entry was revealed, so it wasn't scored.",
    settled: "This entry was never revealed, so it wasn't scored.",
    "labels-hidden": "The host never revealed the labels, so nothing was scored. Each entrant can claim an equal share of the prize.",
    refundable: "Nothing was scored.",
  };
  return <p className="rounded-xl border border-rule bg-band px-4 py-3 text-sm text-muted">{text[c.stage ?? e.status] ?? "This entry has no score yet."}</p>;
}

const nameOf = (names: string[] | undefined, l: number) => names?.[l] || String(l);

function PerClass({ b, names }: { b: EntryBreakdown; names?: string[] }) {
  return (
    <section aria-label="Accuracy per class" className="flex flex-col gap-3">
      <Eyebrow>Accuracy per class</Eyebrow>
      <ul className="flex flex-col gap-1.5">
        {b.perClass.map((r) => {
          const v = r.count === 0 ? 0 : r.correct / r.count;
          return (
            <li key={r.label} className="grid grid-cols-12 items-center gap-3 text-xs">
              <span title={nameOf(names, r.label)} className="col-span-2 truncate font-mono text-muted sm:col-span-1">{nameOf(names, r.label)}</span>
              <span className="col-span-6 h-2 overflow-hidden rounded-full bg-band sm:col-span-8" role="img" aria-label={`Class ${nameOf(names, r.label)}: ${pct(r.correct, r.count)}`}>
                <span className="block h-full rounded-full bg-brand" style={{ width: `${v * 100}%` }} />
              </span>
              <span className="col-span-4 text-right font-mono tabular text-ink sm:col-span-3">{pct(r.correct, r.count)} <span className="text-muted">of {r.count.toLocaleString()}</span></span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Confusion({ b, names }: { b: EntryBreakdown; names?: string[] }) {
  if (!b.confusion) return <p className="text-xs text-muted">{b.classes.length} classes is too many for a confusion matrix; per-class accuracy is above.</p>;
  const n = new Map(b.confusion.map((x) => [`${x.label}:${x.predicted}`, x.count]));
  const truth = b.perClass.map((r) => r.label);
  const rowMax = new Map(b.perClass.map((r) => [r.label, r.count]));
  return (
    <section aria-label="Confusion matrix" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Eyebrow>Confusion matrix</Eyebrow>
        <span className="text-xs text-muted">Rows are the true label, columns what this entry predicted</span>
      </div>
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-0.5 font-mono text-xs tabular">
          <thead>
            <tr><th className="p-1" /><>{b.classes.map((p) => <th key={p} scope="col" title={nameOf(names, p)} className="max-w-8 truncate p-1 text-center font-normal text-muted">{nameOf(names, p)}</th>)}</></tr>
          </thead>
          <tbody>
            {truth.map((t) => (
              <tr key={t}>
                <th scope="row" title={nameOf(names, t)} className="max-w-24 truncate p-1 pr-2 text-right font-normal text-muted">{nameOf(names, t)}</th>
                {b.classes.map((p) => {
                  const v = n.get(`${t}:${p}`) ?? null;
                  const share = v === null ? 0 : v / (rowMax.get(t) || 1);
                  return (
                    <td key={p} title={`true ${t}, predicted ${p}: ${v === null ? "none" : v}`} className="relative size-8 min-w-8 rounded-xs bg-band p-0 text-center align-middle">
                      <span aria-hidden className={cx("absolute inset-0 rounded-xs", t === p ? "bg-brand" : "bg-danger")} style={{ opacity: share * 0.85 }} />
                      <span className={cx("relative", share > 0.5 ? "text-accent-ink" : "text-ink")}>{v ?? ""}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function savePredictions(e: CompetitionEntry) {
  if (!e.predictions) return;
  const hex = e.predictions.slice(2);
  const bytes = Uint8Array.from({ length: hex.length / 2 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
  Object.assign(document.createElement("a"), { href: url, download: `competition-${e.competition}-${e.entrant.slice(0, 10)}.bin` }).click();
  URL.revokeObjectURL(url);
}

function Timeline({ e }: { e: CompetitionEntry }) {
  const rows = [
    ["Entered", at(e.enteredAt)],
    (e.commits ?? 1) > 1 ? [`Replaced ${(e.commits ?? 1) - 1} ${(e.commits ?? 1) === 2 ? "time" : "times"}, last`, at(e.lastCommitAt)] : null,
    ["Revealed and scored", at(e.scoredAt)],
  ].filter((r): r is [string, string | null] => r !== null);
  return (
    <dl className="flex flex-col gap-2.5 rounded-xl border border-rule p-4 text-sm">
      {rows.map(([k, v]) => <div key={k} className="flex justify-between gap-3"><dt className="text-muted">{k}</dt><dd className="text-right text-ink">{v ?? <span className="text-xs text-subtle">Not yet</span>}</dd></div>)}
      {e.revealTx && <div className="flex items-center justify-between gap-3"><dt className="text-muted">Reveal transaction</dt><dd><HashChip value={e.revealTx} label="reveal transaction" /></dd></div>}
    </dl>
  );
}

export function EntrantPage({ id, who }: { id: string; who: string }) {
  const { c, w, state, retry } = useCompetition(id);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const live = !!c?.live;
  const q = useCompetitionEntry(id, who, live && /^0x[0-9a-fA-F]{40}$/.test(who));
  const demo = useMemo(() => (c && !c.live ? demoEntry(c, who) : null), [c, who]);
  const e = live ? q.data?.data ?? null : demo;
  const you = mounted ? w.address : null;
  const mine = !!you && you.toLowerCase() === who.toLowerCase();

  if (!/^0x[0-9a-fA-F]{40}$/.test(who)) {
    return <EmptyState icon={UserRound} title="That isn't an address" action={<Link href={`/competitions/${id}`} className="text-sm text-ink underline decoration-subtle underline-offset-4">Back to the competition</Link>}>Entrant pages are at /competitions/{id}/entries/0x followed by 40 hex characters.</EmptyState>;
  }
  if (!c) {
    if (!mounted || state === "loading") return <div className="flex flex-col gap-3 px-4 py-6 md:px-6"><Skeleton className="h-6 w-56" /><Skeleton className="h-24 w-full" /></div>;
    if (state === "error") return <EmptyState icon={Trophy} title="Couldn't read this competition" action={<Button variant="secondary" icon={RotateCw} onClick={retry}>Try again</Button>}>The coordinator didn&apos;t answer. Try again in a moment.</EmptyState>;
    return <EmptyState icon={Trophy} title="No competition with that id" action={<Link href="/competitions" className="text-sm text-ink underline decoration-subtle underline-offset-4">All competitions</Link>} />;
  }

  const crumbs = <Crumbs items={[{ href: "/competitions", label: "competitions" }, { href: `/competitions/${c.id}`, label: <span title={c.title} className="block max-w-40 truncate sm:max-w-xs">{c.title}</span> }, { label: short(who), mono: true }]} />;
  const loading = live && q.isPending;
  const failed = live && q.isError && !q.data;

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader title={crumbs}>
        <ButtonLink href={`/u/${who}`} variant="secondary" icon={UserRound}>{mine ? "Your record" : "Their record"}</ButtonLink>
      </PageHeader>
      <div className="flex flex-col gap-8 px-4 py-6 md:px-6 lg:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-8">
          <header className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <AddressChip value={who} href={`/u/${who}`} you={mine} />
              {e?.rank === 1 && c.status === "finished" && <Pill tone="brand">Best score</Pill>}
              {e?.tied && <Pill tone="neutral">Tie</Pill>}
            </div>
            <h1 className="break-words text-xl font-medium text-ink">{mine ? "Your entry" : "Entry"} in {c.title}</h1>
          </header>

          {loading && <div className="grid gap-3 sm:grid-cols-3"><Skeleton className="h-32" /><Skeleton className="h-32" /><Skeleton className="h-32" /></div>}
          {failed && (
            <EmptyState icon={Trophy} title={q.error instanceof ApiError && q.error.kind === "off" ? "Entries aren't readable on this network" : "Couldn't read this entry"} action={<Button variant="secondary" icon={RotateCw} onClick={() => void q.refetch()}>Try again</Button>}>
              The coordinator reads entries from the Competitions contract. It didn&apos;t answer this time.
            </EmptyState>
          )}
          {e && !e.entered && (
            <EmptyState icon={UserRound} title={mine ? "You haven't entered" : "Not an entrant"} action={<Link href={`/competitions/${c.id}`} className="text-sm text-ink underline decoration-subtle underline-offset-4">Back to the competition</Link>}>
              {short(who)} has no entry in this competition.
            </EmptyState>
          )}
          {e && e.entered && (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <KpiCard label="Rank" value={e.rank ? `${e.rank}` : "-"} sub={e.rank ? `of ${e.scoredCount} scored${e.of > e.scoredCount ? `, ${e.of} entered` : ""}` : `${e.of} entered`} />
                <KpiCard label="Accuracy" value={e.score !== null && e.score !== undefined ? pct(e.score, e.items) : "-"} sub={e.score !== null && e.score !== undefined ? `${e.score.toLocaleString()} of ${e.items.toLocaleString()} items right` : "Not scored"} />
                <KpiCard label="Commits" value={`${e.commits ?? 1}`} sub={(e.commits ?? 1) > 1 ? "The last one counts" : "Never replaced"} />
              </div>
              <StateLine c={c} e={e} />
              {e.unavailable && <p className="text-sm text-muted">{e.unavailable}</p>}
              {e.breakdown && <PerClass b={e.breakdown} names={c.settings?.classNames} />}
              {e.breakdown && <Confusion b={e.breakdown} names={c.settings?.classNames} />}
              <EntrantNotebook c={c} who={who} you={you} />
            </>
          )}
        </div>
        {e && e.entered && (
          <aside className="flex shrink-0 flex-col gap-4 lg:w-80">
            {live && <Timeline e={e} />}
            {e.predictions && (
              <div className="flex flex-col gap-2 rounded-xl border border-rule p-4">
                <p className="text-sm text-ink">Revealed predictions</p>
                <p className="text-xs text-muted">The exact bytes this entry was scored on, one per item, read from its reveal transaction.</p>
                <Button variant="secondary" icon={Download} onClick={() => savePredictions(e)}>Download {e.items.toLocaleString()} predictions</Button>
              </div>
            )}
            {!live && <p className="text-xs text-muted">Example entry: its {CLASSES} classes are rebuilt in your browser from the example&apos;s seed.</p>}
          </aside>
        )}
      </div>
    </div>
  );
}
