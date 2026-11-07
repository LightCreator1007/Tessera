"use client";
// Post a job one step at a time: data, model, price, review and post. The coordinator prices the job from its spec through POST /v1/jobs/draft (live, or fixtures in demo), so the form never asks for a budget, rounds or stake. Then approve and createJob.
import { calls } from "@/lib/chain";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Database } from "lucide-react";
import { useNodes } from "@/lib/api/hooks";
import { isDemo } from "@/lib/api/client";
import { setWallet, useWallet } from "@/lib/wallet";
import { useTx } from "@/lib/tx";
import { formatToken } from "@/lib/money";
import { More, Sequence, StepPanel, TxButton, TxStatus, WizardProgress, type StepState } from "@/components/flow";
import { openConnect } from "@/components/connect";
import { WorkloadArt } from "@/components/pixel";
import { Banner, Button, HashChip, Money, SourceBadge, cx, short } from "@/components/primitives";
import type { Draft } from "@/lib/api/types";
import { draftRounds } from "@/lib/api/draft";
import { DATASET_HASH, DraftStep, WORKLOAD_ID, formatGops } from "./DraftStep";

const TOD = 1_000_000;

const DATASETS = [
  { id: "mnist", name: "MNIST digits", size: "11 MB", rows: "70k images", fits: ["mlp-exact", "cnn-torch"] },
  { id: "cifar10", name: "CIFAR-10", size: "163 MB", rows: "60k images", fits: ["cnn-torch"] },
];
const WORKLOADS = [
  { id: "mlp-exact", name: "MLP, exact replay", note: "Replays bit for bit. A mismatch slashes the cheater's full stake." },
  { id: "cnn-torch", name: "CNN, PyTorch", note: "Replays within tolerance. Drift is flagged, not slashed." },
];
const STEPS = [{ key: "data", label: "Data" }, { key: "model", label: "Model" }, { key: "price", label: "Price" }, { key: "review", label: "Review" }];

type Form = { dataset: string | null; workload: string | null; epochs: string; quorum: string; maxPerRound: string };
const EMPTY: Form = { dataset: null, workload: null, epochs: "3", quorum: "3", maxPerRound: "6" };
const KEY = "post-job-draft";

