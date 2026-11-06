"use client";
// The six /docs/learn lessons. Each one teaches a single concept and ends in a hands-on check that runs the same math the product uses, in this browser.
import { useId, useState, type ReactNode } from "react";
import { Lock, LockOpen } from "lucide-react";
import { Button, Eyebrow, Money, Pill, cx } from "@/components/primitives";
import { Term } from "@/components/term";
import { DocSection } from "@/features/docs/DocsFrame";
import { ReVerify } from "@/features/verify/ReVerify";
import { LESSONS, type LessonSlug } from "@/lib/learn/glossary";
import { splitPay } from "@/lib/learn/pay";
import { DEMO_SEED, SEGMENTS, STEPS, runReplay, sha256 } from "@/lib/learn/replay";
import { HASH } from "@/features/demo/script";

const U = 1_000_000;

export function LessonIndex() {
  return (
    <ol className="grid gap-2 sm:grid-cols-2">
      {LESSONS.map((l) => (
        <li key={l.slug}>
          <a href={`#${l.slug}`} className="flex h-full items-start gap-3 rounded-lg border border-rule px-3 py-2.5 transition-colors duration-150 ease-out hover:bg-hover">
            <span className="font-mono text-xs tabular text-subtle">0{l.n}</span>
            <span className="flex flex-col">
              <span className="text-sm text-ink">{l.title}</span>
              <span className="text-xs text-muted">{l.sub}</span>
            </span>
          </a>
        </li>
      ))}
    </ol>
  );
}

function Lesson({ slug, children, check }: { slug: LessonSlug; children: ReactNode; check: ReactNode }) {
  const l = LESSONS.find((x) => x.slug === slug);
  if (!l) return null;
  return (
    <DocSection id={slug} title={`0${l.n}  ${l.title}`}>
      {children}
      <div className="flex flex-col gap-4 rounded-xl border border-rule bg-band p-4">
        <Eyebrow>Try it</Eyebrow>
        {check}
      </div>
    </DocSection>
  );
}

function Slider({ label, value, min, max, step, onChange, show }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; show: ReactNode }) {
  const id = useId();
  return (
    <div className="grid grid-cols-12 items-center gap-3">
      <label htmlFor={id} className="col-span-12 text-sm text-ink sm:col-span-4">{label}</label>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="col-span-8 accent-ink sm:col-span-5" />
      <output htmlFor={id} className="col-span-4 text-right font-mono text-xs tabular text-ink sm:col-span-3">{show}</output>
    </div>
  );
}

function Rounds() {
  const [n, setN] = useState(4);
  const batch = 4096;
  return (
    <Lesson
      slug="rounds"
      check={
        <>
          <Slider label="Laptops in this round" value={n} min={2} max={8} step={1} onChange={setN} show={`${n} laptops`} />
          <div className="flex h-8 overflow-hidden rounded-md border border-rule" aria-hidden>
            {Array.from({ length: n }, (_, i) => (
              <span key={i} className={cx("flex flex-1 items-center justify-center border-r border-rule font-mono text-xs text-muted transition-all duration-200 ease-out last:border-r-0", i % 2 ? "bg-surface" : "bg-band")}>{String.fromCharCode(65 + i)}</span>
            ))}
          </div>
          <p className="text-xs text-muted">Each laptop trains {Math.floor(batch / n).toLocaleString()} of the round&apos;s {batch.toLocaleString()} samples. More laptops make a round faster, not cheaper: the budget per round stays the same.</p>
        </>
      }
    >
      <p>A job is trained in <Term k="round">rounds</Term>. Each round, a few idle laptops are drawn, each gets one <Term k="shard">shard</Term> of the batch, and their updates are checked and merged into the next starting point.</p>
      <p>A round takes about two minutes on a laptop. If a laptop drops out, its shard is lost for that round only; the job carries on with the others.</p>
    </Lesson>
  );
}

