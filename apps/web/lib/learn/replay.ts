// A recorded round's replay, small enough to run in a browser: a seeded PRNG stands in for the training kernel, so the same seed always yields the same bytes and the same SHA-256.
export const STEPS = 512;
export const SEGMENTS = 8;
const PER_SEGMENT = 32768;

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Bytes a replay produces. `skipFrom` models a lazy node that stopped training at that step and padded the rest. */
export function replayBytes(seed: number, opts: { skipFrom?: number; segments?: number } = {}) {
  const segments = opts.segments ?? SEGMENTS;
  const out = new Float32Array(segments * PER_SEGMENT);
  const rnd = mulberry32(seed);
  const stepsPer = STEPS / SEGMENTS;
  for (let i = 0; i < out.length; i++) {
    const step = Math.floor(i / PER_SEGMENT) * stepsPer + Math.floor(((i % PER_SEGMENT) / PER_SEGMENT) * stepsPer);
    const v = rnd() * 2 - 1;
    out[i] = opts.skipFrom !== undefined && step >= opts.skipFrom ? 0 : v;
  }
  return out;
}

export async function sha256(buf: ArrayBuffer | ArrayBufferView) {
  const view = buf instanceof ArrayBuffer ? new Uint8Array(buf) : new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const d = await crypto.subtle.digest("SHA-256", view as Uint8Array<ArrayBuffer>);
  return "0x" + Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Replays segment by segment and reports the step reached, yielding to the browser between segments so the counter paints. */
export async function runReplay(seed: number, onStep: (step: number) => void, opts: { skipFrom?: number } = {}) {
  const bytes = replayBytes(seed, opts);
  for (let s = 1; s <= SEGMENTS; s++) {
    await new Promise((r) => setTimeout(r, 140));
    onStep((s * STEPS) / SEGMENTS);
  }
  return sha256(bytes);
}

export const DEMO_SEED = 412_2026;