export function PostJob() {
  const router = useRouter();
  const w = useWallet();
  const nodes = useNodes();
  const [f, setF] = useState<Form>(EMPTY);
  const [step, setStep] = useState(0);
  const [reach, setReach] = useState(0);
  /** null means the default: as much of the budget as your earnings cover. */
  const [earnStr, setEarnStr] = useState<string | null>(null);
  const [drafted, setDrafted] = useState<Draft | null>(null);
  const approve = useTx();
  const create = useTx({ revertAs: "StakeTooLow" });
  const mint = useTx();

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(KEY);
      if (raw) { const saved = JSON.parse(raw) as Partial<Form>; setF({ dataset: saved.dataset ?? null, workload: saved.workload ?? null, epochs: saved.epochs ?? EMPTY.epochs, quorum: saved.quorum ?? EMPTY.quorum, maxPerRound: saved.maxPerRound ?? EMPTY.maxPerRound }); }
    } catch {
      sessionStorage.removeItem(KEY);
    }
  }, []);
  useEffect(() => sessionStorage.setItem(KEY, JSON.stringify(f)), [f]);
  const set = (k: keyof Form) => (v: string | null) => setF((x) => ({ ...x, [k]: v }));
  /** Every step change goes through here, so the progress bar knows how far you have been. */
  const go = (to: number) => {
    const i = to === 3 && !priced ? 2 : to; // review needs a price
    setStep(i);
    setReach((r) => Math.max(r, i));
  };

  const n = (s: string) => (s.trim() === "" ? NaN : Number(s));
  const quorum = Math.floor(n(f.quorum));
  const maxPer = Math.floor(n(f.maxPerRound));
  const errors = {
    quorum: !(quorum >= 2 && quorum <= 32) ? "Between 2 and 32" : null,
    maxPerRound: !(maxPer >= quorum && maxPer <= 32) ? `Between the quorum (${Number.isFinite(quorum) ? quorum : "?"}) and 32` : null,
  };
  const advancedErr = !!(errors.quorum || errors.maxPerRound);
  const ds = DATASETS.find((d) => d.id === f.dataset);
  const wl = WORKLOADS.find((x) => x.id === f.workload);
  const req = ds && wl && n(f.epochs) >= 1 && !advancedErr
    ? { workload: WORKLOAD_ID[wl.id], datasetHash: DATASET_HASH[ds.id], epochs: Math.floor(n(f.epochs)), minQuorum: quorum, maxPerRound: maxPer }
    : null;
  // Every money figure comes from the priced draft. Until it lands there is no number to show.
  const budget = drafted ? drafted.budget : null;
  const rounds = drafted ? draftRounds(drafted) : null;
  const priced = drafted !== null && req !== null;
  const online = (nodes.data?.data ?? []).filter((x) => x.online && f.workload !== null && x.workloads.includes(f.workload));
  const cap = w.connected && budget !== null ? Math.min(w.claimable, budget) : 0;
  const typed = earnStr === null ? cap : Math.round(n(earnStr) * TOD);
  const fromBalance = Number.isFinite(typed) ? Math.max(0, Math.min(cap, typed)) : 0;
  const earnErr = earnStr !== null && Number.isFinite(typed) && typed > cap ? `At most ${formatToken(cap)} TOD` : null;
  const need = budget === null ? null : budget - fromBalance;
  const shortBy = need === null ? null : need - w.usdc;
  const ready = w.connected && !w.wrongNetwork;
  const posted = create.phase === "confirmed";

  const progress = STEPS.map((x, i) => ({ ...x, state: (i === step ? "current" : i <= reach ? "done" : "todo") as StepState }));

  const post = () =>
    drafted && need !== null && rounds !== null && create.send(() => calls.createJob(drafted.createJobCalldata, fromBalance), () => {
      const id = 100 + w.postedJobs.length + 1;
      setWallet((x) => ({
        usdc: x.usdc - need,
        claimable: x.claimable - fromBalance,
        allowance: 0,
        postedJobs: [...x.postedJobs, { id, workload: f.workload ?? "", dataset: ds?.name ?? "", budget: drafted.budget, rounds, stakePerNode: drafted.minStake, minQuorum: quorum, postedAt: Date.now(), fromEarnings: fromBalance }],
      }));
      sessionStorage.removeItem(KEY);
      setTimeout(() => router.push("/jobs?scope=yours"), 900);
    });

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-14 px-6 pt-10 pb-24 md:pt-16">
      <WizardProgress
        steps={progress}
        shown={step}
        onPick={go}
        aside={
          <span className="flex items-center gap-3">
            <button type="button" onClick={() => { setF(EMPTY); setStep(0); setReach(0); sessionStorage.removeItem(KEY); }} className="text-xs text-subtle hover:text-ink">Discard draft</button>
            <SourceBadge source={isDemo ? "demo" : "live"} />
          </span>
        }
      />

      {step === 0 && (
        <StepPanel key="data" title="What should it learn from?" lede="Pick a dataset. Every node downloads the same copy, so their work can be replayed and checked." footer={<Button variant="primary" disabled={!f.dataset} onClick={() => go(1)}>Continue</Button>}>
          <div className="grid gap-3 sm:grid-cols-2">
            {DATASETS.map((d) => (
              <Choice key={d.id} on={f.dataset === d.id} onClick={() => { set("dataset")(d.id); if (f.workload && !d.fits.includes(f.workload)) set("workload")(null); }}>
                <Database className="size-5 text-muted" strokeWidth={1.5} aria-hidden />
                <span className="pt-2 text-sm text-ink">{d.name}</span>
                <span className="text-sm text-subtle">{d.rows} · {d.size}</span>
              </Choice>
            ))}
          </div>
          <p className="text-sm text-muted">Training data is public. Every node and verifier downloads it to train and to check the work, so only use data anyone may see.</p>
          <More label="Can I use my own data?">
            <p>Not yet. Uploads need a store every node can fetch the same bytes from, which comes after the preset datasets.</p>
          </More>
        </StepPanel>
      )}

      {step === 1 && (
        <StepPanel
          key="model"
          title="Which model?"
          lede={`Models that can train on ${ds?.name ?? "this data"}. They differ in how strictly a replay is checked.`}
          footer={<><Button variant="ghost" onClick={() => go(0)}>Back</Button><Button variant="primary" disabled={!f.workload || !(n(f.epochs) >= 1)} onClick={() => go(2)}>Continue</Button></>}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {WORKLOADS.map((x) => {
              const fits = ds?.fits.includes(x.id) ?? false;
              return (
                <Choice key={x.id} on={f.workload === x.id} disabled={!fits} onClick={() => set("workload")(x.id)}>
                  <WorkloadArt workload={x.id} />
                  <span className="pt-2 text-sm text-ink">{x.name}</span>
                  <span className="text-sm text-subtle">{fits ? x.note : `Doesn't fit ${ds?.name}.`}</span>
                </Choice>
              );
            })}
          </div>
          <More label={`Training length: ${f.epochs || "?"} epochs`} open={!(n(f.epochs) >= 1)}>
            <div className="max-w-xs"><Field label="Epochs" value={f.epochs} onChange={set("epochs")} hint="Passes over the data across all rounds" error={n(f.epochs) >= 1 ? null : "At least 1"} /></div>
          </More>
        </StepPanel>
      )}

      {step === 2 && (
        <StepPanel
          key="price"
          title="What it costs"
          lede="The price comes from the work in the spec, not from a number you pick. It locks in the contract and pays out round by round to nodes whose work passes replay."
          footer={<><Button variant="ghost" onClick={() => go(1)}>Back</Button><Button variant="primary" disabled={!priced} onClick={() => go(3)}>Review</Button></>}
        >
          <DraftStep req={req} onDraft={setDrafted} />
          {priced && <EarningsRow connected={w.connected} claimable={w.claimable} cap={cap} value={earnStr ?? (cap ? String(cap / TOD) : "")} onChange={setEarnStr} error={earnErr} fromBalance={fromBalance} budget={drafted.budget} />}
          {priced && f.workload && online.length < quorum && (
            <Banner tone="warn" title={`Only ${online.length} online nodes run ${f.workload}.`}>You can still post. The job waits until {quorum} are free; the matcher retries every 10 seconds.</Banner>
          )}
          <More label={`Nodes per round: ${f.quorum || "?"} to ${f.maxPerRound || "?"}`} open={advancedErr}>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Nodes needed per round" value={f.quorum} onChange={set("quorum")} error={errors.quorum} hint="A round opens only with this many free nodes. The price assumes this many" />
              <Field label="Most nodes per round" value={f.maxPerRound} onChange={set("maxPerRound")} error={errors.maxPerRound} hint="Extra nodes share the same round pay" />
            </div>
          </More>
        </StepPanel>
      )}

      {step === 3 && drafted && need !== null && shortBy !== null && (
        <StepPanel key="review" title="Review and post" lede="Nothing locks until the last step. After that you can cancel from the job's page, and rounds that never opened come back to you." footer={<Button variant="ghost" onClick={() => go(2)} disabled={create.busy || posted}>Back</Button>}>
          {!isDemo && <Banner tone="pending" title="Posting needs a wallet">Pricing the job is live. Locking the budget and posting is signed in your wallet, which this app doesn&apos;t send yet.</Banner>}
          <dl className="flex flex-col">
            <Recap label="Data" onEdit={() => go(0)}>{ds?.name}</Recap>
            <Recap label="Model" onEdit={() => go(1)}><span className="font-mono">{wl?.id}</span>, {f.epochs} epochs</Recap>
            <Recap label="Price" onEdit={() => go(2)}><Money units={drafted.budget} /> for {formatGops(drafted.computeOps)} Gops{rounds ? `, over ${rounds} rounds` : ""}</Recap>
            <Recap label="Each node" onEdit={() => go(2)}>stakes <Money units={drafted.minStake} />, {f.quorum} to {f.maxPerRound} per round</Recap>
            <Recap label="Spec" onEdit={() => go(2)}><HashChip value={drafted.modelSpecHash} label="spec hash" /></Recap>
            <Recap label="Paid with" onEdit={() => go(2)}>{fromBalance > 0 ? <><Money units={fromBalance} /> from earnings + <Money units={need} /> from wallet</> : <><Money units={need} /> from wallet</>}</Recap>
          </dl>
          <Sequence
            items={[
              {
                key: "wallet", title: "Connect the wallet that pays", done: ready, note: w.address ? short(w.address) : undefined,
                body: <><p className="text-sm text-muted">The budget is locked in the contract, not sent to anyone.</p><Button variant="primary" onClick={openConnect}>{w.wrongNetwork ? "Switch network" : "Connect wallet"}</Button></>,
              },
              {
                key: "fund", title: shortBy > 0 && !posted ? `Get ${formatToken(shortBy)} more TOD` : "Enough TOD", done: shortBy <= 0 || posted, note: <Money units={w.usdc} />,
                body: <><p className="text-sm text-muted">You have {formatToken(w.usdc)} TOD. Test TOD is free on this network.</p><TxButton tx={mint} label="Get test TOD" onRun={() => mint.send(calls.faucet, () => setWallet((x) => ({ usdc: x.usdc + 200 * TOD })))} /><TxStatus tx={mint} /></>,
              },
              {
                key: "approve", title: need === 0 ? "No approve needed" : `Allow ${formatToken(need)} TOD`, done: need === 0 || w.allowance >= need || posted, note: need === 0 ? "earnings cover the whole budget" : "exact amount only",
                body: <><p className="text-sm text-muted">Your wallet asks once, for this amount exactly.</p><TxButton tx={approve} label="Approve" onRun={() => approve.send(() => calls.approve("market", need), () => setWallet({ allowance: need }))} /><TxStatus tx={approve} /></>,
              },
              {
                key: "post", title: posted ? "Posted" : "Lock the budget and post", done: posted, note: "taking you to your jobs",
                body: <><TxButton tx={create} label="Post job" onRun={post} /><TxStatus tx={create} /></>,
              },
            ]}
          />
        </StepPanel>
      )}
    </div>
  );
}

