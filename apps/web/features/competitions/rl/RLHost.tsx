"use client";
// Host an RL competition on chain: the environment, hidden evaluation seeds, prize and windows, then the seeds reveal file, approve and sign.
import Link from "next/link";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Download, Upload } from "lucide-react";
import type { Hex } from "viem";
import { More, Sequence, StepPanel, TxButton, TxStatus } from "@/components/flow";
import { openConnect } from "@/components/connect";
import { HumanGate } from "@/components/human/HumanGate";
import { Button, short } from "@/components/primitives";
import { api } from "@/lib/api/client";
import { randomSalt } from "@/lib/chain/competitions";
import { RL_LIMITS, rlCalls, seedsCommit, sha256Of } from "@/lib/chain/rlCompetitions";
import { entryPass, useHuman } from "@/lib/identity";
import { TOKEN_DECIMALS } from "@/lib/money";
import { useTx } from "@/lib/tx";
import { useWallet } from "@/lib/wallet";
import { useContracts } from "../LiveEnter";
import { base64Of, downloadRLKit, parseSeeds, saveRLKit, type RLKit } from "./kit";

const FIELD = "w-full rounded-sm border border-rule bg-surface px-3 py-2 text-sm text-ink placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-focus";
const WINDOWS = [[3600, "1 hour"], [6 * 3600, "6 hours"], [86400, "24 hours"], [2 * 86400, "48 hours"], [7 * 86400, "7 days"]] as const;
const isoLocal = (ms: number) => new Date(ms).toISOString().slice(0, 16);
const randomSeeds = () => Array.from(crypto.getRandomValues(new Uint32Array(5)), Number).join(", ");

