// Floor-plus-contribution pay split used by /demo and the pay lesson. The live contract still splits equally; this is the split the team is deciding on.

/** Each paid node gets `floor`, and the rest of the pot by its share of total loss reduction. A null delta means the update was excluded and earns nothing. */
export function splitPay(deltas: (number | null)[], pot: number, floor: number): (number | null)[] {
  const paid = deltas.filter((d): d is number => d !== null);
  if (paid.length === 0) return deltas.map(() => null);
  const total = paid.reduce((s, d) => s + Math.max(d, 0), 0);
  const rest = Math.max(pot - floor * paid.length, 0);
  return deltas.map((d) => {
    if (d === null) return null;
    // With no measurable improvement anywhere, the remainder splits evenly rather than dividing by zero.
    const share = total > 0 ? Math.max(d, 0) / total : 1 / paid.length;
    return Math.round(floor + rest * share);
  });
}
