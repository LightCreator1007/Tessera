// Shared frame for the mosaic playground: page nav, palette switch (red, ember, bone, lime) and section headers.
"use client";

import "./mosaic.css";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export const PAGES = [
  { href: "/playground/mosaic", label: "Index", note: "Every page in this playground" },
  { href: "/playground/mosaic/covers", label: "Covers", note: "Round posters from animal prints, a studio and image drop" },
  { href: "/playground/mosaic/splash", label: "Splash", note: "TUI and web opening frames driven by health checks" },
  { href: "/playground/mosaic/login", label: "Login", note: "Three sign-in layouts and every wallet-connect state" },
  { href: "/playground/mosaic/onboarding", label: "Onboarding", note: "Role fork, node join and requester journeys as diagrams" },
  { href: "/playground/mosaic/loaders", label: "Loaders", note: "Progress strips, scanners, loss painting, skeletons" },
  { href: "/playground/mosaic/diagrams", label: "Diagrams", note: "Protocol round, pool ripple, seal and fracture" },
  { href: "/playground/mosaic/iso", label: "Isometric", note: "Floor, relief, node city, round stack, system map" },
  { href: "/playground/mosaic/in-app", label: "In the app", note: "Pool, round, node record, live system and join, on real fixtures" },
  { href: "/playground/mosaic/variants", label: "Variants", note: "Five treatments of every figure surface, before and after the fit fix" },
  { href: "/playground/mosaic/states", label: "States", note: "Buttons, empty, success, failure and toasts" },
];

export const PALETTES = ["red", "ember", "bone", "lime"] as const;
export type PaletteName = (typeof PALETTES)[number];

const PaletteCtx = createContext<PaletteName>("red");
export const usePalette = () => useContext(PaletteCtx);

const KEY = "mz-palette";

export function MosaicShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const [pal, setPal] = useState<PaletteName>("red");
  useEffect(() => {
    try {
      const v = localStorage.getItem(KEY);
      if (v && (PALETTES as readonly string[]).includes(v)) setPal(v as PaletteName);
    } catch {
      // Storage blocked (private window): the palette just resets to red, which is the default anyway.
    }
  }, []);
  const pick = (p: PaletteName) => {
    setPal(p);
    try {
      localStorage.setItem(KEY, p);
    } catch {
      // See above: a remembered palette is a convenience only.
    }
  };
  return (
    <PaletteCtx.Provider value={pal}>
      <div className={`mz mz-pal-${pal}`}>
        <div className="mz-wrap">
          <nav className="mz-nav" aria-label="Mosaic playground">
            <div className="mz-seg">
              {PAGES.map((p) => (
                <Link key={p.href} href={p.href} className="mz-btn mz-btn-sm mz-btn-ghost" aria-current={path === p.href ? "page" : undefined}>
                  {p.label}
                </Link>
              ))}
            </div>
            <div className="mz-seg" role="radiogroup" aria-label="Palette">
              {PALETTES.map((p) => (
                <button key={p} type="button" role="radio" aria-checked={pal === p} aria-pressed={pal === p} className="mz-btn mz-btn-sm mz-btn-ghost" onClick={() => pick(p)}>
                  {p}
                </button>
              ))}
            </div>
          </nav>
          {children}
        </div>
      </div>
    </PaletteCtx.Provider>
  );
}

export function Hero({ title, meta }: { title: string; meta: string }) {
  return (
    <header className="mz-hero">
      <h1 className="mz-display">{title}</h1>
      <div className="mz-meta">{meta}</div>
    </header>
  );
}

export function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="mz-section">
      <div className="mz-section-head">
        <h2 className="mz-h2">{title}</h2>
        {note && <p className="mz-note">{note}</p>}
      </div>
      {children}
    </section>
  );
}
