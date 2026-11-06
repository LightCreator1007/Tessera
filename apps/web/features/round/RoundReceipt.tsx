"use client";
// Round receipt in the Neatlogs trace-detail language: a span tree of the five phases (commit, reveal, replay, verify, pay), each expandable to its nodes or verifiers, plus roster and evidence tabs and a Properties rail. Shared by the drawer and the full page.
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { CheckCheck, ChevronsDownUp, ChevronsUpDown, Coins, ExternalLink, Eye, Lock, Minus, Plus, Receipt, ScanSearch, Scale } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useConfig, useEvidence, useRound, useSettlement, useVerdicts } from "@/lib/api/hooks";
import { useWallet } from "@/lib/wallet";
import type { Round, RoundVerdicts } from "@/lib/api/types";
import { Drawer } from "@/components/drawer";
import { NodeVerdict, type NodeResult } from "@/features/verify/NodeVerdict";
import { ReVerify, type Progress } from "@/features/verify/ReVerify";
import { sha256 } from "@/lib/learn/replay";
import { ReceiptHero } from "@/components/mosaic/ReceiptHero";
import { formatToken } from "@/lib/money";
import {
  AddressChip, Banner, Card, Crumbs, DocsLink, EmptyState, Eyebrow, HashChip, Money, Null, PageHeader, PhaseStrip, Pill, PropRow, PropsRail, ROW, RoundStatusPill, Skeleton, TD, TH, THead, TextTabs, TrustLabel, VerdictCell, cx, short,
} from "@/components/primitives";

export function RoundDrawer({ id, r }: { id: number; r: number }) {
  const router = useRouter();
  return (
    <Drawer
      onClose={() => router.back()}
      title={
        <div className="flex items-center gap-2.5">
          <Receipt className="size-4 text-muted" strokeWidth={1.5} aria-hidden />
          <span className="text-sm text-ink">Round {r}</span>
          <span className="font-mono text-xs text-subtle">job #{id}</span>
        </div>
      }
      footer={
        <a href={`/jobs/${id}/rounds/${r}`} className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-ink">
          Open as page <ExternalLink className="size-3.5" aria-hidden />
        </a>
      }
    >
      <RoundReceipt id={id} r={r} drawer />
    </Drawer>
  );
}

export function RoundPage({ id, r }: { id: number; r: number }) {
  const round = useRound(id, r);
  const cfg = useConfig();
  const settlement = useSettlement(id, r);
  const rd = round.data?.data;
  const st = settlement.data?.data;
  return (
    <div className="flex min-h-full flex-col">
      <PageHeader title={<Crumbs items={[{ href: "/jobs", label: "jobs" }, { href: `/jobs/${id}`, label: `job #${id}` }, { label: `round ${r}` }]} />} heading={`Round ${r} of job #${id}`} meta={rd && <RoundStatusPill status={rd.status} />}>
        <DocsLink href="/docs/how-it-works">How a round is checked</DocsLink>
      </PageHeader>
      <div className="grid flex-1 xl:grid-detail">
        <div className="min-w-0 px-4 py-6 md:px-6">
          <RoundReceipt id={id} r={r} />
        </div>
        <PropsRail>
          <PropRow label="Status">{rd ? <RoundStatusPill status={rd.status} /> : <Skeleton className="h-6 w-20" />}</PropRow>
          <PropRow label="Outcome">{rd?.outcome ?? <Null>Not settled</Null>}</PropRow>
          <PropRow label="Source">{rd ? <TrustLabel trust={rd.trust} /> : <Null />}</PropRow>
          <PropRow label="Verifiers">{cfg.data ? <span className="font-mono text-xs">{cfg.data.data.threshold} of {cfg.data.data.verifiers.length} to pay</span> : <Null />}</PropRow>
          <PropRow label="Co-signed">
            {st && cfg.data
              ? <span className={`font-mono text-xs ${st.collected >= cfg.data.data.threshold ? "text-ok" : "text-ink"}`}>{st.collected} of {cfg.data.data.threshold} signatures</span>
              : <Null>{settlement.isPending ? "Loading" : "Not posted yet"}</Null>}
          </PropRow>
          <PropRow label="Seed"><HashChip value={rd?.seed ?? null} label="seed" /></PropRow>
          <PropRow label="Start weights"><HashChip value={rd?.startHash ?? null} label="start hash" /></PropRow>
          <PropRow label="Aggregate"><HashChip value={rd?.aggregateHash ?? null} label="aggregate" /></PropRow>
        </PropsRail>
      </div>
    </div>
  );
}

