"use client";
// RL competitions on a live network: the list, one competition's standings and verifier results, and the next step this wallet signs.
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Download, Upload } from "lucide-react";
import type { Address, Hex } from "viem";
import { Sequence, TxButton, TxStatus } from "@/components/flow";
import { openConnect } from "@/components/connect";
import { HumanGate } from "@/components/human/HumanGate";
import { AddressChip, Banner, Button, Money, Pill, Skeleton, type Tone } from "@/components/primitives";
import { api, ApiError, COORD_BASE, isDemo } from "@/lib/api/client";
import { useRLCompetition, useRLCompetitions } from "@/lib/api/hooks";
import type { RLCompetition, RLStanding } from "@/lib/api/types";
import { randomSalt } from "@/lib/chain/competitions";
import { policyCommit, rlCalls, sha256Of } from "@/lib/chain/rlCompetitions";
import { entryPass, useHuman } from "@/lib/identity";
import { useTx } from "@/lib/tx";
import { useWallet } from "@/lib/wallet";
import { useContracts } from "../LiveEnter";
import { base64Of, downloadRLKit, parseRLKit, rlKitMatches, rlKitsFor, saveRLKit, type RLKit } from "./kit";

type W = ReturnType<typeof useWallet>;
const same = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const score = (s: number | null) => (s === null ? "-" : (s / 1000).toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 }));
const span = (s: number) => (s < 7200 ? `${Math.round(s / 60)} min` : s < 172800 ? `${Math.round(s / 3600)} hours` : `${Math.round(s / 86400)} days`);
const when = (t: number) => new Date(t * 1000).toUTCString().replace(" GMT", " UTC");
const LABEL: Record<RLCompetition["status"], [string, Tone]> = {
  open: ["Open", "ok"], "awaiting-seeds": ["Seeds due", "pending"], "seeds-hidden": ["Seeds hidden", "danger"], refundable: ["Refundable", "warn"],
  revealing: ["Revealing", "pending"], scoring: ["Scoring", "pending"], "ready-to-settle": ["Ready to settle", "warn"], settled: ["Settled", "neutral"],
};

