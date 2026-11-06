"use client";
// The host's settings for a live competition: banner, details, rules, and files such as RL environments. Every save is signed by the host wallet; rules and environments freeze once someone enters.
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ImageUp, Lock, Plus, Settings, Upload } from "lucide-react";
import { Button, Crumbs, EmptyState, Eyebrow, PageHeader, Pill, Skeleton } from "@/components/primitives";
import { openConnect } from "@/components/connect";
import { isDemo } from "@/lib/api/client";
import type { ListingSettings, Resource } from "@/lib/api/types";
import type { Competition } from "@/lib/learn/competition";
import { Rejected } from "@/lib/chain";
import { useCompetition } from "./model";
import { base64, hostSign, PostError, postListing, sha256Hex } from "./hostSign";

const FIELD = "w-full rounded-sm border border-rule bg-surface px-3 py-2 text-sm text-ink placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-focus disabled:opacity-60";
const BANNER_MAX = 1024 * 1024;
const RESOURCE_MAX = 10 * 1024 * 1024;
const kb = (n: number) => (n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(2)} MB`);

type Phase = { busy: boolean; error: string | null; done: string | null };
const IDLE: Phase = { busy: false, error: null, done: null };
const why = (e: unknown) => (e instanceof Rejected ? "You cancelled the signature. Nothing changed." : e instanceof PostError || e instanceof Error ? e.message : "Something went wrong. Nothing changed.");

function Section({ title, sub, locked, children }: { title: string; sub: string; locked?: boolean; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-xl border border-rule p-4 md:p-5">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2"><Eyebrow>{title}</Eyebrow>{locked && <Pill tone="neutral"><Lock className="size-3" aria-hidden /> Frozen</Pill>}</div>
        <p className="text-xs text-muted">{sub}</p>
      </div>
      {children}
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm text-ink">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

function Status({ p }: { p: Phase }) {
  if (p.error) return <p role="alert" className="text-xs text-danger">{p.error}</p>;
  if (p.done) return <p role="status" className="text-xs text-ok">{p.done}</p>;
  return null;
}

function BannerForm({ c, host }: { c: Competition; host: string }) {
  const qc = useQueryClient();
  const [file, setFile] = useState<{ bytes: Uint8Array; url: string; name: string } | null>(null);
  const [p, setP] = useState<Phase>(IDLE);
  useEffect(() => () => { if (file) URL.revokeObjectURL(file.url); }, [file]);
  async function pick(f: File | undefined) {
    setP(IDLE);
    if (!f) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(f.type)) return setP({ ...IDLE, error: "Pick a PNG, JPEG or WebP image." });
    if (f.size > BANNER_MAX) return setP({ ...IDLE, error: `That image is ${kb(f.size)}. Banners can be at most 1 MB.` });
    setFile({ bytes: new Uint8Array(await f.arrayBuffer()), url: URL.createObjectURL(f), name: f.name });
  }
  async function save() {
    if (!file) return;
    setP({ ...IDLE, busy: true });
    try {
      const signed = await hostSign(c.id, "banner", host, await sha256Hex(file.bytes));
      await postListing(c.id, "banner", { ...signed, data: base64(file.bytes) });
      setP({ ...IDLE, done: "Banner saved. It shows on the card and the competition page." });
      void qc.invalidateQueries({ queryKey: ["competitions"] });
    } catch (e) {
      setP({ ...IDLE, error: why(e) });
    }
  }
  const shown = file?.url ?? c.bannerUrl ?? null;
  return (
    <Section title="Banner" sub="Shown on the competition's card and at the top of its page. PNG, JPEG or WebP up to 1 MB; wide images (3:1) crop best. You can change it until the deadline.">
      <div className="flex aspect-3/1 w-full items-center justify-center overflow-hidden rounded-sm border border-rule bg-band">
        {shown ? <img src={shown} alt="Banner preview" className="h-full w-full object-cover" /> : <span className="text-xs text-muted">No banner yet. The card uses a generated cover.</span>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-sm border border-rule bg-surface px-3 text-sm text-ink hover:bg-hover focus-within:ring-2 focus-within:ring-focus">
          <ImageUp className="size-4" strokeWidth={1.5} aria-hidden />{file ? file.name : "Choose image"}
          <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => void pick(e.target.files?.[0])} />
        </label>
        <Button variant="primary" disabled={!file || p.busy} onClick={() => void save()}>{p.busy ? "Sign in your wallet" : "Sign and save banner"}</Button>
      </div>
      <Status p={p} />
    </Section>
  );
}

const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

function DetailsForm({ c, host }: { c: Competition; host: string }) {
  const qc = useQueryClient();
  const base: ListingSettings = c.settings ?? { title: c.title, summary: c.task, rules: "", links: [], tags: [], classNames: [], notebookRules: "optional" };
  const frozen = c.entries.length > 0;
  const [title, setTitle] = useState(base.title);
  const [summary, setSummary] = useState(base.summary);
  const [tags, setTags] = useState(base.tags.join(", "));
  const [links, setLinks] = useState(base.links.map((l) => `${l.label} | ${l.url}`).join("\n"));
  const [rules, setRules] = useState(base.rules);
  const [classes, setClasses] = useState(base.classNames.join("\n"));
  const [nb, setNb] = useState(base.notebookRules);
  const [p, setP] = useState<Phase>(IDLE);

  async function save() {
    setP({ ...IDLE, busy: true });
    const parsedLinks = lines(links).map((l) => { const [a, b] = l.includes("|") ? l.split("|").map((x) => x.trim()) : ["", l]; return { label: a || b, url: b }; });
    const bad = parsedLinks.find((l) => !/^https?:\/\/\S+$/.test(l.url));
    if (bad) return setP({ ...IDLE, error: `"${bad.url}" isn't an http(s) link. Write one link per line as label | url.` });
    const payload = JSON.stringify({
      title: title.trim(), summary: summary.trim(), rules: rules.trim(), links: parsedLinks,
      tags: tags.split(",").map((t) => t.trim()).filter(Boolean), classNames: lines(classes), notebookRules: nb,
    });
    try {
      const signed = await hostSign(c.id, "settings", host, await sha256Hex(new TextEncoder().encode(payload)));
      const r = await postListing<{ version: number }>(c.id, "settings", { ...signed, payload });
      setP({ ...IDLE, done: `Saved as version ${r.version}. Entrants can see every version.` });
      void qc.invalidateQueries({ queryKey: ["competitions"] });
    } catch (e) {
      setP({ ...IDLE, error: why(e) });
    }
  }

  return (
    <>
      <Section title="Details" sub="What people see in the list and at the top of the page. Editable until the deadline; each save is a signed version anyone can read.">
        <Field label="Title" hint={`${title.length} of 120`}><input className={FIELD} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Summary" hint="What's predicted, from what data, and why it matters."><textarea className={FIELD} rows={5} maxLength={4000} value={summary} onChange={(e) => setSummary(e.target.value)} /></Field>
        <Field label="Tags" hint="Up to 8, comma separated."><input className={FIELD} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="vision, agriculture" /></Field>
        <Field label="Links" hint="One per line as label | url: the dataset, a paper, a discussion."><textarea className={`${FIELD} font-mono`} rows={3} value={links} onChange={(e) => setLinks(e.target.value)} placeholder="Training data | https://..." /></Field>
      </Section>
      <Section title="Rules" locked={frozen} sub={frozen ? "Someone has entered, so these are frozen: entrants agreed to them. The contract's prize, deadline and windows never change." : "These freeze once the first entry lands, because entrants agree to them by entering."}>
        <Field label="Extra rules" hint="Anything the contract doesn't enforce: allowed data, external models, team rules."><textarea className={FIELD} rows={4} maxLength={4000} value={rules} disabled={frozen} onChange={(e) => setRules(e.target.value)} /></Field>
        <Field label="Class names" hint="One per line, in label order: line 1 is class 0. Pages show these instead of numbers."><textarea className={`${FIELD} font-mono`} rows={4} value={classes} disabled={frozen} onChange={(e) => setClasses(e.target.value)} /></Field>
        <Field label="Notebooks">
          <select className={FIELD} value={nb} disabled={frozen} onChange={(e) => setNb(e.target.value as ListingSettings["notebookRules"])}>
            <option value="optional">Optional: entrants may attach one</option>
            <option value="required">Expected: entries should come with one</option>
            <option value="off">Off: no notebooks</option>
          </select>
        </Field>
      </Section>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" disabled={p.busy || title.trim().length < 3} onClick={() => void save()}>{p.busy ? "Sign in your wallet" : "Sign and save details"}</Button>
        <Status p={p} />
      </div>
    </>
  );
}

