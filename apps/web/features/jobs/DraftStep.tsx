"use client";
// The price step of posting a job: POST /v1/jobs/draft freezes the spec and prices it (1 TOD pays for at least 1 Gop of replayed training), so the form never asks for a budget.
import { useCallback, useEffect, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api/client";
import type { Draft, DraftRequest } from "@/lib/api/types";
import { draftRounds } from "@/lib/api/draft";
import { Banner, Button, Money, PropRow } from "@/components/primitives";
import { More } from "@/components/flow";
import { TileScanner } from "@/components/mosaic/widgets";

/** Preset datasets the coordinator can draft against, by the card hash in vectors/kernel/presets.json. */
export const DATASET_HASH: Record<string, string> = {
  mnist: "0xa905dbf2a65deb6e1abf496bb1fe7a356639741b5552aaa13a1a0afce7701447",
  cifar10: "0x48a133cef764fd4625c92e07db4d702077f2d11dfd51a0cda2c014fc20d9193c",
};
/** The form's workload names to the registry ids the coordinator knows. */
export const WORKLOAD_ID: Record<string, string> = { "mlp-exact": "mlp-exact/1", "cnn-torch": "cnn-torch/1" };

/** Gops with one decimal, the unit a TOD buys. */
export function formatGops(ops: number): string {
  return (ops / 1e9).toLocaleString("en-US", { maximumFractionDigits: 1 });
}

function why(e: unknown): string {
  if (!(e instanceof ApiError)) return "Something went wrong pricing the job.";
  if (e.kind === "unreachable") return "The coordinator didn't answer. Your choices are kept; try again when it's back.";
  if (e.status === 501) return "Only the exact MLP can be priced for now. Tolerance-class workloads need calibrated drift bands first.";
  if (e.status === 422) return e.message.replace(/^\{"detail":"?|"?\}$/g, "") || "The coordinator refused these settings.";
  return `The coordinator couldn't price the job (HTTP ${e.status}).`;
}

export function DraftStep({ req, onDraft }: { req: DraftRequest | null; onDraft: (d: Draft | null) => void }) {
  const m = useMutation({ mutationFn: (r: DraftRequest) => api.draft(r) });
  const key = req ? JSON.stringify(req) : null;
  const { mutate, reset } = m;
  const report = useRef(onDraft);
  useEffect(() => { report.current = onDraft; }, [onDraft]);
  // Callbacks passed to mutate fire only for the latest call, so a slow answer for old choices can't land.
  const price = useCallback((r: DraftRequest) => mutate(r, { onSuccess: (x) => report.current(x.data), onError: () => report.current(null) }), [mutate]);
  // Re-price whenever the choices change, and drop the old price at once so a stale number is never shown.
  useEffect(() => {
    report.current(null);
    reset();
    if (!key) return;
    const t = setTimeout(() => price(JSON.parse(key) as DraftRequest), 400);
    return () => clearTimeout(t);
  }, [key, price, reset]);

  const d = m.data?.data;
  const rounds = d ? draftRounds(d) : null;
  const quorum = req?.minQuorum ?? 3;
  if (!req) return <p className="text-sm text-subtle">Pick a dataset and a model first.</p>;
  if (m.isError) {
    return (
      <Banner tone="warn" title="The job wasn't priced">
        <span className="flex flex-col items-start gap-3">{why(m.error)}<Button variant="secondary" onClick={() => price(req)}>Try again</Button></span>
      </Banner>
    );
  }
  if (!d) return <TileScanner label="Freezing the spec and measuring the work" />;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <span className="font-mono text-xs uppercase tracking-wide text-subtle">This job costs</span>
        <span className="text-2xl font-medium text-ink"><Money units={d.budget} live /></span>
        <span className="font-mono text-xs uppercase tracking-wide text-muted">
          {formatGops(d.computeOps)} Gop{rounds ? ` / ${rounds} rounds` : ""} / {quorum} nodes a round
        </span>
      </div>
      <dl className="flex flex-col">
        {rounds ? <PropRow label="Each round pays"><Money units={Math.floor(d.budget / rounds)} /></PropRow> : null}
        {rounds ? <PropRow label="Each node, per round">up to <Money units={Math.floor(d.budget / rounds / quorum)} /></PropRow> : null}
        <PropRow label="Each node stakes"><Money units={d.minStake} /></PropRow>
      </dl>
      <More label="Why this price?">
        <p>1 TOD pays for at least 1 Gop, a billion float operations of training that verifiers replay. The coordinator counts the operations from the spec, so nobody types a budget and nobody can underpay. With more nodes than {quorum} in a round, each one is paid less, and a TOD still buys at least a Gop.</p>
      </More>
    </div>
  );
}
