"use client";
// The Stack page: World ID, Swarm and Arkiv doing their jobs on live data, tied together by one job's provenance.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Database, ExternalLink, Fingerprint, HardDrive, Layers, ShieldCheck } from "lucide-react";
import { useConfig } from "@/lib/api/hooks";
import { ARKIV_EXPLORER, BLOCK_SECONDS, SCHEMA_LABEL, curlFor, pieces as piecesOf, projectBlock, queryFor, trails, useArkivHead, useArkivRecords, type Entity, type JobTrail, type Piece } from "@/lib/stack/arkiv";
import { LEVEL_LABEL, SWARM_GATEWAY, checkBytes, useSwarmTree, type Check } from "@/lib/stack/swarm";
import { useTick, TileProgress, TileScanner } from "@/components/mosaic/widgets";
import { Flap } from "@/components/mosaic/Flap";
import { Banner, Button, Card, CodePanel, EmptyState, Eyebrow, HashChip, PageHeader, Null, Pill, PropRow, Segmented, Skeleton, TrustLabel, cx } from "@/components/primitives";
import { ChunkField, type Layout } from "./ChunkField";
import { Lifespans } from "./Lifespans";
import { ShardSplit, pieceName } from "./ShardSplit";
import { WorldSection } from "./WorldSection";

