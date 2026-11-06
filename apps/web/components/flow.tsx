"use client";
// Flow building blocks: the transaction button and its status line, the one-step-at-a-time wizard (progress, step panel, sub-step sequence, disclosure), the wallet gate, and copyable terminal commands.
import { TermTexture } from "@/components/mosaic/TermTexture";
import { Typer } from "@/components/mosaic/widgets";
import { useEffect, useState, type ReactNode } from "react";
import { Check, ChevronRight, Copy, ExternalLink, Loader2, Wallet } from "lucide-react";
import { useWallet } from "@/lib/wallet";
import type { useTx } from "@/lib/tx";
import { openConnect } from "./connect";
import { Button, cx, short, TileBusy } from "./primitives";

type Tx = ReturnType<typeof useTx>;

const LABEL = { wallet: "Confirm in your wallet", pending: "Waiting for the block" } as const;

/** The only way to send a transaction: locks on first click, shows wallet and pending phases, never double-submits. Without a ready wallet it becomes the way to get one. */
export function TxButton({ tx, label, onRun, disabled, why, variant = "primary" }: { tx: Tx; label: string; onRun: () => void; disabled?: boolean; why?: string; variant?: "primary" | "secondary" }) {
  const w = useWallet();
  if (tx.phase === "confirmed") return <span className="animate-tx-glint inline-flex h-9 items-center gap-2 rounded-md bg-ok-bg px-3 text-sm text-ok"><Check className="size-4" aria-hidden />Done</span>;
  if (!w.connected || w.wrongNetwork) {
    return <Button variant={variant} onClick={openConnect} icon={Wallet}>{w.connected ? "Switch network first" : "Connect wallet first"}</Button>;
  }
  return (
    <Button variant={variant} disabled={disabled || tx.busy} title={disabled ? why : undefined} onClick={onRun} aria-busy={tx.busy} className={cx(tx.phase === "reverted" && "animate-tx-crack")}>
      {tx.busy ? <TileBusy /> : null}
      <span className={cx(tx.phase === "reverted" && "text-danger")}>{tx.busy ? LABEL[tx.phase as "wallet" | "pending"] : tx.phase === "rejected" || tx.phase === "reverted" ? `Try again: ${label.toLowerCase()}` : label}</span>
    </Button>
  );
}