type Tab = "timeline" | "roster" | "evidence";

export function RoundReceipt({ id, r, drawer }: { id: number; r: number; drawer?: boolean }) {
  const round = useRound(id, r);
  const ver = useVerdicts(id, r);
  const cfg = useConfig();
  const myOp = useWallet().node?.operator?.toLowerCase() ?? null;
  const [tab, setTab] = useState<Tab>("timeline");

  if (round.isPending) return <div className="flex flex-col gap-3"><Skeleton className="h-6 w-full" /><Skeleton className="h-64 w-full rounded-xl" /></div>;
  if (round.isError) return <EmptyState icon={Receipt} title={`Round ${r} doesn't exist yet`}>Job #{id} hasn&apos;t opened this round.</EmptyState>;

  const rd = round.data.data;
  const verdicts = ver.data?.data ?? [];
  const passes = verdicts.filter((v) => v.verdict === "pass").length;
  const fails = verdicts.filter((v) => v.verdict === "fail");
  const threshold = cfg.data?.data.threshold ?? null;
  const disagree = passes > 0 && fails.length > 0;

  return (
    <div className="flex flex-col gap-5">
      <Outcome rd={rd} verdicts={verdicts} />
      <PhaseStrip status={rd.status} />
      {disagree && <Banner tone="danger" title="Verifiers disagree">One passed this round and one reported a failure. Pay waits for {threshold ?? "the threshold of"} matching verdicts or the fallback window.</Banner>}
      {myOp && rd.roster.some((s) => s.op.toLowerCase() === myOp) && (
        <Card className="p-4"><MyVerdict id={id} r={r} rd={rd} verdicts={verdicts} op={myOp} replayHref={drawer ? `/jobs/${id}/rounds/${r}` : undefined} /></Card>
      )}
      <TextTabs<Tab>
        label="Receipt sections"
        value={tab}
        onChange={setTab}
        items={[{ key: "timeline", label: "Timeline" }, { key: "roster", label: "Roster", count: rd.roster.length }, { key: "evidence", label: "Evidence" }]}
      />
      {tab === "timeline" && <SpanTree rd={rd} verdicts={verdicts} loadingVerdicts={ver.isPending} threshold={threshold} />}
      {tab === "roster" && <Roster rd={rd} verdicts={verdicts} />}
      {tab === "evidence" && <EvidenceList id={id} r={r} />}
    </div>
  );
}

/** The settled outcome as a receipt: the amount (or the outcome word) as the poster, the written account beside it. Open rounds have none. */
function Outcome({ rd, verdicts }: { rd: Round; verdicts: RoundVerdicts }) {
  const total = rd.payouts.reduce((a, p) => a + p.amount, 0);
  const paid = formatToken(Math.round(total));
  const verdictLine = verdicts.length ? verdicts.map((v, k) => `${k ? "b" : "a"} ${v.verdict}`).join(" · ") : "none reported";
  const caught = verdicts.find((v) => v.target)?.target;
  const proof: [string, ReactNode][] = [
    ["Verdicts", verdictLine],
    ["Seed", rd.seed ? short(rd.seed) : "not reported"],
    ["Aggregate", rd.aggregateHash ? short(rd.aggregateHash) : "none"],
  ];
  if (rd.status === "finalized" || rd.status === "fallback") {
    const fb = rd.status === "fallback";
    return (
      <ReceiptHero
        word={`+${paid === null ? "0" : paid}`}
        tone="ok"
        head={fb ? "Paid by fallback · TOD" : "Accepted · TOD"}
        label={`Round ${rd.round} paid ${paid === null ? "an unreported amount" : `${paid} TOD`}`}
        body={fb
          ? <>Only one verifier reported before the window closed, so the round paid on the fallback rule. {rd.payouts.length} nodes shared {paid === null ? "the round's pay" : `${paid} TOD`}. The missing verifier earns nothing for this round.</>
          : <>Both verifiers replayed a random slice of every update and it matched. {rd.payouts.length} nodes shared {paid === null ? "the round's pay" : `${paid} TOD`} by contribution. The next round starts from this aggregate.</>}
        rows={[["Paid to", `${rd.payouts.length} nodes`], ...proof]}
      />
    );
  }
  if (rd.status === "reverted") {
    return (
      <ReceiptHero
        word="SLASHED"
        tone="fail"
        head="Reverted · nothing paid"
        label={`Round ${rd.round} reverted`}
        body={<>{caught ? <span className="font-mono">{short(caught)}</span> : "One node"}&apos;s update did not match the replay, and both verifiers reported it. The round paid nothing and that node&apos;s stake was slashed. The next round restarts from the previous weights; the evidence is public below.</>}
        rows={[["Caught", caught ? short(caught) : "not reported"], ...proof]}
      />
    );
  }
  if (rd.status === "voided") {
    return (
      <ReceiptHero
        word="VOID"
        tone="faint"
        head="Voided"
        label={`Round ${rd.round} voided`}
        body="The job was abandoned mid-round. Nobody was paid or slashed for it, and every stake in the round is free to withdraw."
        rows={proof}
      />
    );
  }
  return null;
}