const mb = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
const span = (blocks: number) => {
  const s = blocks * BLOCK_SECONDS;
  if (s <= 0) return "expired";
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m ${Math.floor(s % 60)}s`;
};
const ERR: Record<string, string> = {
  arkiv_rate_limited: "Arkiv's public RPC is rate-limiting this server. It clears in a minute, or set ARKIV_API_KEY on the web server.",
  arkiv_unreachable: "The Arkiv RPC didn't answer.",
};

/** A file the chunk explorer can open: one shard piece or the final model. */
type File = { name: string; ref: string | undefined; keccak: string; size: number | null };

export function StackPage() {
  const recs = useArkivRecords();
  const headQ = useArkivHead();
  useTick(1000);
  const now = projectBlock(headQ.data, Date.now());
  const cfg = useConfig();
  const params = useSearchParams();
  const live = cfg.data?.source === "live";
  const all = useMemo(() => trails(recs.data ?? []), [recs.data]);
  // On a live coordinator, only its own JobMarket's jobs; on demo, everything the writer has published.
  const mine = useMemo(() => (live && cfg.data ? all.filter((t) => t.jobMarket === cfg.data.data.jobMarket.toLowerCase()) : all), [all, live, cfg.data]);
  const list = mine.length ? mine : all;
  const [pick, setPick] = useState<string | null>(null);
  const wanted = Number(params.get("job"));
  const trail = list.find((t) => t.id === pick) ?? (wanted ? list.find((t) => t.job === wanted) : undefined) ?? list[0] ?? null;

  return (
    <div className="flex flex-col">
      <PageHeader icon={Layers} title="Stack" heading="What Tessera doesn't own" />
      <div className="flex flex-col gap-12 px-4 pb-16 pt-3 md:px-6">
        <p className="max-w-3xl text-sm text-muted">
          Three networks do the parts a coordinator shouldn&apos;t be trusted with. World ID says each seat is one person. Swarm holds the training data and the finished models, addressed by their own hashes. Arkiv keeps the public record of what exists and for how long. The Swarm and Arkiv parts of this page read those networks directly, not Tessera&apos;s database.
        </p>
        <Overview recs={recs.data} now={now} />
        {recs.isError ? (
          <Banner tone="warn" title="Couldn't read Arkiv">{ERR[(recs.error as Error).message] ?? (recs.error as Error).message}</Banner>
        ) : recs.isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : list.length === 0 ? (
          <EmptyState icon={Database} title="Nothing published yet">Tessera writes a shard list when a job is drafted and a model record when it finishes. Neither has happened on this network yet.</EmptyState>
        ) : (
          trail && (
            <>
              <Provenance trail={trail} list={list} onPick={setPick} now={now} live={live} />
              <SwarmPart trail={trail} />
            </>
          )
        )}
        <ArkivPart entities={recs.data ?? []} now={now} loading={recs.isPending} />
        <section id="world" className="flex scroll-mt-6 flex-col gap-4">
          <Head icon={Fingerprint} kicker="People · World ID" title="One person, one seat" sub="Sybil resistance without a sign-up form: a seat in a round is tied to a person, not a wallet." />
          <WorldSection />
        </section>
      </div>
    </div>
  );
}

function Head({ icon: Icon, kicker, title, sub }: { icon: typeof Layers; kicker: string; title: string; sub: string }) {
  return (
    <div className="flex flex-col gap-1.5 border-t border-rule pt-6">
      <span className="flex items-center gap-2 font-mono text-xs uppercase tracking-wide text-subtle"><Icon className="size-3.5" strokeWidth={1.75} aria-hidden />{kicker}</span>
      <h2 className="text-xl font-medium text-ink">{title}</h2>
      <p className="max-w-2xl text-sm text-muted">{sub}</p>
    </div>
  );
}

function Overview({ recs, now }: { recs: Entity[] | undefined; now: number | null }) {
  const files = (recs ?? []).filter((e) => e.schema === "tod.shards").flatMap(piecesOf);
  const models = (recs ?? []).filter((e) => e.schema === "tod.model");
  const bytes = files.reduce((s, p) => s + p.size, 0) + models.filter((e) => e.attrs.size !== undefined).reduce((s, e) => s + Number(e.attrs.size), 0);
  const tiles = [
    { href: "#world", icon: Fingerprint, name: "World ID", role: "who", value: "1 person = 1 seat", sub: "nullifier per person, checked onchain" },
    { href: "#swarm", icon: HardDrive, name: "Swarm", role: "bytes", value: recs ? `${files.length + models.length} files` : "…", sub: recs ? `${mb(bytes)} of shards and models, content-addressed` : "reading" },
    { href: "#arkiv", icon: Database, name: "Arkiv", role: "record", value: now ? <>block <Flap text={now.toLocaleString()} /></> : "…", sub: recs ? `${recs.length} live records, each with an expiry block` : "reading" },
  ];
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {tiles.map((t) => (
        <a key={t.name} href={t.href} className="group flex flex-col gap-3 rounded-xl border border-rule bg-surface p-4 transition-colors hover:bg-hover">
          <span className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm text-ink"><t.icon className="size-4 text-muted" strokeWidth={1.5} aria-hidden />{t.name}</span>
            <Eyebrow>{t.role}</Eyebrow>
          </span>
          <span className="text-xl font-medium tabular text-ink">{t.value}</span>
          <span className="text-xs text-muted">{t.sub}</span>
        </a>
      ))}
    </div>
  );
}

/** One job's chain of custody, left to right. Each step names where it lives and how you'd check it. */
function Provenance({ trail, list, onPick, now, live }: { trail: JobTrail; list: JobTrail[]; onPick: (id: string) => void; now: number | null; live: boolean }) {
  const ps = trail.shards ? piecesOf(trail.shards) : [];
  const train = ps.filter((p) => p.part === "train");
  const shardBytes = ps.reduce((s, p) => s + p.size, 0);
  const m = trail.model;
  const steps = [
    { label: "Dataset", where: "public", value: trail.datasetHash ? `${trail.datasetHash.slice(0, 10)}…` : "unknown", href: "#swarm", on: !!trail.datasetHash },
    { label: "Split", where: "deterministic", value: ps.length ? `${new Set(train.map((p) => p.shard)).size} shards + val` : "no list", href: "#swarm", on: ps.length > 0 },
    { label: "Stored", where: "Swarm", value: ps.length ? `${ps.filter((p) => p.swarmRef).length} files · ${mb(shardBytes)}` : "not stored", href: "#swarm", on: ps.some((p) => p.swarmRef) },
    { label: "Trained", where: "onchain", value: m ? `round ${m.attrs.round} accepted` : "not finished", href: `/jobs/${trail.job}`, on: !!m },
    { label: "Model", where: "Swarm", value: m ? `${m.attrs.size === undefined ? "size not reported" : mb(Number(m.attrs.size))}${m.attrs.swarmRef ? "" : " · no copy"}` : "not yet", href: "#swarm", on: !!m?.attrs.swarmRef },
    { label: "Record", where: "Arkiv", value: m && now ? `${span(m.expiresAt - now)} left` : trail.shards && now ? `${span(trail.shards.expiresAt - now)} left` : "none", href: "#arkiv", on: !!(m || trail.shards) },
  ];
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <Eyebrow>Provenance</Eyebrow>
          <h2 className="text-lg font-medium text-ink">Job #{trail.job}, from dataset to public record</h2>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted">
          Job
          <select value={trail.id} onChange={(e) => onPick(e.target.value)} className="h-8 rounded-md border border-field bg-surface px-2 font-mono text-xs text-ink">
            {list.map((t) => (
              <option key={t.id} value={t.id}>#{t.job}{t.model ? "" : " (running)"}{live ? "" : ` · ${t.chainId === 31337 ? "local" : t.chainId} ${t.jobMarket.slice(0, 6)}`}</option>
            ))}
          </select>
        </label>
      </div>
      <ol className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-rule bg-rule sm:grid-cols-3 xl:grid-cols-6">
        {steps.map((s, i) => (
          <li key={s.label} className="bg-surface">
            <a href={s.href} className={cx("flex h-full flex-col gap-2 p-3.5 transition-colors hover:bg-hover", !s.on && "opacity-50")}>
              <span className="flex items-center justify-between font-mono text-xs uppercase tracking-wide text-subtle">
                <span>{String(i + 1).padStart(2, "0")} {s.label}</span>
                {i < steps.length - 1 && <ArrowRight className="size-3" aria-hidden />}
              </span>
              <span className="truncate text-sm tabular text-ink">{s.value}</span>
              <span className={cx("w-fit rounded-xs px-1.5 font-mono text-xs", s.where === "Swarm" ? "bg-bone/15 text-bone" : s.where === "Arkiv" ? "bg-red-5/15 text-red-5" : s.where === "onchain" ? "bg-chain-bg text-chain" : "bg-band text-muted")}>{s.where}</span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

function SwarmPart({ trail }: { trail: JobTrail }) {
  const ps = trail.shards ? piecesOf(trail.shards) : [];
  const m = trail.model;
  const files: File[] = [
    ...ps.map((p: Piece) => ({ name: pieceName(p), ref: p.swarmRef, keccak: p.keccak, size: p.size })),
    ...(m ? [{ name: "final model", ref: (m.attrs.swarmRef as string) || undefined, keccak: String(m.attrs.keccak), size: m.attrs.size === undefined ? null : Number(m.attrs.size) }] : []),
  ];
  const [sel, setSel] = useState(0);
  useEffect(() => setSel(0), [trail.id]);
  const file = files[Math.min(sel, files.length - 1)];
  return (
    <section id="swarm" className="flex scroll-mt-6 flex-col gap-6">
      <Head icon={HardDrive} kicker="Bytes · Swarm" title="Split, then stored by hash" sub="The job's data is cut into one shard per seat. Each shard is a file on Swarm, which cuts it again into 4 KB chunks and scatters them across the network by their hashes." />
      {ps.length > 0 ? (
        <ShardSplit pieces={ps} selected={sel < ps.length ? sel : -1} onSelect={setSel} />
      ) : (
        <p className="text-sm text-muted">This job has no shard list on Arkiv, so its data was served by the coordinator rather than Swarm.</p>
      )}
      {m && (
        <div className="flex items-center gap-2">
          <button onClick={() => setSel(files.length - 1)} className={cx("rounded-md border px-3 py-1.5 text-xs transition-colors", sel === files.length - 1 ? "border-ink text-ink" : "border-rule text-muted hover:text-ink")}>
            Open the final model instead
          </button>
        </div>
      )}
      {file && <ChunkExplorer key={file.ref ?? file.name} file={file} />}
    </section>
  );
}

function ChunkExplorer({ file }: { file: File }) {
  const tree = useSwarmTree(file.ref ?? null);
  const [layout, setLayout] = useState<Layout>("tree");
  const [hover, setHover] = useState<number | null>(null);
  const [check, setCheck] = useState<Check>({ kind: "idle" });
  const t = tree.data;
  const h = t && hover !== null ? t.nodes[hover] : null;
  if (!file.ref) return <Banner tone="warn" title={`${file.name} isn't on Swarm`}>The publisher gives Swarm three tries, then records the file without a reference. The coordinator still serves it.</Banner>;
  return (
    <Card className="grid grid-cols-1 gap-6 p-4 md:p-6 lg:grid-cols-2">
      <div className="flex flex-col items-center gap-3">
        <div className="flex w-full items-center justify-between gap-2">
          <Eyebrow>{file.name}</Eyebrow>
          <Segmented items={[{ key: "tree", label: "Chunk tree" }, { key: "address", label: "Address ring" }]} value={layout} onChange={setLayout} label="Layout" />
        </div>
        {tree.isPending ? (
          <div className="flex aspect-square w-full max-w-xl items-center justify-center"><TileScanner label="Walking the chunk tree" /></div>
        ) : tree.isError ? (
          <div className="flex aspect-square w-full max-w-xl flex-col items-center justify-center gap-3 text-center text-sm text-muted">
            The gateway didn&apos;t hand over the chunks.<Button onClick={() => tree.refetch()}>Try again</Button>
          </div>
        ) : (
          <ChunkField tree={t!} layout={layout} onHover={setHover} />
        )}
        <p className="h-4 font-mono text-xs text-muted">
          {h ? `${h.ref.slice(0, 12)}…  ${h.kind}${h.parity ? " · parity" : h.kind === "leaf" ? " · data" : ""} · neighbourhood ${h.ref.slice(0, 2)}` : t ? "Hover a chunk" : ""}
        </p>
      </div>
      <div className="flex min-w-0 flex-col gap-5">
        <div className="grid grid-cols-3 gap-3">
          <Stat label="data chunks" value={t?.leaves} swatch="bg-bone" />
          <Stat label="parity chunks" value={t?.parity} swatch="bg-red-5" />
          <Stat label="intermediates" value={t ? t.inner + 1 : undefined} swatch="bg-ink" />
        </div>
        <p className="text-sm text-muted">
          {layout === "tree"
            ? "Each dot is a real 4 KB chunk. The root at the centre holds the addresses of the ones below it, and that root's hash is the Swarm reference. Red dots are erasure-coding parity: the file can be rebuilt even when some chunks go missing."
            : "Same chunks, placed by their own hash. Consecutive pieces of one file land in unrelated neighbourhoods, so no single node holds the file and no one chose where it went."}
        </p>
        <div className="flex flex-col">
          <PropRow label="Swarm ref"><HashChip value={file.ref} label="Swarm reference" /></PropRow>
          <PropRow label="Size">{file.size === null ? <Null /> : mb(file.size)}</PropRow>
          <PropRow label="Erasure coding">{t ? `${LEVEL_LABEL[t.level] ?? t.level}${t.level ? ` (level ${t.level})` : ""}` : "…"}</PropRow>
          <PropRow label="Read live">{t ? `${t.fetched} chunk${t.fetched === 1 ? "" : "s"} from the gateway` : "…"}</PropRow>
          <PropRow label="Keccak on Arkiv"><HashChip value={file.keccak} label="keccak recorded on Arkiv" /></PropRow>
        </div>
        <CheckRow file={file} check={check} setCheck={setCheck} />
      </div>
    </Card>
  );
}

