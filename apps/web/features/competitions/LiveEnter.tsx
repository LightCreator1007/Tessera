"use client";
// Enter, or replace an entry in, a competition on chain: connect, verify, pick predictions, save the reveal file, sign. The reveal file comes before the signature because an entry without it can never be scored.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Download, Upload } from "lucide-react";
import type { Address } from "viem";
import { More, Sequence, StepPanel, TxButton, TxStatus } from "@/components/flow";
import { openConnect } from "@/components/connect";
import { HumanGate } from "@/components/human/HumanGate";
import { Button, Money, short } from "@/components/primitives";
import { getContracts, type Contracts } from "@/lib/chain";
import { competitionCalls, entryCommit, randomSalt } from "@/lib/chain/competitions";
import { entryPass, useHuman } from "@/lib/identity";
import type { Competition } from "@/lib/learn/competition";
import { useTx } from "@/lib/tx";
import type { useWallet } from "@/lib/wallet";
import { downloadKit, hexOf, readClassFile, saveKit, type Kit } from "./revealKit";

const date = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(new Date(iso));

export function useContracts() {
  const [c, setC] = useState<Contracts | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    getContracts().then(setC, (e: unknown) => setError(e instanceof Error ? e.message : "Couldn't read the network's contracts."));
  }, []);
  return { contracts: c, error };
}