function NoFaking() {
  const [work, setWork] = useState("weights after 64 steps: 0.4121");
  const [commit, setCommit] = useState<string | null>(null);
  const [reveal, setReveal] = useState("");
  const [verdict, setVerdict] = useState<"match" | "mismatch" | null>(null);
  const enc = (s: string) => new TextEncoder().encode(s);
  return (
    <Lesson
      slug="no-faking"
      check={
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-sm text-ink">
            1. Your result
            <input value={work} disabled={commit !== null} onChange={(e) => setWork(e.target.value)} className="h-9 rounded-md border border-field bg-surface px-3 font-mono text-xs text-ink disabled:text-muted" />
          </label>
          {commit === null ? (
            <Button variant="primary" icon={Lock} onClick={async () => { setCommit(await sha256(enc(work))); setReveal(work); }}>Commit</Button>
          ) : (
            <>
              <p className="flex flex-wrap items-center gap-2 text-xs text-muted">Posted on chain <span className="break-all font-mono text-ink">{commit.slice(0, 18)}…</span> Everyone sees this fingerprint, nobody sees the result.</p>
              <label className="flex flex-col gap-1.5 text-sm text-ink">
                2. Reveal. Try changing it, the way a copier would.
                <input value={reveal} onChange={(e) => { setReveal(e.target.value); setVerdict(null); }} className="h-9 rounded-md border border-rule bg-surface px-3 font-mono text-xs text-ink" />
              </label>
              <div className="flex flex-wrap items-center gap-3">
                <Button icon={LockOpen} onClick={async () => setVerdict((await sha256(enc(reveal))) === commit ? "match" : "mismatch")}>Reveal</Button>
                <button type="button" onClick={() => { setCommit(null); setVerdict(null); }} className="text-xs text-muted underline decoration-subtle underline-offset-4 hover:text-ink">Start over</button>
              </div>
              {verdict && (
                <p role="status" className={cx("animate-step-in text-sm", verdict === "match" ? "text-ok" : "text-danger")}>
                  {verdict === "match" ? "Reveal accepted: it hashes to the commit." : "Rejected: this reveal doesn't hash to the commit. On chain, the node is marked as a missed reveal."}
                </p>
              )}
            </>
          )}
        </div>
      }
    >
      <p>Each node posts a fingerprint of its result before anyone shows theirs, then reveals the result. That is <Term k="commit-reveal">commit, then reveal</Term>. A reveal that doesn&apos;t match its commit is thrown out, so a node can&apos;t wait and copy a neighbour.</p>
      <p>The random seed that picks which slice gets replayed is drawn after every commit is in. A node can&apos;t know in advance which part of its work will be checked.</p>
    </Lesson>
  );
}

function Replay() {
  const per = STEPS / SEGMENTS;
  const [stop, setStop] = useState(STEPS);
  const skipped = (STEPS - stop) / per;
  const once = skipped / SEGMENTS;
  const ten = 1 - Math.pow(1 - once, 10);
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return (
    <Lesson
      slug="replay"
      check={
        <>
          <Slider label="Node stops training at step" value={stop} min={per} max={STEPS} step={per} onChange={setStop} show={stop === STEPS ? "never, honest" : `step ${stop}`} />
          <div className="grid grid-cols-8 gap-1" aria-label={`${skipped} of ${SEGMENTS} segments skipped`}>
            {Array.from({ length: SEGMENTS }, (_, i) => (
              <span key={i} className={cx("h-6 rounded-xs transition-colors duration-200 ease-out", i * per >= stop ? "bg-hatch" : "bg-muted")} />
            ))}
          </div>
          <p className="text-xs text-muted">
            {skipped === 0
              ? "Every segment was trained, so any replay matches."
              : `${skipped} of ${SEGMENTS} segments are padding. One round's replay lands on one of them ${pct(once)} of the time; across 10 rounds the node is caught with ${pct(ten)} odds, and one catch slashes its stake.`}
          </p>
          <ReVerify
            key={stop}
            expected={HASH.honest}
            what="this node's weights"
            run={(on) => runReplay(DEMO_SEED, (step) => on({ phase: "run", step, of: STEPS }), stop < STEPS ? { skipFrom: stop } : {})}
          />
        </>
      }
    >
      <p>Commit-reveal stops copying, not laziness. A node could skip most of the training and reveal padding. So two verifiers <Term k="replay">replay</Term> one random segment of its work from the same start, and compare the result bit for bit.</p>
      <p>The check below re-runs a recorded round in your browser. The on-chain hash is what an honest run produces. Drag the slider to make the node lazy, then replay it.</p>
    </Lesson>
  );
}

function Poison() {
  const FLAG = 3;
  const MAX = 5;
  const [d, setD] = useState(4.6);
  const others = [{ k: "A", v: 0.7 }, { k: "B", v: 1.1 }, { k: "C", v: 0.9 }];
  const flagged = d > FLAG;
  return (
    <Lesson
      slug="poison"
      check={
        <>
          <Slider label="How far node D pushes" value={d} min={0} max={MAX} step={0.1} onChange={setD} show={`${d.toFixed(1)}x`} />
          <div className="relative h-14" aria-hidden>
            <span className="absolute inset-x-0 top-1/2 h-px bg-rule" />
            <span className="absolute inset-y-0 border-l border-dashed border-danger" style={{ left: `${(FLAG / MAX) * 100}%` }} />
            {[...others, { k: "D", v: d }].map((p) => (
              <span key={p.k} className="absolute top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 transition-all duration-150 ease-out" style={{ left: `${(p.v / MAX) * 100}%` }}>
                <span className={cx("size-3 rounded-full ring-2 ring-band", p.k === "D" && flagged ? "bg-danger" : "bg-ink")} />
                <span className="font-mono text-xs text-muted">{p.k}</span>
              </span>
            ))}
          </div>
          <p role="status" className={cx("text-sm", flagged ? "text-danger" : "text-ink")}>
            {flagged ? `Flagged. D sits ${d.toFixed(1)} times the usual spread from the median, past the line at ${FLAG}. It is left out of the merge and not paid.` : "Merged. D is inside the normal spread, so its update counts like the others. A small push also does little harm."}
          </p>
        </>
      }
    >
      <p>Replay proves a node did the work. It doesn&apos;t prove the work was honest: a node can train on doctored data and replay perfectly. <Term k="poison">Poison detection</Term> ranks every update by how far it sits from the median update.</p>
      <p>The trade-off is deliberate. A poisoner who pushes hard is caught; one who pushes gently stays inside the spread and moves the model very little.</p>
    </Lesson>
  );
}

