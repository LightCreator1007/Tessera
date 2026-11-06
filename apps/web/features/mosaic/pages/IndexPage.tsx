// Playground index: one card per page, each with a live mosaic thumbnail.
"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Mosaic } from "@/components/mosaic/Mosaic";
import { COVERS, figureField, useGray } from "@/components/mosaic/figures";
import { Hero, PAGES, usePalette } from "../shell";

function Thumb({ i }: { i: number }) {
  const pal = usePalette();
  const c = COVERS[i % COVERS.length];
  const g = useGray(c.src);
  const field = useMemo(() => figureField(g, { ...c.fit, fit: "cover" }, c.tone, "dissolve", c.focus), [g, c]);
  return <Mosaic field={field} label={`${c.title} mosaic`} cell={7} seed={i + 2} palette={pal} />;
}

export function IndexPage() {
  return (
    <>
      <Hero title="Word mosaic" meta={"ToD brand playground\nDev only / not in builds\nbrand-direction.md"} />
      <div className="mz-index">
        {PAGES.slice(1).map((p, i) => (
          <Link key={p.href} href={p.href} className="mz-index-card">
            <div className="mz-thumb">
              <Thumb i={i} />
            </div>
            <div className="mz-index-body">
              <span className="mz-index-n">{String(i + 1).padStart(2, "0")}</span>
              <span className="mz-index-title">{p.label}</span>
              <span className="mz-index-note">{p.note}</span>
            </div>
          </Link>
        ))}
      </div>
      <p className="mz-fine" style={{ marginTop: 32 }}>
        Figures: public-domain prints by Ohara Koson, Kishi Ganku and Katsushika Hokusai (Wikimedia Commons), converted to ink-density maps.
      </p>
    </>
  );
}
