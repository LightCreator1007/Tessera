"use client";
// Host a competition in four steps: commit the labels, set the prize and compute budget, pick the deadline under the fixed rules, then review and sign once. The labels hash is the point of the whole flow, so it is shown before anything is paid. Without a competition contract this runs on the demo wallet only.
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { isDemo } from "@/lib/api/client";
import { setWallet, useWallet } from "@/lib/wallet";
import { useTx } from "@/lib/tx";
import { formatToken } from "@/lib/money";
import { More, Sequence, StepPanel, TxButton, TxStatus, WizardProgress, type StepState } from "@/components/flow";
import { openConnect } from "@/components/connect";
import { Checkbox, TextField } from "@/components/fields";
import { Banner, Button, HashChip, Money, short } from "@/components/primitives";
import { Field, Recap } from "@/features/jobs/PostJob";
import { CommitFile } from "./CommitFile";
import { RULES } from "./Competitions";
import { sampleLabels, split, type Committed } from "./model";

const TOD = 1_000_000;
const DAY = 86_400_000;
const STEPS = [{ key: "labels", label: "Labels" }, { key: "prize", label: "Prize" }, { key: "deadline", label: "Deadline" }, { key: "review", label: "Review" }];
const KEY = "host-competition-draft";

type Form = { title: string; task: string; labels: Committed | null; seed: number | null; final: boolean; prize: string; budget: string; fee: string; deadline: string };
const EMPTY: Form = { title: "", task: "", labels: null, seed: null, final: false, prize: "100", budget: "40", fee: "1", deadline: "" };

const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 28) || "competition";

