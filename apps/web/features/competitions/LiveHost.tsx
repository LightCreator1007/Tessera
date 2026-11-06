"use client";
// Host a competition on chain: describe it, pick the answer labels, set prize and windows, save the labels reveal file, approve the prize, sign. Banner, rules and environments come after, in Settings.
import Link from "next/link";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Download, Upload } from "lucide-react";
import { More, Sequence, StepPanel, TxButton, TxStatus } from "@/components/flow";
import { openConnect } from "@/components/connect";
import { HumanGate } from "@/components/human/HumanGate";
import { Button, short } from "@/components/primitives";
import { competitionCalls, labelsCommit, LIMITS, randomSalt } from "@/lib/chain/competitions";
import { entryPass, useHuman } from "@/lib/identity";
import { TOKEN_DECIMALS } from "@/lib/money";
import { useTx } from "@/lib/tx";
import { useWallet } from "@/lib/wallet";
import { useContracts } from "./LiveEnter";
import { downloadKit, hexOf, readClassFile, saveKit, type Kit } from "./revealKit";

const FIELD = "w-full rounded-sm border border-rule bg-surface px-3 py-2 text-sm text-ink placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-focus";
const WINDOWS = [[3600, "1 hour"], [6 * 3600, "6 hours"], [86400, "24 hours"], [2 * 86400, "48 hours"], [7 * 86400, "7 days"]] as const;
const isoLocal = (ms: number) => new Date(ms).toISOString().slice(0, 16);

