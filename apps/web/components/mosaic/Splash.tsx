// Cold-start splash from the brand playground: once per browser session the app opens on the crow developing while
// the real health checks run (chain, coordinator, blob store), one mono line each. It leaves on its own once the
// checks resolve; a failed check turns its line red and hands over to the page's degraded banners. Skippable with
// Escape or the button, and skipped entirely under reduced motion, when turned off in Settings, or when storage is blocked.
"use client";

import { useEffect, useMemo, useState } from "react";
import { useHealth } from "@/lib/api/hooks";
import { isDemo } from "@/lib/api/client";
import { readPrefs, reducedMotion, usePrefs } from "@/lib/prefs";
import { PosterThumb } from "./PosterCard";
import { coverById, sampler, subjectFit, useGray } from "./figures";
import { tone } from "./fields";
import { VOCAB_FINE, type FieldFn } from "./engine";

const KEY = "tod-splash";

function firstThisSession() {
  try {
    if (sessionStorage.getItem(KEY)) return false;
    sessionStorage.setItem(KEY, "1");
    return true;
  } catch {
    return false; // No storage: never show, so a blocked browser is not stuck seeing it on every load.
  }
}

export function Splash() {
  const [show, setShow] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [shown, setShown] = useState(0);
  const health = useHealth();
  const h = health.data?.data;
  const failed = health.isError;
  const checks = [
    { k: "chain", ok: failed ? null : h ? h.block !== null : null, line: h && h.block !== null ? `base sepolia · block ${h.block.toLocaleString()}` : "reading the chain" },
    { k: "coordinator", ok: failed ? false : h ? h.ok : null, line: failed ? "unreachable · showing chain data only" : isDemo ? "demo data · no coordinator set" : h ? `ok · v${h.version}` : "reaching the coordinator" },
    { k: "store", ok: failed ? false : h ? h.storeOk : null, line: h ? (h.storeOk ? "blob store ok" : "blob store degraded") : "checking the blob store" },
  ];
  const resolved = checks.filter((c) => c.ok !== null).length;
  const progress = Math.min(shown, resolved) / checks.length;

  const prefs = usePrefs();
  useEffect(() => {
    if (!readPrefs().splash || reducedMotion()) return;
    if (firstThisSession()) setShow(true);
  }, []);
  useEffect(() => { if (!prefs.splash) setShow(false); }, [prefs.splash]);
  useEffect(() => {
    if (!show) return;
    const id = setInterval(() => setShown((s) => Math.min(checks.length, s + 1)), 420);
    return () => clearInterval(id);
  }, [show, checks.length]);
  useEffect(() => {
    if (!show || shown < checks.length || resolved < checks.length && !failed) return;
    const t1 = setTimeout(() => setLeaving(true), failed ? 1600 : 900);
    const t2 = setTimeout(() => setShow(false), failed ? 1900 : 1200);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [show, shown, resolved, failed, checks.length]);
  useEffect(() => {
    if (!show) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && setShow(false);
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [show]);

  const crow = coverById("crow");
  const g = useGray(show ? crow.src : null);
  const field: FieldFn = useMemo(() => {
    // The check list sits top left, so the crow is contained to the right half of the viewport.
    const s = sampler(g, subjectFit(crow, { ax: 0.82, pad: 0.08 }));
    return (tile, c) => {
      const v = tone(s(tile, c), crow.tone);
      const th = 1 - Math.max(0.15, progress);
      if (v < 0.1 || v < th - 0.06) return 0;
      return progress < 1 && v < th + 0.05 ? 1.05 : v;
    };
  }, [g, crow, progress]);

  if (!show) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label="Tessera is starting" className={`fixed inset-0 z-50 bg-surface transition-opacity duration-300 ${leaving ? "opacity-0" : "opacity-100"}`}>
      <PosterThumb field={field} label="Cawing crow, developing while the app starts" cell={8} vocab={VOCAB_FINE} live className="absolute inset-0" />
      <div className="absolute left-0 top-0 flex flex-col gap-4 bg-surface p-6 md:p-10">
        <span className="text-hero font-medium tracking-tight text-muted">Tessera</span>
        <ol className="flex flex-col gap-1 font-mono text-xs uppercase tracking-wide">
          {checks.slice(0, shown).map((c) => (
            <li key={c.k} className={c.ok === false ? "text-danger" : c.ok ? "text-ink" : "text-subtle"}>
              <span className="inline-block w-28">{c.k}</span>
              {c.ok === null ? "…" : c.ok ? "ok" : "fail"} · {c.line}
            </li>
          ))}
        </ol>
      </div>
      <button type="button" onClick={() => setShow(false)} className="absolute bottom-6 right-6 bg-surface px-3 py-2 font-mono text-xs uppercase tracking-wide text-muted hover:text-ink">
        skip · esc
      </button>
    </div>
  );
}