export function HostCompetition() {
  const router = useRouter();
  const w = useWallet();
  const [f, setF] = useState<Form>(EMPTY);
  const [step, setStep] = useState(0);
  const [reach, setReach] = useState(0);
  const [now, setNow] = useState<number | null>(null);
  const approve = useTx();
  const mint = useTx();
  const open = useTx({ revertAs: "BadInput" });

  useEffect(() => {
    setNow(Date.now());
    try {
      const raw = sessionStorage.getItem(KEY);
      if (raw) setF({ ...EMPTY, ...JSON.parse(raw) });
    } catch {
      sessionStorage.removeItem(KEY); // A draft from an older shape is dropped rather than half-restored.
    }
  }, []);
  useEffect(() => sessionStorage.setItem(KEY, JSON.stringify(f)), [f]);
  const set = <K extends keyof Form>(k: K) => (v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const go = (i: number) => { setStep(i); setReach((r) => Math.max(r, i)); };

  const n = (s: string) => (s.trim() === "" ? NaN : Number(s));
  const prize = Math.round(n(f.prize) * TOD);
  const budget = Math.round(n(f.budget) * TOD);
  const fee = Math.round(n(f.fee) * TOD);
  const total = prize + budget;
  const minDay = now ? isoDay(now + DAY) : "";
  const maxDay = now ? isoDay(now + 90 * DAY) : "";

  const errors = {
    title: f.title.trim().length < 3 ? "At least 3 characters" : f.title.length > 80 ? "80 characters at most" : null,
    task: f.task.trim().length < 10 ? "Say what entrants predict, in a sentence" : null,
    prize: !(prize >= TOD) ? "At least 1 TOD" : null,
    budget: !(budget >= 0) ? "0 or more" : null,
    fee: !(fee >= 0) ? "0 or more" : fee > prize ? "No more than the prize" : null,
    deadline: !f.deadline ? "Pick a date" : f.deadline < minDay || f.deadline > maxDay ? "Between tomorrow and 90 days out" : null,
  };
  const labelsOk = !errors.title && !errors.task && !!f.labels && f.final;
  const prizeOk = !errors.prize && !errors.budget && !errors.fee;
  const deadlineOk = !errors.deadline;

  const pay = split(total, w);
  const ready = w.connected && !w.wrongNetwork;
  const opened = open.phase === "confirmed";
  const progress = STEPS.map((x, i) => ({ ...x, state: (i === step ? "current" : i <= reach ? "done" : "todo") as StepState }));

  const commit = () =>
    open.run(() => {
      const id = `${slug(f.title)}-${w.hosted.length + 1}`;
      setWallet((x) => ({
        usdc: x.usdc - pay.need,
        claimable: x.claimable - pay.fromEarnings,
        allowance: 0,
        hosted: [...x.hosted, {
          id, host: x.address ?? "", title: f.title.trim(), task: f.task.trim(), prize, budget, fee, deadline: `${f.deadline}T18:00:00Z`,
          labelsHash: f.labels?.hash ?? "", labelsSeed: f.labels?.sample ? f.seed : null,
          committedAt: 18_390_000 + x.hosted.length * 1_000 + 17, createdAt: Date.now(), fromEarnings: pay.fromEarnings,
        }],
      }));
      sessionStorage.removeItem(KEY);
      setTimeout(() => router.push(`/competitions/${id}`), 900);
    });

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-14 px-6 pt-10 pb-24 md:pt-16">
      <WizardProgress
        steps={progress}
        shown={step}
        onPick={go}
        aside={<button type="button" onClick={() => { setF(EMPTY); setStep(0); setReach(0); sessionStorage.removeItem(KEY); }} className="text-xs text-subtle hover:text-ink">Discard draft</button>}
      />

      {step === 0 && (
        <StepPanel
          key="labels"
          title="What will entrants be scored on?"
          lede="Name the task, then commit the answer key. Its hash goes on chain before anyone enters, so nobody, including you, can change the scoring later."
          footer={<Button variant="primary" disabled={!labelsOk} onClick={() => go(1)}>Continue</Button>}
        >
          <div className="flex flex-col gap-5">
            <Labelled id="c-title" label="Title" error={f.title ? errors.title : null}>
              <TextField id="c-title" value={f.title} onChange={set("title")} placeholder="Leaf disease, 10 classes" invalid={!!f.title && !!errors.title} />
            </Labelled>
            <Labelled id="c-task" label="What entrants predict" error={f.task ? errors.task : null}>
              <textarea
                id="c-task"
                rows={3}
                value={f.task}
                onChange={(e) => set("task")(e.target.value)}
                placeholder="Classify 2,000 held-out leaf photos into 10 disease classes."
                className="w-full rounded-lg border border-field bg-sunken px-3 py-2 text-sm text-ink outline-none placeholder:text-subtle focus:border-muted"
              />
            </Labelled>
          </div>
          <div className="flex flex-col gap-3">
            <p className="text-sm text-ink">Labels</p>
            <CommitFile what="labels" value={f.labels} onChange={(v) => setF((x) => ({ ...x, labels: v, final: false, seed: v?.sample ? x.seed : null }))} sample={() => { const seed = 9000 + Math.floor(Math.random() * 999); set("seed")(seed); return sampleLabels(seed); }} />
            {f.labels && <Checkbox checked={f.final} onChange={set("final")} label="These are the final labels" hint="After you sign, a different file can't match this hash. Keep the file: you reveal it after the deadline." />}
          </div>
          <More label="Who sees the labels?">
            <p>Nobody, until the deadline. Only the hash is public. After the deadline you have 48 hours to reveal the file; anyone can check it hashes to this commitment and recompute every score.</p>
          </More>
        </StepPanel>
      )}

      {step === 1 && (
        <StepPanel
          key="prize"
          title="Prize and compute budget"
          lede="Both lock in the contract when you sign. The prize goes to the winner; the compute budget pays the nodes that score entries."
          footer={<><Button variant="ghost" onClick={() => go(0)}>Back</Button><Button variant="primary" disabled={!prizeOk} onClick={() => go(2)}>Continue</Button></>}
        >
          <div className="grid gap-6 sm:grid-cols-2">
            <Field label="Prize (TOD)" value={f.prize} onChange={set("prize")} error={errors.prize} big />
            <Field label="Compute budget (TOD)" value={f.budget} onChange={set("budget")} error={errors.budget} big />
          </div>
          <div className="max-w-xs">
            <Field label="Entry fee (TOD)" value={f.fee} onChange={set("fee")} error={errors.fee} hint="Joins the prize pool. 0 makes entry free." />
          </div>
          <PayLine total={total} pay={pay} connected={w.connected} claimable={w.claimable} />
        </StepPanel>
      )}

      {step === 2 && (
        <StepPanel
          key="deadline"
          title="Deadline and rules"
          lede="Entries close at 18:00 UTC on the deadline. The rules are the same for every competition and are shown to entrants before they pay."
          footer={<><Button variant="ghost" onClick={() => go(1)}>Back</Button><Button variant="primary" disabled={!deadlineOk} onClick={() => go(3)}>Review</Button></>}
        >
          <div className="max-w-xs">
            <Labelled id="c-deadline" label="Deadline" error={f.deadline ? errors.deadline : null}>
              <TextField id="c-deadline" type="date" value={f.deadline} onChange={set("deadline")} invalid={!!f.deadline && !!errors.deadline} />
            </Labelled>
          </div>
          <dl className="flex flex-col">
            {RULES.map(([k, v]) => (
              <div key={k} className="grid gap-1 border-t border-rule py-2.5 sm:grid-cols-4 sm:gap-4">
                <dt className="text-sm text-ink">{k}</dt>
                <dd className="text-sm text-muted sm:col-span-3">{v}</dd>
              </div>
            ))}
          </dl>
        </StepPanel>
      )}

      {step === 3 && (
        <StepPanel key="review" title="Review and open entries" lede="One signature commits the labels hash and locks the prize and budget. After that the competition can't be edited or cancelled." footer={<Button variant="ghost" onClick={() => go(2)} disabled={open.busy || opened}>Back</Button>}>
          {!isDemo && <Banner tone="warn" title="Competitions aren't on chain yet.">Your draft is kept in this tab. Opening entries needs the competition contract.</Banner>}
          <dl className="flex flex-col">
            <Recap label="Task" onEdit={() => go(0)}>{f.title}</Recap>
            <Recap label="Labels" onEdit={() => go(0)}><HashChip value={f.labels?.hash ?? null} label="labels commitment" /></Recap>
            <Recap label="Prize" onEdit={() => go(1)}><Money units={prize} />, plus <Money units={budget} /> compute</Recap>
            <Recap label="Entry fee" onEdit={() => go(1)}>{fee === 0 ? "Free" : <Money units={fee} />}</Recap>
            <Recap label="Deadline" onEdit={() => go(2)}>{f.deadline}, 18:00 UTC</Recap>
            <Recap label="Paid with" onEdit={() => go(1)}>{pay.fromEarnings > 0 ? <><Money units={pay.fromEarnings} /> from earnings + <Money units={pay.need} /> from wallet</> : <><Money units={pay.need} /> from wallet</>}</Recap>
          </dl>
          <Sequence
            items={[
              {
                key: "wallet", title: "Connect the wallet that hosts", done: ready, note: w.address ? short(w.address) : undefined,
                body: <><p className="text-sm text-muted">This wallet becomes the host. Its owner can't enter the competition.</p><Button variant="primary" onClick={openConnect}>{w.wrongNetwork ? "Switch network" : "Connect wallet"}</Button></>,
              },
              {
                key: "fund", title: pay.shortBy > 0 && !opened ? `Get ${formatToken(pay.shortBy)} more TOD` : "Enough TOD", done: pay.shortBy <= 0 || opened, note: <Money units={w.usdc} />,
                body: <><p className="text-sm text-muted">You have {formatToken(w.usdc)} TOD. Test TOD is free on this network.</p><TxButton tx={mint} label="Get test TOD" onRun={() => mint.run(() => setWallet((x) => ({ usdc: x.usdc + 200 * TOD })))} /><TxStatus tx={mint} /></>,
              },
              {
                key: "approve", title: pay.need === 0 ? "No approve needed" : `Allow ${formatToken(pay.need)} TOD`, done: pay.approved || opened, note: pay.need === 0 ? "earnings cover it" : "exact amount only",
                body: <><p className="text-sm text-muted">Your wallet asks once, for this amount exactly.</p><TxButton tx={approve} label="Approve" onRun={() => approve.run(() => setWallet({ allowance: pay.need }))} /><TxStatus tx={approve} /></>,
              },
              {
                key: "open", title: opened ? "Entries are open" : "Commit labels and open entries", done: opened, note: "taking you to the competition",
                body: <><TxButton tx={open} label="Open entries" disabled={!isDemo || !labelsOk || !prizeOk || !deadlineOk} why={!isDemo ? "Needs the competition contract" : "A step above has a problem"} onRun={commit} /><TxStatus tx={open} /></>,
              },
            ].filter((x) => pay.need > 0 || (x.key !== "fund" && x.key !== "approve"))}
          />
        </StepPanel>
      )}
    </div>
  );
}

function Labelled({ id, label, error, children }: { id: string; label: string; error: string | null; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm text-ink">{label}</label>
      {children}
      {error && <span className="text-sm text-danger">{error}</span>}
    </div>
  );
}

/** The pay-from-earnings default in one line, used by hosting and entering. */
export function PayLine({ total, pay, connected, claimable }: { total: number; pay: ReturnType<typeof split>; connected: boolean; claimable: number }) {
  if (!(total > 0)) return null;
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-brand-line bg-brand-soft p-4">
      <p className="text-sm text-ink"><Money units={total} /> locks when you sign</p>
      <p className="text-sm text-muted">
        {!connected ? "Connect a wallet to pay part of it from round pay you've earned."
          : pay.fromEarnings === 0 ? "No earnings yet, so the wallet pays all of it."
          : pay.need === 0 ? <>Your earnings cover all of it, so there's no approve step. <Money units={claimable - pay.fromEarnings} /> stays earned.</>
          : <><Money units={pay.fromEarnings} /> from earnings + <Money units={pay.need} /> from your wallet.</>}
      </p>
    </div>
  );
}
