"use client";
// Profile: who this wallet is on ToD. The wallet's poster, the three roles it can hold (lend a laptop, train, host)
// with where each one stands, the identity facts other screens rely on, the milestone posters, and shortcuts into Settings.
import Link from "next/link";
import { useMemo } from "react";
import { Bell, ChevronRight, Copy, Check, Laptop, MonitorCog, UserRound, Wallet, type LucideIcon } from "lucide-react";
import { ConnectGate } from "@/components/mosaic/ConnectGate";
import { CoverBand } from "@/components/mosaic/CoverBand";
import { Flap } from "@/components/mosaic/Flap";
import { PosterCard, PosterThumb, VOCAB_SHORT, useWordField } from "@/components/mosaic/PosterCard";
import { coverById, coverFor } from "@/components/mosaic/figures";
import { openSettings } from "@/components/settings";
import { isDemo } from "@/lib/api/client";
import { useNodeChain } from "@/lib/api/hooks";
import { formatToken, TOKEN_SYMBOL } from "@/lib/money";
import { usePrefs } from "@/lib/prefs";
import { DEMO_OWNED_JOBS, useWallet } from "@/lib/wallet";
import { CREDENTIAL_LABEL, useHuman } from "@/lib/identity";
import { useLedger } from "./Overview";
import { Card, Identicon, Money, PageHeader, Pill, SectionTitle, cx, short, useCopy } from "@/components/primitives";