export function LiveHost() {
  const w = useWallet();
  const human = useHuman();
  const qc = useQueryClient();
  const { contracts } = useContracts();
  const approve = useTx();
  const create = useTx();
  const [title, setTitle] = useState("");
  const [task, setTask] = useState("");
  const [labels, setLabels] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [prize, setPrize] = useState("10");
  const [deadline, setDeadline] = useState(() => isoLocal(Date.now() + 3 * 86400_000));
  const [windowS, setWindowS] = useState<number>(86400);
  const [saved, setSaved] = useState(false);
  const salt = useMemo(() => randomSalt(), [labels]);

  const units = Math.round(Number(prize) * 10 ** TOKEN_DECIMALS);
  const deadlineS = Math.floor(Date.parse(`${deadline}:00Z`) / 1000);
  const problems = [
    title.trim().length < 3 && "Give it a title of at least 3 characters.",
    task.trim().length < 10 && "Say what's predicted, in at least 10 characters.",
    !labels && "Pick the answer labels.",
    !(units >= LIMITS.minPrize) && "The prize must be at least 1 TOD.",
    !(deadlineS > Date.now() / 1000 + 300) && "The deadline must be at least 5 minutes away.",
  ].filter((x): x is string => typeof x === "string");
  const ready = w.connected && !w.wrongNetwork && !!w.address;
  const done = create.phase === "confirmed";

  const kit: Kit | null = useMemo(() => {
    if (!labels || !w.address || !contracts?.competitions) return null;
    return { v: 1, kind: "labels", chainId: contracts.chainId, contract: contracts.competitions, competition: null, wallet: w.address.toLowerCase(), commit: labelsCommit(labels.bytes, salt), salt, data: hexOf(labels.bytes), items: labels.bytes.length };
  }, [labels, w.address, contracts, salt]);

  async function pick(f: File | undefined) {
    setFileError(null);
    setSaved(false);
    if (!f) return;
    const r = await readClassFile(f);
    if (typeof r === "string") { setLabels(null); return setFileError(r); }
    setLabels({ name: f.name, bytes: r });
  }

  const meta = JSON.stringify({ title: title.trim(), task: task.trim(), dataset: "custom" });

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-10 px-6 pt-10 pb-24 md:pt-16">
      <StepPanel
        eyebrow={<Link href="/competitions" className="hover:text-ink">competitions</Link>}
        title="Host a competition"
        lede="The contract holds the prize and scores every entry against your labels, so nobody has to trust you or Tessera with the result. Only a hash of the labels is public until the deadline."
        footer={<Link href="/competitions" className="text-sm text-muted hover:text-ink">Cancel</Link>}
      >
        {contracts && !contracts.competitions && <p role="alert" className="text-sm text-danger">This network&apos;s coordinator doesn&apos;t name a Competitions contract, so hosting can&apos;t be signed here.</p>}
        <Sequence
          items={[
            {
              key: "wallet", title: "Connect a wallet", done: ready, note: w.address ? short(w.address) : undefined,
              body: <><p className="text-sm text-muted">This wallet pays the prize and is the only one that can reveal labels and edit the listing.</p><Button variant="primary" onClick={openConnect}>{w.wrongNetwork ? "Switch network" : "Connect wallet"}</Button></>,
            },
            {
              key: "person", title: human.verified ? "Verified as one person" : "Prove you're one person", done: human.verified || done, note: "World ID",
              body: <HumanGate intro="Hosts verify too, so the contract can stop a host entering their own competition from a second wallet." />,
            },
            {
              key: "details", title: "Describe it and set the terms", done: (problems.length === 0 && !!labels) || done, note: labels ? `${labels.bytes.length.toLocaleString()} items` : undefined,
              body: (
                <div className="flex w-full flex-col gap-4">
                  <label className="flex flex-col gap-1.5"><span className="text-sm text-ink">Title</span><input className={FIELD} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Read the digits" /></label>
                  <label className="flex flex-col gap-1.5"><span className="text-sm text-ink">What's predicted</span><textarea className={FIELD} rows={3} maxLength={2000} value={task} onChange={(e) => setTask(e.target.value)} placeholder="Classify 1,000 handwritten digits into 10 classes." /></label>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-sm text-ink">Answer labels</span>
                    <label className="inline-flex h-9 w-fit cursor-pointer items-center gap-2 rounded-sm border border-rule bg-surface px-3 text-sm text-ink hover:bg-hover focus-within:ring-2 focus-within:ring-focus">
                      <Upload className="size-4" strokeWidth={1.5} aria-hidden />{labels ? labels.name : "Choose labels file"}
                      <input type="file" className="sr-only" onChange={(e) => void pick(e.target.files?.[0])} />
                    </label>
                    {fileError && <p role="alert" className="text-xs text-danger">{fileError}</p>}
                    <More label="What format?"><p>One true class (0 to 255) per item, up to 10,000 items: raw bytes, or text with one number per line or comma. The file never leaves your browser until you reveal it after the deadline, and then it&apos;s public on chain.</p></More>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <label className="flex flex-col gap-1.5"><span className="text-sm text-ink">Prize, TOD</span><input type="number" min={1} step="any" className={FIELD} value={prize} onChange={(e) => setPrize(e.target.value)} /></label>
                    <label className="flex flex-col gap-1.5"><span className="text-sm text-ink">Deadline, UTC</span><input type="datetime-local" className={FIELD} value={deadline} onChange={(e) => setDeadline(e.target.value)} /></label>
                    <label className="flex flex-col gap-1.5"><span className="text-sm text-ink">Reveal window</span>
                      <select className={FIELD} value={windowS} onChange={(e) => setWindowS(Number(e.target.value))}>{WINDOWS.map(([s, l]) => <option key={s} value={s}>{l}</option>)}</select>
                    </label>
                  </div>
                  <p className="text-xs text-muted">After the deadline you have the reveal window to reveal the labels, then entrants have the same window to reveal their entries. Miss yours and the prize is split between entrants.</p>
                  {problems.length > 0 && labels && <ul className="flex flex-col gap-1 text-xs text-danger">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
                </div>
              ),
            },
            {
              key: "save", title: saved ? "Labels reveal file saved" : "Save your labels reveal file", done: saved || done,
              body: <div className="flex flex-col gap-2"><p className="text-sm text-muted">It holds the labels and the salt behind the public hash. Without it you can&apos;t reveal, and the prize goes to the entrants. A copy stays in this browser.</p><Button variant="primary" icon={Download} disabled={!kit || problems.length > 0} onClick={() => { if (kit) { saveKit(kit); downloadKit(kit); setSaved(true); } }}>Download reveal file</Button></div>,
            },
            {
              key: "approve", title: `Allow ${prize || 0} TOD for the prize`, done: approve.phase === "confirmed" || done, note: "exact amount only",
              body: <><p className="text-sm text-muted">The contract takes the prize when you create the competition and holds it until settle.</p><TxButton tx={approve} label="Approve prize" disabled={!saved} why="Save the reveal file first" onRun={() => void approve.run(undefined, () => competitionCalls.approvePrize(units))} /><TxStatus tx={approve} /></>,
            },
            {
              key: "create", title: done ? "Competition created" : "Sign and create", done,
              body: (
                <>
                  <p className="text-sm text-muted">Tessera signs an entry pass for your wallet, then your wallet signs the competition. Afterwards, add a banner, rules and files such as RL environments in its Settings.</p>
                  <TxButton tx={create} label="Create competition" disabled={!kit || problems.length > 0} onRun={() => void create.run(() => void qc.invalidateQueries({ queryKey: ["competitions"] }), async () => {
                    if (!kit || !w.address) throw new Error("Pick the labels first.");
                    const pass = await entryPass(w.address);
                    if (pass.wallet.toLowerCase() !== w.address.toLowerCase()) throw new Error(`The entry pass is for ${short(pass.wallet)}, not ${short(w.address)}.`);
                    return competitionCalls.create({ prize: units, labelsHash: kit.commit, deadline: deadlineS, revealWindow: windowS, items: kit.items, meta, pass });
                  })} />
                  <TxStatus tx={create} />
                  {done && <Link href="/competitions" className="text-sm text-ink underline decoration-subtle underline-offset-4">See it in competitions, then open Settings</Link>}
                </>
              ),
            },
          ]}
        />
      </StepPanel>
    </div>
  );
}
