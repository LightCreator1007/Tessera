"use client";
// A round's progress for the Live rounds card. Segments is the shipped form; rail and roster stay as variants of the same round.
import type { Round, RoundStatus } from "@/lib/api/types";
import { ROUND_LABEL, cx, short } from "./primitives";

export type ProgressStyle = "segments" | "rail" | "roster";
const PHASES: { key: RoundStatus; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "committing", label: "Commit" },
  { key: "revealing", label: "Reveal" },
  { key: "verifying", label: "Replay" },
  { key: "finalized", label: "Pay" },
];

type Read = { idx: number; sub: number; terminal: boolean; status: RoundStatus | null };

/** Where the round is: the phase index, and how far through that phase (commit and reveal count the roster; the rest are all or nothing). */
function read(r: Round | null): Read {
  const status = r?.status ?? null;
  const terminal = status === "reverted" || status === "voided" || status === "fallback";
  const idx = status === null ? -1 : terminal ? PHASES.length - 1 : PHASES.findIndex((p) => p.key === status);
  const n = r ? r.roster.length : 0; // no round means no seats to count, not a missing reading
  const sub = !r || n === 0 ? 0 : status === "committing" ? r.committed.length / n : status === "revealing" ? r.revealed.length / n : status === "finalized" ? 1 : 0;
  return { idx, sub, terminal, status };
}

const endTone = (s: RoundStatus | null) => (s === "reverted" ? "bg-danger" : "bg-warn");

export function RoundProgress({ round, variant }: { round: Round | null; variant: ProgressStyle }) {
  const r = read(round);
  if (variant === "rail") return <Rail r={r} />;
  if (variant === "roster" && round) return <Roster round={round} r={r} />;
  return <Segments r={r} />;
}

/** A: five segments. Finished phases are solid red, the live one fills by its own progress with a sheen running over it. */
function Segments({ r }: { r: Read }) {
  return (
    <ol className="grid grid-cols-5 gap-1" aria-label="Round phase">
      {PHASES.map((p, i) => {
        const done = i < r.idx || (i === r.idx && r.status === "finalized");
        const now = i === r.idx && !done;
        const fill = done ? 1 : now ? Math.max(r.sub, 0.08) : 0;
        return (
          <li key={p.key} aria-current={now ? "step" : undefined} className="flex min-w-0 flex-col gap-1.5">
            <span className="relative h-2 overflow-hidden rounded-xs bg-band">
              <span
                className={cx("absolute inset-0 origin-left transition-transform duration-500 ease-out", now && r.terminal ? endTone(r.status) : "bg-mosaic", now && !r.terminal && "progress-sheen")}
                style={{ transform: `scaleX(${fill})` }}
              />
            </span>
            <span className={cx("flex items-baseline justify-between gap-1 truncate text-xs", now ? "text-ink" : done ? "text-muted" : "text-subtle")}>
              {now && r.terminal ? ROUND_LABEL[r.status!] : p.label}
              {now && r.sub > 0 && r.sub < 1 && <span className="font-mono text-subtle">{Math.round(r.sub * 100)}%</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** B: one track with five stations. The red line runs continuously to where the round is, the live station rings. */
function Rail({ r }: { r: Read }) {
  const last = PHASES.length - 1;
  const at = r.idx < 0 ? 0 : Math.min(last, r.idx + (r.status === "finalized" ? 0 : r.sub)) / last;
  return (
    <div className="flex flex-col gap-2" aria-label={`Round phase: ${r.status ? ROUND_LABEL[r.status] : "not started"}`}>
      <div className="relative mx-1.5 h-3">
        <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-rule-strong" />
        <span className="absolute inset-x-0 top-1/2 h-0.5 origin-left -translate-y-1/2 bg-mosaic transition-transform duration-500 ease-out" style={{ transform: `scaleX(${at})` }} />
        {PHASES.map((p, i) => {
          const done = i < r.idx || (i === r.idx && r.status === "finalized");
          const now = i === r.idx && !done;
          return (
            <span
              key={p.key}
              className={cx(
                "absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 transition-colors duration-300",
                done ? "border-mosaic bg-mosaic" : now ? cx("bg-surface", r.terminal ? "border-warn" : "border-mosaic station-ring") : "border-rule-strong bg-surface",
              )}
              style={{ left: `${(i / last) * 100}%` }}
            />
          );
        })}
      </div>
      <ol className="flex justify-between text-xs">
        {PHASES.map((p, i) => {
          const now = i === r.idx && r.status !== "finalized";
          return <li key={p.key} className={cx("w-0 whitespace-nowrap text-center first:text-left last:text-right", now ? "text-ink" : i < r.idx ? "text-muted" : "text-subtle")}><span className={cx("inline-block", i === 0 ? "" : i === last ? "-translate-x-full" : "-translate-x-1/2")}>{now && r.terminal ? ROUND_LABEL[r.status!] : p.label}</span></li>;
        })}
      </ol>
    </div>
  );
}

/** C: the roster itself. One column per seat, two cells each: committed, then revealed. You see who the round is waiting on. */
function Roster({ round, r }: { round: Round; r: Read }) {
  const committed = new Set(round.committed);
  const revealed = new Set(round.revealed);
  const pastReveal = r.idx > 2;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5" role="list" aria-label="Roster progress">
        {round.roster.map((s, i) => {
          const c = committed.has(s.op) || pastReveal;
          const v = revealed.has(s.op) || pastReveal;
          return (
            <span key={s.op} role="listitem" title={`${short(s.op)} · shard ${s.shard} · ${v ? "revealed" : c ? "committed" : "waiting"}`} className="group flex flex-col gap-0.5">
              <span className={cx("h-2.5 w-5 rounded-xs transition-colors duration-300", c ? "bg-mosaic" : "border border-rule-strong")} style={{ transitionDelay: `${i * 40}ms` }} />
              <span className={cx("h-2.5 w-5 rounded-xs transition-colors duration-300", v ? "bg-brand-cream" : "border border-rule-strong")} style={{ transitionDelay: `${i * 40 + 20}ms` }} />
            </span>
          );
        })}
      </div>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-subtle">
        <span className="text-ink">{r.status ? ROUND_LABEL[r.status] : "Not started"}</span>
        <span className="flex items-center gap-1"><span className="size-2 rounded-xs bg-mosaic" aria-hidden />committed</span>
        <span className="flex items-center gap-1"><span className="size-2 rounded-xs bg-brand-cream" aria-hidden />revealed</span>
      </p>
    </div>
  );
}