export function Profile() {
  const w = useWallet();
  const p = usePrefs();
  const human = useHuman();
  const { rows, earned, spent, recycled } = useLedger();
  const op = w.node?.operator ?? "";
  const chain = useNodeChain(op, Boolean(w.node?.joined));
  const since = useMemo(() => (rows.length ? Math.min(...rows.map((r) => r.at)) : null), [rows]);

  if (!w.connected || !w.address) {
    return (
      <div className="flex min-h-full flex-col">
        <PageHeader icon={UserRound} title="profile" heading="Profile" />
        <ConnectGate title="Connect to see your profile" figure="owl">
          Your profile is your wallet: the laptop it runs, the jobs it paid for, the competitions it hosts and the posters it has collected. Connect to see it.
        </ConnectGate>
      </div>
    );
  }

  const address = w.address;
  const node = w.node;
  const jobs = w.postedJobs.length + (isDemo ? DEMO_OWNED_JOBS.length : 0);
  const paidRounds = rows.filter((r) => r.kind === "payout").length;
  const roles = [node?.joined && "node", jobs > 0 && "requester", w.hosted.length > 0 && "host"].filter(Boolean) as string[];
  const meta = [
    w.wrongNetwork ? "Wrong network" : "Base Sepolia",
    roles.length ? roles.join(" · ") : "No role yet",
    since ? `Since ${new Date(since * 1000).toLocaleDateString(undefined, { month: "short", year: "numeric" })}` : "New wallet",
  ];
  const nodeNote = !node ? (paidRounds > 0 ? `No laptop paired now. ${paidRounds} rounds paid to this wallet before.` : "No laptop on this wallet. Add one and its round pay funds your jobs.") : !node.joined ? "Paired, not joined. Verify, stake and join to be drawn into rounds." : `${node.running ? "Running" : "Paused"} · ${formatToken(node.stake)} ${TOKEN_SYMBOL} bond · ${paidRounds} rounds paid`;
  const jobNote = jobs === 0 ? "No jobs yet. Lock a budget and idle laptops train it." : `${jobs} job${jobs === 1 ? "" : "s"} posted · ${formatToken(spent)} ${TOKEN_SYMBOL} in budgets${recycled > 0 ? `, ${formatToken(recycled)} from round pay` : ""}`;
  const hostNote = w.hosted.length === 0 && w.entries.length === 0 ? "Nothing hosted or entered. Commit your labels and anyone can compete." : `${w.hosted.length} hosted · ${w.entries.length} entered`;

  return (
    <div className="flex min-h-full flex-col pb-10">
      <PageHeader icon={UserRound} title="profile" heading="Profile" />
      <div className="flex flex-col gap-8 px-4 py-5 md:px-6">
        <CoverBand
          cover={coverFor(address)}
          live
          label={`${coverFor(address).title}, this wallet's poster`}
          title={<span className="flex items-center gap-3"><Identicon value={address} className="size-7" /><span className="font-mono">{short(address, 6, 4)}</span></span>}
          meta={meta}
        />

        <section className="flex flex-col gap-3">
          <SectionTitle title="Roles" sub="one wallet can hold all three; each pays for or earns from the others" />
          <div className="grid gap-3 md:grid-cols-3">
            <PosterCard href={node?.joined ? "/me/node" : "/nodes/add"} n="01" title="Lend a laptop" note={nodeNote} art={<RoleArt word="LEND" on={Boolean(node?.joined)} live={Boolean(node?.joined)} held={Boolean(node?.joined && !node.running)} />} tag={node?.joined ? <Pill tone={node.running ? "ok" : "neutral"} live={node.running}>{node.running ? "running" : "paused"}</Pill> : node ? <Pill tone="warn">setup</Pill> : undefined} />
            <PosterCard href={jobs > 0 ? "/jobs?scope=yours" : "/jobs/new"} n="02" title="Train a model" note={jobNote} art={<RoleArt word="TRAIN" on={jobs > 0} />} tag={jobs > 0 ? <Pill tone="neutral">{jobs}</Pill> : undefined} />
            <PosterCard href={w.hosted.length ? "/competitions" : "/competitions/new"} n="03" title="Host a competition" note={hostNote} art={<RoleArt word="HOST" on={w.hosted.length > 0} />} tag={w.hosted.length ? <Pill tone="neutral">{w.hosted.length}</Pill> : undefined} />
          </div>
        </section>

        <div className="grid gap-8 lg:grid-cols-5">
          <section className="flex flex-col gap-3 lg:col-span-3">
            <SectionTitle title="Identity" sub="what other screens read from this wallet" />
            <Card className="divide-y divide-rule-row">
              <Fact label="Address"><CopyAddress value={address} /></Fact>
              <Fact label="Network">{w.wrongNetwork ? <span className="flex flex-wrap items-center gap-2"><Pill tone="warn">wrong network</Pill><button type="button" onClick={w.switchNetwork} className="text-sm text-ink underline decoration-subtle underline-offset-4">Switch</button></span> : <Pill tone="neutral">Base Sepolia</Pill>}</Fact>
              <Fact label="One person" hint="World ID, checked once for this wallet">{human.loading ? <span className="font-mono text-xs text-subtle">checking</span> : human.verified ? <span className="flex items-center gap-2"><Pill tone="ok">verified</Pill>{human.status?.credential && <span className="font-mono text-xs text-muted">{CREDENTIAL_LABEL[human.status.credential]}</span>}</span> : <Link href="/join/verify?next=/me" className="text-sm text-muted underline decoration-subtle underline-offset-4 hover:text-ink">Not yet. Verify, about a minute</Link>}</Fact>
              <Fact label="Earnings go to" hint="where Withdraw sends round pay">
                <button type="button" onClick={() => openSettings("wallet")} className="text-left font-mono text-sm text-ink underline decoration-subtle underline-offset-4 hover:decoration-ink">
                  {p.claimTo ? short(p.claimTo, 6, 4) : "this wallet"}
                </button>
              </Fact>
              <Fact label="Balance">
                <span className="flex flex-col items-end gap-0.5 text-sm">
                  <Money units={w.usdc} className="text-ink" />
                  <Link href="/balance" className="text-xs text-muted underline decoration-subtle underline-offset-4 hover:text-ink"><Flap text={formatToken(w.claimable) ?? ""} /> earned, unclaimed · {formatToken(earned)} all time</Link>
                </span>
              </Fact>
            </Card>
          </section>
          <section className="flex flex-col gap-3 lg:col-span-2">
            <SectionTitle title="Settings" sub="opens over this page" />
            <Card className="divide-y divide-rule-row">
              <Shortcut icon={Wallet} title="Wallet" hint="Network, payout address, disconnect" onClick={() => openSettings("wallet")} />
              <Shortcut icon={Laptop} title="Node" hint="Pause, schedule, limits" onClick={() => openSettings("node")} />
              <Shortcut icon={Bell} title="Notifications" hint="What tells you, and where" onClick={() => openSettings("notifications")} />
              <Shortcut icon={MonitorCog} title="Display" hint={`Motion ${p.motion} · start screen ${p.splash ? "on" : "off"}`} onClick={() => openSettings("display")} />
            </Card>
          </section>
        </div>

        <PosterShelf earned={earned > 0} spent={spent > 0} recycled={recycled > 0} joined={Boolean(node?.joined)} human={human.verified} graduated={chain.data?.data.graduated === true} />
      </div>
    </div>
  );
}

