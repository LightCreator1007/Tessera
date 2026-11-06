// The landing page's isometric round: a job feeding four laptops, the coordinator, two verifiers and the contract, staged by step.
"use client";

import { useMemo, useRef } from "react";
import { IsoMosaic, type IsoCell, type IsoLabel, type IsoScene } from "@/components/mosaic/iso";

const W = 21;
const D = 14;
const LAPS = [1, 4, 7, 10]; // laptop rows (j)
const LAZY = 2; // the laptop that skips its work
const MID = 5; // centre row for job, coordinator and contract

function box(out: IsoCell[], taken: Set<string>, i: number, j: number, w: number, d: number, h: number, tone: number, z = 0, hole?: (a: number, b: number) => boolean) {
  for (let a = 0; a < w; a++)
    for (let b = 0; b < d; b++) {
      taken.add(`${i + a},${j + b}`);
      out.push(hole && hole(a, b) ? { i: i + a, j: j + b, z, h: 0, tone: 0, hole: true } : { i: i + a, j: j + b, z, h, tone });
    }
}

/** An L-shaped lane of flat tiles; when on, a pulse runs along it from start to end. */
function lane(out: IsoCell[], taken: Set<string>, i0: number, j0: number, i1: number, j1: number, on: boolean, t: number, k = 0) {
  let i = i0;
  let j = j0;
  let n = 0;
  for (;;) {
    if (!taken.has(`${i},${j}`)) {
      const pulse = Math.floor(t * 6 - n + k) % 5 === 0;
      out.push({ i, j, h: 0.06, tone: on ? (pulse ? 1.05 : 0.62) : 0.18 });
      taken.add(`${i},${j}`);
    }
    if (i === i1 && j === j1) break;
    if (i !== i1) i += Math.sign(i1 - i);
    else j += Math.sign(j1 - j);
    n++;
  }
}

export function RoundIso({ step }: { step: number }) {
  const stepRef = useRef(step);
  stepRef.current = step;

  const scene: IsoScene = useMemo(() => {
    let last = -1;
    let t0 = 0;
    return (t) => {
      const s = stepRef.current;
      if (s !== last) {
        last = s;
        t0 = t;
      }
      const p = t - t0; // seconds into this step
      const cells: IsoCell[] = [];
      const labels: IsoLabel[] = [];
      const taken = new Set<string>();

      // The job holds the budget and the dataset; it lights while it hands out shards.
      box(cells, taken, 0, MID, 3, 3, 1.6, s === 0 ? 1.05 : 0.5);

      LAPS.forEach((j, k) => {
        const lazy = k === LAZY;
        const grow = s === 0 ? Math.min(1, p * (lazy ? 1.1 : 0.45 + k * 0.06)) : 1;
        const h = 0.25 + grow * 0.75;
        const caught = lazy && (s === 3 || (s === 2 && p > 1.4));
        const tone = caught ? 0.66 : s === 3 ? 0.88 : lazy ? 0.3 : s === 0 && grow < 1 ? 0.7 : 0.55;
        box(cells, taken, 6, j, 2, 2, h, tone, 0, caught ? (a, b) => (a + b) % 2 === 0 : undefined);
        // Commit: a fingerprint seal lands on each laptop in turn and stays for the rest of the round.
        if (s >= 1 && !caught && (s > 1 || p > 0.3 + k * 0.35)) cells.push({ i: 6, j, z: h, h: 0.35, tone: 1.05 });
        if (caught) labels.push({ i: 6, j: j + 1, z: 0, text: "caught", fail: true, left: true });
      });

      box(cells, taken, 11, MID, 3, 3, 1.3, s === 1 ? 1.05 : 0.5);
      box(cells, taken, 15, 1, 2, 2, 1, s === 2 ? 1.05 : 0.45);
      box(cells, taken, 15, 10, 2, 2, 1, s === 2 ? 1.05 : 0.45);
      box(cells, taken, 18, MID, 3, 3, 2.3, s === 3 ? 1.05 : 0.62);

      LAPS.forEach((j, k) => lane(cells, taken, 3, MID + 1, 5, j + 1, s === 0, t, k));
      LAPS.forEach((j, k) => lane(cells, taken, 8, j + 1, 10, MID + 1, s === 1, t, k));
      lane(cells, taken, 14, MID + 1, 15, 3, s === 2, t);
      lane(cells, taken, 14, MID + 1, 15, 9, s === 2, t, 2);
      lane(cells, taken, 17, 2, 19, 4, s === 3, t);
      lane(cells, taken, 17, 11, 19, 8, s === 3, t, 2);

      for (let i = 0; i < W; i++) for (let j = 0; j < D; j++) if (!taken.has(`${i},${j}`)) cells.push({ i, j, h: 0, tone: 0 });

      labels.push(
        { i: 0, j: MID + 3, z: 0, text: "your job", left: true },
        { i: 11, j: MID + 3, z: 0, text: "coordinator", left: true },
        { i: 17, j: 1, z: 1, text: "verifiers" },
        { i: 21, j: MID, z: 2.3, text: "contract" },
      );
      return { cells, labels };
    };
  }, []);

  return <IsoMosaic scene={scene} cols={W} rows={D} maxH={2.8} label="A round: the job, four laptops, the coordinator, two verifiers and the contract" seed={41} gutter={0.12} gutterLeft={0.17} build={1.1} />;
}
