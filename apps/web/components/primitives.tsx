"use client";
// Core primitives in the Neatlogs language (REVAMP-2 section 6): tinted pill badges, hairline cards, 32px controls, 40px table header, text tabs, steps, popovers, code panel, page states.
import { StatePoster } from "@/components/mosaic/StatePoster";
import { Flap } from "@/components/mosaic/Flap";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowUpRight, Check, ChevronDown, ChevronRight, CircleDashed, Copy, FlaskConical, Hash, ShieldCheck, type LucideIcon } from "lucide-react";
import type { JobStatus, RoundStatus, Source, Trust, Verdict } from "@/lib/api/types";
import { formatToken, TOKEN_SYMBOL } from "@/lib/money";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export type Tone = "ok" | "warn" | "danger" | "pending" | "neutral" | "chain" | "brand";
const TONE: Record<Tone, string> = {
  ok: "text-ok bg-ok-bg",
  warn: "text-warn bg-warn-bg",
  danger: "text-danger bg-danger-bg",
  pending: "text-pending bg-pending-bg",
  neutral: "text-muted bg-band",
  chain: "text-chain bg-chain-bg",
  brand: "text-brand bg-brand-soft",
};

/** Neatlogs badge: 24px, 12/500, full radius, tinted pair, no border. */
export function Pill({ tone, children, live }: { tone: Tone; children: ReactNode; live?: boolean }) {
  return (
    <span className={cx("inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-xs px-2 font-mono text-xs uppercase tracking-wide", TONE[tone])}>
      {live && <span className="size-1.5 rounded-full bg-current live-dot" aria-hidden />}
      {children}
    </span>
  );
}

export function Count({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx("inline-flex h-5 min-w-5 items-center justify-center rounded-xs bg-band px-1.5 text-xs font-medium tabular text-muted", className)}>{children}</span>;
}

export const JOB_TONE: Record<JobStatus, Tone> = { open: "pending", running: "ok", completed: "neutral", abandoned: "warn", invalid: "danger" };
export const JOB_LABEL: Record<JobStatus, string> = { open: "Waiting", running: "Training", completed: "Finished", abandoned: "Abandoned", invalid: "Invalid" };
export function JobStatusPill({ status }: { status: JobStatus }) {
  return <Pill tone={JOB_TONE[status]} live={status === "running"}>{JOB_LABEL[status]}</Pill>;
}

export const ROUND_TONE: Record<RoundStatus, Tone> = {
  open: "pending", committing: "pending", revealing: "pending", verifying: "pending",
  finalized: "ok", reverted: "danger", voided: "warn", fallback: "warn",
};
export const ROUND_LABEL: Record<RoundStatus, string> = {
  open: "Open", committing: "Committing", revealing: "Revealing", verifying: "Verifying",
  finalized: "Finalized", reverted: "Reverted", voided: "Voided", fallback: "Fallback pay",
};
export function RoundStatusPill({ status }: { status: RoundStatus }) {
  const active = ["open", "committing", "revealing", "verifying"].includes(status);
  return <Pill tone={ROUND_TONE[status]} live={active}>{ROUND_LABEL[status]}</Pill>;
}

const TRUST: Record<Trust | "demo", { label: string; hint: string; cls: string; icon: LucideIcon }> = {
  chain: { label: "On chain", hint: "Read from the JobMarket contract. Nobody can edit it.", cls: "text-chain", icon: ShieldCheck },
  "hash-checked": { label: "Hash checked", hint: "From the coordinator, and its hash matches the one on chain.", cls: "text-hash", icon: Hash },
  untrusted: { label: "Coordinator only", hint: "From the coordinator, not yet checked against the chain.", cls: "text-untrusted", icon: CircleDashed },
  demo: { label: "Demo data", hint: "No coordinator is connected. These are fixtures shaped like the real responses.", cls: "text-demo", icon: FlaskConical },
};
export function TrustLabel({ trust }: { trust: Trust | "demo" }) {
  const t = TRUST[trust];
  const Icon = t.icon;
  return (
    <span title={t.hint} className="inline-flex cursor-help items-center gap-1.5 whitespace-nowrap text-xs text-muted">
      <Icon className={cx("size-3.5", t.cls)} strokeWidth={1.75} aria-hidden />
      {t.label}
    </span>
  );
}

/** Demo is said once, in the sidebar status line; pages stay quiet. Kept so callers compile. */
export function SourceBadge(_: { source: Source | undefined }) {
  return null;
}

