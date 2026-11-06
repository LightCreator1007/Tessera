"use client";
// One person per wallet: what the coordinator knows about a wallet's World ID, and the calls that prove it. Demo mode keeps the answer in the demo wallet, so every path can be walked without World App.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, COORD_BASE, isDemo, request } from "@/lib/api/client";
import { setWallet, useWallet } from "@/lib/wallet";

export type IdentityMode = "dev" | "worldid" | "demo";
export type IdentityConfig = { mode: IdentityMode; appId: string; rpId: string; action: string; environment: string };
export type Credential = "orb" | "selfie" | "dev";
export type HumanStatus = {
  owner: string;
  verified: boolean;
  joined: boolean;
  credential: Credential | null;
  verifiedAt: number | null;
  excluded: { reason: string; at: number } | null;
};
/** IDKit's rp_context. */
export type RpContext = { rp_id: string; nonce: string; created_at: number; expires_at: number; signature: string };

export const DEMO_CONFIG: IdentityConfig = { mode: "demo", appId: "app_demo", rpId: "rp_demo", action: "tod-pool-join", environment: "staging" };

/** Must match the coordinator's worldid.signal_for: the proof is only good for this wallet. */
export const signalFor = (owner: string) => "tod-owner:" + owner.toLowerCase();

export const CREDENTIAL_LABEL: Record<Credential, string> = { orb: "Orb", selfie: "Selfie Check", dev: "Dev identity" };

export type FailKind =
  | "cancelled"
  | "linked_elsewhere"
  | "wallet_taken"
  | "rate_limited"
  | "off"
  | "rejected"
  | "excluded"
  | "dev_refused"
  | "unreachable"
  | "expired"
  | "failed";

export class IdentityError extends Error {
  constructor(public kind: FailKind, message: string) {
    super(message);
  }
}

/** Sorts a coordinator refusal into what the screen says about it. The detail strings come from identity/router.py. */
export function toIdentityError(status: number, detail: string): IdentityError {
  const d = detail || "";
  if (status === 0 || status === 502) return new IdentityError("unreachable", "The coordinator didn't answer.");
  if (status === 409 && /already linked to/.test(d)) return new IdentityError("linked_elsewhere", d);
  if (status === 409) return new IdentityError("wallet_taken", d);
  if (status === 429) return new IdentityError("rate_limited", d);
  if (status === 503) return new IdentityError("off", d);
  if (status === 403 && /dev/.test(d)) return new IdentityError("dev_refused", d);
  if (status === 403) return new IdentityError("excluded", d);
  if (status === 400) return new IdentityError("rejected", d);
  return new IdentityError("failed", d || `${status}`);
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await request(`${COORD_BASE}/v1/identity${path}`, body === undefined
      ? { headers: { accept: "application/json" } }
      : { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) }, 20_000);
  } catch (e) {
    throw toIdentityError(e instanceof ApiError ? e.status : 0, "");
  }
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { detail?: unknown; code?: string };
    throw toIdentityError(res.status === 502 && res.headers.get("x-proxy") === "tod" ? 0 : res.status, typeof j.detail === "string" ? j.detail : j.code ?? "");
  }
  return (await res.json()) as T;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function useIdentityConfig() {
  return useQuery({
    queryKey: ["identity", "config"],
    queryFn: () => (isDemo ? Promise.resolve(DEMO_CONFIG) : call<IdentityConfig>("/config")),
    staleTime: Infinity,
  });
}

/** Whether the connected wallet is one verified person. Live reads the coordinator; demo reads the demo wallet. */
export function useHuman() {
  const w = useWallet();
  const owner = w.connected && !w.wrongNetwork ? w.address : null;
  const demoVerified = w.personVerified || !!w.node?.humanVerified;
  const q = useQuery({
    queryKey: ["identity", "owner", owner?.toLowerCase()],
    queryFn: () => call<HumanStatus>(`/owners/${owner}`),
    enabled: !isDemo && !!owner,
    staleTime: 30_000,
  });
  if (isDemo) {
    const status: HumanStatus | null = owner
      ? { owner, verified: demoVerified, joined: !!w.node?.joined, credential: demoVerified ? "orb" : null, verifiedAt: null, excluded: null }
      : null;
    return { owner, status, verified: demoVerified && !!owner, loading: false, error: null as Error | null };
  }
  return { owner, status: q.data ?? null, verified: q.data?.verified === true, loading: !!owner && q.isPending, error: q.error };
}

export async function rpContext(cfg: IdentityConfig): Promise<RpContext> {
  if (cfg.mode === "demo") {
    await wait(350);
    const now = Math.floor(Date.now() / 1000);
    return { rp_id: cfg.rpId, nonce: "0x" + "0".repeat(64), created_at: now, expires_at: now + 300, signature: "0x" };
  }
  const s = await call<{ sig: string; nonce: string; created_at: number; expires_at: number }>("/rp-signature", { action: cfg.action });
  return { rp_id: cfg.rpId, nonce: s.nonce, created_at: s.created_at, expires_at: s.expires_at, signature: s.sig };
}

export type Verified = { owner: string; nullifier: string; credential: Credential };

/** Hands the IDKit result to the coordinator, which checks it with World and records one human for this wallet. */
export function useSubmitProof() {
  const qc = useQueryClient();
  return async (owner: string, proof: unknown, demoFail?: FailKind): Promise<Verified> => {
    let out: Verified;
    if (isDemo) {
      await wait(1100);
      if (demoFail) throw new IdentityError(demoFail, DEMO_FAIL[demoFail] ?? "");
      out = { owner, nullifier: "0x" + "d3".repeat(32), credential: "orb" };
    } else {
      out = await call<Verified>("/verify", { owner, proof: proof ?? {} });
    }
    setWallet({ personVerified: true });
    qc.setQueryData(["identity", "owner", owner.toLowerCase()], (s: HumanStatus | undefined) => ({
      owner, verified: true, joined: s?.joined ?? false, credential: out.credential, verifiedAt: Math.floor(Date.now() / 1000), excluded: null,
    }));
    return out;
  };
}

const DEMO_FAIL: Partial<Record<FailKind, string>> = {
  linked_elsewhere: "this World ID is already linked to 0x1111...1111",
  rejected: "World ID verification failed: all_verifications_failed",
};
