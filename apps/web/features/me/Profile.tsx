"use client";
// An address's public record at /u/[address]: its poster, standing, nodes, jobs and competitions, readable by anyone. On your own address an owner strip on top lists only what needs you. /me sends the connected wallet here.
import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, Check, Copy, Settings, UserRound, type LucideIcon } from "lucide-react";
import { ConnectGate } from "@/components/mosaic/ConnectGate";
import { CoverBand } from "@/components/mosaic/CoverBand";
import { PosterCard, PosterThumb, VOCAB_SHORT, useWordField } from "@/components/mosaic/PosterCard";
import { coverById, coverFor } from "@/components/mosaic/figures";
import { openSettings } from "@/components/settings";
import { formatToken, TOKEN_SYMBOL } from "@/lib/money";
import { useWallet } from "@/lib/wallet";
import { MIN_STAKE } from "@/features/node/JoinFlow";
import { useAddressRecord, type AddressRecord } from "./record";
import { Banner, Button, Card, Counter, EmptyState, Identicon, Money, Null, PageHeader, Pill, SectionTitle, Skeleton, cx, short, useCopy } from "@/components/primitives";

const isAddress = (v: string) => /^0x[0-9a-fA-F]{40}$/.test(v);

/** /me: your record lives at your address, so this only connects and redirects. */
export function Profile() {
  const w = useWallet();
  const router = useRouter();
  useEffect(() => { if (w.connected && w.address) router.replace(`/u/${w.address.toLowerCase()}`); }, [w.connected, w.address, router]);
  if (w.connected && w.address) return <div className="flex min-h-full flex-col"><PageHeader icon={UserRound} title="profile" heading="Profile" /><div className="px-4 py-5 md:px-6"><Skeleton className="h-56 w-full" /></div></div>;
  return (
    <div className="flex min-h-full flex-col">
      <PageHeader icon={UserRound} title="profile" heading="Profile" />
      <ConnectGate title="Connect to see your profile" figure="owl">
        Your profile is your wallet&apos;s public record: the laptops it runs, the jobs it paid for, the competitions it hosts and the posters it has collected. Anyone can look up an address; connecting shows yours and what needs you.
      </ConnectGate>
    </div>
  );
}

export function AddressPage({ address }: { address: string }) {
  if (!isAddress(address)) {
    return (
      <div className="flex min-h-full flex-col">
        <PageHeader icon={UserRound} title="profile" heading="Profile" />
        <EmptyState icon={UserRound} poster="EMPTY" title="That isn't an address">An address is 0x and 40 hex characters.</EmptyState>
      </div>
    );
  }
  return <Record address={address.toLowerCase()} />;
}