export function short(v: string, head = 6, tail = 4) {
  return v.length <= head + tail + 1 ? v : `${v.slice(0, head)}…${v.slice(-tail)}`;
}

export function useCopy() {
  const [copied, setCopied] = useState(false);
  return {
    copied,
    copy: (v: string) => {
      void navigator.clipboard?.writeText(v);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    },
  };
}

export function HashChip({ value, label }: { value: string | null; label?: string }) {
  const { copied, copy } = useCopy();
  if (value === null) return <Null>{label ? `No ${label} yet` : "Not set yet"}</Null>;
  return (
    <button
      type="button"
      onClick={() => copy(value)}
      title={value}
      aria-label={`Copy ${label ?? "hash"} ${value}`}
      className="group inline-flex h-6 items-center gap-1.5 rounded-md px-1.5 font-mono text-xs text-muted transition-colors hover:bg-band hover:text-ink"
    >
      {short(value, 8, 6)}
      {copied ? <Check className="size-3 text-ok" aria-hidden /> : <Copy className="size-3 text-subtle group-hover:text-muted" aria-hidden />}
    </button>
  );
}

/** An address as a 3x3 mirrored block of mosaic tones, so the same wallet reads as the same mark everywhere. */
export function Identicon({ value, className }: { value: string; className?: string }) {
  // Hash the whole address: vanity and test addresses share long runs of zeros, so raw nibbles would all look alike.
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619) >>> 0;
  const half = [0, 1, 2, 3, 4, 5].map((i) => {
    const n = (h >>> (i * 5)) & 15;
    return n < 5 ? "var(--mz-tex)" : n === 15 ? "var(--mz-l6)" : `var(--mz-l${2 + (n % 4)})`;
  });
  const cells = [0, 1, 2].flatMap((r) => [half[r * 2], half[r * 2 + 1], half[r * 2]]);
  return (
    <span aria-hidden className={cx("grid shrink-0 grid-cols-3 overflow-hidden rounded-xs bg-surface", className ?? "size-5")}>
      {cells.map((c, i) => <span key={i} style={{ background: c }} />)}
    </span>
  );
}

export function AddressChip({ value, href, you }: { value: string; href?: string; you?: boolean }) {
  const body = (
    <span className="inline-flex items-center gap-2 font-mono text-xs text-ink">
      <Identicon value={value} className="size-4" />
      {short(value)}
      {you && <Pill tone="brand">you</Pill>}
    </span>
  );
  return href ? <Link href={href} className="relative z-10 rounded-sm hover:underline hover:decoration-rule-strong hover:underline-offset-4">{body}</Link> : body;
}

export function Null({ children = "Not reported" }: { children?: ReactNode }) {
  return <span className="text-xs text-subtle">{children}</span>;
}

/** live: a change while you watch split-flaps the digits, and a rise ends in one bone glint (pay landed). */
export function Money({ units, className, compact, unit = true, live }: { units: number | null; className?: string; compact?: boolean; unit?: boolean; live?: boolean }) {
  const v = formatToken(units, { compact });
  if (v === null) return <Null />;
  return (
    <span className={cx("whitespace-nowrap font-mono tabular", className)}>
      {live ? <LiveAmount text={v} units={units} /> : v}
      {unit && <span className="ml-1 text-xs text-subtle">{TOKEN_SYMBOL}</span>}
    </span>
  );
}

function LiveAmount({ text, units }: { text: string; units: number | null }) {
  const last = useRef(units);
  const rose = units !== null && last.current !== null && units > last.current;
  useEffect(() => { last.current = units; }, [units]);
  return <Flap text={text} glint={rose} />;
}

const VERDICT: Record<Verdict, { label: string; tone: Tone }> = {
  pass: { label: "Pass", tone: "ok" },
  fail: { label: "Fail", tone: "danger" },
  pending: { label: "Waiting", tone: "pending" },
  absent: { label: "No report", tone: "neutral" },
};
export function VerdictCell({ verdict }: { verdict: Verdict }) {
  const v = VERDICT[verdict];
  return <Pill tone={v.tone}>{v.label}</Pill>;
}