function Stat({ label, value, swatch }: { label: string; value: number | undefined; swatch: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-md bg-sunken p-3">
      <span className="flex items-center gap-1.5 text-xs text-muted"><span className={cx("size-2 rounded-xs", swatch)} aria-hidden />{label}</span>
      <span className="font-mono text-lg tabular text-ink">{value === undefined ? "…" : value.toLocaleString()}</span>
    </div>
  );
}

function CheckRow({ file, check, setCheck }: { file: File; check: Check; setCheck: (c: Check) => void }) {
  const run = () => checkBytes(file.ref!, file.keccak, file.size, setCheck);
  return (
    <div className="flex flex-col gap-2 rounded-md border border-rule p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm text-ink"><ShieldCheck className="size-4 text-muted" strokeWidth={1.5} aria-hidden />Check it yourself</span>
        {check.kind === "ok" ? <TrustLabel trust="hash-checked" /> : <Button onClick={run} disabled={check.kind === "fetching"}>{check.kind === "idle" ? `Download ${file.size === null ? "it" : mb(file.size)} and hash it` : check.kind === "fetching" ? "Downloading…" : "Run again"}</Button>}
      </div>
      {check.kind === "fetching" && <div className="overflow-hidden"><TileProgress value={check.total ? check.got / check.total : 0} label={`${mb(check.got)}${check.total ? ` of ${mb(check.total)}` : ""}`} /></div>}
      {check.kind === "ok" && <p className="text-xs text-ok">The bytes Swarm returned hash to the keccak on Arkiv ({(check.ms / 1000).toFixed(1)} s). Nothing here came from Tessera.</p>}
      {check.kind === "mismatch" && <p className="text-xs text-danger">Swarm returned bytes that hash to {check.hash.slice(0, 12)}…, not the recorded keccak. Don&apos;t use them.</p>}
      {check.kind === "error" && <p className="text-xs text-danger">{check.msg}. <a className="underline" href={`${SWARM_GATEWAY}/bytes/${file.ref}`} target="_blank" rel="noreferrer">Open on the gateway</a></p>}
      {check.kind === "idle" && <p className="text-xs text-muted">Your browser fetches the file from Swarm and computes its keccak locally. The public gateway is slow; a shard can take a minute or two.</p>}
    </div>
  );
}