function Record({ address }: { address: string }) {
  const w = useWallet();
  const r = useAddressRecord(address);
  const roles = [r.operators.length > 0 && "node", r.jobs.length > 0 && "requester", r.hosted > 0 && "host"].filter(Boolean) as string[];
  const meta = [
    roles.length ? roles.join(" · ") : "No role yet",
    r.firstAt ? `Since ${new Date(r.firstAt * 1000).toLocaleDateString(undefined, { month: "short", year: "numeric" })}` : "No history yet",
    r.human === null ? null : r.human ? "One verified person" : "Not verified",
  ].filter((x): x is string => x !== null);
  const op = r.operators[0];

  return (
    <div className="flex min-h-full flex-col pb-10">
      <PageHeader icon={UserRound} title={r.self ? "profile" : "address"} heading={r.self ? "Profile" : <span className="font-mono">{short(address, 6, 4)}</span>}>
        {r.self && <Button variant="ghost" icon={Settings} onClick={() => openSettings("wallet")}>Settings</Button>}
      </PageHeader>
      <div className="flex flex-col gap-8 px-4 py-5 md:px-6">
        {r.self && <OwnerStrip r={r} />}

        <CoverBand
          cover={coverFor(address)}
          live
          label={`${coverFor(address).title}, this address's poster`}
          title={<span className="flex items-center gap-3"><Identicon value={address} className="size-7" /><CopyAddress value={address} />{r.self && <Pill tone="brand">you</Pill>}</span>}
          meta={meta}
        />

        {r.excluded && (
          <Banner tone="danger" title="Excluded from new rounds">
            {r.excluded.reason} {r.excluded.evidence.length > 0 && `${r.excluded.evidence.length} confirmed round${r.excluded.evidence.length === 1 ? "" : "s"} back this up.`}
          </Banner>
        )}

        <section className="flex flex-col gap-3">
          <SectionTitle title="Record" sub={r.source === "demo" ? "demo data, from the demo wallet" : r.source === "partial" ? "this coordinator doesn't serve owner records, so node and pay counts are missing" : r.indexedTo ? `from the chain, indexed to block ${r.indexedTo.toLocaleString()}` : "from the chain"} />
          {r.loading ? <Skeleton className="h-24 w-full rounded-xl" /> : (
            <Card className="grid grid-cols-2 gap-x-6 gap-y-5 p-4 md:grid-cols-5">
              <Counter value={r.verifiedRounds ?? <Null />} label="verified rounds" />
              <Counter value={r.paidRounds ?? <Null />} label="rounds paid" />
              <Counter value={r.slashes ?? <Null />} label="slashes" tone={r.slashes ? "danger" : undefined} />
              <Counter value={r.jobs.length} label="jobs posted" />
              <Counter value={`${r.hosted} · ${r.entered}`} label="hosted · entered" />
            </Card>
          )}
          {r.proving && <Proving done={r.proving.done} need={r.proving.need} />}
        </section>

        <section className="flex flex-col gap-3">
          <SectionTitle title="Roles" sub="one wallet can hold all three; each pays for or earns from the others" />
          <div className="grid gap-3 md:grid-cols-3">
            <PosterCard
              href={op ? `/nodes/${op}` : r.self ? "/nodes/add" : "/nodes"}
              n="01"
              title="Lend a laptop"
              note={r.operators.length === 0 ? (r.self ? "No laptop on this wallet. Add one and its round pay funds your jobs." : "Runs no node.") : `${r.operators.length} node${r.operators.length === 1 ? "" : "s"}${r.paidRounds === null ? "" : ` · ${r.paidRounds} rounds paid`}${r.paidAmount ? ` · ${formatToken(r.paidAmount)} ${TOKEN_SYMBOL}` : ""}`}
              art={<RoleArt word="LEND" on={r.operators.length > 0} live={r.self && Boolean(w.node?.running)} held={r.self && Boolean(w.node?.joined && !w.node.running)} />}
            />
            <PosterCard
              href={r.self ? (r.jobs.length ? "/jobs?scope=yours" : "/jobs/new") : r.jobs[0] ? `/jobs/${r.jobs[0].id}` : "/jobs"}
              n="02"
              title="Train a model"
              note={r.jobs.length === 0 ? (r.self ? "No jobs yet. Lock a budget and idle laptops train it." : "Posted no jobs.") : `${r.jobs.length} job${r.jobs.length === 1 ? "" : "s"} · ${formatToken(r.jobs.reduce((s, j) => s + j.budget, 0))} ${TOKEN_SYMBOL} in budgets`}
              art={<RoleArt word="TRAIN" on={r.jobs.length > 0} />}
              tag={r.jobs.length ? <Pill tone="neutral">{r.jobs.length}</Pill> : undefined}
            />
            <PosterCard
              href={r.self && r.hosted === 0 ? "/competitions/new" : "/competitions"}
              n="03"
              title="Host a competition"
              note={r.hosted === 0 && r.entered === 0 ? (r.self ? "Nothing hosted or entered. Commit your labels and anyone can compete." : "Hosted and entered nothing.") : `${r.hosted} hosted · ${r.entered} entered`}
              art={<RoleArt word="HOST" on={r.hosted > 0} />}
              tag={r.hosted ? <Pill tone="neutral">{r.hosted}</Pill> : undefined}
            />
          </div>
        </section>

        {r.operators.length > 0 && (
          <section className="flex flex-col gap-3">
            <SectionTitle title="Nodes" sub={r.operators.length > 1 ? "one seat per round per owner, so at most one of these trains in any round" : "the laptop this address runs"} />
            <Card className="divide-y divide-rule-row">
              {r.operators.map((o) => (
                <Link key={o} href={`/nodes/${o}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-hover">
                  <Identicon value={o} className="size-5" />
                  <span className="flex-1 font-mono text-sm text-ink">{short(o, 6, 4)}</span>
                  {r.self && w.node?.operator.toLowerCase() === o.toLowerCase() && <Pill tone={w.node.running ? "ok" : "neutral"} live={w.node.running}>{w.node.running ? "running" : "paused"}</Pill>}
                  <ArrowRight className="size-4 text-subtle" aria-hidden />
                </Link>
              ))}
            </Card>
          </section>
        )}

        <PosterShelf self={r.self} earned={r.paidRounds !== null && r.paidRounds > 0} spent={r.jobs.length > 0} recycled={r.recycled > 0} joined={r.operators.length > 0} human={Boolean(r.human)} graduated={r.graduated} />
      </div>
    </div>
  );
}

type Need = { key: string; tone: "danger" | "warn" | "neutral"; icon: LucideIcon; text: string; href?: string; onClick?: () => void; cta: string };

/** Only what needs the owner now. Everything else lives on Balance and the node page. */
function OwnerStrip({ r }: { r: AddressRecord }) {
  const w = useWallet();
  const node = w.node;
  const refunds = r.jobs.filter((j) => j.status === "abandoned" && j.remaining > 0);
  const needs: Need[] = [
    r.excluded && { key: "ex", tone: "danger", icon: AlertTriangle, text: "This wallet is excluded from new rounds.", href: op(node) ? `/nodes/${node!.operator}` : "/balance", cta: "See why" },
    w.wrongNetwork && { key: "net", tone: "warn", icon: AlertTriangle, text: "Your wallet is on another network.", onClick: w.switchNetwork, cta: "Switch" },
    w.claimable > 0 && { key: "claim", tone: "neutral", icon: ArrowRight, text: `${formatToken(w.claimable)} ${TOKEN_SYMBOL} earned and not claimed.`, href: "/balance", cta: "Claim" },
    node && !node.joined && { key: "setup", tone: "warn", icon: AlertTriangle, text: "Your laptop is paired but hasn't joined.", href: "/nodes/add", cta: "Finish setup" },
    node?.joined && node.stake < MIN_STAKE && { key: "stake", tone: "warn", icon: AlertTriangle, text: `Stake is ${formatToken(node.stake)} ${TOKEN_SYMBOL}, under the ${formatToken(MIN_STAKE)} minimum. Rounds stop drawing this node.`, href: `/nodes/${node.operator}`, cta: "Top up" },
    node?.joined && !node.running && { key: "paused", tone: "neutral", icon: AlertTriangle, text: "Your node is paused.", href: `/nodes/${node.operator}#node-settings`, cta: "Resume" },
    ...refunds.map((j) => ({ key: `ref${j.id}`, tone: "neutral" as const, icon: ArrowRight, text: `Job #${j.id} has ${formatToken(j.remaining)} ${TOKEN_SYMBOL} to refund.`, href: `/jobs/${j.id}`, cta: "Withdraw" })),
  ].filter(Boolean) as Need[];

  if (needs.length === 0) {
    return <p className="flex items-center gap-2 text-sm text-muted"><Check className="size-4 text-ok" aria-hidden />Nothing needs you. <Money units={w.usdc} className="text-ink" /> in the wallet.</p>;
  }
  return (
    <section aria-label="Needs you" className="flex flex-col gap-2">
      <SectionTitle title="Needs you" sub={`${needs.length} thing${needs.length === 1 ? "" : "s"}`} />
      <Card className="divide-y divide-rule-row">
        {needs.map((n) => (
          <div key={n.key} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <n.icon className={cx("size-4 shrink-0", n.tone === "danger" ? "text-danger" : n.tone === "warn" ? "text-warn" : "text-muted")} aria-hidden />
            <span className="min-w-0 flex-1 text-sm text-ink">{n.text}</span>
            {n.href ? <Link href={n.href} className="inline-flex min-h-6 items-center gap-1 text-sm text-ink underline decoration-subtle underline-offset-4 hover:decoration-ink">{n.cta}</Link> : <Button onClick={n.onClick}>{n.cta}</Button>}
          </div>
        ))}
      </Card>
    </section>
  );
}
const op = (n: { operator: string } | null) => Boolean(n?.operator);

/** Days of verified work against the proving period, as one bar. */
function Proving({ done, need }: { done: number; need: number }) {
  const pct = need > 0 ? Math.min(1, done / need) : 0;
  return (
    <Card className="flex flex-col gap-2 p-4">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-ink">Proving period</span>
        <span className="font-mono tabular text-muted">{(done / 86400).toFixed(1)} of {(need / 86400).toFixed(0)} days verified</span>
      </div>
      <div className="h-1.5 w-full rounded-xs bg-rule" role="progressbar" aria-label="Proving period" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct * 100)}>
        <div className="h-full rounded-xs bg-mosaic" style={{ width: `${pct * 100}%` }} />
      </div>
    </Card>
  );
}

/** A role's word poster. The node's one is live while the laptop runs; paused, it stops twinkling and dims a tone. */
function RoleArt({ word, on, live, held }: { word: string; on: boolean; live?: boolean; held?: boolean }) {
  const field = useWordField(word, on, held);
  return <PosterThumb field={field} label={word} live={live} hold={held} vocab={VOCAB_SHORT} cell={6} className="h-32 border-b border-rule" />;
}

function CopyAddress({ value }: { value: string }) {
  const { copied, copy } = useCopy();
  const Icon = copied ? Check : Copy;
  return (
    <button type="button" onClick={() => copy(value)} aria-label={copied ? "Address copied" : "Copy address"} className="inline-flex max-w-full items-center gap-2 font-mono text-ink hover:text-muted">
      {short(value, 6, 4)}
      <Icon className={cx("size-3.5 shrink-0", copied ? "text-ok" : "text-subtle")} aria-hidden />
    </button>
  );
}

const POSTERS = [
  { key: "joined", cover: "heron", title: "First light", got: "A laptop joined the network", todo: "Add your laptop as a node", href: "/nodes/add" },
  { key: "human", cover: "owl", title: "One person", got: "Proved one person with World ID", todo: "Verify with World ID when you join", href: "/nodes/join" },
  { key: "earned", cover: "crow", title: "First round", got: "A node was paid for a round", todo: "Get paid for one round", href: "/nodes/add" },
  { key: "graduated", cover: "nightheron", title: "Proven", got: "Finished the 7-day proving period", todo: "Stay honest through proving", href: "/nodes" },
  { key: "spent", cover: "tiger", title: "First job", got: "Trained a model", todo: "Lock a budget for a job", href: "/jobs/new" },
  { key: "recycled", cover: "fuji", title: "Full circle", got: "A laptop paid for its owner's training", todo: "Spend round pay on a job", href: "/jobs/new" },
] as const;

/** One poster per first, collected rather than ranked. On your own record the missing ones point at how to earn them; on someone else's they just sit faint. */
function PosterShelf({ self, ...has }: { self: boolean } & Record<(typeof POSTERS)[number]["key"], boolean>) {
  const got = POSTERS.filter((x) => has[x.key]).length;
  return (
    <section className="flex flex-col gap-3">
      <SectionTitle title="Posters" sub={`${got} of ${POSTERS.length} collected · one for each first, nothing to rank`} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {POSTERS.map((x, k) => (
          <PosterCard key={x.key} href={self ? x.href : undefined} n={String(k + 1).padStart(2, "0")} title={x.title} note={has[x.key] ? x.got : self ? `to earn: ${x.todo.toLowerCase()}` : "not yet"} cover={coverById(x.cover)} dim={!has[x.key]} thumb="h-36" tag={has[x.key] ? <Pill tone="ok">collected</Pill> : undefined} />
        ))}
      </div>
    </section>
  );
}