export function Recap({ label, onEdit, children }: { label: string; onEdit: () => void; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-4 border-b border-rule py-3.5 first:border-t">
      <dt className="w-24 shrink-0 text-sm text-subtle">{label}</dt>
      <dd className="min-w-0 flex-1 text-sm text-ink">{children}</dd>
      <button type="button" onClick={onEdit} className="text-sm text-muted hover:text-ink">Edit</button>
    </div>
  );
}

function Choice({ on, disabled, onClick, children }: { on: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={cx("flex flex-col items-start gap-1.5 rounded-lg border p-5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50", on ? "border-ink bg-active" : "border-rule bg-raised hover:border-rule-strong")}
    >
      {children}
    </button>
  );
}

export function Field({ label, value, onChange, error, hint, big }: { label: string; value: string; onChange: (v: string) => void; error?: string | null; hint?: string; big?: boolean }) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-sm text-ink">{label}</span>
      <input
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ""))}
        aria-invalid={!!error}
        className={cx("rounded-lg border bg-sunken px-3 font-mono text-ink outline-none focus:border-muted", big ? "h-14 text-2xl" : "h-10 text-sm", error ? "border-danger" : "border-field")}
      />
      {error ? <span className="text-sm text-danger">{error}</span> : hint ? <span className="text-sm text-subtle">{hint}</span> : null}
    </label>
  );
}

