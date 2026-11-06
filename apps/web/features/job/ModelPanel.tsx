"use client";
// A job's model: the latest accepted weights, a keccak-checked download, and where the final model is indexed (Arkiv) and stored (Swarm).
import { useState } from "react";
import { keccak256 } from "viem";
import { Box, Download, ExternalLink } from "lucide-react";
import { isDemo, modelUrl } from "@/lib/api/client";
import { useRounds } from "@/lib/api/hooks";
import type { Job, Published } from "@/lib/api/types";
import { Banner, Button, Card, EmptyState, HashChip, Null, Pill, PropRow, SectionTitle, Skeleton } from "@/components/primitives";

export const SWARM_GATEWAY = (process.env.NEXT_PUBLIC_SWARM_GATEWAY || "https://api.gateway.ethswarm.org").replace(/\/$/, "");
const ARKIV_EXPLORER = process.env.NEXT_PUBLIC_ARKIV_EXPLORER?.replace(/\/$/, "");

type DL = { kind: "idle" } | { kind: "fetching" } | { kind: "hashing" } | { kind: "ok"; file: string } | { kind: "mismatch"; got: string } | { kind: "error"; msg: string };

/** Downloads bytes, hashes them, and only hands the file to the browser when the hash is the one on chain. */
async function fetchChecked(url: string, want: string, file: string, set: (d: DL) => void) {
  set({ kind: "fetching" });
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  } catch {
    return set({ kind: "error", msg: "The download didn't finish. The coordinator may be offline." });
  }
  if (res.status === 404) return set({ kind: "error", msg: "This coordinator no longer has the bytes, and Swarm had no copy it could serve." });
  if (!res.ok) return set({ kind: "error", msg: `The download failed (HTTP ${res.status}).` });
  const bytes = new Uint8Array(await res.arrayBuffer());
  set({ kind: "hashing" });
  const got = keccak256(bytes);
  if (got.toLowerCase() !== want.toLowerCase()) return set({ kind: "mismatch", got });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
  a.download = file;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  set({ kind: "ok", file });
}

const PUBLISH_TONE = { pending: "pending", indexed: "ok", failed: "danger" } as const;
const PUBLISH_WORD = { pending: "Queued for Arkiv", indexed: "Indexed on Arkiv", failed: "Arkiv write failed" } as const;

export function ArkivRecord({ p }: { p: Published }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2"><Pill tone={PUBLISH_TONE[p.state]} live={p.state === "pending"}>{PUBLISH_WORD[p.state]}</Pill><span className="text-xs text-muted">final model from round {p.round}</span></div>
      {p.state === "failed" && <p className="text-sm text-muted">The coordinator stops after a failed write rather than resending it, so nothing is paid twice. An operator retries it from the admin route after checking the Arkiv explorer.</p>}
      {p.state === "pending" && <p className="text-sm text-muted">Written within a minute, once the job&apos;s last round is a few blocks deep.</p>}
      <dl className="flex flex-col">
        <PropRow label="Arkiv entity">{p.arkivKey ? (ARKIV_EXPLORER ? <a className="inline-flex items-center gap-1 font-mono text-xs text-ink underline underline-offset-4" href={`${ARKIV_EXPLORER}/entity/${p.arkivKey}`} target="_blank" rel="noreferrer">{p.arkivKey.slice(0, 12)}… <ExternalLink className="size-3" aria-hidden /></a> : <HashChip value={p.arkivKey} label="Arkiv entity key" />) : <Null>Not written yet</Null>}</PropRow>
        <PropRow label="Arkiv tx">{p.arkivTx ? <HashChip value={p.arkivTx} label="Arkiv transaction" /> : <Null>Not written yet</Null>}</PropRow>
        <PropRow label="Swarm copy">{p.swarmRef ? <a className="inline-flex items-center gap-1 font-mono text-xs text-ink underline underline-offset-4" href={`${SWARM_GATEWAY}/bytes/${p.swarmRef}`} target="_blank" rel="noreferrer">{p.swarmRef.slice(0, 12)}… <ExternalLink className="size-3" aria-hidden /></a> : <Null>No Swarm copy</Null>}</PropRow>
      </dl>
    </div>
  );
}

export function ModelPanel({ job }: { job: Job }) {
  const rounds = useRounds(job.id);
  const [dl, setDl] = useState<DL>({ kind: "idle" });
  if (rounds.isPending) return <Skeleton className="h-32 w-full" />;
  // The latest accepted round holds the current model; reverted, void and fallback rounds don't change it.
  const lastFinal = [...(rounds.data?.data ?? [])].reverse().find((r) => r.status === "finalized" && r.aggregateHash);
  if (!lastFinal) return <EmptyState icon={Box} title="No model yet">The first trained weights exist once a round is accepted. Until then the model is the requester&apos;s starting weights.</EmptyState>;
  const want = lastFinal.aggregateHash!;
  const pub = job.published ?? null;
  // Only a published final model is public; mid-job weights are served to signed node requests alone.
  const url = pub && pub.keccak.toLowerCase() === want.toLowerCase() ? modelUrl(pub.keccak) : null;
  const file = `tod-job${job.id}-r${lastFinal.round}.bin`;

  async function run() {
    if (isDemo) {
      setDl({ kind: "fetching" });
      await new Promise((r) => setTimeout(r, 600));
      setDl({ kind: "hashing" });
      await new Promise((r) => setTimeout(r, 400));
      return setDl(job.trust === "untrusted" ? { kind: "mismatch", got: want.replace(/.{6}$/, "c0ffee") } : { kind: "ok", file });
    }
    if (url) await fetchChecked(url, want, file, setDl);
  }
  const busy = dl.kind === "fetching" || dl.kind === "hashing";
  const canDownload = isDemo || !!url;

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <Card className="flex flex-col gap-5 p-6">
        <SectionTitle title={`Weights after round ${lastFinal.round}`} sub="checked against the aggregate hash on chain before saving" />
        <dl className="flex flex-col"><PropRow label="Expected hash"><HashChip value={want} label="aggregate hash" /></PropRow></dl>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" icon={Download} onClick={run} disabled={busy || !canDownload}>
            {dl.kind === "fetching" ? "Downloading…" : dl.kind === "hashing" ? "Checking hash…" : "Download weights"}
          </Button>
          {dl.kind === "ok" && <span className="text-sm text-ok">Hash matches. Saved {dl.file}</span>}
        </div>
        {!canDownload && <p className="text-sm text-muted">{job.status === "completed" ? "The final model becomes public once it's indexed on Arkiv." : "Weights are public when the job completes. Until then only the nodes in a round can fetch them."}</p>}
        {dl.kind === "error" && <Banner tone="warn" title="Download didn't finish">{dl.msg}</Banner>}
        {dl.kind === "mismatch" && (
          <Banner tone="danger" title="Hash mismatch, file discarded">
            The coordinator served bytes hashing to {dl.got.slice(0, 12)}…, but the chain says {want.slice(0, 12)}…. Nothing was saved.
          </Banner>
        )}
      </Card>
      {pub && <Card className="p-6"><SectionTitle title="Published model" sub="a public record anyone can find without this coordinator" /><div className="mt-4"><ArkivRecord p={pub} /></div></Card>}
    </div>
  );
}
