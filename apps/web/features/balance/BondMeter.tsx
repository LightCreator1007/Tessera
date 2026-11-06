"use client";
// The earned-bond meter: one track, two zones. Earnings fill the bond zone up to the threshold; past it they spill into the withdrawable zone. Slashes are ticks on the track, each linked to its receipt. Pending pay is drawn hatched and never counts toward the threshold.
import Link from "next/link";
import { formatToken, TOKEN_SYMBOL } from "@/lib/money";
import { cx } from "@/components/primitives";
import { Term } from "@/components/term";

export type Slash = { amount: number; href: string; label: string };

export function BondMeter({ held, threshold, pending, slashes = [] }: { held: number; threshold: number; pending: number; slashes?: Slash[] }) {
  const bond = Math.min(held, threshold);
  const free = Math.max(0, held - threshold);
  const span = Math.max(threshold * 1.5, held + pending);
  const pct = (v: number) => `${(v / span) * 100}%`;
  const left = threshold - bond;
  const unlocked = left <= 0;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink">
        <span className="font-mono tabular">{formatToken(bond)}</span>
        <span className="text-muted"> / {formatToken(threshold)} {TOKEN_SYMBOL} held as your <Term k="bond">bond</Term>. </span>
        {unlocked ? <span className="text-ok">{free > 0 ? `${formatToken(free)} ${TOKEN_SYMBOL} withdrawable.` : "Withdrawals unlocked. Nothing above the bond yet."}</span> : <span>{formatToken(left)} more to unlock withdrawals.</span>}
      </p>
      <div className="relative h-3" role="img" aria-label={`${formatToken(bond)} of ${formatToken(threshold)} held, ${formatToken(free)} withdrawable, ${formatToken(pending)} pending`}>
        <span className="absolute inset-0 rounded-full bg-band" />
        <span className="absolute inset-y-0 left-0 rounded-l-full bg-ink transition-width duration-200 ease-out" style={{ width: pct(bond) }} />
        <span className="absolute inset-y-0 bg-ok transition-width duration-200 ease-out" style={{ left: pct(threshold), width: pct(free) }} />
        {pending > 0 && <span className="absolute inset-y-0 bg-hatch opacity-60" style={{ left: pct(held), width: pct(pending) }} />}
        <span className="absolute -inset-y-1 w-px bg-ink" style={{ left: pct(threshold) }} aria-hidden />
      </div>
      <div className="relative h-4 font-mono text-xs uppercase tracking-wide text-subtle">
        <span className="absolute left-0">bond</span>
        <span className="absolute -translate-x-1/2" style={{ left: pct(threshold) }}>{formatToken(threshold)}</span>
        <span className={cx("absolute right-0", free > 0 ? "text-ok" : "")}>withdrawable</span>
      </div>
      {pending > 0 && <p className="text-xs text-pending">Pending: {formatToken(pending)} {TOKEN_SYMBOL}, final when verifiers sign. Pending pay doesn&apos;t count toward the threshold.</p>}
      {slashes.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs">
          {slashes.map((s) => (
            <li key={s.href} className="flex items-center gap-2 text-danger">
              <span className="size-1.5 rounded-full bg-danger" aria-hidden />-{formatToken(s.amount)} {TOKEN_SYMBOL} <Link href={s.href} className="text-muted underline decoration-subtle underline-offset-4 hover:text-ink">{s.label}</Link>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted">Only held money can be <Term k="slash">slashed</Term>. What you&apos;ve withdrawn is yours.</p>
    </div>
  );
}