/** One line under a tx button: what happened, with the hash once there is one. */
export function TxStatus({ tx }: { tx: Tx }) {
  if (tx.phase === "idle" || tx.phase === "wallet") return null;
  const tone = { pending: "text-pending", confirmed: "text-ok", rejected: "text-muted", reverted: "text-danger" }[tx.phase];
  const text = { pending: "Sent. Waiting for it to land in a block.", confirmed: "Confirmed on Base Sepolia.", rejected: tx.reason, reverted: `Reverted. ${tx.reason}` }[tx.phase];
  return (
    <p role={tx.phase === "reverted" ? "alert" : "status"} className={cx("flex flex-wrap items-center gap-x-2 text-sm", tone)}>
      {text}
      {tx.hash && (
        <a href={`https://sepolia.basescan.org/tx/${tx.hash}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-xs text-muted hover:text-ink">
          {short(tx.hash)} <ExternalLink className="size-3" aria-hidden />
        </a>
      )}
    </p>
  );
}

export type StepState = "done" | "current" | "todo";

/** Routing for a wizard whose position is derived from chain state. Every step change goes through go(); looking back at a finished step never moves the real position, and any state change snaps the view back to it. */
export function useWizard(current: number) {
  const [view, setView] = useState<number | null>(null);
  useEffect(() => setView(null), [current]);
  const shown = view !== null && view < current ? view : current;
  return { shown, go: (i: number | null) => setView(i === null || i >= current ? null : i), state: (i: number): StepState => (i < current ? "done" : i === current ? "current" : "todo") };
}

/** Wizard progress: one tile per step. Finished steps stay clickable so you can look back without losing your place. */
export function WizardProgress({ steps, shown, onPick, aside }: { steps: { key: string; label: string; state: StepState }[]; shown: number; onPick: (i: number) => void; aside?: ReactNode }) {
  return (
    <nav aria-label="Progress" className="flex flex-col gap-3">
      <div className="flex items-baseline gap-3">
        <p className="font-mono text-xs tabular text-subtle">{String(shown + 1).padStart(2, "0")} / {String(steps.length).padStart(2, "0")}</p>
        <p className="text-sm text-muted">{steps[shown]?.label}</p>
        <span className="ml-auto">{aside}</span>
      </div>
      <ol className="flex gap-1.5">
        {steps.map((s, i) => (
          <li key={s.key} className="flex-1">
            <button
              type="button"
              disabled={s.state === "todo"}
              onClick={() => onPick(i)}
              aria-current={i === shown ? "step" : undefined}
              aria-label={`${s.label}, ${s.state === "done" ? "done" : s.state === "current" ? "current step" : "not yet"}`}
              className="group flex h-6 w-full items-center disabled:cursor-default"
            >
              <span
                className={cx(
                  "h-1.5 w-full rounded-xs transition-colors",
                  s.state === "done" && "bg-ink group-hover:opacity-80",
                  s.state === "current" && "bg-mosaic",
                  s.state === "todo" && "bg-rule",
                  i === shown && s.state === "done" && "outline-2 outline-offset-2 outline-ink",
                )}
              />
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** One wizard step on its own: a title, a single sentence of why, the one thing to do, and a footer. Everything else hides behind More. */
export function StepPanel({ eyebrow, title, lede, children, footer }: { eyebrow?: ReactNode; title: string; lede?: ReactNode; children?: ReactNode; footer?: ReactNode }) {
  return (
    <section className="animate-step-in flex flex-col gap-10">
      <header className="flex flex-col gap-3">
        {eyebrow && <p className="text-xs uppercase tracking-wider text-subtle">{eyebrow}</p>}
        <h1 className="text-balance text-xl font-medium text-ink">{title}</h1>
        {lede && <p className="max-w-prose text-sm leading-relaxed text-muted">{lede}</p>}
      </header>
      {children}
      {footer && <div className="flex flex-wrap items-center gap-3">{footer}</div>}
    </section>
  );
}

/** Labelled disclosure for the second layer: the why, the troubleshooting, the advanced settings. */
export function More({ label, children, open }: { label: string; children: ReactNode; open?: boolean }) {
  return (
    <details className="more group" open={open}>
      <summary className="inline-flex cursor-pointer list-none items-center gap-2 rounded-sm text-sm text-muted hover:text-ink">
        <ChevronRight className="size-4 transition-transform group-open:rotate-90" aria-hidden />
        {label}
      </summary>
      <div className="flex flex-col gap-3 pt-4 pl-6 text-sm leading-relaxed text-muted">{children}</div>
    </details>
  );
}

/** Sub-steps inside one wizard step (approve, join, deposit). Only the first unfinished one is open; finished ones shrink to a line, later ones wait as a faint title. */
export function Sequence({ items }: { items: { key: string; title: string; done: boolean; note?: ReactNode; body: ReactNode }[] }) {
  const active = items.findIndex((x) => !x.done);
  return (
    <ol className="flex flex-col">
      {items.map((x, i) => {
        const state = x.done ? "done" : i === active ? "current" : "todo";
        return (
          <li key={x.key} className="grid grid-step">
            <span className="flex flex-col items-center">
              <span
                className={cx(
                  "inline-flex size-6 shrink-0 items-center justify-center rounded-xs font-mono text-xs",
                  state === "done" && "bg-ink text-brand-ink",
                  state === "current" && "bg-mosaic text-surface",
                  state === "todo" && "border border-rule text-subtle",
                )}
                aria-hidden
              >
                {state === "done" ? <Check className="size-3.5" /> : i + 1}
              </span>
              {i < items.length - 1 && <span className={cx("my-1.5 w-px flex-1", state === "done" ? "bg-ink" : "bg-rule")} />}
            </span>
            <div className={cx("flex min-w-0 flex-col gap-4", i < items.length - 1 ? "pb-7" : "pb-1")}>
              <p className={cx("flex min-h-6 flex-wrap items-center gap-x-3", state === "current" ? "text-sm text-ink" : state === "done" ? "text-sm text-muted" : "text-sm text-subtle")}>
                <span className="sr-only">{state === "done" ? "Done: " : state === "current" ? "Now: " : "Later: "}</span>
                {x.title}
                {state === "done" && x.note && <span className="text-sm text-subtle">{x.note}</span>}
              </p>
              {state === "current" && <div className="animate-step-in flex flex-col items-start gap-3">{x.body}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Connect and network guard for pages that read your own data. */
export function WalletGate({ why }: { why: string }) {
  const w = useWallet();
  if (w.connected && !w.wrongNetwork) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-rule bg-raised px-4 py-3">
      <Wallet className="size-4 text-muted" strokeWidth={1.5} aria-hidden />
      <p className="min-w-0 flex-1 text-sm text-muted">{w.wrongNetwork ? "Your wallet is on another network. Everything here is on Base Sepolia." : why}</p>
      <Button variant="primary" onClick={openConnect}>{w.wrongNetwork ? "Switch network" : "Connect wallet"}</Button>
    </div>
  );
}

/** A terminal command with copy. One per OS where they differ. */
export function Command({ cmd, label }: { cmd: string; label?: string }) {
  const [copied, setCopied] = useState<"ok" | "failed" | null>(null);
  const [plays, setPlays] = useState(0);
  // The whole command lands in under a second however long it is.
  const per = Math.max(4, Math.min(22, 900 / Math.max(1, cmd.length)));
  const copy = () => {
    const settle = (s: "ok" | "failed") => {
      setCopied(s);
      if (s === "ok") setPlays((p) => p + 1);
      setTimeout(() => setCopied(null), 1500);
    };
    // Only claim "ok" once the write resolves: it is refused without a secure context or clipboard permission.
    if (!navigator.clipboard) return settle("failed");
    navigator.clipboard.writeText(cmd).then(() => settle("ok"), () => settle("failed"));
  };
  return (
    <div className="flex w-full flex-col gap-1.5">
      {label && <span className="text-xs uppercase tracking-wider text-subtle">{label}</span>}
      <div className="relative overflow-hidden rounded-lg border border-rule p-3">
        <TermTexture className="absolute inset-0" />
      <div className="relative flex items-start gap-2 border border-rule bg-surface p-4">
        <span className={cx("min-w-4 shrink-0 select-none font-mono text-sm", copied === "ok" ? "text-bone" : "text-mosaic")} aria-hidden>{copied === "ok" ? "ok" : "$"}</span>
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre font-mono text-sm leading-relaxed text-brand-cream no-scrollbar"><Typer text={cmd} play={plays} per={per} rolls={2} /></code>
        {copied === "failed" && <span role="status" className="shrink-0 self-center font-mono text-xs text-danger">select and copy by hand</span>}
        <button
          type="button"
          onClick={copy}
          aria-label={copied === "ok" ? "Copied" : copied === "failed" ? "Copy failed" : "Copy command"}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-brand-cream/60 hover:text-brand-cream"
        >
          {copied === "ok" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </button>
      </div>
      </div>
    </div>
  );
}
