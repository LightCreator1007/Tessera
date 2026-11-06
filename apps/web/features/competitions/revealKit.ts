// Reveal files: the bytes and salt behind a commitment. Without one an entry is never scored and hidden labels split the prize, so it is kept in this browser and downloaded.
import type { Address, Hex } from "viem";
import { entryCommit, labelsCommit } from "@/lib/chain/competitions";

export type Kit = {
  v: 1; kind: "entry" | "labels"; chainId: number; contract: string; competition: number | null; wallet: string;
  /** The commitment this reveals: the labels hash for a host, the entry commit for an entrant. */
  commit: Hex; salt: Hex; data: Hex; items: number;
};

const PREFIX = "tod.reveal.v1:";
const key = (k: Pick<Kit, "chainId" | "contract" | "commit">) => `${PREFIX}${k.chainId}:${k.contract.toLowerCase()}:${k.commit.toLowerCase()}`;

export const hexOf = (b: Uint8Array): Hex => `0x${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`;
export function bytesOf(h: string): Uint8Array {
  const s = h.replace(/^0x/, "");
  return Uint8Array.from({ length: s.length / 2 }, (_, i) => parseInt(s.slice(i * 2, i * 2 + 2), 16));
}

export function saveKit(kit: Kit) {
  try { localStorage.setItem(key(kit), JSON.stringify(kit)); } catch { /* Private mode or full storage: the downloaded file is the copy that matters. */ }
}

/** Every kit this browser holds for a contract, so a page can find the one matching an onchain commitment. */
export function kitsFor(chainId: number, contract: string): Kit[] {
  const out: Kit[] = [];
  try {
    const pre = `${PREFIX}${chainId}:${contract.toLowerCase()}:`;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith(pre)) continue;
      const kit = parseKit(localStorage.getItem(k) ?? "");
      if (typeof kit !== "string") out.push(kit);
    }
  } catch { /* Storage blocked: the person uploads their reveal file instead. */ }
  return out;
}

export function downloadKit(kit: Kit) {
  const name = kit.kind === "labels" ? `labels-reveal-${kit.commit.slice(2, 10)}.json` : `entry-reveal-competition-${kit.competition}-${kit.wallet.slice(2, 8)}.json`;
  const url = URL.createObjectURL(new Blob([JSON.stringify(kit, null, 2)], { type: "application/json" }));
  Object.assign(document.createElement("a"), { href: url, download: name }).click();
  URL.revokeObjectURL(url);
}

export function parseKit(text: string): Kit | string {
  try {
    const k = JSON.parse(text) as Partial<Kit>;
    if (k.v !== 1 || (k.kind !== "entry" && k.kind !== "labels") || !k.salt || !k.data || !k.commit || !k.wallet) return "That isn't a reveal file.";
    return k as Kit;
  } catch {
    return "That isn't a reveal file.";
  }
}

/** Whether a kit's bytes and salt really hash to its commitment, checked before any transaction is built. */
export function kitMatches(kit: Kit): boolean {
  const data = bytesOf(kit.data);
  return kit.kind === "labels"
    ? labelsCommit(data, kit.salt).toLowerCase() === kit.commit.toLowerCase()
    : kit.competition !== null && entryCommit(kit.competition, kit.wallet as Address, data, kit.salt).toLowerCase() === kit.commit.toLowerCase();
}

/**
 * Reads a labels or predictions file: raw bytes, one per item, or text with one whole number from 0 to 255 per line or comma.
 * `items` set means the file must have exactly that many.
 */
export async function readClassFile(file: File, items?: number): Promise<Uint8Array | string> {
  if (file.size === 0) return "That file is empty.";
  if (file.size > 1024 * 1024) return "That file is over 1 MB. A competition has at most 10,000 items.";
  const raw = new Uint8Array(await file.arrayBuffer());
  const text = new TextDecoder().decode(raw).trim();
  const looksText = /^[\d\s,;]+$/.test(text);
  let out: Uint8Array;
  if (looksText && (!items || raw.length !== items)) {
    const nums = text.split(/[\s,;]+/).filter(Boolean).map(Number);
    if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return "Every value must be a whole number from 0 to 255.";
    out = Uint8Array.from(nums);
  } else {
    out = raw;
  }
  if (items && out.length !== items) return `This competition has ${items.toLocaleString()} items, and the file has ${out.length.toLocaleString()}.`;
  if (out.length > 10_000) return "A competition has at most 10,000 items.";
  return out;
}