/** The RL section of the competitions page. Hidden on a network without the contract. */
export function RLList() {
  const q = useRLCompetitions();
  if (isDemo || (q.error instanceof ApiError && q.error.status === 503)) return null;
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-lg text-ink">RL competitions</h2>
        <Link href="/competitions/rl/new" className="text-sm text-muted underline decoration-subtle underline-offset-4 hover:text-ink">Host an RL competition</Link>
      </div>
      {q.isPending && <Skeleton className="h-16 w-full" />}
      {q.isError && <Banner tone="danger" title="Couldn't read RL competitions" action={<Button onClick={() => void q.refetch()}>Retry</Button>} />}
      {q.data?.data.length === 0 && <p className="text-sm text-muted">None yet. Verifiers run each entrant&apos;s policy on the host&apos;s hidden seeds, and the contract pays the best mean return.</p>}
      <ul className="flex flex-col divide-y divide-rule rounded-sm border border-rule">
        {q.data?.data.map((c) => (
          <li key={c.id}>
            <Link href={`/competitions/rl/${c.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-hover">
              <span className="min-w-0 basis-full truncate text-sm text-ink sm:basis-auto sm:flex-1">{c.title}</span>
              <Pill tone={LABEL[c.status][1]}>{LABEL[c.status][0]}</Pill>
              <Money units={c.prize} className="text-sm" />
              <span className="font-mono text-xs text-muted">{c.entries} {c.entries === 1 ? "entry" : "entries"}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function FilePick({ label, onPick }: { label: string; onPick: (f: File) => void }) {
  return (
    <label className="inline-flex h-9 w-fit cursor-pointer items-center gap-2 rounded-sm border border-rule bg-surface px-3 text-sm text-ink hover:bg-hover focus-within:ring-2 focus-within:ring-focus">
      <Upload className="size-4" strokeWidth={1.5} aria-hidden />{label}
      <input type="file" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = ""; }} />
    </label>
  );
}

/** Picks a file and checks its sha256 against the one the contract holds before anything leaves the browser. */
function useHashedFile(want: string | null) {
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array; sha: Hex } | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function pick(f: File) {
    setError(null);
    if (f.size > 10 * 1024 * 1024) return setError("Files are capped at 10 MB.");
    const bytes = new Uint8Array(await f.arrayBuffer());
    const sha = await sha256Of(bytes);
    if (want && sha.toLowerCase() !== want.toLowerCase()) { setFile(null); return setError(`That file's sha256 is ${sha.slice(0, 12)}..., not the ${want.slice(0, 12)}... the contract holds.`); }
    setFile({ name: f.name, bytes, sha });
  }
  return { file, error, pick, setError };
}

function SendFile({ id, what, want, label, note }: { id: number; what: "env" | `policies/${string}`; want: string; label: string; note: string }) {
  const qc = useQueryClient();
  const f = useHashedFile(want);
  const [busy, setBusy] = useState(false);
  async function send() {
    if (!f.file) return;
    setBusy(true);
    try {
      await api.rlUpload(String(id), what, await base64Of(f.file.bytes));
      void qc.invalidateQueries({ queryKey: ["rl"] });
    } catch (e) {
      f.setError(e instanceof Error ? e.message : "The coordinator refused the file.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted">{note}</p>
      <FilePick label={f.file ? f.file.name : label} onPick={(x) => void f.pick(x)} />
      {f.error && <p role="alert" className="text-xs text-danger">{f.error}</p>}
      <Button variant="primary" disabled={!f.file || busy} onClick={() => void send()}>{busy ? "Uploading" : "Upload"}</Button>
    </div>
  );
}

function useRLKit(c: RLCompetition, find: (k: RLKit) => boolean) {
  const { contracts } = useContracts();
  const [kit, setKit] = useState<RLKit | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (contracts?.rlCompetitions && !kit) setKit(rlKitsFor(contracts.chainId, contracts.rlCompetitions).find(find) ?? null);
  }, [contracts, kit, find]);
  async function upload(f: File) {
    setError(null);
    const k = parseRLKit(await f.text());
    if (typeof k === "string") return setError(k);
    if (!rlKitMatches(k)) return setError("That reveal file doesn't hash to its own commitment. It may be damaged.");
    if (!find(k)) return setError(`That reveal file isn't for this ${k.kind === "seeds" ? "competition's seeds" : "competition and wallet"}.`);
    setKit(k);
  }
  return {
    kit,
    slot: (
      <div className="flex flex-col gap-2">
        <p className={kit ? "text-xs text-ok" : "text-xs text-muted"}>{kit ? "Reveal file ready." : `No reveal file for competition ${c.id} in this browser. Upload the one you saved.`}</p>
        <FilePick label={kit ? "Use a different reveal file" : "Upload reveal file"} onPick={(f) => void upload(f)} />
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      </div>
    ),
  };
}

function RevealSeeds({ c }: { c: RLCompetition }) {
  const qc = useQueryClient();
  const tx = useTx();
  const [find] = useState(() => (k: RLKit) => k.kind === "seeds" && same(k.commit, c.seedsHash));
  const { kit, slot } = useRLKit(c, find);
  return (
    <>
      {slot}
      <TxButton tx={tx} label="Reveal seeds" disabled={!kit?.seeds} why="Needs your reveal file" onRun={() => kit?.seeds && void tx.run(() => void qc.invalidateQueries({ queryKey: ["rl"] }), () => rlCalls.revealSeeds(c.id, kit.seeds as number[], kit.salt))} />
      <TxStatus tx={tx} />
    </>
  );
}

function RevealPolicy({ c, you }: { c: RLCompetition; you: string }) {
  const qc = useQueryClient();
  const tx = useTx();
  const [find] = useState(() => (k: RLKit) => k.kind === "policy" && k.competition === c.id && same(k.wallet, you));
  const { kit, slot } = useRLKit(c, find);
  const f = useHashedFile(kit?.policy ?? null);
  async function afterReveal() {
    // Taken only once the reveal is on chain; give the listing a moment to see it.
    for (let i = 0; i < 6 && f.file; i++) {
      await new Promise((r) => setTimeout(r, 2500));
      try { await api.rlUpload(String(c.id), `policies/${you.toLowerCase()}`, await base64Of(f.file.bytes)); break; } catch { /* retried; the upload card shows if it never lands */ }
    }
    void qc.invalidateQueries({ queryKey: ["rl"] });
  }
  return (
    <>
      {slot}
      <FilePick label={f.file ? f.file.name : "Choose your policy file again"} onPick={(x) => void f.pick(x)} />
      {f.error && <p role="alert" className="text-xs text-danger">{f.error}</p>}
      <p className="text-xs text-muted">The policy goes to the coordinator only after the reveal is on chain, and only if it hashes to what you committed.</p>
      <TxButton tx={tx} label="Reveal policy" disabled={!kit?.policy || !f.file} why={!kit ? "Needs your reveal file" : "Choose the policy file"} onRun={() => kit?.policy && void tx.run(() => void afterReveal(), () => rlCalls.revealPolicy(c.id, you as Address, kit.policy as Hex, kit.salt))} />
      <TxStatus tx={tx} />
    </>
  );
}

function PostScore({ c, s }: { c: RLCompetition; s: RLStanding }) {
  const qc = useQueryClient();
  const tx = useTx();
  const ready = s.results.ready;
  if (!ready) return null;
  return (
    <>
      <p className="text-sm text-muted">{ready.signatures.length} verifiers agree on a mean return of {score(ready.score)}. Anyone can post it.</p>
      <TxButton tx={tx} label="Post score" onRun={() => void tx.run(() => void qc.invalidateQueries({ queryKey: ["rl"] }), () => rlCalls.submitScore(c.id, s.entrant as Address, ready.score, ready.signatures as Hex[]))} />
      <TxStatus tx={tx} />
    </>
  );
}

function Simple({ label, make }: { label: string; make: () => ReturnType<typeof rlCalls.settle> }) {
  const qc = useQueryClient();
  const tx = useTx();
  return (
    <>
      <TxButton tx={tx} label={label} onRun={() => void tx.run(() => void qc.invalidateQueries({ queryKey: ["rl"] }), make)} />
      <TxStatus tx={tx} />
    </>
  );
}

function Enter({ c, w, replacing }: { c: RLCompetition; w: W; replacing: boolean }) {
  const qc = useQueryClient();
  const human = useHuman();
  const { contracts } = useContracts();
  const tx = useTx();
  const f = useHashedFile(null);
  const [salt, setSalt] = useState<Hex>(() => randomSalt());
  const [saved, setSaved] = useState(false);
  const ready = w.connected && !w.wrongNetwork && !!w.address;
  const kit: RLKit | null = f.file && w.address && contracts?.rlCompetitions
    ? { v: 1, kind: "policy", chainId: contracts.chainId, contract: contracts.rlCompetitions, competition: c.id, wallet: w.address.toLowerCase(), commit: policyCommit(c.id, w.address as Address, f.file.sha, salt), salt, policy: f.file.sha, file: f.file.name }
    : null;
  const done = tx.phase === "confirmed";
  return (
    <Sequence items={[
      { key: "wallet", title: "Connect a wallet", done: ready, body: <Button variant="primary" onClick={openConnect}>{w.wrongNetwork ? "Switch network" : "Connect wallet"}</Button> },
      { key: "person", title: human.verified ? "Verified as one person" : "Prove you're one person", done: human.verified || done, note: "World ID", body: <HumanGate intro="One entry per person, so nobody wins by entering many wallets." /> },
      {
        key: "policy", title: f.file ? `Policy: ${f.file.name}` : "Choose your policy", done: !!f.file || done,
        body: (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted">A <span className="font-mono">policy.py</span> with <span className="font-mono">act(observation)</span>, or a zip with it at the top. Observations arrive as plain lists and numbers. Only its sha256 goes on chain until the deadline.</p>
            <FilePick label="Choose policy file" onPick={(x) => { setSaved(false); setSalt(randomSalt()); void f.pick(x); }} />
            {f.error && <p role="alert" className="text-xs text-danger">{f.error}</p>}
          </div>
        ),
      },
      { key: "save", title: saved ? "Reveal file saved" : "Save your reveal file", done: saved || done, body: <><p className="text-sm text-muted">It holds the salt behind your commitment. Without it, and the policy file itself, your entry can&apos;t be revealed or scored.</p><Button variant="primary" icon={Download} disabled={!kit} onClick={() => { if (kit) { saveRLKit(kit); downloadRLKit(kit); setSaved(true); } }}>Download reveal file</Button></> },
      {
        key: "sign", title: done ? (replacing ? "Entry replaced" : "Entered") : replacing ? "Sign the replacement" : "Sign and enter", done,
        body: (
          <>
            <TxButton tx={tx} label={replacing ? "Replace entry" : "Enter"} disabled={!kit || !saved} why="Save the reveal file first" onRun={() => void tx.run(() => void qc.invalidateQueries({ queryKey: ["rl"] }), async () => {
              if (!kit || !w.address) throw new Error("Choose the policy first.");
              const pass = await entryPass(w.address, undefined, "rl");
              if (!same(pass.wallet, w.address)) throw new Error(`The entry pass is for ${pass.wallet}, not this wallet.`);
              return rlCalls.enter(c.id, kit.commit, pass);
            })} />
            <TxStatus tx={tx} />
          </>
        ),
      },
    ]} />
  );
}

/** What this wallet can do now, or null when the next move belongs to someone else. */
function NextStep({ c, w }: { c: RLCompetition; w: W }) {
  const you = w.address;
  const host = same(c.host, you);
  const mine = you ? c.standings.find((s) => same(s.entrant, you)) : undefined;
  const postable = c.standings.filter((s) => s.score === null && s.results.ready);
  const step = (title: string, body: ReactNode) => <Panel title={title}>{body}</Panel>;
  if (!c.envUploaded && c.status !== "settled") {
    return step("Upload the environment", <SendFile id={c.id} what="env" want={c.env} label="Choose environment file" note="An env.py exposing an Env class with Gymnasium's reset and step, or a zip with it at the top. Anyone may upload it; only the file the host locked on chain is taken." />);
  }
  switch (c.status) {
    case "open":
      return host ? null : step(mine ? "Replace your entry" : "Enter", <Enter c={c} w={w} replacing={!!mine} />);
    case "awaiting-seeds":
      return host ? step("Reveal the seeds", <RevealSeeds c={c} />) : null;
    case "revealing":
    case "scoring":
      if (mine && !mine.policy && c.status === "revealing" && you) return step("Reveal your policy", <RevealPolicy c={c} you={you} />);
      if (mine?.policy && !mine.policyUploaded) return step("Upload your policy", <SendFile id={c.id} what={`policies/${mine.entrant}`} want={mine.policy} label="Choose policy file" note="Verifiers can only run it once the coordinator has it." />);
      return postable.length ? step("Post verified scores", postable.map((s) => <PostScore key={s.entrant} c={c} s={s} />)) : null;
    case "ready-to-settle":
    case "refundable":
      return step("Settle", <Simple label={c.status === "refundable" ? "Settle and refund the host" : "Settle and pay the winner"} make={() => rlCalls.settle(c.id)} />);
    case "seeds-hidden":
      return mine && !mine.share ? step("Claim your share", <Simple label="Claim my share" make={() => rlCalls.claimShare(c.id)} />) : null;
    default:
      return null;
  }
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return <section className="flex flex-col gap-3 rounded-sm border border-rule p-4"><h2 className="text-sm text-ink">{title}</h2>{children}</section>;
}

function Fact({ k, children }: { k: string; children: ReactNode }) {
  return <div className="flex flex-col gap-0.5"><dt className="text-xs text-muted">{k}</dt><dd className="font-mono text-sm text-ink">{children}</dd></div>;
}

function Standings({ c }: { c: RLCompetition }) {
  if (c.standings.length === 0) return <p className="text-sm text-muted">No entries yet.</p>;
  return (
    <div className="overflow-x-auto rounded-sm border border-rule">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-muted"><th className="px-3 py-2">Rank</th><th className="px-3 py-2">Entrant</th><th className="px-3 py-2">Policy</th><th className="px-3 py-2">Verifiers</th><th className="px-3 py-2 text-right">Mean return</th></tr></thead>
        <tbody className="divide-y divide-rule">
          {c.standings.map((s) => (
            <tr key={s.entrant}>
              <td className="px-3 py-2 font-mono">{s.rank ?? "-"}{s.tied && <span className="ml-1 text-xs text-warn">tie</span>}</td>
              <td className="px-3 py-2"><AddressChip value={s.entrant} /></td>
              <td className="px-3 py-2 text-xs text-muted">{s.policy ? (s.policyUploaded ? "revealed" : "revealed, file missing") : "sealed"}</td>
              <td className="px-3 py-2 text-xs text-muted">{s.results.results.length ? `${s.results.results.length} ran it${s.results.agreed ? "" : ", disagree"}` : "-"}</td>
              <td className="px-3 py-2 text-right font-mono">{score(s.score ?? s.results.ready?.score ?? null)}{s.score === null && s.results.ready && <span className="ml-1 text-xs text-muted">unposted</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RLDetail({ id }: { id: string }) {
  const q = useRLCompetition(id);
  const w = useWallet();
  if (isDemo) return <Shell><Banner tone="demo" title="RL competitions need a live network">Run the site against a coordinator whose network has an RLCompetitions contract.</Banner></Shell>;
  if (q.isPending) return <Shell><Skeleton className="h-8 w-2/3" /><Skeleton className="h-40 w-full" /></Shell>;
  if (q.isError || !q.data) {
    const missing = q.error instanceof ApiError && q.error.status === 404;
    return <Shell><Banner tone="danger" title={missing ? "No such RL competition" : "Couldn't read this competition"} action={missing ? undefined : <Button onClick={() => void q.refetch()}>Retry</Button>} /></Shell>;
  }
  const c = q.data.data;
  return (
    <Shell>
      <div className="flex flex-col gap-2">
        <Link href="/competitions" className="text-xs text-muted hover:text-ink">competitions</Link>
        <div className="flex flex-wrap items-center gap-3"><h1 className="text-2xl text-ink">{c.title}</h1><Pill tone={LABEL[c.status][1]}>{LABEL[c.status][0]}</Pill></div>
        {c.task && <p className="max-w-prose text-sm text-muted">{c.task}</p>}
      </div>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Fact k="Prize"><Money units={c.prize} /></Fact>
        <Fact k="Deadline">{when(c.deadline)}</Fact>
        <Fact k="Episodes per seed">{c.episodes}</Fact>
        <Fact k="Step limit">{c.maxSteps.toLocaleString()}</Fact>
        <Fact k="Seeds">{c.seeds ? c.seeds.join(", ") : "hidden until the deadline"}</Fact>
        <Fact k="Environment">{c.envUploaded && COORD_BASE ? <a className="underline decoration-subtle underline-offset-4" href={`${COORD_BASE}/v1/rl/competitions/${c.id}/env`}>download</a> : "not uploaded"}</Fact>
        <Fact k="Host"><AddressChip value={c.host} you={same(c.host, w.address)} /></Fact>
        <Fact k="Reveal window">{span(c.revealWindow)}</Fact>
      </dl>
      <NextStep c={c} w={w} />
      <section className="flex flex-col gap-3"><h2 className="text-lg text-ink">Standings</h2><Standings c={c} /></section>
      {c.settledTo && <p className="text-sm text-muted">{c.settledTo.refunded ? "Refunded to the host." : <>Paid <Money units={c.settledTo.amount} /> to <AddressChip value={c.settledTo.to} />.</>}</p>}
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 pt-10 pb-24 md:pt-16">{children}</div>;
}

