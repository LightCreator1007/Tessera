"use client";
// Inline concept term: dotted underline, a peek on hover intent or focus, one sentence and one fact, then a hand-off to the lesson.
import Link from "next/link";
import { useId, useRef, useState, type ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { GLOSSARY, type TermKey } from "@/lib/learn/glossary";

const OPEN_DELAY = 300;

export function Term({ k, children }: { k: TermKey; children?: ReactNode }) {
  const g = GLOSSARY[k];
  const [open, setOpen] = useState(false);
  const timer = useRef<number | null>(null);
  const id = useId();
  const clear = () => { if (timer.current !== null) window.clearTimeout(timer.current); timer.current = null; };
  const later = (v: boolean, ms: number) => { clear(); timer.current = window.setTimeout(() => setOpen(v), ms); };
  return (
    <span className="relative inline-block" onMouseEnter={() => later(true, OPEN_DELAY)} onMouseLeave={() => later(false, 120)}>
      <button
        type="button"
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={() => { clear(); setOpen((o) => !o); }}
        onFocus={() => setOpen(true)}
        onBlur={(e) => { if (!e.currentTarget.parentElement?.contains(e.relatedTarget as Node)) setOpen(false); }}
        onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
        className="cursor-help underline decoration-subtle decoration-dotted underline-offset-4 hover:decoration-ink"
      >
        {children ?? g.term.toLowerCase()}
      </button>
      {open && (
        <span id={id} role="tooltip" className="absolute left-0 top-full z-50 mt-1.5 flex w-term animate-tip-in flex-col gap-2 rounded-xl border border-rule bg-raised p-3 text-left shadow-popover">
          <span className="text-sm font-medium text-ink">{g.term}</span>
          <span className="text-sm text-muted">{g.line}</span>
          <span className="font-mono text-xs uppercase tracking-wide text-subtle">{g.fact}</span>
          <Link href={`/docs/learn#${g.lesson}`} className="inline-flex items-center gap-1 text-xs text-ink hover:underline">
            Learn more <ArrowRight className="size-3" aria-hidden />
          </Link>
        </span>
      )}
    </span>
  );
}
