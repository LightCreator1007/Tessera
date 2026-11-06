"use client";
// Entrants' notebooks: sealed until the deadline, then listed and read here. An entrant attaches theirs with a wallet signature.
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { verifyMessage, type Hex } from "viem";
import { BadgeCheck, Download, FileText, Lock, RotateCw, Upload } from "lucide-react";
import { AddressChip, Button, Eyebrow, HashChip, Pill, Skeleton, cx } from "@/components/primitives";
import { api, ApiError, isDemo } from "@/lib/api/client";
import { useNotebook, useNotebooks } from "@/lib/api/hooks";
import type { Notebook } from "@/lib/api/types";
import { Rejected, signText } from "@/lib/chain";
import type { Competition } from "@/lib/learn/competition";

export const MAX_NOTEBOOK = 2 * 1024 * 1024;
const KINDS = [".ipynb", ".md", ".py"];
const KIND_LABEL = { ipynb: "Notebook", markdown: "Markdown", python: "Python" } as const;
const kb = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(2)} MB`);
const at = (unix: number) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(new Date(unix * 1000)) + " UTC";

/** The exact text the coordinator checks the signature against; any change here must match api/notebooks.py. */
export const notebookMessage = (cid: string, wallet: string, name: string, sha256: string, signedAt: number) =>
  `Attach a notebook to competition ${cid}\nWallet: ${wallet.toLowerCase()}\nFile: ${name}\nsha256: ${sha256}\nSigned at: ${signedAt}`;

async function sha256Hex(bytes: Uint8Array) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Checks a picked file before anything is signed, so a bad file never costs a wallet prompt. */
export async function readNotebook(file: File): Promise<{ name: string; content: string } | string> {
  const name = file.name.trim().slice(0, 120);
  if (!KINDS.some((k) => name.toLowerCase().endsWith(k))) return "Pick an .ipynb, .md or .py file.";
  if (file.size === 0) return "That file is empty.";
  if (file.size > MAX_NOTEBOOK) return `That file is ${kb(file.size)}. Notebooks can be at most 2 MB; clear large outputs and try again.`;
  const content = await file.text();
  if (name.toLowerCase().endsWith(".ipynb")) {
    try {
      const nb: unknown = JSON.parse(content);
      if (!nb || typeof nb !== "object" || !Array.isArray((nb as { cells?: unknown }).cells)) return "That .ipynb has no cells. Is it a Jupyter notebook?";
    } catch {
      return "That .ipynb isn't valid JSON.";
    }
  }
  return { name, content };
}

const WHY: Record<number, string> = {
  401: "The signature didn't check out. Sign again with the wallet that entered.",
  403: "Only an entrant can attach a notebook. Enter first, then attach it.",
  409: "The deadline has passed, so notebooks can't change.",
  413: "That file is over 2 MB.",
  415: "Pick an .ipynb, .md or .py file.",
  422: "That .ipynb has no cells.",
};

function AttachNotebook({ c, you, has }: { c: Competition; you: string; has: boolean }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [phase, setPhase] = useState<"idle" | "signing" | "sending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<{ name: string; content: string } | null>(null);
  const busy = phase === "signing" || phase === "sending";

  async function pick(f: File | undefined) {
    setError(null);
    setPhase("idle");
    if (!f) return setFile(null);
    const r = await readNotebook(f);
    if (typeof r === "string") {
      setFile(null);
      return setError(r);
    }
    setFile(r);
  }

  async function attach() {
    if (!file) return;
    setError(null);
    try {
      setPhase("signing");
      const digest = await sha256Hex(new TextEncoder().encode(file.content));
      const signedAt = Math.floor(Date.now() / 1000);
      const { address, signature } = await signText(notebookMessage(c.id, you, file.name, digest, signedAt));
      if (address.toLowerCase() !== you.toLowerCase()) throw new Error("The wallet that signed isn't the one that entered. Switch back and try again.");
      setPhase("sending");
      await api.attachNotebook(c.id, { entrant: address, name: file.name, title: title.trim(), content: file.content, signedAt, signature });
      setPhase("done");
      void qc.invalidateQueries({ queryKey: ["competitions", c.id] });
    } catch (e) {
      setPhase("idle");
      if (e instanceof Rejected) return setError("You cancelled the signature. Nothing was sent.");
      if (e instanceof ApiError) return setError(WHY[e.status] ?? (e.kind === "unreachable" ? "The coordinator didn't answer. Try again." : "The coordinator refused the notebook."));
      setError(e instanceof Error ? e.message : "Something went wrong. Nothing was sent.");
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-brand-line bg-brand-soft p-4">
      <div className="flex flex-col gap-1">
        <p className="text-sm text-ink">{has ? "Replace your notebook" : "Attach a notebook to your entry"}</p>
        <p className="text-xs text-muted">An .ipynb, .md or .py file up to 2 MB explaining how you got your predictions. It stays sealed until the deadline, then anyone can read it. Your wallet signs its hash, so nobody can swap it.</p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-sm border border-rule bg-surface px-3 text-sm text-ink hover:bg-band focus-within:ring-2 focus-within:ring-focus">
          <Upload className="size-4" strokeWidth={1.5} aria-hidden />
          <span className="max-w-56 truncate">{file ? file.name : "Choose file"}</span>
          <input type="file" accept={KINDS.join(",")} className="sr-only" disabled={busy} onChange={(e) => void pick(e.target.files?.[0])} />
        </label>
        <input
          type="text" value={title} maxLength={120} disabled={busy} onChange={(e) => setTitle(e.target.value)}
          placeholder="Title (optional)" aria-label="Notebook title"
          className="h-9 min-w-0 flex-1 rounded-sm border border-rule bg-surface px-3 text-sm text-ink placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-focus"
        />
        <Button variant="primary" disabled={!file || busy} onClick={() => void attach()}>
          {phase === "signing" ? "Sign in your wallet" : phase === "sending" ? "Sending" : has ? "Sign and replace" : "Sign and attach"}
        </Button>
      </div>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      {phase === "done" && <p role="status" className="text-xs text-ok">Attached. It opens to everyone at the deadline.</p>}
    </div>
  );
}

/** The competition page's notebooks: a sealed count while open, the list after. */
export function CompetitionNotebooks({ c, you, entered }: { c: Competition; you: string | null; entered: boolean }) {
  const q = useNotebooks(c.id);
  const ix = q.data?.data;
  const canAttach = !isDemo && c.live && c.status === "open" && entered && !!you;
  return (
    <section aria-label="Notebooks" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Eyebrow>Notebooks</Eyebrow>
        {ix?.sealed && <Pill tone="neutral"><Lock className="size-3" aria-hidden /> Sealed</Pill>}
      </div>
      {q.isPending && <Skeleton className="h-12 w-full" />}
      {q.isError && !ix && (
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
          {q.error instanceof ApiError && q.error.kind === "off" ? "Notebooks aren't available on this network." : "Couldn't load notebooks."}
          {!(q.error instanceof ApiError && q.error.kind === "off") && <Button variant="ghost" icon={RotateCw} onClick={() => void q.refetch()}>Try again</Button>}
        </p>
      )}
      {ix?.sealed && (
        <p className="text-sm text-muted">
          {ix.count === 0 ? "No notebooks yet." : `${ix.count} ${ix.count === 1 ? "notebook" : "notebooks"} attached.`} Notebooks open to everyone at the deadline, {at(ix.opensAt)}, so nobody can read the leader&apos;s approach while entries are open.
        </p>
      )}
      {ix && !ix.sealed && ix.notebooks.length === 0 && <p className="text-sm text-muted">No entrant attached a notebook.</p>}
      {ix && !ix.sealed && ix.notebooks.length > 0 && (
        <ul className="flex flex-col divide-y divide-rule rounded-xl border border-rule">
          {ix.notebooks.map((n) => (
            <li key={n.entrant}>
              <Link href={`/competitions/${c.id}/entries/${n.entrant}#notebook`} className="flex flex-col gap-1 px-4 py-3 hover:bg-band sm:flex-row sm:items-center sm:justify-between">
                <span className="flex min-w-0 items-center gap-2">
                  <FileText className="size-4 shrink-0 text-muted" strokeWidth={1.5} aria-hidden />
                  <span className="truncate text-sm text-ink">{n.title}</span>
                </span>
                <span className="flex items-center gap-3 text-xs text-muted">
                  <AddressChip value={n.entrant} />
                  <span>{KIND_LABEL[n.kind]} · {kb(n.size)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {canAttach && <AttachNotebook c={c} you={you} has={false} />}
      {isDemo && c.status === "open" && <p className="text-xs text-muted">On a live network, entrants attach a notebook here once they&apos;ve entered.</p>}
    </section>
  );
}