/** A role's word poster. The node's one is live while the laptop runs; paused, it stops twinkling and dims a tone. */
function RoleArt({ word, on, live, held }: { word: string; on: boolean; live?: boolean; held?: boolean }) {
  const field = useWordField(word, on, held);
  return <PosterThumb field={field} label={word} live={live} hold={held} vocab={VOCAB_SHORT} cell={6} className="h-32 border-b border-rule" />;
}

function Fact({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <span className="flex flex-col">
        <span className="text-sm text-ink">{label}</span>
        {hint && <span className="text-xs text-subtle">{hint}</span>}
      </span>
      <span className="min-w-0 text-right">{children}</span>
    </div>
  );
}

function CopyAddress({ value }: { value: string }) {
  const { copied, copy } = useCopy();
  const Icon = copied ? Check : Copy;
  return (
    <button type="button" onClick={() => copy(value)} aria-label={copied ? "Address copied" : "Copy address"} className="inline-flex max-w-full items-center gap-2 font-mono text-sm text-ink hover:text-muted">
      <span className="hidden truncate md:inline">{value}</span>
      <span className="md:hidden">{short(value, 6, 4)}</span>
      <Icon className={cx("size-3.5 shrink-0", copied ? "text-ok" : "text-subtle")} aria-hidden />
    </button>
  );
}

function Shortcut({ icon: Icon, title, hint, onClick }: { icon: LucideIcon; title: string; hint: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-haspopup="dialog" className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-hover">
      <Icon className="size-4 shrink-0 text-muted" strokeWidth={1.5} aria-hidden />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm text-ink">{title}</span>
        <span className="truncate text-xs text-subtle">{hint}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-subtle" aria-hidden />
    </button>
  );
}

const POSTERS = [
  { key: "joined", cover: "heron", title: "First light", got: "Your laptop joined the network", todo: "Add your laptop as a node", href: "/nodes/add" },
  { key: "human", cover: "owl", title: "One person", got: "Proved you're one person", todo: "Verify with World ID", href: "/join/verify?next=/me" },
  { key: "earned", cover: "crow", title: "First round", got: "Your node was paid for a round", todo: "Get paid for one round", href: "/nodes/add" },
  { key: "graduated", cover: "nightheron", title: "Proven", got: "Finished the 7-day proving period", todo: "Stay honest through proving", href: "/nodes" },
  { key: "spent", cover: "tiger", title: "First job", got: "You trained a model", todo: "Lock a budget for a job", href: "/jobs/new" },
  { key: "recycled", cover: "fuji", title: "Full circle", got: "Your laptop paid for your training", todo: "Spend round pay on a job", href: "/jobs/new" },
] as const;

/** One poster per first, collected rather than ranked. Ones not earned yet sit faint and point at how to earn them. */
function PosterShelf(has: Record<(typeof POSTERS)[number]["key"], boolean>) {
  const got = POSTERS.filter((x) => has[x.key]).length;
  return (
    <section className="flex flex-col gap-3">
      <SectionTitle title="Posters" sub={`${got} of ${POSTERS.length} collected · one for each first, nothing to rank`} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {POSTERS.map((x, k) => (
          <PosterCard key={x.key} href={x.href} n={String(k + 1).padStart(2, "0")} title={x.title} note={has[x.key] ? x.got : `to earn: ${x.todo.toLowerCase()}`} cover={coverById(x.cover)} dim={!has[x.key]} thumb="h-36" tag={has[x.key] ? <Pill tone="ok">collected</Pill> : undefined} />
        ))}
      </div>
    </section>
  );
}
