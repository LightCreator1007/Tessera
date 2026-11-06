"use client";
// Balance: one balance with two sources (wallet TOD, node earnings) and one sink (job budgets). A ledger of what the laptop earned and what the jobs spent, with the claimable balance and its two exits, spend on a job or claim. REVAMP-3 section 3.
import { calls } from "@/lib/chain";
import { ConnectGate } from "@/components/mosaic/ConnectGate";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Coins, Download, ArrowDownLeft, ArrowUpRight, Laptop, LayoutDashboard, Layers, Lock, Plus, Wallet } from "lucide-react";
import { isDemo } from "@/lib/api/client";
import { useNodeChain } from "@/lib/api/hooks";
import { WithdrawButton, WithdrawDialog } from "@/features/balance/Withdraw";
import { Term } from "@/components/term";
import { setWallet, useWallet } from "@/lib/wallet";
import { useTx } from "@/lib/tx";
import { formatToken } from "@/lib/money";
import { openConnect } from "@/components/connect";
import {
  Button, ButtonLink, Card, EmptyState, Eyebrow, KpiCard, Money, Null, PageHeader, Pill, ROW, SectionTitle, TD, TH, THead, TextTabs, cx, relTime, short,
} from "@/components/primitives";

const TOD = 1_000_000;
const DUST = 10_000;
const usdc = (v: number) => Math.round(v * TOD);
type Kind = "payout" | "budget" | "claim" | "refund";
type Movement = { key: string; at: number; kind: Kind; amount: number; fromEarnings?: number; job?: number; round?: number; note: string };

/** Demo history for the demo wallet, shaped like the JobMarket events an indexer will read (RoundFinalized pay, JobCreated with fromBalance, Claimed, RefundWithdrawn). */
function demoHistory(now: number): Movement[] {
  const d = (days: number) => now - days * 86400;
  const pay = [4.2, 3.8, 5.1, 2.9, 4.6, 3.3, 4.1, 3.5, 4.9];
  return [
    ...pay.map((a, i) => ({ key: `p${i}`, at: d(8.5 - i * 0.9), kind: "payout" as const, amount: usdc(a), job: i < 5 ? 7 : 6, round: i < 5 ? i + 2 : i - 3, note: "Round paid your node" })),
    { key: "b3", at: d(9), kind: "budget", amount: usdc(90), fromEarnings: 0, job: 3, note: "Posted cnn-torch #3" },
    { key: "c1", at: d(6.2), kind: "claim", amount: usdc(6), note: "Claimed to wallet" },
    { key: "b4", at: d(5), kind: "budget", amount: usdc(60), fromEarnings: usdc(18), job: 4, note: "Posted mlp-exact #4" },
    { key: "r3", at: d(2.5), kind: "refund", amount: usdc(61.2), job: 3, note: "Refund for rounds that never opened" },
  ];
}

const KIND: Record<Kind, { label: string; tone: "ok" | "neutral" | "pending" | "brand"; dir: "in" | "out" }> = {
  payout: { label: "Earned", tone: "ok", dir: "in" },
  refund: { label: "Refund", tone: "pending", dir: "in" },
  budget: { label: "Job budget", tone: "neutral", dir: "out" },
  claim: { label: "Claimed", tone: "brand", dir: "out" },
};

/** The balance as one set of numbers, shared by this page and home so both say the same thing. */
export function useLedger() {
  const w = useWallet();
  const [now] = useState(() => Date.now() / 1000);
  const rows = useMemo<Movement[]>(() => {
    const local: Movement[] = [
      ...w.postedJobs.map((p) => ({ key: `pj${p.id}`, at: p.postedAt / 1000, kind: "budget" as const, amount: p.budget, fromEarnings: p.fromEarnings ?? 0, job: p.id, note: `Posted ${p.workload} #${p.id}` })), // rails-allow: jobs posted before the split existed were paid fully from the wallet
      ...w.claims.map((c, i) => ({ key: `lc${i}`, at: c.at / 1000, kind: "claim" as const, amount: c.amount, note: "Claimed to wallet" })),
    ];
    return [...(isDemo ? demoHistory(now) : []), ...local].sort((a, b) => b.at - a.at);
  }, [w.postedJobs, w.claims, now]);
  const sum = (k: Kind) => rows.filter((r) => r.kind === k).reduce((s, r) => s + r.amount, 0);
  const spent = sum("budget");
  const recycled = rows.reduce((s, r) => s + (r.fromEarnings ?? 0), 0); // rails-allow: no split recorded means nothing came from earnings
  return { now, rows, earned: sum("payout"), spent, recycled, claimed: sum("claim"), refunds: sum("refund"), share: spent > 0 ? recycled / spent : null };
}