/** One entrant's notebook on their entry page, with what it says about who wrote it. */
export function EntrantNotebook({ c, who, you }: { c: Competition; who: string; you: string | null }) {
  const ix = useNotebooks(c.id).data?.data;
  const sealed = ix?.sealed ?? c.status === "open";
  const q = useNotebook(c.id, who, !sealed);
  const mine = !!you && you.toLowerCase() === who.toLowerCase();
  const none = q.error instanceof ApiError && q.error.status === 404;
  return (
    <section id="notebook" aria-label="Notebook" className="flex scroll-mt-20 flex-col gap-3">
      <Eyebrow>Notebook</Eyebrow>
      {sealed && <p className="text-sm text-muted"><Lock className="mr-1 inline size-3.5 align-text-bottom" aria-hidden />Notebooks are sealed until the deadline{ix ? `, ${at(ix.opensAt)}` : ""}.</p>}
      {sealed && mine && !isDemo && c.live && c.status === "open" && <AttachNotebook c={c} you={you!} has={false} />}
      {!sealed && q.isPending && <Skeleton className="h-40 w-full" />}
      {!sealed && none && <p className="text-sm text-muted">{mine ? "You didn't attach a notebook." : "This entrant didn't attach a notebook."}</p>}
      {!sealed && q.isError && !none && (
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted">Couldn&apos;t load the notebook.<Button variant="ghost" icon={RotateCw} onClick={() => void q.refetch()}>Try again</Button></p>
      )}
      {q.data && <NotebookView nb={q.data.data} />}
    </section>
  );
}