function ResourcesForm({ c, host }: { c: Competition; host: string }) {
  const qc = useQueryClient();
  const frozen = c.entries.length > 0;
  const [kind, setKind] = useState<Resource["kind"]>(frozen ? "starter" : "environment");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [entrypoint, setEntrypoint] = useState("");
  const [seeds, setSeeds] = useState("0, 1, 2, 3, 4");
  const [episodes, setEpisodes] = useState(5);
  const [maxSteps, setMaxSteps] = useState(1000);
  const [file, setFile] = useState<{ bytes: Uint8Array; name: string } | null>(null);
  const [p, setP] = useState<Phase>(IDLE);

  async function pick(f: File | undefined) {
    setP(IDLE);
    if (!f) return;
    if (f.size > RESOURCE_MAX) return setP({ ...IDLE, error: `That file is ${kb(f.size)}. Files can be at most 10 MB.` });
    setFile({ bytes: new Uint8Array(await f.arrayBuffer()), name: f.name });
    if (!name) setName(f.name.replace(/\.[^.]+$/, "").replace(/[^\w.\- ]/g, "-").slice(0, 80));
  }

  async function save() {
    if (!file) return;
    const seedList = seeds.split(/[\s,]+/).filter(Boolean).map(Number);
    if (kind === "environment" && (!entrypoint.trim() || seedList.length === 0 || seedList.some((s) => !Number.isInteger(s)))) {
      return setP({ ...IDLE, error: "An environment needs an entrypoint and whole-number seeds." });
    }
    const spec = JSON.stringify({ name: name.trim(), kind, description: description.trim(), ...(kind === "environment" ? { env: { entrypoint: entrypoint.trim(), seeds: seedList, episodes, maxSteps } } : {}) });
    setP({ ...IDLE, busy: true });
    try {
      const digest = await sha256Hex(new TextEncoder().encode(`${spec}\n${await sha256Hex(file.bytes)}`));
      const signed = await hostSign(c.id, "resource", host, digest);
      await postListing(c.id, "resources", { ...signed, spec, data: base64(file.bytes) });
      setP({ ...IDLE, done: `${name} is attached. Entrants can download it from the competition page.` });
      setFile(null);
      void qc.invalidateQueries({ queryKey: ["competitions"] });
    } catch (e) {
      setP({ ...IDLE, error: why(e) });
    }
  }

  return (
    <Section title="Files and environments" sub="Downloads for entrants, up to 8 files of 10 MB each. An RL environment also says how entries are evaluated, so it freezes on the first entry like the rules.">
      {(c.resources ?? []).length > 0 && (
        <ul className="flex flex-col divide-y divide-rule rounded-sm border border-rule">
          {(c.resources ?? []).map((r) => (
            <li key={r.name} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="flex min-w-0 items-center gap-2"><span className="truncate text-ink">{r.name}</span><Pill tone={r.kind === "environment" ? "brand" : "neutral"}>{r.kind}</Pill></span>
              <span className="text-xs text-muted">{kb(r.size)}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Kind">
          <select className={FIELD} value={kind} onChange={(e) => setKind(e.target.value as Resource["kind"])}>
            <option value="environment" disabled={frozen}>RL environment{frozen ? " (frozen)" : ""}</option>
            <option value="starter">Starter kit</option>
            <option value="data">Data</option>
          </select>
        </Field>
        <Field label="Name"><input className={FIELD} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="cartpole-env" /></Field>
      </div>
      <Field label="Description"><textarea className={FIELD} rows={2} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      {kind === "environment" && (
        <div className="grid gap-4 rounded-sm bg-band p-3 sm:grid-cols-2">
          <Field label="Entrypoint" hint="A Gymnasium id or module:Class inside the package."><input className={`${FIELD} font-mono`} value={entrypoint} onChange={(e) => setEntrypoint(e.target.value)} placeholder="my_env:CropEnv" /></Field>
          <Field label="Evaluation seeds" hint="1 to 64 whole numbers. Every entry runs on the same seeds."><input className={`${FIELD} font-mono`} value={seeds} onChange={(e) => setSeeds(e.target.value)} /></Field>
          <Field label="Episodes per seed"><input type="number" min={1} max={100} className={FIELD} value={episodes} onChange={(e) => setEpisodes(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} /></Field>
          <Field label="Max steps per episode"><input type="number" min={1} max={1_000_000} className={FIELD} value={maxSteps} onChange={(e) => setMaxSteps(Math.max(1, Math.min(1_000_000, Number(e.target.value) || 1)))} /></Field>
          <p className="text-xs text-muted sm:col-span-2">Score is the mean return over every seed and episode. Verifiers run each entry&apos;s policy in the locked-down sandbox; until the RL evaluator ships, environments are published for entrants to train against.</p>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-sm border border-rule bg-surface px-3 text-sm text-ink hover:bg-hover focus-within:ring-2 focus-within:ring-focus">
          <Upload className="size-4" strokeWidth={1.5} aria-hidden /><span className="max-w-56 truncate">{file ? `${file.name}, ${kb(file.bytes.length)}` : "Choose file"}</span>
          <input type="file" className="sr-only" onChange={(e) => void pick(e.target.files?.[0])} />
        </label>
        <Button variant="primary" icon={Plus} disabled={!file || !name.trim() || p.busy} onClick={() => void save()}>{p.busy ? "Sign in your wallet" : "Sign and attach"}</Button>
      </div>
      <Status p={p} />
    </Section>
  );
}

export function HostSettings({ id }: { id: string }) {
  const { c, w, state } = useCompetition(id);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || (!c && state === "loading")) return <div className="flex flex-col gap-3 px-4 py-6 md:px-6"><Skeleton className="h-6 w-56" /><Skeleton className="h-64 w-full" /></div>;
  if (!c) return <EmptyState icon={Settings} title="No competition with that id" action={<Link href="/competitions" className="text-sm text-ink underline decoration-subtle underline-offset-4">All competitions</Link>} />;
  const back = <Link href={`/competitions/${c.id}`} className="text-sm text-ink underline decoration-subtle underline-offset-4">Back to the competition</Link>;
  const header = <PageHeader title={<Crumbs items={[{ href: "/competitions", label: "competitions" }, { href: `/competitions/${c.id}`, label: <span className="block max-w-40 truncate sm:max-w-xs">{c.title}</span> }, { label: "settings" }]} />} />;
  let body: ReactNode;
  if (isDemo || !c.live) body = <EmptyState icon={Settings} title="Settings are for live competitions" action={back}>Example competitions can&apos;t be edited. Host one on a live network to set its banner, rules and files.</EmptyState>;
  else if (!w.address) body = <EmptyState icon={Settings} title="Connect the host wallet" action={<Button variant="primary" onClick={openConnect}>Connect wallet</Button>}>Only the wallet that created this competition can change it.</EmptyState>;
  else if (w.address.toLowerCase() !== c.host.toLowerCase()) body = <EmptyState icon={Lock} title="Only the host can change this" action={back}>This competition was created by another wallet.</EmptyState>;
  else if (c.status !== "open") body = <EmptyState icon={Lock} title="The deadline has passed" action={back}>The listing is final once entries close.</EmptyState>;
  else body = (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 md:px-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-medium text-ink">Competition settings</h1>
        <p className="text-sm text-muted">Prize, deadline, reveal window and item count are fixed on chain. Everything here is signed by your wallet and kept by the coordinator.</p>
      </div>
      <BannerForm c={c} host={w.address} />
      <DetailsForm c={c} host={w.address} />
      <ResourcesForm c={c} host={w.address} />
    </div>
  );
  return <div className="flex min-h-full flex-col">{header}{body}</div>;
}