type Span = { key: string; icon: LucideIcon; name: string; kind: string; kindCls: string; meta: ReactNode; right: ReactNode; bad?: boolean; children?: ReactNode };

function SpanTree({ rd, verdicts, loadingVerdicts, threshold }: { rd: Round; verdicts: RoundVerdicts; loadingVerdicts: boolean; threshold: number | null }) {
  const myOp = useWallet().node?.operator?.toLowerCase() ?? null;
  const settled = !["open", "committing", "revealing"].includes(rd.status);
  const slashed = verdicts.find((v) => v.target)?.target;
  const passes = verdicts.filter((v) => v.verdict === "pass").length;
  const fails = verdicts.filter((v) => v.verdict === "fail").length;
  const total = rd.payouts.reduce((s, p) => s + p.amount, 0);
  const node = (op: string) => <AddressChip value={op} href={`/nodes/${op}`} you={op.toLowerCase() === myOp} />;
  const state = (ok: boolean, waiting: boolean, okLabel: string, badLabel: string) => (ok ? <span className="text-ok">{okLabel}</span> : waiting ? <span className="text-muted">waiting</span> : <span className="text-warn">{badLabel}</span>);

  const spans: Span[] = [
    {
      key: "commit", icon: Lock, name: "commit", kind: "Phase", kindCls: "text-pending",
      meta: `${rd.committed.length} of ${rd.roster.length} committed`,
      right: <Mono>{rd.committed.length}/{rd.roster.length}</Mono>,
      children: rd.roster.map((s) => <Leaf key={s.op} left={<><Mono>shard {s.shard}</Mono>{node(s.op)}</>} right={state(rd.committed.includes(s.op), rd.status === "open" || rd.status === "committing", "committed", "no commit")} />),
    },
    {
      key: "reveal", icon: Eye, name: "reveal", kind: "Phase", kindCls: "text-pending",
      meta: `${rd.revealed.length} of ${rd.roster.length} revealed`,
      right: <Mono>{rd.revealed.length}/{rd.roster.length}</Mono>,
      bad: settled && rd.revealed.length < rd.roster.length,
      children: rd.roster.map((s) => <Leaf key={s.op} left={<><Mono>shard {s.shard}</Mono>{node(s.op)}</>} right={state(rd.revealed.includes(s.op), !settled, "revealed", "no reveal, 10% stake")} />),
    },
    {
      key: "replay", icon: ScanSearch, name: "replay", kind: "Verifier", kindCls: "text-demo",
      meta: loadingVerdicts ? "loading verdicts" : `${verdicts.length} verifier${verdicts.length === 1 ? "" : "s"} replayed a random piece`,
      right: <Mono>{passes} pass · {fails} fail</Mono>,
      bad: fails > 0,
      children: verdicts.map((v, i) => (
        <Leaf key={v.verifier} bad={v.verdict === "fail"} left={<><Mono>verifier {String.fromCharCode(65 + i)}</Mono><AddressChip value={v.verifier} />{v.target && <span className="flex items-center gap-1.5 text-xs text-danger">flagged {node(v.target)}</span>}</>} right={<VerdictCell verdict={v.verdict} />} />
      )),
    },
    {
      key: "verify", icon: Scale, name: "verify", kind: "Gate", kindCls: "text-warn",
      meta: threshold === null ? "threshold not loaded" : `${threshold} matching verdicts needed to pay`,
      right: rd.outcome ? <Pill tone={rd.outcome === "Accepted" ? "ok" : "danger"}>{rd.outcome}</Pill> : <Mono>pending</Mono>,
      bad: rd.outcome === "Reverted",
    },
    {
      key: "pay", icon: Coins, name: "pay", kind: "Settle", kindCls: "text-ok",
      meta: total > 0 ? `${rd.payouts.length} node${rd.payouts.length === 1 ? "" : "s"} paid` : rd.status === "reverted" ? "nothing paid, slash shared" : "not paid yet",
      right: total > 0 ? <Money units={total} /> : <Null>none</Null>,
      children: rd.roster.map((s) => {
        const pay = rd.payouts.find((p) => p.op === s.op);
        return <Leaf key={s.op} bad={slashed === s.op} left={node(s.op)} right={slashed === s.op ? <Pill tone="danger">slashed</Pill> : pay ? <Money units={pay.amount} /> : <Null>none</Null>} />;
      }),
    },
  ];
  const expandable = spans.filter((s) => s.children).map((s) => s.key);
  const [open, setOpen] = useState<string[]>(rd.status === "reverted" || fails > 0 ? ["replay", "pay"] : []);
  const all = open.length === expandable.length;

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-rule px-4 py-2.5">
        <Eyebrow>5 phases · {rd.status}</Eyebrow>
        <button type="button" onClick={() => setOpen(all ? [] : expandable)} className="inline-flex items-center gap-1.5 font-mono text-xs uppercase tracking-wide text-muted hover:text-ink">
          {all ? <ChevronsDownUp className="size-3.5" aria-hidden /> : <ChevronsUpDown className="size-3.5" aria-hidden />}
          {all ? "collapse all" : "expand all"}
        </button>
      </div>
      <ol className="relative py-2">
        <span className="absolute bottom-6 left-7 top-6 w-px bg-rule" aria-hidden />
        {spans.map((s) => {
          const isOpen = open.includes(s.key);
          return (
            <li key={s.key} className="relative">
              <div className={cx("flex min-h-11 items-center gap-3 px-4 transition-colors duration-150 hover:bg-hover", s.bad && "text-danger")}>
                {s.children ? (
                  <button type="button" onClick={() => setOpen(isOpen ? open.filter((k) => k !== s.key) : [...open, s.key])} aria-expanded={isOpen} aria-label={`${isOpen ? "Collapse" : "Expand"} ${s.name}`} className="relative z-10 inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-rule bg-surface text-muted hover:text-ink">
                    {isOpen ? <Minus className="size-3" aria-hidden /> : <Plus className="size-3" aria-hidden />}
                  </button>
                ) : (
                  <span className="relative z-10 inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-rule bg-surface text-muted"><CheckCheck className="size-3" aria-hidden /></span>
                )}
                <s.icon className={cx("size-4 shrink-0", s.bad ? "text-danger" : "text-muted")} strokeWidth={1.5} aria-hidden />
                <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2.5">
                  <span className={cx("text-sm", s.bad ? "text-danger" : "text-ink")}>{s.name}</span>
                  <span className={cx("font-mono text-xs uppercase tracking-wide", s.kindCls)}>{s.kind}</span>
                  <span className="truncate font-mono text-xs text-subtle">{s.meta}</span>
                </span>
                <span className="shrink-0 text-right">{s.right}</span>
              </div>
              {isOpen && s.children && <div className="ml-14 mr-4 mb-2 animate-step-in rounded-lg border border-rule">{s.children}</div>}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

function Leaf({ left, right, bad }: { left: ReactNode; right: ReactNode; bad?: boolean }) {
  return (
    <div className={cx("flex min-h-10 items-center justify-between gap-3 border-t border-rule-row px-3 first:border-t-0", bad && "bg-danger-bg")}>
      <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">{left}</span>
      <span className="shrink-0 text-xs">{right}</span>
    </div>
  );
}

function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono text-xs tabular text-muted">{children}</span>;
}

function Roster({ rd, verdicts }: { rd: Round; verdicts: RoundVerdicts }) {
  const myOp = useWallet().node?.operator?.toLowerCase() ?? null;
  const slashed = verdicts.find((v) => v.target)?.target;
  const settled = !["open", "committing", "revealing"].includes(rd.status);
  const total = rd.payouts.reduce((s, p) => s + p.amount, 0);
  return (
    <div className="overflow-hidden rounded-xl border border-rule">
      <table className="w-full text-sm">
        <THead><TH>Shard</TH><TH>Node</TH><TH>Gate</TH><TH className="text-right">Paid</TH></THead>
        <tbody>
          {rd.roster.map((s) => {
            const pay = rd.payouts.find((p) => p.op === s.op);
            const miss = settled && !rd.revealed.includes(s.op);
            return (
              <tr key={s.op} className={ROW}>
                <TD className="font-mono text-xs text-subtle">{s.shard}</TD>
                <TD><AddressChip value={s.op} href={`/nodes/${s.op}`} you={s.op.toLowerCase() === myOp} /></TD>
                <TD>{slashed === s.op ? <Pill tone="danger">Slashed</Pill> : miss ? <Pill tone="warn">No reveal</Pill> : rd.revealed.includes(s.op) ? <Pill tone="ok">Passed</Pill> : <Pill tone="pending">Waiting</Pill>}</TD>
                <TD className="text-right">{pay ? <Money units={pay.amount} /> : <Null>none</Null>}</TD>
              </tr>
            );
          })}
        </tbody>
        {total > 0 && (
          <tfoot className="border-t border-rule bg-band">
            <tr><td colSpan={3} className="h-10 px-4 text-xs text-muted md:px-6">Total paid</td><td className="h-10 px-4 text-right md:px-6"><Money units={total} /></td></tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

function EvidenceList({ id, r }: { id: number; r: number }) {
  const ev = useEvidence(id, r);
  if (ev.isPending) return <Skeleton className="h-24 w-full rounded-xl" />;
  if (!ev.data) return <Null>No evidence.</Null>;
  const rows = [
    { label: "Aggregate blob", ref: ev.data.data.aggregate },
    { label: "Pay table", ref: ev.data.data.pay },
    ...ev.data.data.reports.map((ref, i) => ({ label: `Verifier report ${i + 1}`, ref })),
  ];
  return (
    <Card className="px-4 py-2">
      <p className="py-2 text-xs text-muted">Blobs anyone can fetch and re-hash against the chain.</p>
      <dl className="flex flex-col divide-y divide-rule-row">
        {rows.map((x) => <PropRow key={x.label} label={x.label}>{x.ref ? <HashChip value={x.ref.hash} label={x.label} /> : <Null>Not published yet</Null>}</PropRow>)}
      </dl>
    </Card>
  );
}

const REASON: Record<NodeResult, string> = {
  passed: "Both verifiers replayed a random piece of your node's work and got the weights it revealed, bit for bit.",
  "replay-failed": "Your node's weights didn't match the replay. Usual causes: a different PyTorch build, or the laptop slept mid-round.",
  flagged: "The replay matched, but your update pulled far from the others, so it was left out of the merge.",
  "missed-reveal": "Your node committed but never revealed, so its work couldn't be checked. Two missed reveals bench the node until you re-arm it.",
  "not-audited": "Verifiers haven't reported on this round yet. Nothing is decided.",
  fallback: "Only one verifier reported before the window closed. Pay stays pending until the fallback review settles it.",
};

function MyVerdict({ id, r, rd, verdicts, op, replayHref }: { id: number; r: number; rd: Round; verdicts: RoundVerdicts; op: string; replayHref?: string }) {
  const ev = useEvidence(id, r);
  const settled = !["open", "committing", "revealing"].includes(rd.status);
  const slashed = verdicts.some((v) => v.target?.toLowerCase() === op);
  const pay = rd.payouts.find((p) => p.op.toLowerCase() === op);
  const reported = verdicts.filter((v) => v.verdict === "pass" || v.verdict === "fail");
  const result: NodeResult = slashed ? "replay-failed" : settled && !rd.revealed.some((x) => x.toLowerCase() === op) ? "missed-reveal" : rd.status === "fallback" ? "fallback" : reported.length === 0 ? "not-audited" : "passed";
  const money = slashed ? { kind: "forfeited" as const, units: null } : pay ? { kind: rd.status === "finalized" ? ("held" as const) : ("pending" as const), units: pay.amount } : { kind: "none" as const, units: null };
  const agg = ev.data?.data.aggregate ?? null;
  return (
    <NodeVerdict
      who="Your node"
      result={result}
      segment={null}
      checks={verdicts.map((v, i) => ({ name: `Verifier ${String.fromCharCode(65 + i)}`, result: v.target?.toLowerCase() === op ? "fail" : v.verdict === "fail" && v.target ? "pass" : v.verdict }))}
      reason={REASON[result]}
      money={money}
      evidence={rd.aggregateHash}
      reverify={agg && <ReVerify expected={agg.hash} what="the aggregate" run={(on) => fetchAndHash(agg.url, on)} />}
      replayHref={replayHref}
    />
  );
}

async function fetchAndHash(url: string, on: (p: Progress) => void) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`The evidence blob didn't download (HTTP ${res.status}).`);
  const total = Number(res.headers.get("content-length")) || null;
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    bytes += value.byteLength;
    on({ phase: "download", bytes, total });
  }
  const all = new Uint8Array(bytes);
  let o = 0;
  for (const p of parts) { all.set(p, o); o += p.byteLength; }
  return sha256(all);
}
