// The only place token amounts are formatted. TOD base units (6 decimals, ToDToken.sol). Null stays null so callers render "not reported", never 0.
import { formatUnits } from "viem";

export const TOKEN_DECIMALS = 6;
export const TOKEN_SYMBOL = "TOD";

export function formatToken(units: number | bigint | null | undefined, opts: { compact?: boolean } = {}): string | null {
  if (units === null || units === undefined) return null;
  const n = Number(formatUnits(BigInt(units), TOKEN_DECIMALS));
  if (opts.compact && Math.abs(n) >= 1000) {
    return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
  }
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

export function ratio(part: number | null, whole: number | null): number | null {
  if (part === null || whole === null || whole === 0) return null;
  return part / whole;
}
