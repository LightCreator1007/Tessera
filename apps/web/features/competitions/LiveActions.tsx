"use client";
// The one action a live competition needs next from this wallet, signed here: reveal the labels, reveal your entry, settle, or claim your share.
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import type { Address } from "viem";
import { TxButton, TxStatus } from "@/components/flow";
import { competitionCalls } from "@/lib/chain/competitions";
import type { Competition } from "@/lib/learn/competition";
import { useTx } from "@/lib/tx";
import type { useWallet } from "@/lib/wallet";
import { useContracts } from "./LiveEnter";
import { bytesOf, kitMatches, kitsFor, parseKit, type Kit } from "./revealKit";

type W = ReturnType<typeof useWallet>;
const same = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** Finds this browser's reveal file for a commitment, or takes an uploaded one, and checks it hashes before anything is signed. */
function useKit(find: (k: Kit) => boolean, check: (k: Kit) => string | null) {
  const { contracts } = useContracts();
  const [kit, setKit] = useState<Kit | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!contracts?.competitions || kit) return;
    const found = kitsFor(contracts.chainId, contracts.competitions).find(find);
    if (found) setKit(found);
  }, [contracts, kit, find]);
  async function upload(f: File | undefined) {
    setError(null);
    if (!f) return;
    const k = parseKit(await f.text());
    if (typeof k === "string") return setError(k);
    if (!kitMatches(k)) return setError("That reveal file's data and salt don't hash to its own commitment. It may be damaged.");
    const why = check(k);
    if (why) return setError(why);
    setKit(k);
  }
  return { kit, error, upload, fromBrowser: kit !== null && !error };
}

function KitSlot({ kit, error, upload, what }: { kit: Kit | null; error: string | null; upload: (f: File | undefined) => void; what: string }) {
  return (
    <div className="flex flex-col gap-2">
      {kit ? <p className="text-xs text-ok">Reveal file ready: {kit.items.toLocaleString()} {what}.</p> : <p className="text-xs text-muted">No reveal file for this in this browser. Upload the one you saved.</p>}
      <label className="inline-flex h-9 w-fit cursor-pointer items-center gap-2 rounded-sm border border-rule bg-surface px-3 text-sm text-ink hover:bg-hover focus-within:ring-2 focus-within:ring-focus">
        <Upload className="size-4" strokeWidth={1.5} aria-hidden />{kit ? "Use a different reveal file" : "Upload reveal file"}
        <input type="file" accept=".json,application/json" className="sr-only" onChange={(e) => upload(e.target.files?.[0])} />
      </label>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  );
}

function RevealLabels({ c }: { c: Competition }) {
  const qc = useQueryClient();
  const tx = useTx();
  const [find] = useState(() => (k: Kit) => k.kind === "labels" && same(k.commit, c.labelsHash));
  const [check] = useState(() => (k: Kit) => (k.kind !== "labels" ? "That's an entry's reveal file, not the labels'." : !same(k.commit, c.labelsHash) ? "That reveal file is for a different labels commitment." : k.items !== c.items ? `That file has ${k.items} labels; this competition has ${c.items}.` : null));
  const { kit, error, upload } = useKit(find, check);
  return (
    <div className="flex flex-col gap-3">
      <KitSlot kit={kit} error={error} upload={upload} what="labels" />
      <TxButton tx={tx} label="Reveal labels" disabled={!kit} why="Needs your reveal file" onRun={() => kit && void tx.run(() => void qc.invalidateQueries({ queryKey: ["competitions"] }), () => competitionCalls.revealLabels(Number(c.id), bytesOf(kit.data), kit.salt))} />
      <TxStatus tx={tx} />
    </div>
  );
}

function RevealEntry({ c, you }: { c: Competition; you: string }) {
  const qc = useQueryClient();
  const tx = useTx();
  const id = Number(c.id);
  const [find] = useState(() => (k: Kit) => k.kind === "entry" && k.competition === id && same(k.wallet, you));
  const [check] = useState(() => (k: Kit) => (k.kind !== "entry" ? "That's the labels' reveal file, not an entry's." : k.competition !== id ? `That reveal file is for competition ${k.competition}.` : !same(k.wallet, you) ? "That reveal file is for another wallet." : null));
  const { kit, error, upload } = useKit(find, check);
  return (
    <div className="flex flex-col gap-3">
      <KitSlot kit={kit} error={error} upload={upload} what="predictions" />
      <TxButton tx={tx} label="Reveal and score my entry" disabled={!kit} why="Needs your reveal file" onRun={() => kit && void tx.run(() => void qc.invalidateQueries({ queryKey: ["competitions"] }), () => competitionCalls.revealEntry(id, you as Address, bytesOf(kit.data), kit.salt))} />
      <TxStatus tx={tx} />
    </div>
  );
}

function Simple({ c, label, make }: { c: Competition; label: string; make: (id: number) => ReturnType<typeof competitionCalls.settle> }) {
  const qc = useQueryClient();
  const tx = useTx();
  return (
    <div className="flex flex-col gap-2">
      <TxButton tx={tx} label={label} onRun={() => void tx.run(() => void qc.invalidateQueries({ queryKey: ["competitions"] }), () => make(Number(c.id)))} />
      <TxStatus tx={tx} />
    </div>
  );
}

/** What this wallet can sign now, or null when the next move belongs to someone else. */
export function LiveAction({ c, w }: { c: Competition; w: W }) {
  const you = w.address;
  const host = same(c.host, you);
  const mine = you ? c.entries.find((e) => same(e.op, you)) : undefined;
  switch (c.stage) {
    case "awaiting-labels":
      return host ? <RevealLabels c={c} /> : null;
    case "scoring":
      return mine && (mine.rank === null || mine.rank === undefined) && you ? <RevealEntry c={c} you={you} /> : null;
    case "ready-to-settle":
    case "refundable":
      return <Simple c={c} label={c.stage === "refundable" ? "Settle and refund the host" : "Settle and pay the winner"} make={competitionCalls.settle} />;
    case "labels-hidden":
      return mine && !mine.share ? <Simple c={c} label="Claim my share" make={competitionCalls.claimShare} /> : null;
    default:
      return null;
  }
}
