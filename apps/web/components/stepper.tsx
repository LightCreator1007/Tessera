"use client";
// A one-line stepper: numbered mono labels joined by hairlines. Done steps get a check (and can link back), the current one is ink.
import Link from "next/link";
import { Check } from "lucide-react";
import { cx } from "@/components/primitives";

export type Step = { key: string; word: string; label: string; href?: string };

export function Stepper({ steps, current, label = "Progress" }: { steps: readonly Step[]; current: number; label?: string }) {
  return (
    <nav aria-label={label}>
      <ol className="flex items-center gap-3 font-mono text-xs uppercase tracking-wide">
        {steps.map((s, i) => {
          const state = i < current ? "done" : i === current ? "current" : "todo";
          const body = (
            <span className={cx("flex items-center gap-2 whitespace-nowrap transition-colors duration-150 ease-out", state === "done" && "text-muted hover:text-ink", state === "current" && "text-ink", state === "todo" && "text-subtle")}>
              {state === "done" ? <Check className="size-3.5" strokeWidth={2.5} aria-hidden /> : <span className="tabular">{String(i + 1).padStart(2, "0")}</span>}
              <span className={cx(i !== current && "hidden sm:inline")}>{s.word}</span>
            </span>
          );
          return (
            <li key={s.key} className={cx("flex items-center gap-3", i < steps.length - 1 && "flex-1")} aria-current={state === "current" ? "step" : undefined}
              aria-label={`${s.label}, ${state === "done" ? "done" : state === "current" ? "current step" : "not yet"}`}>
              {state === "done" && s.href ? <Link href={s.href}>{body}</Link> : body}
              {i < steps.length - 1 && <span aria-hidden className={cx("h-px flex-1 transition-colors duration-300", i < current ? "bg-ink" : "bg-rule")} />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
