"use client";
// /activity: the threads screen on real data. Opening the page marks everything seen for the sidebar badge, while the page keeps this visit's "new" highlights until you leave or mark them read.
import { useEffect, useRef, useState } from "react";
import { openConnect } from "@/components/connect";
import { ActivityScreen } from "./ActivityScreen";
import { markSeen, readSeen, useActivity } from "./useActivity";

// Titles already name the job and round, so the "where" line would repeat them.
const SHOW = { detail: true, chips: false, amount: true, tx: false, block: false, time: "relative" } as const;

export function ActivityPage() {
  const [since, setSince] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now() / 1000);
  const opened = useRef(false);
  useEffect(() => {
    // Read before marking, once per mount: a second run (strict mode) would read the time it just wrote and lose the highlights.
    if (opened.current) return;
    opened.current = true;
    setSince(readSeen());
    markSeen();
  }, []);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now() / 1000), 30_000);
    return () => window.clearInterval(t);
  }, []);
  const a = useActivity(since);
  return (
    <ActivityScreen
      acts={a.acts}
      attention={a.attention}
      threads={a.threads}
      state={a.state}
      signedIn={a.signedIn}
      onConnect={openConnect}
      onRetry={a.retry}
      onReadAll={() => { const t = Date.now() / 1000; setSince(t); markSeen(t); }}
      show={SHOW}
      density="comfortable"
      showAttention
      showFacets
      preview={2}
      progress="segments"
      groupRepeats
      stagger={false}
      arrived={null}
      now={now}
    />
  );
}
