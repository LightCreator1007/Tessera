// RL reveal files: the seeds and salt behind a host's commitment, or the policy hash and salt behind an entry. Kept in this browser and downloaded.
import type { Address, Hex } from "viem";
import { policyCommit, seedsCommit } from "@/lib/chain/rlCompetitions";

export type RLKit = {
  v: 1; kind: "seeds" | "policy"; chainId: number; contract: string; competition: number | null; wallet: string;
  commit: Hex; salt: Hex; seeds?: number[]; policy?: Hex; file?: string;
};

const PREFIX = "tod.rlreveal.v1:";

export function saveRLKit(k: RLKit) {
  try { localStorage.setItem(`${PREFIX}${k.chainId}:${k.contract.toLowerCase()}:${k.commit.toLowerCase()}`, JSON.stringify(k)); } catch { /* Private mode or full storage: the downloaded file is the copy that matters. */ }
}

export function rlKitsFor(chainId: number, contract: string): RLKit[] {
  const out: RLKit[] = [];
  try {
    const pre = `${PREFIX}${chainId}:${contract.toLowerCase()}:`;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      const kit = k?.startsWith(pre) ? parseRLKit(localStorage.getItem(k) ?? "") : null;
      if (kit && typeof kit !== "string") out.push(kit);
    }
  } catch { /* Storage blocked: the person uploads their reveal file instead. */ }
  return out;
}

export function downloadRLKit(k: RLKit) {
  const name = k.kind === "seeds" ? `rl-seeds-reveal-${k.commit.slice(2, 10)}.json` : `rl-policy-reveal-${k.competition}-${k.wallet.slice(2, 8)}.json`;
  const url = URL.createObjectURL(new Blob([JSON.stringify(k, null, 2)], { type: "application/json" }));
  Object.assign(document.createElement("a"), { href: url, download: name }).click();
  URL.revokeObjectURL(url);
}

export function parseRLKit(text: string): RLKit | string {
  try {
    const k = JSON.parse(text) as Partial<RLKit>;
    if (k.v !== 1 || (k.kind !== "seeds" && k.kind !== "policy") || !k.salt || !k.commit || !k.wallet) return "That isn't an RL reveal file.";
    return k as RLKit;
  } catch {
    return "That isn't an RL reveal file.";
  }
}

/** Whether the kit's seeds or policy hash and salt really hash to its commitment, checked before anything is signed. */
export function rlKitMatches(k: RLKit): boolean {
  const want = k.commit.toLowerCase();
  if (k.kind === "seeds") return !!k.seeds?.length && seedsCommit(k.seeds, k.salt).toLowerCase() === want;
  return k.competition !== null && !!k.policy && policyCommit(k.competition, k.wallet as Address, k.policy, k.salt).toLowerCase() === want;
}

/** Seeds typed as whole numbers split by commas, spaces or lines. */
export function parseSeeds(text: string): number[] | string {
  const parts = text.split(/[\s,;]+/).filter(Boolean);
  if (parts.length === 0) return "Give at least one seed.";
  if (parts.length > 64) return "At most 64 seeds.";
  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isSafeInteger(n) || n < 0)) return "Every seed must be a whole number, 0 or more.";
  return nums;
}

export async function base64Of(bytes: Uint8Array): Promise<string> {
  const url = await new Promise<string>((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.readAsDataURL(new Blob([bytes as BlobPart])); });
  return url.slice(url.indexOf(",") + 1);
}
