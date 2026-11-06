// Signs a host's listing change the way api/listing.py checks it: the wallet signs a text naming the competition and the change's sha256.
import { signText } from "@/lib/chain";
import { COORD_BASE } from "@/lib/api/client";

export async function sha256Hex(bytes: Uint8Array) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function base64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Must match message() in services/coordinator/api/listing.py exactly. */
const message = (cid: string, what: string, host: string, sha256: string, signedAt: number) =>
  `Update competition ${cid} ${what}\nWallet: ${host.toLowerCase()}\nsha256: ${sha256}\nSigned at: ${signedAt}`;

export async function hostSign(cid: string, what: "settings" | "banner" | "resource", host: string, digest: string) {
  const signedAt = Math.floor(Date.now() / 1000);
  const { address, signature } = await signText(message(cid, what, host, digest, signedAt));
  if (address.toLowerCase() !== host.toLowerCase()) throw new Error("The wallet that signed isn't the host's. Switch to the host wallet and try again.");
  return { host: address, signedAt, signature };
}

export class PostError extends Error {
  constructor(public status: number, message: string, public fields: string[] = []) { super(message); }
}

/** POSTs a signed change; the coordinator's refusal comes back as words the page can show. */
export async function postListing<T>(cid: string, path: "settings" | "banner" | "resources", body: unknown): Promise<T> {
  if (!COORD_BASE) throw new PostError(0, "Listing edits need a live coordinator. This is demo mode.");
  let res: Response;
  try {
    res = await fetch(`${COORD_BASE}/v1/competitions/${encodeURIComponent(cid)}/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new PostError(0, "The coordinator didn't answer. Try again.");
  }
  const j = (await res.json().catch(() => null)) as { detail?: unknown } | null;
  if (!res.ok) {
    const d = j?.detail;
    if (d && typeof d === "object" && "message" in d) throw new PostError(res.status, String((d as { message: unknown }).message), ((d as { fields?: string[] }).fields) ?? []);
    throw new PostError(res.status, typeof d === "string" ? d : `The coordinator refused this (${res.status}).`);
  }
  return j as T;
}
