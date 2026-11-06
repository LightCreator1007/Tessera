"use client";
// The "freeze the spec" step of posting a job: POST /v1/jobs/draft turns the form into a frozen spec, its hash and the createJob calldata.
import { useMutation } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api/client";
import type { Draft, DraftRequest } from "@/lib/api/types";
import { Banner, Button, HashChip, Money, PropRow } from "@/components/primitives";
import { formatToken } from "@/lib/money";

/** Preset datasets the coordinator can draft against, by the card hash in vectors/kernel/presets.json. */
export const DATASET_HASH: Record<string, string> = {
  mnist: "0xa905dbf2a65deb6e1abf496bb1fe7a356639741b5552aaa13a1a0afce7701447",
  cifar10: "0x48a133cef764fd4625c92e07db4d702077f2d11dfd51a0cda2c014fc20d9193c",
};
/** The form's workload names to the registry ids the coordinator knows. */
export const WORKLOAD_ID: Record<string, string> = { "mlp-exact": "mlp-exact/1", "cnn-torch": "cnn-torch/1" };

function why(e: unknown): string {
  if (!(e instanceof ApiError)) return "Something went wrong building the spec.";
  if (e.kind === "unreachable") return "The coordinator didn't answer. Your form is kept; try again when it's back.";
  if (e.status === 501) return "Only the exact MLP can be drafted for now. Tolerance-class workloads need calibrated drift bands first.";
  if (e.status === 422) return e.message.replace(/^\{"detail":"?|"?\}$/g, "") || "The coordinator refused these settings.";
  return `The coordinator couldn't build the spec (HTTP ${e.status}).`;
}

export function DraftStep({ req, stake, onDraft }: { req: DraftRequest | null; stake: number; onDraft: (d: Draft | null) => void }) {
  const m = useMutation({ mutationFn: (r: DraftRequest) => api.draft(r), onSuccess: (r) => onDraft(r.data), onError: () => onDraft(null) });
  const d = m.data?.data;
  const lowStake = d ? stake < d.minStake : false;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">The coordinator turns this form into a frozen spec and its hash, so every node trains exactly the same thing. Nothing is sent to the chain yet.</p>
      <div>
        <Button variant={d ? "secondary" : "primary"} disabled={!req || m.isPending} onClick={() => req && m.mutate(req)}>
          {m.isPending ? "Building the spec…" : d ? "Build it again" : "Freeze spec"}
        </Button>
      </div>
      {!req && <p className="text-xs text-subtle">Pick a dataset and a model first.</p>}
      {m.isError && <Banner tone="warn" title="The spec wasn't built">{why(m.error)}</Banner>}
      {d && (
        <dl className="flex flex-col">
          <PropRow label="Spec hash"><HashChip value={d.modelSpecHash} label="spec hash" /></PropRow>
          <PropRow label="Starting weights"><HashChip value={d.initialWeightsHash} label="initial weights hash" /></PropRow>
          <PropRow label="Minimum stake"><Money units={d.minStake} /></PropRow>
          <PropRow label="Calldata"><span className="font-mono text-xs text-muted">{(d.createJobCalldata.length - 2) / 2} bytes, ready to sign</span></PropRow>
        </dl>
      )}
      {lowStake && d && <Banner tone="warn" title={`Nodes must stake at least ${formatToken(d.minStake)} TOD for this budget`}>Raise the stake on the budget step, or the contract refuses the job.</Banner>}
    </div>
  );
}