function ArkivPart({ entities, now, loading }: { entities: Entity[]; now: number | null; loading: boolean }) {
  const [sel, setSel] = useState<string | null>(null);
  const e = entities.find((x) => x.key === sel) ?? entities[0] ?? null;
  return (
    <section id="arkiv" className="flex scroll-mt-6 flex-col gap-6">
      <Head icon={Database} kicker="Record · Arkiv" title="A public record that knows when to forget" sub="Every record Tessera writes has an expiry block. Shard lists, models and competitions stay findable while they matter, then drop out of every query on their own. Anyone can extend a model's record." />
      {loading || now === null ? (
        <Skeleton className="h-56 w-full" />
      ) : entities.length === 0 ? (
        <p className="text-sm text-muted">No live records from Tessera&apos;s writer right now.</p>
      ) : (
        <Card className="flex flex-col gap-4 p-4 md:p-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-col gap-1">
              <Eyebrow>Rabdi head · a block every {BLOCK_SECONDS} s</Eyebrow>
              <span className="font-mono text-2xl tabular text-ink"><Flap text={now.toLocaleString()} /></span>
            </div>
            <span className="max-w-sm text-right text-xs text-muted">
              <span>Bars are time left, on a log axis. They shrink toward now as the head moves; a record past its block is simply gone from the next read.</span>
            </span>
          </div>
          <Lifespans entities={entities} now={now} selected={e?.key ?? null} onSelect={setSel} />
        </Card>
      )}
      {e && now !== null && <Inspector e={e} now={now} />}
    </section>
  );
}