export function LiveEnter({ c, w, replacing }: { c: Competition; w: ReturnType<typeof useWallet>; replacing: boolean }) {
  const router = useRouter();
  const qc = useQueryClient();
  const human = useHuman();
  const { contracts, error: contractsError } = useContracts();
  const enter = useTx({ revertAs: "DeadlinePassed" });
  const [preds, setPreds] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const salt = useMemo(() => randomSalt(), [preds]); // a new file gets a new salt, and a new reveal file to save
  const id = Number(c.id);
  const items = c.items ?? null;
  const ready = w.connected && !w.wrongNetwork && !!w.address;
  const entered = enter.phase === "confirmed";

  const kit: Kit | null = useMemo(() => {
    if (!preds || !w.address || !contracts?.competitions) return null;
    return {
      v: 1, kind: "entry", chainId: contracts.chainId, contract: contracts.competitions, competition: id, wallet: w.address.toLowerCase(),
      commit: entryCommit(id, w.address as Address, preds.bytes, salt), salt, data: hexOf(preds.bytes), items: preds.bytes.length,
    };
  }, [preds, w.address, contracts, id, salt]);

  useEffect(() => setSaved(false), [kit?.commit]);

  async function pick(f: File | undefined) {
    setFileError(null);
    if (!f) return;
    const r = await readClassFile(f, items ?? undefined);
    if (typeof r === "string") {
      setPreds(null);
      return setFileError(r);
    }
    setPreds({ name: f.name, bytes: r });
  }

  function save() {
    if (!kit) return;
    saveKit(kit);
    downloadKit(kit);
    setSaved(true);
  }

  const submit = () =>
    enter.run(
      () => {
        void qc.invalidateQueries({ queryKey: ["competitions"] });
        setTimeout(() => router.push(`/competitions/${c.id}`), 1200);
      },
      async () => {
        if (!kit || !w.address) throw new Error("Pick your predictions file first.");
        const pass = await entryPass(w.address);
        if (pass.wallet.toLowerCase() !== w.address.toLowerCase()) throw new Error(`The entry pass is for ${short(pass.wallet)}, not the connected wallet ${short(w.address)}.`);
        return competitionCalls.enter(id, kit.commit, pass);
      },
    );

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-10 px-6 pt-10 pb-24 md:pt-16">
      <StepPanel
        eyebrow={<Link href={`/competitions/${c.id}`} className="hover:text-ink">{c.title}</Link>}
        title={replacing ? "Replace your entry" : "Enter this competition"}
        lede={<>Entries close {date(c.deadline)} UTC. Only a hash of your predictions goes on chain now; you reveal them after the host reveals the labels, and the contract scores them.{replacing && " Replacing moves your entry to the back of the queue for ties."}</>}
        footer={<Link href={`/competitions/${c.id}`} className="text-sm text-muted hover:text-ink">Cancel</Link>}
      >
        {contractsError && <p role="alert" className="text-sm text-danger">{contractsError}</p>}
        {contracts && !contracts.competitions && <p role="alert" className="text-sm text-danger">This network&apos;s coordinator doesn&apos;t name a Competitions contract, so entries can&apos;t be signed here.</p>}
        <dl className="grid grid-cols-3 gap-4 border-y border-rule py-4">
          <div className="flex flex-col gap-1"><dt className="text-xs text-muted">Entry fee</dt><dd className="text-sm text-ink">Free</dd></div>
          <div className="flex flex-col gap-1"><dt className="text-xs text-muted">Prize</dt><dd className="text-sm"><Money units={c.prize} /></dd></div>
          <div className="flex flex-col gap-1"><dt className="text-xs text-muted">Items</dt><dd className="text-sm tabular text-ink">{items === null ? "Not reported" : items.toLocaleString()}</dd></div>
        </dl>
        <Sequence
          items={[
            {
              key: "wallet", title: "Connect a wallet", done: ready, note: w.address ? short(w.address) : undefined,
              body: <><p className="text-sm text-muted">The wallet that enters is the one that can win.</p><Button variant="primary" onClick={openConnect}>{w.wrongNetwork ? "Switch network" : "Connect wallet"}</Button></>,
            },
            {
              key: "person", title: human.verified ? "Verified as one person" : "Prove you're one person", done: human.verified || entered, note: "World ID",
              body: <HumanGate intro="One entry per person. World ID proves that without telling Tessera who you are, and you only do it once." />,
            },
            {
              key: "preds", title: "Pick your predictions", done: !!preds || entered, note: preds ? `${preds.name}, ${preds.bytes.length.toLocaleString()} items` : undefined,
              body: (
                <div className="flex w-full flex-col gap-3">
                  <label className="inline-flex h-9 w-fit cursor-pointer items-center gap-2 rounded-sm border border-rule bg-surface px-3 text-sm text-ink hover:bg-hover focus-within:ring-2 focus-within:ring-focus">
                    <Upload className="size-4" strokeWidth={1.5} aria-hidden />Choose predictions file
                    <input type="file" className="sr-only" onChange={(e) => void pick(e.target.files?.[0])} />
                  </label>
                  {fileError && <p role="alert" className="text-xs text-danger">{fileError}</p>}
                  <More label="What format?"><p>One predicted class (0 to 255) per item, in item order{items === null ? "" : `, ${items.toLocaleString()} items`}. Either raw bytes, one per item, or text with one number per line or comma. It stays in your browser; only its hash goes on chain.</p></More>
                </div>
              ),
            },
            {
              key: "save", title: saved ? "Reveal file saved" : "Save your reveal file", done: saved || entered, note: saved ? "keep it until you're scored" : undefined,
              body: (
                <div className="flex flex-col gap-2">
                  <p className="text-sm text-muted">It holds your predictions and the random salt that hides them. After the deadline you reveal with it; without it this entry can never be scored. A copy stays in this browser too.</p>
                  <Button variant="primary" icon={Download} disabled={!kit} onClick={save}>Download reveal file</Button>
                </div>
              ),
            },
            {
              key: "enter", title: entered ? (replacing ? "Replaced" : "Entered") : "Sign your entry", done: entered, note: entered ? "taking you back to the competition" : undefined,
              body: <><p className="text-sm text-muted">Tessera checks you&apos;re one person and signs an entry pass, then your wallet signs the entry. No fee.</p><TxButton tx={enter} label={replacing ? "Replace entry" : "Enter"} disabled={!kit || !saved || !contracts?.competitions} why={!saved ? "Save your reveal file first" : undefined} onRun={submit} /><TxStatus tx={enter} /></>,
            },
          ]}
        />
      </StepPanel>
    </div>
  );
}
