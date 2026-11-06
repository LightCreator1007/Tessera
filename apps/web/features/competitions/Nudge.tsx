"use client";
// A one-time suggestion on the owner's node page: once earnings cover an open competition's fee, point at it. It goes away for good on dismiss or on click.
import Link from "next/link";
import { useEffect, useState } from "react";
import { Trophy, X } from "lucide-react";
import { Money } from "@/components/primitives";
import { entryGate, useCompetitions } from "./model";

const KEY = "tod-competition-nudge";

function seen() {
  try {
    return localStorage.getItem(KEY) === "done";
  } catch {
    return true; // Storage blocked: without a way to remember the dismissal, showing it on every visit would nag, so stay quiet.
  }
}

function markSeen() {
  try {
    localStorage.setItem(KEY, "done");
  } catch {
    // Storage blocked: the nudge is already hidden for this visit through state, which is all that can be kept.
  }
}

export function CompetitionNudge() {
  const { list, w } = useCompetitions();
  const [hidden, setHidden] = useState(true);
  useEffect(() => setHidden(seen()), []);
  if (hidden || w.claimable === 0) return null;
  const pick = list
    .filter((c) => c.fee > 0 && c.fee <= w.claimable && entryGate(c, w).ok)
    .sort((a, b) => Date.parse(a.deadline) - Date.parse(b.deadline))[0];
  if (!pick) return null;
  const done = () => { markSeen(); setHidden(true); };

  return (
    <div role="note" className="flex items-start gap-3 rounded-lg border border-rule bg-raised px-4 py-3">
      <Trophy className="mt-0.5 size-4 shrink-0 text-muted" strokeWidth={1.5} aria-hidden />
      <p className="min-w-0 flex-1 text-sm text-muted">
        You&apos;ve earned enough to enter <Link href={`/competitions/${pick.id}`} onClick={done} className="text-ink underline decoration-rule-strong underline-offset-4 hover:decoration-ink">{pick.title}</Link>. The fee is <Money units={pick.fee} />, paid from earnings.
      </p>
      <button type="button" onClick={done} aria-label="Dismiss" className="-my-1 -mr-2 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-subtle hover:bg-hover hover:text-ink">
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}
