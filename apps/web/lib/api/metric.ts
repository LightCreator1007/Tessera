// Decodes the coordinator's f64hex metric (an IEEE-754 float64 as 16 big-endian hex digits) into a number.
export function f64(hex: string | null | undefined): number | null {
  if (!hex) return null;
  const h = hex.replace(/^0x/, "");
  if (!/^[0-9a-fA-F]{16}$/.test(h)) return null;
  const view = new DataView(new ArrayBuffer(8));
  for (let i = 0; i < 8; i++) view.setUint8(i, parseInt(h.slice(i * 2, i * 2 + 2), 16));
  const v = view.getFloat64(0);
  return Number.isFinite(v) ? v : null;
}

/** The inverse, for fixtures, so demo data has the same wire shape as live data. */
export function toF64(v: number): string {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, v);
  return Array.from({ length: 8 }, (_, i) => view.getUint8(i).toString(16).padStart(2, "0")).join("");
}