const PHASES: { key: RoundStatus; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "committing", label: "Commit" },
  { key: "revealing", label: "Reveal" },
  { key: "verifying", label: "Replay" },
  { key: "finalized", label: "Pay" },
];
/** Round phases as five tiles: the mosaic in data form (REVAMP-2 section 7). */
export function PhaseStrip({ status }: { status: RoundStatus | null }) {
  const terminal = status === "reverted" || status === "voided" || status === "fallback";
  const idx = status === null ? -1 : terminal ? PHASES.length - 1 : PHASES.findIndex((p) => p.key === status);
  return (
    <ol className="grid grid-cols-5 gap-1" aria-label="Round phase">
      {PHASES.map((p, i) => {
        const done = i < idx || (i === idx && status === "finalized");
        const now = i === idx && status !== "finalized";
        const bar = done ? "bg-ok" : now ? (terminal ? (status === "reverted" ? "bg-danger" : "bg-warn") : "bg-brand live-dot") : "bg-band";
        return (
          <li key={p.key} aria-current={now ? "step" : undefined} className="flex min-w-0 flex-col gap-1.5">
            <span className={cx("h-2 rounded-xs", bar)} />
            <span className={cx("truncate text-xs", now ? "text-ink" : done ? "text-muted" : "text-subtle")}>
              {now && terminal ? ROUND_LABEL[status!] : p.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function Banner({ tone, title, children, action }: { tone: "warn" | "danger" | "pending" | "demo"; title: string; children?: ReactNode; action?: ReactNode }) {
  const cls = { warn: "text-warn", danger: "text-danger", pending: "text-pending", demo: "text-demo" }[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-rule bg-surface px-4 py-3">
      <span className={cx("size-1.5 shrink-0 rounded-full bg-current", cls)} aria-hidden />
      <p className={cx("text-sm font-medium", cls)}>{title}</p>
      {children && <p className="min-w-0 flex-1 text-sm text-muted">{children}</p>}
      {action}
    </div>
  );
}

/** Five tiles lighting in a wave, in the current text colour: the busy state for buttons and rows. */
export function TileBusy({ className }: { className?: string }) {
  return <span aria-hidden className={cx("tile-busy", className)}><i /><i /><i /><i /><i /></span>;
}
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cx("block skeleton", className)} />;
}

/** Neatlogs empty state: 48px icon tile with two fanned ghost cards, 13/500 title, one muted line. */
/** Empty state. With `poster`, a word poster (EMPTY by default) stands in for the icon: use it where the list is empty for a reason the user can act on, not for filtered-to-nothing results. */
export function EmptyState({ icon: Icon, title, children, action, poster }: { icon: LucideIcon; title: string; children?: ReactNode; action?: ReactNode; poster?: string }) {
  return (
    <div role="status" className="flex flex-col items-center justify-center gap-1 px-6 py-14 text-center">
      {poster ? <StatePoster word={poster} kind="empty" className="mb-4 h-24 w-full max-w-sm" /> : <span className="relative mb-4 inline-flex size-12 items-center justify-center" aria-hidden>
        <span className="absolute inset-0 translate-x-2 rotate-12 rounded-lg border border-rule bg-surface" />
        <span className="absolute inset-0 -translate-x-2 -rotate-12 rounded-lg border border-rule bg-surface" />
        <span className="relative inline-flex size-12 items-center justify-center rounded-lg border border-rule bg-band">
          <Icon className="size-5 text-muted" strokeWidth={1.5} />
        </span>
      </span>}
      <p className="text-sm font-medium text-ink">{title}</p>
      {children && <p className="max-w-sm text-sm text-muted">{children}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

type BtnVariant = "primary" | "secondary" | "ghost";
const BTN: Record<BtnVariant, string> = {
  primary: "bg-accent text-accent-ink border-rule shadow-cta hover:opacity-90",
  secondary: "border-rule bg-surface text-ink hover:bg-hover",
  ghost: "border-transparent text-muted hover:text-ink hover:bg-band",
};
const BTN_BASE = "inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 text-sm transition-colors duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-50";
export function Button({ children, variant = "secondary", icon: Icon, ...p }: React.ComponentProps<"button"> & { variant?: BtnVariant; icon?: LucideIcon }) {
  return (
    <button type="button" {...p} className={cx(BTN_BASE, BTN[variant], p.className)}>
      {Icon && <Icon className="size-4" strokeWidth={1.5} aria-hidden />}
      {children}
    </button>
  );
}
export function ButtonLink({ children, variant = "secondary", icon: Icon, href, className }: { children: ReactNode; variant?: BtnVariant; icon?: LucideIcon; href: string; className?: string }) {
  return (
    <Link href={href} className={cx(BTN_BASE, BTN[variant], className)}>
      {Icon && <Icon className="size-4" strokeWidth={1.5} aria-hidden />}
      {children}
    </Link>
  );
}

export function IconButton({ icon: Icon, label, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...p}
      className={cx("inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-rule bg-surface text-muted transition-colors duration-150 hover:bg-hover hover:text-ink disabled:opacity-50", p.className)}
    >
      <Icon className="size-4" strokeWidth={1.5} aria-hidden />
    </button>
  );
}

/** Text docs link: 12px, offset underline, arrow glyph. */
export function DocsLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="inline-flex min-h-6 items-center gap-1 text-xs text-ink underline decoration-rule-strong underline-offset-4 hover:decoration-ink">
      {children}
      <ArrowUpRight className="size-3.5" strokeWidth={1.5} aria-hidden />
    </Link>
  );
}

/** Segmented control: band track r4, the active segment lifts to the surface. */
export function Segmented<T extends string>({ items, value, onChange, label, counts }: { items: { key: T; label: string }[]; value: T; onChange: (v: T) => void; label: string; counts?: Partial<Record<T, number>> }) {
  return (
    <div role="tablist" aria-label={label} className="no-scrollbar inline-flex items-center gap-0.5 overflow-x-auto rounded-sm bg-band p-0.5">
      {items.map((it) => (
        <button
          key={it.key}
          role="tab"
          aria-selected={value === it.key}
          onClick={() => onChange(it.key)}
          className={cx(
            "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-sm px-2.5 text-xs transition-colors duration-150",
            value === it.key ? "bg-surface font-medium text-ink shadow-cta" : "text-muted hover:text-ink",
          )}
        >
          {it.label}
          {counts?.[it.key] !== undefined && <span className="tabular text-subtle">{counts[it.key]}</span>}
        </button>
      ))}
    </div>
  );
}

/** Text tabs as buttons (local state). Neatlogs detection sub-tabs: 28px, r4, active ink 500. */
export function TextTabs<T extends string>({ items, value, onChange, label }: { items: { key: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="no-scrollbar flex items-center gap-0.5 overflow-x-auto">
      {items.map((it) => (
        <button
          key={it.key}
          role="tab"
          aria-selected={value === it.key}
          onClick={() => onChange(it.key)}
          className={cx("inline-flex h-7 shrink-0 items-center gap-1.5 rounded-sm px-2.5 text-sm transition-colors duration-150", value === it.key ? "bg-band font-medium text-ink" : "text-muted hover:text-ink")}
        >
          {it.label}
          {it.count !== undefined && <span className="tabular text-subtle">{it.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Borderless pill chip with a chevron, the Neatlogs filter chip. */
export function FilterChip({ label, value, onClick, active }: { label: string; value?: string; onClick?: () => void; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx("inline-flex h-6.5 shrink-0 items-center gap-1 rounded-xs pl-2.5 pr-1.5 text-xs transition-colors duration-150", active ? "bg-band text-ink" : "text-ink hover:bg-band")}
    >
      {label}
      {value && <span className="text-muted">{value}</span>}
      <ChevronDown className="size-3.5 opacity-60" aria-hidden />
    </button>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("rounded-xl border border-rule bg-surface", className)}>{children}</div>;
}

/** Neatlogs KPI: r12 pad 16, 12/500 label at 80%, 24/500 value, footnote row, mosaic glyph at right. */
export function KpiCard({ label, value, sub, tag, loading, art }: { label: string; value: ReactNode; sub?: ReactNode; tag?: ReactNode; loading?: boolean; art?: ReactNode }) {
  return (
    <Card className="flex min-h-32 flex-col justify-between gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <span className="text-xs font-medium text-muted">{label}</span>
        {art && !loading && <span className="flex shrink-0 items-center" aria-hidden>{art}</span>}
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-xl font-medium tabular text-ink">{loading ? <Skeleton className="my-1 h-7 w-24" /> : value}</span>
        {(sub || tag) && (
          <span className="flex flex-wrap items-center gap-2 text-xs text-subtle">
            {sub && <span>{sub}</span>}
            {tag && <span className="rounded-sm bg-band px-1.5 font-mono text-xs text-muted">{tag}</span>}
          </span>
        )}
      </div>
    </Card>
  );
}

/** The 56px header row inside the main panel: 16px icon, 13px title, right cluster of 32px controls. */
/** Top bar with the breadcrumb and page actions. `heading` adds the page's h1 as a 24px title row under the bar; pages that render their own h1 leave it out. */
export function PageHeader({ icon: Icon, title, meta, children, back, heading }: { icon?: LucideIcon; title: ReactNode; meta?: ReactNode; children?: ReactNode; back?: ReactNode; heading?: ReactNode }) {
  return (
    <>
      <div className="flex min-h-14 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-rule px-4 py-2.5 md:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          {back}
          {Icon && <Icon className="size-4 shrink-0 text-muted" strokeWidth={1.5} aria-hidden />}
          <div className="min-w-0 truncate text-sm text-ink">{title}</div>
          {meta}
        </div>
        <div className="flex flex-wrap items-center gap-2">{children}</div>
      </div>
      {heading && <h1 className="px-4 pt-6 text-xl font-medium text-ink md:px-6">{heading}</h1>}
    </>
  );
}

export function TH({ children, className }: { children?: ReactNode; className?: string }) {
  return <th className={cx("h-10 whitespace-nowrap px-3 text-left text-xs font-medium uppercase tracking-wide text-muted first:pl-4 last:pr-4 md:first:pl-6 md:last:pr-6", className)}>{children}</th>;
}
export function TD({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cx("h-13 px-3 py-1.5 first:pl-4 last:pr-4 md:first:pl-6 md:last:pr-6", className)}>{children}</td>;
}
export function THead({ children }: { children: ReactNode }) {
  return (
    <thead className="bg-band">
      <tr>{children}</tr>
    </thead>
  );
}
export const ROW = "relative border-t border-rule-row transition-colors duration-150 hover:bg-hover";

/** Two-line name cell: 13 primary, 11 muted. */
export function NameCell({ title, sub, lead }: { title: ReactNode; sub?: ReactNode; lead?: ReactNode }) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      {lead}
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm text-ink">{title}</span>
        {sub && <span className="truncate text-xs text-muted">{sub}</span>}
      </span>
    </span>
  );
}

/** Link tabs with counts (Kaggle "Code (453)", drawn as Neatlogs text tabs). */
export function PillTabs<T extends string>({ items, value, hrefFor }: { items: { key: T; label: string; count?: number }[]; value: T; hrefFor: (k: T) => string }) {
  return (
    <nav className="no-scrollbar flex items-center gap-0.5 overflow-x-auto" aria-label="Sections">
      {items.map((it) => (
        <Link
          key={it.key}
          href={hrefFor(it.key)}
          scroll={false}
          aria-current={value === it.key ? "page" : undefined}
          className={cx("inline-flex h-7 shrink-0 items-center gap-1.5 rounded-sm px-2.5 text-sm transition-colors duration-150", value === it.key ? "bg-band font-medium text-ink" : "text-muted hover:text-ink")}
        >
          {it.label}
          {it.count !== undefined && <span className="tabular text-subtle">{it.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

export function PropRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-4 text-sm">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 text-right text-ink">{children}</dd>
    </div>
  );
}

export function SectionTitle({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-lg font-semibold text-ink">{title}</h2>
        {sub && <p className="text-xs text-muted">{sub}</p>}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}

/** Mono caps counter, the trace header "7 STEPS · 5S". */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx("font-mono text-xs uppercase tracking-wide text-subtle", className)}>{children}</span>;
}

/** 4px square track (onboarding) or 8px pill meter. */
export function Progress({ value, kind = "track", tone = "ink", label }: { value: number | null; kind?: "track" | "meter"; tone?: "ink" | "brand" | "warn" | "danger"; label?: string }) {
  const fill = { ink: "bg-ink", brand: "bg-brand", warn: "bg-warn", danger: "bg-danger" }[tone];
  const pct = value === null ? 0 : Math.max(0, Math.min(1, value)) * 100;
  return (
    <span
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value === null ? undefined : Math.round(pct)}
      className={cx("block w-full overflow-hidden", kind === "track" ? "h-1 bg-rule" : "h-2 bg-band")}
    >
      <span className={cx("block h-full transition-width duration-200 ease-out", fill)} style={{ width: `${pct}%` }} />
    </span>
  );
}

/** Inverted code surface (light panel in the dark theme) with a floating Copy. */
export function CodePanel({ code, label = "Copy" }: { code: string; label?: string }) {
  const { copied, copy } = useCopy();
  return (
    <div className="relative rounded-xl bg-code p-4 pr-24">
      <pre className="no-scrollbar overflow-x-auto font-mono text-xs text-code-ink">{code}</pre>
      <button
        type="button"
        onClick={() => copy(code)}
        className="absolute right-2 top-2 inline-flex h-7 items-center gap-1.5 rounded-md bg-surface px-2 text-xs text-ink shadow-cta hover:opacity-90"
      >
        {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
        {copied ? "Copied" : label}
      </button>
    </div>
  );
}

export type Step = { key: string; title: string; sub?: ReactNode; body?: ReactNode; done?: boolean; open?: boolean };
/** Vertical steps: 28px numbered circle, 1px rail below, check when done. */
export function Steps({ steps }: { steps: Step[] }) {
  return (
    <ol className="flex flex-col">
      {steps.map((s, i) => (
        <li key={s.key} className="grid grid-step gap-x-4">
          <span className="flex flex-col items-center">
            <span
              className={cx(
                "inline-flex size-7 shrink-0 items-center justify-center rounded-xs text-xs font-medium tabular",
                s.done ? "bg-brand text-brand-ink" : s.open ? "bg-ink text-surface" : "border border-rule text-muted",
              )}
            >
              {s.done ? <Check className="size-3.5" strokeWidth={2.5} aria-hidden /> : i + 1}
            </span>
            {i < steps.length - 1 && <span className="w-px flex-1 bg-rule" aria-hidden />}
          </span>
          <div className={cx("flex min-w-0 flex-col gap-1", i < steps.length - 1 ? "pb-8" : "pb-2")}>
            <span className="flex min-h-7 items-center text-sm font-medium text-ink">{s.title}</span>
            {s.sub && <span className="text-sm text-muted">{s.sub}</span>}
            {s.open && s.body && <div className="mt-3 animate-step-in">{s.body}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Updated dot: 6px status dot and a mono timestamp at 80%. */
export function Updated({ at, live }: { at: string; live?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-xs text-muted">
      <span className={cx("size-1.5 rounded-full", live ? "bg-ok live-dot" : "bg-subtle")} aria-hidden />
      {at}
    </span>
  );
}

/** Popover anchored under its trigger. Closes on outside click and Escape; focus returns to the trigger. */
export function Popover({ trigger, children, align = "start", side = "bottom", width = "w-popover", className }: {
  trigger: (p: { open: boolean; toggle: () => void; ref: React.Ref<HTMLButtonElement> }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "start" | "end";
  /** "top" opens above the trigger, for triggers pinned to the bottom of a column where a menu below would push the page. */
  side?: "bottom" | "top";
  width?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); btn.current?.focus(); } };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
  }, [open]);
  const close = () => setOpen(false);
  return (
    <div ref={box} className={cx("relative", className)}>
      {trigger({ open, toggle: () => setOpen((o) => !o), ref: btn })}
      {open && (
        <div className={cx("absolute z-50 rounded-xl border border-rule bg-raised p-1 shadow-popover", side === "top" ? "bottom-full mb-1 animate-pop-up" : "mt-1 animate-pop-in", width, align === "end" ? "right-0" : "left-0")}>
          {children(close)}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ icon: Icon, title, hint, href, onClick }: { icon?: LucideIcon; title: string; hint?: ReactNode; href?: string; onClick?: () => void }) {
  const cls = "flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors duration-150 hover:bg-band";
  const body = (
    <>
      {Icon && <Icon className="mt-0.5 size-4 shrink-0 text-muted" strokeWidth={1.5} aria-hidden />}
      <span className="flex min-w-0 flex-col">
        <span className="text-sm text-ink">{title}</span>
        {hint && <span className="text-xs text-muted">{hint}</span>}
      </span>
    </>
  );
  return href ? <Link href={href} onClick={onClick} className={cls}>{body}</Link> : <button type="button" onClick={onClick} className={cls}>{body}</button>;
}

export function relTime(unixSeconds: number, now = Date.now() / 1000) {
  const d = Math.round(now - unixSeconds);
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.round(d / 60)}m ago`;
  if (d < 86400) return `${Math.round(d / 3600)}h ago`;
  return `${Math.round(d / 86400)}d ago`;
}

export function duration(sec: number | null) {
  if (sec === null) return null;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`;
}

/** Filter chip that opens a one-of list with a check on the current choice (Neatlogs chip menu, single select). */
export function ChipSelect<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { key: T; label: string; count?: number }[]; onChange: (v: T) => void }) {
  const cur = options.find((o) => o.key === value);
  const isDefault = options[0]?.key === value;
  return (
    <Popover
      trigger={({ open, toggle, ref }) => (
        <button ref={ref} type="button" onClick={toggle} aria-expanded={open} aria-haspopup="listbox" className={cx("inline-flex h-6.5 shrink-0 items-center gap-1 rounded-xs pl-2.5 pr-1.5 text-xs transition-colors duration-150", open || !isDefault ? "bg-band text-ink" : "text-ink hover:bg-band")}>
          {label}
          {!isDefault && cur && <span className="text-muted">{cur.label}</span>}
          <ChevronDown className="size-3.5 opacity-60" aria-hidden />
        </button>
      )}
    >
      {(close) => (
        <div role="listbox" aria-label={label} className="flex flex-col">
          {options.map((o) => (
            <button key={o.key} type="button" role="option" aria-selected={o.key === value} onClick={() => { onChange(o.key); close(); }} className={cx("flex h-8 items-center gap-2 rounded-lg px-2 text-left text-sm transition-colors duration-150 hover:bg-band", o.key === value ? "text-ink" : "text-muted")}>
              <span className="flex size-4 items-center justify-center">{o.key === value && <Check className="size-3.5" aria-hidden />}</span>
              <span className="flex-1 truncate">{o.label}</span>
              {o.count !== undefined && <span className="tabular text-xs text-subtle">{o.count}</span>}
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}

/** Sticky pager bar: rows per page and range. One page today; the controls show the range honestly. */
export function Pager({ shown, total }: { shown: number; total: number }) {
  return (
    <footer className="sticky bottom-0 flex h-11 items-center justify-between gap-4 border-t border-rule bg-surface px-4 text-xs text-muted md:px-6">
      <span className="flex items-center gap-2">Rows per page <span className="inline-flex h-7 items-center rounded-md border border-rule px-2 font-mono text-ink">25</span></span>
      <span className="font-mono tabular">{shown ? `1-${shown} of ${total}` : "0 of 0"}</span>
    </footer>
  );
}

/** Detail page breadcrumb for the header row: back arrow, then parent > current (Neatlogs detection detail). */
export function Crumbs({ items }: { items: { href?: string; label: ReactNode; mono?: boolean }[] }) {
  const parent = [...items].reverse().find((i, k) => k > 0 && i.href);
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-sm">
      {parent?.href && (
        <Link href={parent.href} aria-label="Back" className="inline-flex size-6 items-center justify-center rounded-sm text-muted hover:bg-band hover:text-ink">
          <ArrowLeft className="size-4" strokeWidth={1.5} />
        </Link>
      )}
      {items.map((x, i) => (
        <span key={i} className="flex min-w-0 items-center gap-2">
          {i > 0 && <ChevronRight className="size-3.5 shrink-0 text-subtle" aria-hidden />}
          {i === items.length - 1 || !x.href ? (
            <span aria-current={i === items.length - 1 ? "page" : undefined} className={cx("truncate text-ink", x.mono && "font-mono text-xs")}>{x.label}</span>
          ) : (
            <Link href={x.href} className={cx("truncate text-muted hover:text-ink", x.mono && "font-mono text-xs")}>{x.label}</Link>
          )}
        </span>
      ))}
    </nav>
  );
}

/** Mono counters on a stat card: "8 ROUNDS DONE". */
export function Counter({ value, label, tone }: { value: ReactNode; label: string; tone?: "warn" | "danger" | "ok" }) {
  const cls = tone ? { warn: "text-warn", danger: "text-danger", ok: "text-ok" }[tone] : "text-ink";
  return (
    <div className="flex flex-col gap-1">
      <dd className={cx("font-mono text-lg tabular", cls)}>{value}</dd>
      <dt className="text-xs text-muted first-letter:uppercase">{label}</dt>
    </div>
  );
}

/** Right-hand Properties rail of a detail page. */
export function PropsRail({ children, title = "Properties" }: { children: ReactNode; title?: string }) {
  return (
    <aside className="border-t border-rule px-4 py-5 md:px-6 xl:border-l xl:border-t-0">
      <p className="pb-2 text-xs font-medium text-muted">{title}</p>
      <dl className="flex flex-col divide-y divide-rule-row">{children}</dl>
    </aside>
  );
}
