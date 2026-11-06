// Word-mosaic renderer (brand-direction.md section 3). One canvas, rows of word tiles whose width follows the word,
// each tile lit to one of seven levels by a field function. Only tiles whose level or word changed are redrawn.

/** Crypto, AI, training and dev words. Short and long mixed on purpose: tile width follows the word. */
export const VOCAB_CRYPTO = [
  "HASH", "BLOCK", "NONCE", "STAKE", "SLASH", "ESCROW", "TOD", "ETH", "BASE", "L2", "GAS", "GWEI", "WALLET",
  "SIGN", "MERKLE", "ROOT", "ORACLE", "MINT", "VAULT", "LEDGER", "ZK", "PROOF", "COMMIT", "REVEAL", "SALT",
  "EVM", "ABI", "RPC", "TX", "BOND", "QUORUM", "CONSENSUS", "VALIDATOR", "0x", "SEPOLIA", "EIP-712", "SETTLE",
];
export const VOCAB_AI = [
  "MODEL", "TENSOR", "WEIGHT", "BIAS", "LOGIT", "EMBED", "TOKEN", "ATTN", "LAYER", "RELU", "SOFTMAX", "LATENT",
  "INFER", "LORA", "VECTOR", "KERNEL", "CUDA", "GPU", "FLOPS", "PARAMS", "DROPOUT", "AGENT", "PROMPT", "CONTEXT",
];
export const VOCAB_TRAIN = [
  "TRAIN", "EPOCH", "BATCH", "LOSS", "GRAD", "LR", "ADAM", "SGD", "DESCENT", "BACKPROP", "SHARD", "DATASET",
  "STEP", "SEED", "REPLAY", "VERIFY", "EVAL", "CONVERGE", "CHECKPOINT", "ROUND", "DELTA", "MINIMUM",
];
export const VOCAB_DEV = [
  "GIT", "MERGE", "PUSH", "DIFF", "BUILD", "DEPLOY", "PNPM", "NODE", "DOCKER", "CLI", "API", "JSON", "LINT",
  "TEST", "CI", "BRANCH", "FORK", "PR", "SHIP", "FIX", "LOG", "SSH", "HTTP", "200", "TS", "PY", "WASM", "ENV",
];
export const VOCAB = [...VOCAB_CRYPTO, ...VOCAB_AI, ...VOCAB_TRAIN, ...VOCAB_DEV];

/** A tile as the field sees it. Coordinates are CSS pixels. `r` is a stable random in 0..1 for dissolves and jitter. */
export interface Tile {
  i: number;
  row: number;
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
  r: number;
  word: string;
  /** Empty cell: at level 0 nothing is drawn, so the texture has holes. Lit tiles ignore it, so figures stay solid. */
  blank: boolean;
}

export interface FieldCtx {
  t: number;
  W: number;
  H: number;
}

/** Returns a tone: below 0 is a void (a hole in the figure), 0..1 maps to levels, 1+ is the peak glint. */
export type FieldFn = (tile: Tile, c: FieldCtx) => number;

/** Tone thresholds for levels 1..7. Level 0 is a texture word on the ground; 7 is the peak bone glint. */
const THRESH = [0.1, 0.22, 0.36, 0.5, 0.64, 0.8, 0.97];
export const VOID = -1;

export function quantize(v: number, jitter: number): number {
  if (v < 0) return VOID;
  const x = v + jitter;
  let l = 0;
  for (let k = 0; k < THRESH.length; k++) if (x >= THRESH[k]) l = k + 1;
  return l;
}

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

interface Palette {
  ground: string;
  void: string;
  bg: string[]; // index = level, [0] unused
  fg: string[]; // index = level, [0] = texture word colour
}

/** Palette comes from CSS custom properties on the canvas (mosaic.css), so colour stays in tokens, not in code. */
function readPalette(el: HTMLElement): Palette {
  const cs = getComputedStyle(el);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  const bg = [""];
  const fg = [v("--mz-tex")];
  for (let l = 1; l <= 7; l++) {
    bg.push(v(`--mz-l${l}`));
    fg.push(v(`--mz-t${l}`));
  }
  return { ground: v("--mz-ground"), void: v("--mz-void"), bg, fg };
}

export interface MosaicOptions {
  cell: number; // row height, px
  seed: number;
  vocab: string[];
  twinkle: number; // share of tiles that swap word per second
  empty: number; // 0..1, share of texture cells left empty, in clusters along the row
  /** When set, the row height becomes canvas height / rows, capped at `cell`, so small canvases keep enough rows. */
  rows?: number;
}

export class MosaicRenderer {
  private ctx: CanvasRenderingContext2D;
  private tiles: Tile[] = [];
  private levels: Int8Array = new Int8Array(0);
  private drawn: string[] = [];
  private jit: Float32Array = new Float32Array(0);
  private pal!: Palette;
  private W = 0;
  private H = 0;
  private font = "";
  private pad = 3;
  private gap = 1;
  private lastT = 0;
  private rnd: () => number;