/** Pay-from-earnings row (REVAMP-2 12.2): createJob(params, fromBalance) takes this part from claimable, so only the rest needs an approve. */
function EarningsRow({ connected, claimable, cap, value, onChange, error, fromBalance, budget }: { connected: boolean; claimable: number; cap: number; value: string; onChange: (v: string) => void; error: string | null; fromBalance: number; budget: number }) {
  if (!connected || claimable === 0) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rule px-4 py-3">
        <span className="flex flex-col">
          <span className="text-sm text-ink">Pay from earnings</span>
          <span className="text-xs text-muted">{connected ? "No earnings yet. A node's round pay can fund your next budget." : "Connect a wallet to use any round pay it has earned."}</span>
        </span>
        <Link href="/nodes/add" className="text-xs text-ink underline decoration-rule-strong underline-offset-4 hover:decoration-ink">Add a node</Link>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-brand-line bg-brand-soft p-4">
      <div className="grid items-end gap-4 sm:grid-cols-2">
        <Field label="Pay from earnings (TOD)" value={value} onChange={onChange} error={error} hint={`You have ${formatToken(claimable)} TOD earned; up to ${formatToken(cap)} fits this budget`} />
        <p className="text-sm text-muted sm:pb-2">
          {budget > 0 ? <><span className="font-mono text-ink">{formatToken(fromBalance)}</span> from earnings + <span className="font-mono text-ink">{formatToken(budget - fromBalance)}</span> from wallet</> : "Set a budget first."}
        </p>
      </div>
      {fromBalance > 0 && fromBalance === budget && <p className="text-xs text-brand">Earnings cover the whole budget, so there is no approve step: one transaction posts the job.</p>}
    </div>
  );
}