export function RLHost() {
  const w = useWallet();
  const human = useHuman();
  const qc = useQueryClient();
  const { contracts } = useContracts();
  const approve = useTx();
  const create = useTx();
  const [title, setTitle] = useState("");
  const [task, setTask] = useState("");
  const [env, setEnv] = useState<{ name: string; bytes: Uint8Array; sha: Hex } | null>(null);
  const [envError, setEnvError] = useState<string | null>(null);
  const [seedsText, setSeedsText] = useState(randomSeeds);
  const [episodes, setEpisodes] = useState("5");
  const [maxSteps, setMaxSteps] = useState("1000");
  const [prize, setPrize] = useState("10");
  const [deadline, setDeadline] = useState(() => isoLocal(Date.now() + 3 * 86400_000));
  const [windowS, setWindowS] = useState<number>(86400);
  const [saved, setSaved] = useState(false);
  const [envPosted, setEnvPosted] = useState<string | null>(null);
  const seeds = parseSeeds(seedsText);
  const salt = useMemo(() => randomSalt(), [seedsText]);

  const units = Math.round(Number(prize) * 10 ** TOKEN_DECIMALS);
  const deadlineS = Math.floor(Date.parse(`${deadline}:00Z`) / 1000);
  const eps = Number(episodes);
  const steps = Number(maxSteps);
  const problems = [
    title.trim().length < 3 && "Give it a title of at least 3 characters.",
    !env && "Pick the environment file.",
    typeof seeds === "string" && seeds,
    !(Number.isInteger(eps) && eps >= 1 && eps <= RL_LIMITS.maxEpisodes) && "Episodes per seed must be 1 to 100.",
    !(Number.isInteger(steps) && steps >= 1 && steps <= RL_LIMITS.maxSteps) && "The step limit must be 1 to 1,000,000.",
    !(units >= RL_LIMITS.minPrize) && "The prize must be at least 1 TOD.",
    !(deadlineS > Date.now() / 1000 + 300) && "The deadline must be at least 5 minutes away.",
  ].filter((x): x is string => typeof x === "string");
  const ready = w.connected && !w.wrongNetwork && !!w.address;
  const done = create.phase === "confirmed";

  const kit: RLKit | null = useMemo(() => {
    if (typeof seeds === "string" || !w.address || !contracts?.rlCompetitions) return null;
    return { v: 1, kind: "seeds", chainId: contracts.chainId, contract: contracts.rlCompetitions, competition: null, wallet: w.address.toLowerCase(), commit: seedsCommit(seeds, salt), salt, seeds };
  }, [seeds, w.address, contracts, salt]);

  async function pick(f: File | undefined) {
    setEnvError(null);
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) return setEnvError("The environment is capped at 10 MB.");
    const bytes = new Uint8Array(await f.arrayBuffer());
    setEnv({ name: f.name, bytes, sha: await sha256Of(bytes) });
  }

  /** The new competition's id isn't in hand yet: find it by this host and environment, then post the file there. */
  async function postEnv() {
    if (!env || !w.address) return;
    for (let i = 0; i < 8; i++) {
      await new Promise((r) => setTimeout(r, 2500));
      try {
        const row = (await api.rlCompetitions()).data.find((c) => c.host.toLowerCase() === w.address?.toLowerCase() && c.env.toLowerCase() === env.sha.toLowerCase() && !c.envUploaded);
        if (row) { await api.rlUpload(String(row.id), "env", await base64Of(env.bytes)); setEnvPosted(String(row.id)); break; }
      } catch { /* tried again; the competition page also asks for the file if it never lands */ }
    }
    void qc.invalidateQueries({ queryKey: ["rl"] });
  }

  const meta = JSON.stringify({ title: title.trim(), task: task.trim() });

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-10 px-6 pt-10 pb-24 md:pt-16">
      <StepPanel
        eyebrow={<Link href="/competitions" className="hover:text-ink">competitions</Link>}
        title="Host an RL competition"
        lede="Entrants commit a policy. After the deadline you reveal the seeds, verifiers run every policy on them in a sandbox and sign its mean return, and the contract pays the best one."
        footer={<Link href="/competitions" className="text-sm text-muted hover:text-ink">Cancel</Link>}
      >
        {contracts && !contracts.rlCompetitions && <p role="alert" className="text-sm text-danger">This network&apos;s coordinator doesn&apos;t name an RLCompetitions contract, so hosting can&apos;t be signed here.</p>}
        <Sequence
          items={[
            { key: "wallet", title: "Connect a wallet", done: ready, note: w.address ? short(w.address) : undefined, body: <Button variant="primary" onClick={openConnect}>{w.wrongNetwork ? "Switch network" : "Connect wallet"}</Button> },
            { key: "person", title: human.verified ? "Verified as one person" : "Prove you're one person", done: human.verified || done, note: "World ID", body: <HumanGate intro="Hosts verify too, so the contract can stop a host entering their own competition from a second wallet." /> },
            {
              key: "details", title: "Describe it and set the terms", done: problems.length === 0 || done,
              body: (
                <div className="flex w-full flex-col gap-4">
                  <label className="flex flex-col gap-1.5"><span className="text-sm text-ink">Title</span><input className={FIELD} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Balance the pole" /></label>
                  <label className="flex flex-col gap-1.5"><span className="text-sm text-ink">What the agent does</span><textarea className={FIELD} rows={3} maxLength={2000} value={task} onChange={(e) => setTask(e.target.value)} placeholder="Keep a pole upright on a moving cart for as long as you can." /></label>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-sm text-ink">Environment</span>
                    <label className="inline-flex h-9 w-fit cursor-pointer items-center gap-2 rounded-sm border border-rule bg-surface px-3 text-sm text-ink hover:bg-hover focus-within:ring-2 focus-within:ring-focus">
                      <Upload className="size-4" strokeWidth={1.5} aria-hidden />{env ? env.name : "Choose environment file"}
                      <input type="file" className="sr-only" onChange={(e) => void pick(e.target.files?.[0])} />
                    </label>
                    {envError && <p role="alert" className="text-xs text-danger">{envError}</p>}
                    <More label="What format?"><p>An <span className="font-mono">env.py</span> with an <span className="font-mono">Env</span> class that follows Gymnasium&apos;s API (<span className="font-mono">reset(seed=)</span> and <span className="font-mono">step(action)</span>), or a zip with it at the top. It runs in a sandbox with no network and only the Python packages the node image has, so it can&apos;t import gymnasium. Its sha256 is locked on chain, and it&apos;s public so entrants can train on it.</p></More>
                  </div>
                  <label className="flex flex-col gap-1.5"><span className="text-sm text-ink">Evaluation seeds</span><input className={FIELD} value={seedsText} onChange={(e) => { setSeedsText(e.target.value); setSaved(false); }} /></label>
                  <p className="-mt-2 text-xs text-muted">Hidden until the deadline, so nobody tunes a policy to them. Up to 64.</p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="flex flex-col gap-1.5"><span className="text-sm text-ink">Episodes per seed</span><input type="number" min={1} max={100} className={FIELD} value={episodes} onChange={(e) => setEpisodes(e.target.value)} /></label>
                    <label className="flex flex-col gap-1.5"><span className="text-sm text-ink">Step limit per episode</span><input type="number" min={1} className={FIELD} value={maxSteps} onChange={(e) => setMaxSteps(e.target.value)} /></label>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <label className="flex flex-col gap-1.5"><span className="text-sm text-ink">Prize, TOD</span><input type="number" min={1} step="any" className={FIELD} value={prize} onChange={(e) => setPrize(e.target.value)} /></label>
                    <label className="flex flex-col gap-1.5"><span className="text-sm text-ink">Deadline, UTC</span><input type="datetime-local" className={FIELD} value={deadline} onChange={(e) => setDeadline(e.target.value)} /></label>
                    <label className="flex flex-col gap-1.5"><span className="text-sm text-ink">Reveal window</span>
                      <select className={FIELD} value={windowS} onChange={(e) => setWindowS(Number(e.target.value))}>{WINDOWS.map(([s, l]) => <option key={s} value={s}>{l}</option>)}</select>
                    </label>
                  </div>
                  <p className="text-xs text-muted">After the deadline you have one window to reveal the seeds. Entrants then have one window to reveal their policies, and verifiers another to finish scoring. Miss yours and the prize is split between entrants.</p>
                  {problems.length > 0 && (title || env) && <ul className="flex flex-col gap-1 text-xs text-danger">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
                </div>
              ),
            },
            { key: "save", title: saved ? "Seeds reveal file saved" : "Save your seeds reveal file", done: saved || done, body: <div className="flex flex-col gap-2"><p className="text-sm text-muted">It holds the seeds and the salt behind the public hash. Without it you can&apos;t reveal, and the prize goes to the entrants. A copy stays in this browser.</p><Button variant="primary" icon={Download} disabled={!kit || problems.length > 0} onClick={() => { if (kit) { saveRLKit(kit); downloadRLKit(kit); setSaved(true); } }}>Download reveal file</Button></div> },
            { key: "approve", title: `Allow ${prize || 0} TOD for the prize`, done: approve.phase === "confirmed" || done, note: "exact amount only", body: <><TxButton tx={approve} label="Approve prize" disabled={!saved} why="Save the reveal file first" onRun={() => void approve.run(undefined, () => rlCalls.approvePrize(units))} /><TxStatus tx={approve} /></> },
            {
              key: "create", title: done ? "Competition created" : "Sign and create", done,
              body: (
                <>
                  <p className="text-sm text-muted">Tessera signs an entry pass for your wallet, then your wallet signs the competition. The environment file is uploaded right after.</p>
                  <TxButton tx={create} label="Create competition" disabled={!kit || !env || problems.length > 0} onRun={() => void create.run(() => void postEnv(), async () => {
                    if (!kit || !env || !w.address) throw new Error("Finish the details first.");
                    const pass = await entryPass(w.address, undefined, "rl");
                    if (pass.wallet.toLowerCase() !== w.address.toLowerCase()) throw new Error(`The entry pass is for ${short(pass.wallet)}, not ${short(w.address)}.`);
                    return rlCalls.create({ prize: units, env: env.sha, episodes: eps, maxSteps: steps, seedsHash: kit.commit, deadline: deadlineS, revealWindow: windowS, meta, pass });
                  })} />
                  <TxStatus tx={create} />
                  {done && (envPosted ? <Link href={`/competitions/rl/${envPosted}`} className="text-sm text-ink underline decoration-subtle underline-offset-4">Open the competition</Link> : <p className="text-xs text-muted">Uploading the environment...</p>)}
                </>
              ),
            },
          ]}
        />
      </StepPanel>
    </div>
  );
}