  constructor(private canvas: HTMLCanvasElement, private opts: MosaicOptions) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d canvas unavailable");
    this.ctx = ctx;
    this.rnd = mulberry32(opts.seed ^ 0x9e3779b9);
  }

  setOptions(o: Partial<MosaicOptions>) {
    this.opts = { ...this.opts, ...o };
    this.layout();
  }

  /** Re-read colours (palette switch) and force a full redraw. */
  repaint() {
    this.pal = readPalette(this.canvas);
    this.levels.fill(-2);
  }

  layout() {
    const { canvas, ctx, opts } = this;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.W = Math.max(1, Math.round(rect.width));
    this.H = Math.max(1, Math.round(rect.height));
    canvas.width = Math.round(this.W * dpr);
    canvas.height = Math.round(this.H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cell = opts.rows ? Math.max(4, Math.min(opts.cell, Math.round(this.H / opts.rows))) : opts.cell;
    const family = getComputedStyle(canvas).fontFamily || "monospace";
    const fontPx = Math.max(5, Math.round(cell * 0.6 * 10) / 10);
    this.font = `600 ${fontPx}px ${family}`;
    this.pad = Math.max(2, Math.round(cell * 0.28));
    this.gap = cell >= 10 ? 1 : 0.75;
    ctx.font = this.font;
    ctx.textBaseline = "middle";

    const rnd = mulberry32(opts.seed);
    const widths = new Map<string, number>();
    const measure = (w: string) => {
      let m = widths.get(w);
      if (m === undefined) {
        m = Math.ceil(ctx.measureText(w).width);
        widths.set(w, m);
      }
      return m;
    };
    const tiles: Tile[] = [];
    for (let y = 0, row = 0; y < this.H; y += cell, row++) {
      let x = -Math.floor(rnd() * 40);
      // Empty cells come in runs, like the gaps between word groups in the reference, not as salt-and-pepper noise.
      let run = 0;
      while (x < this.W) {
        const word = opts.vocab[Math.floor(rnd() * opts.vocab.length)];
        const w = measure(word) + this.pad * 2;
        if (run <= 0 && rnd() < opts.empty * 0.45) run = 1 + Math.floor(rnd() * 4);
        const blank = run > 0;
        run--;
        tiles.push({ i: tiles.length, row, x, y, w, h: cell, cx: x + w / 2, cy: y + cell / 2, r: rnd(), word, blank });
        x += w + this.gap;
      }
    }
    this.tiles = tiles;
    this.levels = new Int8Array(tiles.length).fill(-2);
    this.drawn = tiles.map((t) => t.word);
    this.jit = new Float32Array(tiles.length).map(() => (rnd() - 0.5) * 0.09);
    this.pal = readPalette(canvas);
    ctx.fillStyle = this.pal.ground;
    ctx.fillRect(0, 0, this.W, this.H);
  }

  size() {
    return { W: this.W, H: this.H };
  }

  frame(field: FieldFn, t: number) {
    const { ctx, tiles, levels, pal, opts } = this;
    const c: FieldCtx = { t, W: this.W, H: this.H };
    const dt = Math.max(0, t - this.lastT);
    this.lastT = t;
    const swaps = opts.twinkle > 0 ? Math.round(tiles.length * opts.twinkle * dt) : 0;
    for (let s = 0; s < swaps; s++) {
      const k = Math.floor(this.rnd() * tiles.length);
      const tile = tiles[k];
      const alt = opts.vocab[Math.floor(this.rnd() * opts.vocab.length)];
      if (alt.length <= tile.word.length) {
        this.drawn[k] = alt;
        if (opts.empty > 0 && this.rnd() < 0.3) tile.blank = !tile.blank;
        levels[k] = -2;
      }
    }
    ctx.font = this.font;
    for (let k = 0; k < tiles.length; k++) {
      const tile = tiles[k];
      const lvl = quantize(field(tile, c), this.jit[k]);
      if (lvl === levels[k]) continue;
      levels[k] = lvl;
      const { x, y, w, h } = tile;
      ctx.fillStyle = pal.ground;
      ctx.fillRect(x - 0.5, y, w + this.gap + 0.5, h);
      if (lvl === VOID) {
        ctx.fillStyle = pal.void;
        ctx.fillRect(x, y + this.gap, w, h - this.gap);
        continue;
      }
      if (lvl === 0 && tile.blank) continue;
      if (lvl > 0) {
        ctx.fillStyle = pal.bg[lvl];
        ctx.fillRect(x, y + this.gap, w, h - this.gap);
      }
      ctx.fillStyle = pal.fg[lvl];
      ctx.fillText(this.drawn[k], x + this.pad, y + h / 2 + this.gap / 2 + 0.5);
    }
  }
}

/**
 * Tokens of three characters or fewer, plus hex bytes. Tile width follows the word, so this is the vocabulary that
 * keeps a figure's horizontal resolution close to its vertical one: a 10-letter word is a 60px block, a byte is 12px.
 */
export const VOCAB_FINE = [
  ...VOCAB.filter((w) => w.length <= 3),
  "A3", "FF", "0E", "7C", "B1", "4D", "9F", "2A", "E8", "C0", "5B", "D6",
];

/** Words of four characters or fewer. Giant type needs narrow tiles, or letter strokes are thinner than one tile. */
export const VOCAB_SHORT = VOCAB.filter((w) => w.length <= 4);