function Inspector({ e, now }: { e: Entity; now: number }) {
  const left = e.expiresAt - now;
  const life = e.expiresAt - e.createdAt;
  const subject = e.attrs.job !== undefined ? `job #${e.attrs.job}` : e.attrs.competition !== undefined ? `competition #${e.attrs.competition}` : "";
  const shown = Object.entries(e.attrs).filter(([k]) => k !== "arkiv.schema");
  return (
    <Card className="grid grid-cols-1 gap-6 p-4 md:p-6 lg:grid-cols-2">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Pill tone="brand">{SCHEMA_LABEL[e.schema]}</Pill>
          <span className="text-sm text-ink">{subject}</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex justify-between text-xs text-muted"><span>written at {e.createdAt.toLocaleString()}</span><span>expires at {e.expiresAt.toLocaleString()}</span></div>
          <div className="h-2 overflow-hidden rounded-xs bg-band"><div className="h-full bg-red-5 transition-all duration-1000 ease-linear" style={{ width: `${Math.max(0, Math.min(100, ((now - e.createdAt) / life) * 100))}%` }} /></div>
          <span className="font-mono text-sm tabular text-ink">{span(left)} left · {Math.max(0, left).toLocaleString()} blocks</span>
        </div>
        <div className="flex flex-col">
          <PropRow label="Entity key"><HashChip value={e.key} label="Arkiv entity key" /></PropRow>
          <PropRow label="Written by"><span className="font-mono text-xs">{e.owner.slice(0, 8)}…{e.owner.slice(-6)}</span> <span className="text-xs text-muted">(Tessera&apos;s writer)</span></PropRow>
          {shown.map(([k, v]) => (
            <PropRow key={k} label={k}>
              {typeof v === "string" && /^(0x)?[0-9a-f]{24,}$/i.test(v) ? <HashChip value={v} label={k} /> : <span className="break-all font-mono text-xs">{String(v)}</span>}
            </PropRow>
          ))}
          {e.schema === "tod.shards" && <PropRow label="payload">{piecesOf(e).length} files listed</PropRow>}
        </div>
        <a href={`${ARKIV_EXPLORER}/entity/${e.key}`} target="_blank" rel="noreferrer" className="inline-flex w-fit items-center gap-1 text-xs text-ink underline underline-offset-4">Open in the Arkiv explorer <ExternalLink className="size-3" aria-hidden /></a>
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <Eyebrow>Read it without us</Eyebrow>
        <p className="text-xs text-muted">This is the query this page runs. Paste it in a terminal and Arkiv answers directly.</p>
        <CodePanel code={curlFor(queryFor(e.schema))} />
      </div>
    </Card>
  );
}