function SignatureCheck({ nb }: { nb: Notebook }) {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    if (!nb.signature) return;
    let live = true;
    verifyMessage({ address: nb.entrant as Hex, message: nb.message, signature: nb.signature as Hex })
      .then((v) => live && setOk(v), () => live && setOk(false));
    return () => { live = false; };
  }, [nb]);
  if (!nb.signature) return <Pill tone="neutral">Example, not signed</Pill>;
  if (ok === null) return <span className="text-xs text-muted">Checking signature</span>;
  return ok
    ? <span className="inline-flex items-center gap-1 text-xs text-ok"><BadgeCheck className="size-3.5" aria-hidden />Signed by this entrant</span>
    : <span className="text-xs text-danger">Signature doesn&apos;t match this entrant</span>;
}

function download(nb: Notebook) {
  const url = URL.createObjectURL(new Blob([nb.content], { type: "text/plain" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: nb.name });
  a.click();
  URL.revokeObjectURL(url);
}

export function NotebookView({ nb }: { nb: Notebook }) {
  return (
    <article className="overflow-hidden rounded-xl border border-rule">
      <header className="flex flex-col gap-2 border-b border-rule bg-band px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="min-w-0 break-words text-sm font-medium text-ink">{nb.title}</h2>
          <Button variant="ghost" icon={Download} onClick={() => download(nb)}>Download</Button>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
          <span className="font-mono">{nb.name}</span>
          <span>{kb(nb.size)}</span>
          {nb.revisions > 1 && <span>Replaced {nb.revisions - 1} {nb.revisions === 2 ? "time" : "times"}</span>}
          <span>Last signed {at(nb.signedAt)}</span>
          <SignatureCheck nb={nb} />
        </div>
        {nb.sha256 && <HashChip value={nb.sha256} label="sha256" />}
      </header>
      <div className="flex flex-col gap-4 px-4 py-4">
        {nb.kind === "ipynb" ? <Ipynb text={nb.content} /> : nb.kind === "markdown" ? <Markdown text={nb.content} /> : <Code text={nb.content} />}
      </div>
    </article>
  );
}

// Outputs are user content: only text and PNG images are shown, never HTML or scripts.
type Cell = { cell_type?: string; source?: string | string[]; outputs?: Output[] };
type Output = { output_type?: string; text?: string | string[]; data?: Record<string, string | string[]>; ename?: string; evalue?: string };
const join = (v: string | string[] | undefined) => (Array.isArray(v) ? v.join("") : v ?? "");
const MAX_OUT = 5000;
const clip = (t: string) => (t.length > MAX_OUT ? `${t.slice(0, MAX_OUT)}\n... ${(t.length - MAX_OUT).toLocaleString()} more characters` : t);

function Ipynb({ text }: { text: string }) {
  let cells: Cell[] = [];
  try {
    cells = (JSON.parse(text) as { cells?: Cell[] }).cells ?? [];
  } catch {
    return <Code text={text} />;
  }
  if (cells.length === 0) return <p className="text-sm text-muted">This notebook has no cells.</p>;
  return (
    <>
      {cells.map((cell, i) =>
        cell.cell_type === "code" ? (
          <div key={i} className="flex flex-col gap-1">
            <Code text={join(cell.source)} />
            {(cell.outputs ?? []).map((o, k) => <CellOutput key={k} o={o} />)}
          </div>
        ) : cell.cell_type === "markdown" ? <Markdown key={i} text={join(cell.source)} /> : <Code key={i} text={join(cell.source)} />,
      )}
    </>
  );
}

function CellOutput({ o }: { o: Output }) {
  const png = o.data?.["image/png"];
  if (png) return <img src={`data:image/png;base64,${join(png).replace(/\s/g, "")}`} alt="Cell output" className="max-w-full rounded-sm border border-rule" />;
  const t = o.output_type === "error" ? `${o.ename ?? "Error"}: ${o.evalue ?? ""}` : o.text !== undefined ? join(o.text) : join(o.data?.["text/plain"]);
  if (!t) return null;
  return <pre className={cx("overflow-x-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-xs", o.output_type === "error" ? "text-danger" : "text-muted")}>{clip(t)}</pre>;
}

function Code({ text }: { text: string }) {
  return <pre className="overflow-x-auto rounded-sm bg-band px-3 py-2 font-mono text-xs leading-relaxed text-ink">{clip(text)}</pre>;
}

/** Inline markdown: code spans, bold and http(s) links. Everything else stays text. */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(<code key={m.index} className="rounded-xs bg-band px-1 font-mono text-xs">{m[1]}</code>);
    else if (m[2]) out.push(<strong key={m.index} className="font-medium text-ink">{m[2]}</strong>);
    else out.push(<a key={m.index} href={m[4]} target="_blank" rel="noopener noreferrer nofollow ugc" className="text-ink underline decoration-subtle underline-offset-4">{m[3]}</a>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** A small, safe subset of markdown: headings, lists, fenced code and paragraphs. Nothing is rendered as HTML. */
export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("```")) {
      const body: string[] = [];
      for (i++; i < lines.length && !lines[i].startsWith("```"); i++) body.push(lines[i]);
      i++;
      blocks.push(<Code key={blocks.length} text={body.join("\n")} />);
    } else if (/^#{1,6}\s/.test(line)) {
      const level = line.match(/^#+/)![0].length;
      const cls = level === 1 ? "text-lg font-medium" : level === 2 ? "text-base font-medium" : "text-sm font-medium";
      blocks.push(<p key={blocks.length} role="heading" aria-level={Math.min(level + 2, 6)} className={cx("text-ink", cls)}>{inline(line.replace(/^#+\s/, ""))}</p>);
      i++;
    } else if (/^\s*([-*]|\d+\.)\s/.test(line)) {
      const items: string[] = [];
      const ordered = /^\s*\d+\./.test(line);
      for (; i < lines.length && /^\s*([-*]|\d+\.)\s/.test(lines[i]); i++) items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s/, ""));
      const List = ordered ? "ol" : "ul";
      blocks.push(<List key={blocks.length} className={cx("flex flex-col gap-1 pl-5 text-sm text-muted", ordered ? "list-decimal" : "list-disc")}>{items.map((t, k) => <li key={k}>{inline(t)}</li>)}</List>);
    } else if (line.trim() === "") {
      i++;
    } else {
      const para: string[] = [];
      for (; i < lines.length && lines[i].trim() !== "" && !/^(#{1,6}\s|```|\s*([-*]|\d+\.)\s)/.test(lines[i]); i++) para.push(lines[i]);
      blocks.push(<p key={blocks.length} className="break-words text-sm leading-relaxed text-muted">{inline(para.join(" "))}</p>);
    }
  }
  return <div className="flex flex-col gap-3">{blocks}</div>;
}
