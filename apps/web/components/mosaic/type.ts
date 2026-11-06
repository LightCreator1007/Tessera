// Giant type as a mosaic field: render words in the display face to an offscreen canvas and use the ink as a grey
// map, so a step name, a percentage or a state word is drawn by lit tiles the same way the animal figures are.
"use client";

import { useEffect, useState } from "react";
import type { Gray } from "./fields";

const cache = new Map<string, Gray>();

export function textGray(text: string, weight = 600, tracking = -0.04): Gray {
  const key = `${weight}|${tracking}|${text}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const lines = text.split("\n");
  const size = 220;
  const fam = getComputedStyle(document.documentElement).getPropertyValue("--font-sans").trim() || "sans-serif";
  const c = document.createElement("canvas");
  const x = c.getContext("2d", { willReadFrequently: true });
  if (!x) throw new Error("2d canvas unavailable");
  const font = `${weight} ${size}px ${fam}`;
  const setup = () => {
    x.font = font;
    x.letterSpacing = `${tracking * size}px`;
    x.textBaseline = "alphabetic";
  };
  setup();
  const lh = size * 0.9;
  const w = Math.ceil(Math.max(...lines.map((l) => x.measureText(l).width))) + 24;
  const h = Math.ceil(lh * lines.length + size * 0.22);
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  setup();
  x.fillStyle = "white";
  lines.forEach((l, i) => x.fillText(l, 12, size * 0.8 + i * lh));
  const px = x.getImageData(0, 0, c.width, c.height).data;
  const data = new Float32Array(c.width * c.height);
  for (let i = 0; i < data.length; i++) data[i] = px[i * 4 + 3] / 255;
  const g = { w: c.width, h: c.height, data };
  cache.set(key, g);
  return g;
}

/**
 * Which line of a multi-line textGray a canvas y falls on, for a height-limited contain fit with vertical anchor 0.5.
 * Matches the layout above: lines every 0.9 em, 0.22 em of bottom room.
 */
export function lineAt(y: number, H: number, lines: number, scale: number) {
  const em = lines * 0.9 + 0.22;
  const top = (H - H * scale) / 2;
  const yem = ((y - top) / (H * scale)) * em;
  return Math.max(0, Math.min(lines - 1, Math.floor((yem - 0.05) / 0.9)));
}

/** The grey map for a word, built once the display font has loaded (null before that). */
export function useTextGray(text: string, weight = 600): Gray | null {
  const [g, setG] = useState<Gray | null>(null);
  useEffect(() => {
    let live = true;
    document.fonts.ready.then(() => live && setG(textGray(text, weight)));
    return () => {
      live = false;
    };
  }, [text, weight]);
  return g;
}
