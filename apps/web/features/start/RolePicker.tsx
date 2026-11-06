"use client";
// /start: pick a role, see its promise, and go to that role's first proof of value. The pick is remembered in this browser only.
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, Cpu, Laptop, Trophy } from "lucide-react";
import { Eyebrow, cx } from "@/components/primitives";
import { PosterThumb, VOCAB_SHORT, useWordField } from "@/components/mosaic/PosterCard";
import { coverById } from "@/components/mosaic/figures";

const KEY = "tod-role";
const ROLES = [
  { key: "lend", word: "LEND", icon: Laptop, title: "Lend a laptop", promise: "Your laptop trains verified jobs. Earnings pay for your own jobs or competition entries.", first: { href: "/demo", label: "Watch a replay catch a lazy node, 40 s" }, then: { href: "/nodes/add", label: "Add your laptop" } },
  { key: "train", word: "TRAIN", icon: Cpu, title: "Train a model", promise: "Lock a budget. Laptops train it, verifiers check every round, and you pay only for verified work.", first: { href: "/demo", label: "See how a round is checked" }, then: { href: "/jobs/new", label: "Start from a preset job" } },
  { key: "host", word: "HOST", icon: Trophy, title: "Host a competition", promise: "Commit your labels up front. Nobody, including you, can change the scoring afterwards.", first: { href: "/competitions/leaf-10", label: "Open a finished example" }, then: { href: "/competitions/new", label: "Host a competition" } },
] as const;
type Role = (typeof ROLES)[number]["key"];

function read(): Role | null {
  try {
    const v = localStorage.getItem(KEY);
    return ROLES.some((r) => r.key === v) ? (v as Role) : null;
  } catch {
    return null; // Storage blocked (private mode): the page works without remembering.
  }
}

function RoleArt({ word, on }: { word: string; on: boolean }) {
  const field = useWordField(word, on);
  return <PosterThumb field={field} label={word} vocab={VOCAB_SHORT} cell={6} className="h-48 border-b border-rule" />;
}

export function RolePicker() {
  const [role, setRole] = useState<Role | null>(null);
  useEffect(() => setRole(read()), []);
  const pick = (r: Role) => {
    setRole(r);
    try { localStorage.setItem(KEY, r); } catch { /* Not remembered when storage is blocked; the choice still applies on this page. */ }
  };
  return (
    <div className="relative min-h-full overflow-hidden">
      <PosterThumb cover={coverById("tiger")} live label="Tiger poster" cell={7} className="absolute inset-0" />
    <div className="relative mx-4 my-6 flex max-w-flow flex-col gap-8 border border-rule bg-surface px-4 py-8 md:mx-auto md:my-12 md:px-8">
      <header className="flex flex-col gap-2">
        <Eyebrow>Start</Eyebrow>
        <h1 className="text-xl font-medium text-ink">What brings you to Tessera?</h1>
        <p className="text-sm text-muted">Pick one. You can switch any time, and every path starts by showing you a real check before asking for anything.</p>
      </header>
      <ul className="grid gap-3 md:grid-cols-3" role="radiogroup" aria-label="Your role">
        {ROLES.map((r) => {
          const on = role === r.key;
          return (
            <li key={r.key} className="flex">
              <button type="button" role="radio" aria-checked={on} onClick={() => pick(r.key)} className={cx("flex flex-1 flex-col items-stretch overflow-hidden rounded-xl border text-left transition-colors duration-150 ease-out", on ? "border-rule-strong bg-band" : "border-rule bg-card hover:border-rule-strong")}>
                <RoleArt word={r.word} on={on || role === null} />
                <span className="flex flex-col gap-1.5 px-4 pb-4 pt-3">
                  <span className="flex items-center gap-2 font-mono text-xs text-mosaic"><r.icon className="size-3.5" strokeWidth={1.5} aria-hidden />{r.word.toLowerCase()}</span>
                  <span className="text-xl font-medium tracking-tight text-ink">{r.title}</span>
                  <span className="text-sm text-muted">{r.promise}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {role && (() => {
        const r = ROLES.find((x) => x.key === role)!;
        return (
          <section aria-label="Next steps" key={role} className="flex animate-step-in flex-col gap-3 rounded-xl border border-rule p-4 sm:flex-row sm:items-center sm:justify-between">
            <Link href={r.first.href} className="inline-flex h-9 items-center gap-2 rounded-md bg-accent px-3 text-sm font-medium text-accent-ink shadow-cta transition-opacity duration-150 hover:opacity-90">
              {r.first.label} <ArrowRight className="size-4" aria-hidden />
            </Link>
            <Link href={r.then.href} className="text-sm text-muted underline decoration-subtle underline-offset-4 hover:text-ink">Skip to: {r.then.label}</Link>
          </section>
        );
      })()}
    </div>
    </div>
  );
}
