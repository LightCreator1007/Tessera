"use client";
// Finished models as Arkiv holds them: one row per published final model, each with its keccak, Swarm copy and a checked download.
import { useState } from "react";
import Link from "next/link";
import { Boxes, ExternalLink, Search } from "lucide-react";
import { useModels } from "@/lib/api/hooks";
import type { ModelRecord } from "@/lib/api/types";
import { Problem } from "@/components/problem";
import { Card, EmptyState, HashChip, PageHeader, Skeleton, TD, TH, THead, ROW } from "@/components/primitives";
import { SWARM_GATEWAY } from "@/features/job/ModelPanel";

const kb = (n: number) => (n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const days = (expiresAt: number) => {
  const d = (expiresAt * 1000 - Date.now()) / 86_400_000;
  return d <= 0 ? "expired" : d < 1 ? "under a day" : `${Math.floor(d)} days`;
};

export function ModelsPage() {
  const models = useModels();
  const [q, setQ] = useState("");
  const rows = (models.data?.data ?? []).filter((m) => !q || `${m.job} ${m.workload ?? ""} ${m.keccak}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="flex flex-col">
      <PageHeader title="Models" />
      <div className="flex flex-col gap-4 px-4 py-6 md:px-6">
        <p className="max-w-2xl text-sm text-muted">Every completed job&apos;s final model gets a public record on Arkiv with its keccak hash, so anyone can find it and check the bytes without trusting this coordinator. This list is read from Arkiv, not from the coordinator&apos;s own tables. Records expire unless they are extended.</p>
        {models.isPending ? <Skeleton className="h-48 w-full" /> : models.isError ? (
          <Problem error={models.error} retry={() => models.refetch()} overrides={{
            off: { title: "Model publishing is off on this coordinator", body: "It runs without an Arkiv key, so finished models stay on the coordinator only. Job pages still offer the weights." },
            upstream: { title: "Arkiv didn't answer", body: "The coordinator is up, but its read from Arkiv failed. The public RPC rate-limits; try again in a minute." },
          }} />
        ) : models.data.data.length === 0 ? (
          <EmptyState icon={Boxes} title="No published models yet">A model is published a few blocks after its job&apos;s last round is accepted. <Link href="/jobs" className="text-ink underline underline-offset-4">See running jobs</Link></EmptyState>
        ) : (
          <>
            <label className="flex h-9 max-w-sm items-center gap-2 rounded-md border border-field bg-surface px-2">
              <Search className="size-4 text-subtle" aria-hidden />
              <span className="sr-only">Filter models</span>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Job, workload or hash" className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none" />
            </label>
            <Card className="overflow-x-auto">
              <table className="w-full text-sm">
                <THead><TH>Job</TH><TH>Workload</TH><TH>Keccak</TH><TH>Size</TH><TH>Swarm</TH><TH className="text-right">Kept for</TH></THead>
                <tbody>
                  {rows.map((m) => <Row key={m.arkivKey} m={m} />)}
                  {rows.length === 0 && <tr><TD className="py-6 text-muted">Nothing matches &ldquo;{q}&rdquo;.</TD></tr>}
                </tbody>
              </table>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function Row({ m }: { m: ModelRecord }) {
  return (
    <tr className={ROW}>
      <TD><Link href={`/jobs/${m.job}?tab=model`} className="text-ink underline decoration-rule-strong underline-offset-4">#{m.job}</Link> <span className="text-xs text-muted">round {m.round}</span></TD>
      <TD className="font-mono text-xs">{m.workload ?? "?"}</TD>
      <TD><HashChip value={m.keccak} label="model keccak" /></TD>
      <TD className="font-mono text-xs tabular">{kb(m.size)}</TD>
      <TD>{m.swarmRef ? <a href={`${SWARM_GATEWAY}/bytes/${m.swarmRef}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-xs text-ink underline underline-offset-4">{m.swarmRef.slice(0, 8)}… <ExternalLink className="size-3" aria-hidden /></a> : <span className="text-xs text-muted">none</span>}</TD>
      <TD className="text-right text-xs text-muted">{days(m.expiresAt)}</TD>
    </tr>
  );
}