export function Overview() {
  const w = useWallet();
  const claim = useTx({ revertAs: "NothingToClaim" });
  const [filter, setFilter] = useState<"all" | "in" | "out">("all");
  const [withdrawing, setWithdrawing] = useState(false);
  const [dust, setDust] = useState(false);
  const { now, rows, earned, spent, recycled, claimed, share } = useLedger();
  const op = w.node?.operator ?? "";
  const chain = useNodeChain(op, Boolean(w.node?.joined));
  const penalties = chain.data?.data.penalties ?? null;
  const forfeited = penalties === null ? null : penalties.some((p) => p.amount === null) ? null : penalties.reduce((s, p) => s + (p.amount as number), 0);

  if (!w.connected) {
    return (
      <div className="flex min-h-full flex-col">
        <PageHeader icon={Coins} title="balance" heading="Balance" />
        <ConnectGate title="Connect to see your balance">
          Your balance has two sources, the TOD in your wallet and what your node earns, and it pays for training jobs. Connect to see every movement in one ledger.
        </ConnectGate>
        <div className="mx-auto grid w-full max-w-2xl gap-3 px-4 pb-10 sm:grid-cols-2">
          <EntryCard href="/jobs/new" icon={Layers} title="Train a model" hint="Lock a budget; idle laptops train it" />
          <EntryCard href="/nodes/add" icon={Laptop} title="Add your laptop" hint="Its earnings pay for your jobs" />
        </div>
      </div>
    );
  }

  const matching = rows.filter((r) => filter === "all" || KIND[r.kind].dir === filter);
  const small = matching.filter((r) => r.amount < DUST);
  const shown = dust ? matching : matching.filter((r) => r.amount >= DUST);

  return (
    <div className="flex min-h-full flex-col pb-10">
      <PageHeader icon={Coins} title="balance" heading="Balance" meta={w.address && <span className="font-mono text-xs text-subtle">{short(w.address)}</span>}>
        <ButtonLink href="/jobs/new" variant="primary" icon={Plus} className="md:hidden">New job</ButtonLink>
      </PageHeader>

      <div className="flex flex-col gap-4 px-4 py-5 md:px-6">
        <Card className="flex flex-col gap-5 p-4 md:p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted">Earned, not yet moved</span>
              <span className="text-2xl font-medium text-ink"><Money units={w.claimable} live /></span>
              <span className="max-w-md text-sm text-muted">
                {w.claimable > 0 ? "Paid by rounds your laptop trained. It sits in the contract: spend it on a job with no approve step, or withdraw it to your wallet." : earned > 0 ? "All of it has been spent or claimed. New round pay lands here." : "Nothing earned yet. Rent your laptop and round pay lands here."}
              </span>
            </div>
            <div className="flex flex-wrap items-start gap-2">
              {w.claimable > 0 ? <ButtonLink href="/jobs/new" variant="primary" icon={Layers}>Spend on a job</ButtonLink> : <ButtonLink href="/nodes/add" variant="primary" icon={Laptop}>Add a node</ButtonLink>}
              <WithdrawButton disabled={w.claimable === 0} why="Nothing to withdraw yet" onClick={() => setWithdrawing(true)} />
            </div>
          </div>
          {earned > 0 && <Split earned={earned} recycled={recycled} claimed={claimed} waiting={w.claimable} />}
          {share !== null && recycled > 0 && (
            <p className="border-t border-rule pt-4 text-sm text-ink">
              Your laptop paid for <span className="font-mono text-brand">{Math.round(share * 100)}%</span> of your training.
              <span className="text-muted"> {formatToken(recycled)} TOD of {formatToken(spent)} TOD in budgets came from round pay, not your wallet.</span>
            </p>
          )}
        </Card>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Held" value={w.node ? <Money units={w.node.stake} /> : <Null>No node</Null>} sub={w.node ? <>your node&apos;s <Term k="bond">bond</Term>, slashable</> : "a node's bond sits here"} />
          <KpiCard label="Withdrawable" value={<Money units={w.claimable} />} sub={`${rows.filter((r) => r.kind === "payout").length} paid rounds so far`} />
          <KpiCard label="Spent on your jobs" value={<Money units={recycled} />} sub={share === null ? "no jobs yet" : `${Math.round(share * 100)}% of your budgets`} />
          <KpiCard label="Forfeited" value={!w.node?.joined ? <Null>No node</Null> : forfeited === null ? <Null>{chain.isPending ? "Loading" : "Not reported"}</Null> : <Money units={forfeited} />} sub={penalties && penalties.length > 0 ? <Link href={`/jobs/${penalties[0].job}/rounds/${penalties[0].round}`} className="underline decoration-subtle underline-offset-4 hover:text-ink">latest: job #{penalties[0].job}, round {penalties[0].round}</Link> : "slashes and missed reveals"} loading={chain.isPending && Boolean(w.node?.joined)} />
        </div>

        {earned === 0 && spent > 0 && <Invite href="/nodes/add" icon={Laptop} title="Pay for the next job with your laptop" hint="Add it as a node; round pay funds your next budget." />}
        {spent === 0 && earned > 0 && <Invite href="/jobs/new" icon={Layers} title="Train something with what you earned" hint={`${formatToken(w.claimable)} TOD is ready to use as a job budget.`} />}

        <section className="flex flex-col gap-3">
          <SectionTitle title="Movements" sub={isDemo ? "demo history plus anything you did in this browser" : "from this browser; full history needs the indexer"}>
            <span className="flex items-center gap-3">
              <TextTabs label="Filter movements" value={filter} onChange={setFilter} items={[{ key: "all", label: "All", count: rows.length }, { key: "in", label: "In" }, { key: "out", label: "Out" }]} />
              <Button variant="ghost" icon={Download} onClick={() => exportCsv(rows)} disabled={rows.length === 0}>CSV</Button>
            </span>
          </SectionTitle>
          {shown.length === 0 ? (
            <Card><EmptyState icon={LayoutDashboard} title="No movements yet">Round pay, job budgets, claims and refunds for this wallet show up here.</EmptyState></Card>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-rule">
              <table className="w-full min-w-table text-sm">
                <THead><TH>When</TH><TH>What</TH><TH>For</TH><TH className="text-right">Amount</TH></THead>
                <tbody>
                  {shown.map((r) => {
                    const k = KIND[r.kind];
                    return (
                      <tr key={r.key} className={ROW}>
                        <TD className="whitespace-nowrap font-mono text-xs text-muted">{relTime(r.at, now)}</TD>
                        <TD>
                          <span className="flex items-center gap-2">
                            {k.dir === "in" ? <ArrowDownLeft className="size-4 text-ok" strokeWidth={1.5} aria-label="in" /> : <ArrowUpRight className="size-4 text-muted" strokeWidth={1.5} aria-label="out" />}
                            <Pill tone={k.tone}>{k.label}</Pill>
                            {!!r.fromEarnings && <Pill tone="brand">{formatToken(r.fromEarnings)} from earnings</Pill>}
                          </span>
                        </TD>
                        <TD>
                          <span className="flex flex-col">
                            <span className="text-ink">{r.note}</span>
                            {r.job !== undefined && (
                              <Link href={r.round ? `/jobs/${r.job}/rounds/${r.round}` : `/jobs/${r.job}`} className="relative z-10 w-fit font-mono text-xs text-subtle hover:text-ink hover:underline">
                                job #{r.job}{r.round ? ` · round ${r.round}` : ""}
                              </Link>
                            )}
                          </span>
                        </TD>
                        <TD className={cx("whitespace-nowrap text-right", k.dir === "in" ? "text-ok" : "text-ink")}>
                          {k.dir === "in" ? "+" : "-"}<Money units={r.amount} />
                        </TD>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {small.length > 0 && (
            <button type="button" onClick={() => setDust((d) => !d)} className="self-start text-xs text-muted underline decoration-subtle underline-offset-4 hover:text-ink">
              {dust ? "Hide small amounts" : `Show ${small.length} small amount${small.length === 1 ? "" : "s"} under ${formatToken(DUST)} TOD`}
            </button>
          )}
        </section>
        {w.address && (
          <WithdrawDialog
            open={withdrawing}
            onClose={() => setWithdrawing(false)}
            amount={w.claimable}
            to={w.address}
            bond={w.node?.stake ?? null}
            tx={claim}
            onExport={() => exportCsv(rows)}
            onConfirm={() => claim.send(calls.claim, () => setWallet((x) => ({ usdc: x.usdc + x.claimable, claimable: 0, claims: [...x.claims, { amount: x.claimable, at: Date.now() }] })))}
          />
        )}
      </div>
    </div>
  );
}

/** Where the earnings went, as one segmented 8px bar: recycled into jobs, claimed out, still waiting. */
function Split({ earned, recycled, claimed, waiting }: { earned: number; recycled: number; claimed: number; waiting: number }) {
  const parts = [
    { key: "recycled", label: "spent on your jobs", v: recycled, cls: "bg-brand" },
    { key: "claimed", label: "claimed to wallet", v: claimed, cls: "bg-ink" },
    { key: "waiting", label: "waiting", v: waiting, cls: "bg-rule-strong" },
  ];
  const total = Math.max(earned, recycled + claimed + waiting);
  return (
    <div className="flex flex-col gap-2">
      <Eyebrow>where {formatToken(earned)} usdc of round pay went</Eyebrow>
      <div className="flex h-2 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={parts.map((p) => `${formatToken(p.v)} ${p.label}`).join(", ")}>
        {parts.filter((p) => p.v > 0).map((p) => <span key={p.key} className={cx("h-full", p.cls)} style={{ width: `${(p.v / total) * 100}%` }} />)}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {parts.map((p) => <li key={p.key} className="flex items-center gap-1.5"><span className={cx("size-2 rounded-xs", p.cls)} aria-hidden /><span className="font-mono text-ink">{formatToken(p.v)}</span> {p.label}</li>)}
      </ul>
    </div>
  );
}

function EntryCard({ href, icon: Icon, title, hint }: { href: string; icon: typeof Laptop; title: string; hint: string }) {
  return (
    <Link href={href} className="flex items-center gap-3 rounded-xl border border-rule p-4 transition-colors duration-150 hover:bg-hover">
      <span className="inline-flex size-9 items-center justify-center rounded-lg bg-band"><Icon className="size-4 text-muted" strokeWidth={1.5} aria-hidden /></span>
      <span className="flex flex-col"><span className="text-sm text-ink">{title}</span><span className="text-xs text-muted">{hint}</span></span>
    </Link>
  );
}

function Invite({ href, icon: Icon, title, hint }: { href: string; icon: typeof Laptop; title: string; hint: string }) {
  return (
    <Link href={href} className="flex items-center gap-3 rounded-xl border border-brand-line bg-brand-soft px-4 py-3 transition-opacity duration-150 hover:opacity-90">
      <Icon className="size-4 text-brand" strokeWidth={1.5} aria-hidden />
      <span className="flex min-w-0 flex-col"><span className="text-sm text-ink">{title}</span><span className="text-xs text-muted">{hint}</span></span>
      <ArrowUpRight className="ml-auto size-4 text-muted" aria-hidden />
    </Link>
  );
}

function exportCsv(rows: Movement[]) {
  const head = "date,type,amount_usdc,from_earnings_usdc,job,round,note";
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = rows.map((r) => [new Date(r.at * 1000).toISOString(), KIND[r.kind].label, (KIND[r.kind].dir === "in" ? "" : "-") + formatToken(r.amount), r.fromEarnings ? formatToken(r.fromEarnings) : "", r.job ?? "", r.round ?? "", esc(r.note)].join(","));
  const url = URL.createObjectURL(new Blob([[head, ...lines].join("\n")], { type: "text/csv" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: "tod-ledger.csv" });
  a.click();
  URL.revokeObjectURL(url);
}