function Pay() {
  const POT = 2 * U;
  const FLOOR = 0.2 * U;
  const [ds, setDs] = useState([0.031, 0.019, 0.012]);
  const [cFailed, setCFailed] = useState(false);
  const deltas = ds.map((d, i) => (i === 2 && cFailed ? null : d));
  const pay = splitPay(deltas, POT, FLOOR);
  const max = Math.max(...pay.filter((v): v is number => v !== null), 1);
  const paidCount = deltas.filter((d) => d !== null).length;
  return (
    <Lesson
      slug="pay"
      check={
        <>
          {ds.map((d, i) => (
            <Slider key={i} label={`Node ${"ABC"[i]} loss reduction`} value={d} min={0} max={0.05} step={0.001} onChange={(v) => setDs((p) => p.map((x, j) => (j === i ? v : x)))} show={d.toFixed(3)} />
          ))}
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={cFailed} onChange={(e) => setCFailed(e.target.checked)} className="accent-ink" />
            Node C failed its replay
          </label>
          <ul className="flex flex-col gap-2.5 border-t border-rule pt-4">
            {pay.map((p, i) => (
              <li key={i} className="grid grid-cols-12 items-center gap-3">
                <span className="col-span-2 text-sm text-ink sm:col-span-1">{"ABC"[i]}</span>
                <span className="col-span-6 block h-2 overflow-hidden rounded-full bg-surface sm:col-span-8">
                  {p !== null && <span className="block h-full rounded-full bg-ink transition-all duration-200 ease-out" style={{ width: `${(p / max) * 100}%` }} />}
                </span>
                <span className="col-span-4 text-right text-xs sm:col-span-3">{p !== null ? <Money units={p} /> : <span className="text-danger">nothing, slashed</span>}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">Pot <Money units={POT} />, floor <Money units={FLOOR} /> each. The contract live today splits equally instead: <Money units={paidCount ? Math.round(POT / paidCount) : null} /> to each paid node.</p>
        </>
      }
    >
      <p>Every node that passes its checks gets a small floor for showing up, and the rest of the round&apos;s pot is shared by how much each update lowered the validation loss. Shard luck still matters, which is why the floor exists.</p>
      <p><Pill tone="pending">Proposed</Pill> This split is what the team is deciding on. The contract live today pays every passing node the same.</p>
    </Lesson>
  );
}

function Money6() {
  const PROBATION = 5;
  const ROUND = 0.42 * U;
  const [h, setH] = useState(2);
  const proving = h < PROBATION;
  return (
    <Lesson
      slug="money"
      check={
        <>
          <Slider label="Hours since your node joined" value={h} min={0} max={10} step={0.5} onChange={setH} show={`${h} h`} />
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div className="flex flex-col gap-1 rounded-lg border border-rule bg-surface p-3">
              <dt className="text-xs text-muted">A verified round pays</dt>
              <dd className="flex flex-wrap items-baseline gap-2"><Money units={ROUND} /> <span className={cx("text-xs", proving ? "text-warn" : "text-ok")}>{proving ? "to the community pool" : "to you, claim any time"}</span></dd>
            </div>
            <div className="flex flex-col gap-1 rounded-lg border border-rule bg-surface p-3">
              <dt className="text-xs text-muted">Your stake, held in the registry</dt>
              <dd className="flex flex-wrap items-baseline gap-2"><Money units={15 * U} /> <span className="text-xs text-muted">slashed only if caught</span></dd>
            </div>
          </dl>
          <p className="text-xs text-muted">{proving ? `${PROBATION - h} h of proving left. Earnings in this window go to the pool that pays new nodes, so a throwaway node gains nothing by cheating early.` : "Proving is over. Every verified round now pays you."}</p>
        </>
      }
    >
      <p>Three things hold your money. The <Term k="bond">stake</Term> stays in the registry while your node is in the pool. Earnings from verified rounds are yours to claim any time. A node caught cheating is <Term k="slash">slashed</Term>: it loses stake, never earnings already claimed.</p>
      <p>For its first five hours a node is proving itself, and its earnings go to the community pool instead.</p>
    </Lesson>
  );
}

export function Lessons() {
  return (
    <>
      <Rounds />
      <NoFaking />
      <Replay />
      <Poison />
      <Pay />
      <Money6 />
    </>
  );
}
