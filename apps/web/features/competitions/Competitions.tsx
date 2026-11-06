"use client";
// Competition list and detail. Against a coordinator, the Competitions contract's competitions with onchain scores; in demo mode, examples plus this wallet's.
import Link from "next/link";
import { Fragment, useEffect, useState } from "react";
import { ChevronDown, Lock, Plus, RotateCw, Trophy } from "lucide-react";
import { AddressChip, Banner, Button, ButtonLink, Crumbs, DocsLink, EmptyState, Eyebrow, HashChip, Money, PageHeader, Pill, ROW, Segmented, Skeleton, TD, TH, THead, cx, type Tone } from "@/components/primitives";
import { Countdown } from "./Countdown";
import { CompetitionNotebooks } from "./Notebooks";
import { Term } from "@/components/term";
import { ReVerify } from "@/features/verify/ReVerify";
import { Command } from "@/components/flow";
import { isDemo } from "@/lib/api/client";
import { PosterCard } from "@/components/mosaic/PosterCard";
import { coverFor } from "@/components/mosaic/figures";
import { formatToken } from "@/lib/money";
import { ITEMS, labelBytes, rescore, scoreOf, type Competition } from "@/lib/learn/competition";
import { chainTime, entryGate, relationOf, useCompetition, useCompetitions } from "./model";
import { sha256 } from "@/lib/learn/replay";

type Status = Competition["status"];
const LABEL: Record<Status, string> = { open: "Open", closed: "Closed", finished: "Finished", unrevealed: "Labels not revealed" };
const TONE: Record<Status, Tone> = { open: "ok", closed: "neutral", finished: "neutral", unrevealed: "danger" };
const NOT_LIVE = isDemo
  ? "Competitions aren't on chain yet. Hosting and entering run on the test wallet in this browser."
  : "These are read from the Competitions contract. Until the web wallet signs transactions, host and enter with docker/dev/competition.py.";
const REL = { host: "Hosting", entered: "Entered" } as const;

const date = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(iso));
const pct = (v: number) => `${(v * 100).toFixed(2)}%`;

function ExampleBanner() {
  return (
    <Banner tone="demo" title="Example competitions.">
      These show how competitions will work. Every score is reproducible: re-check any of them in your browser.
    </Banner>
  );
}

function Disabled({ children, icon }: { children: string; icon: typeof Plus }) {
  return <Button variant="primary" icon={icon} disabled aria-describedby="not-live">{children}</Button>;
}

/** The list or page couldn't be read: with nothing to show, the body says so; with something, a line above it does. */
function ReadFailed({ stale, retry }: { stale: boolean; retry: () => void }) {
  const again = <Button variant="secondary" icon={RotateCw} onClick={retry}>Try again</Button>;
  if (stale) return <Banner tone="warn" title="Couldn't refresh." action={again}>Showing the last competitions read from the chain.</Banner>;
  return (
    <EmptyState icon={Trophy} title="Couldn't read competitions" action={again}>
      The coordinator didn&apos;t answer, or couldn&apos;t read the Competitions contract. Nothing here is lost; try again in a moment.
    </EmptyState>
  );
}

function ListSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading competitions" className="grid gap-4 px-4 pb-6 sm:grid-cols-2 md:px-6 xl:grid-cols-3">
      {[0, 1, 2].map((k) => (
        <div key={k} className="flex flex-col overflow-hidden rounded-xl border border-rule">
          <Skeleton className="h-48 w-full" />
          <div className="flex flex-col gap-2 p-4"><Skeleton className="h-6 w-3/4" /><Skeleton className="h-4 w-1/2" /></div>
        </div>
      ))}
    </div>
  );
}

export function CompetitionList() {
  const { list, w, state, stale, retry } = useCompetitions();
  const [seg, setSeg] = useState<"all" | Status>("all");
  const counts = { all: list.length, open: 0, closed: 0, finished: 0, unrevealed: 0 };
  list.forEach((c) => counts[c.status]++);
  const shown = list.filter((c) => seg === "all" || c.status === seg);
  return (
    <div className="flex min-h-full flex-col">
      <PageHeader icon={Trophy} title="competitions" heading="Competitions" meta={<DocsLink href="/docs/learn#no-faking">Why scores can&apos;t be rigged</DocsLink>}>
        {isDemo ? <ButtonLink href="/competitions/new" variant="primary" icon={Plus}>Host a competition</ButtonLink> : <Disabled icon={Plus}>Host a competition</Disabled>}
      </PageHeader>
      <div className="flex flex-col gap-3 px-4 pt-4 md:px-6">
        {isDemo && <ExampleBanner />}
        {stale && <ReadFailed stale retry={retry} />}
        <p id="not-live" className="text-xs text-muted">{NOT_LIVE}</p>
        <Segmented label="Status" value={seg} onChange={setSeg} counts={counts} items={[{ key: "all", label: "All" }, { key: "open", label: "Open" }, { key: "closed", label: "Closed" }, { key: "finished", label: "Finished" }, { key: "unrevealed", label: "Not revealed" }]} />
      </div>
      <div className={cx("mt-3 flex-1", stale && "opacity-60")}>
        {state === "loading" && <ListSkeleton />}
        {state === "error" && <ReadFailed stale={false} retry={retry} />}
        {shown.length > 0 && (
          <div className="grid gap-4 px-4 pb-6 sm:grid-cols-2 md:px-6 xl:grid-cols-3">
            {shown.map((c, k) => {
              const rel = relationOf(c, w);
              const prize = formatToken(c.prize);
              return (
                <PosterCard
                  key={c.id}
                  href={`/competitions/${c.id}`}
                  n={String(k + 1).padStart(2, "0")}
                  title={<span title={c.title} className="line-clamp-2 break-words">{c.title}</span>}
                  cover={coverFor(c.id)}
                  live={c.status === "open"}
                  tag={rel ? <Pill tone="brand">{REL[rel as keyof typeof REL]}</Pill> : <Pill tone={TONE[c.status]}>{LABEL[c.status]}</Pill>}
                  note={`${prize === null ? "prize not reported" : `${prize} TOD prize`} · ${c.entries.length} ${c.entries.length === 1 ? "entry" : "entries"} · closes ${when(c)}`}
                />
              );
            })}
          </div>
        )}
        {state === "ready" && shown.length === 0 && (list.length === 0 && !isDemo ? (
          <EmptyState icon={Trophy} title="No competitions yet">
            Nobody has hosted a competition on this network yet. The first one shows here as soon as its transaction lands.
          </EmptyState>
        ) : (
          <EmptyState icon={Trophy} title="No competitions here" action={seg !== "all" ? <button type="button" onClick={() => setSeg("all")} className="text-sm text-ink underline decoration-subtle underline-offset-4">Show all</button> : isDemo ? <Link href="/competitions/leaf-10" className="text-sm text-ink underline decoration-subtle underline-offset-4">See a finished example</Link> : undefined}>
            Nothing matches this status.
          </EmptyState>
        ))}
      </div>
    </div>
  );
}

export const RULES = [
  ["Scoring", `Accuracy on ${ITEMS.toLocaleString()} hidden labels. Anyone can recompute it once the labels are revealed.`],
  ["Ties", "The entry whose latest commit came first wins. Replacing an entry moves it to the back of the queue for ties. Commit order is on chain."],
  ["No entries", "If nobody enters by the deadline, the prize returns to the host."],
  ["Labels not revealed", "If the host doesn't reveal labels that match the commitment within 48 hours of the deadline, the prize is split evenly between entrants."],
  ["Who can enter", "One entry per verified person. The host's own identity is blocked from entering."],
] as const;

// An unknown window says so rather than "0 seconds".
const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
const span = (s?: number) =>
  s === undefined ? "the reveal window" : s % 3600 === 0 ? plural(s / 3600, "hour") : s % 60 === 0 ? plural(s / 60, "minute") : plural(s, "second");
// A live competition can close within the hour, so its deadline shows the time too.
const when = (c: Competition) =>
  c.live ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(new Date(c.deadline)) + " UTC" : date(c.deadline);

/** A live competition's rules carry its own size and windows, as the contract enforces them. */
function rulesFor(c: Competition) {
  if (!c.live) return RULES;
  const w = span(c.revealWindow);
  return RULES.map(([k, v]): readonly [string, string] =>
    k === "Scoring" ? [k, `Accuracy on ${(c.items ?? ITEMS).toLocaleString()} hidden labels, counted by the contract when each entry is revealed.`]
      : k === "Labels not revealed" ? [k, `If the host doesn't reveal labels that match the commitment within ${w} of the deadline, the prize is split evenly between entrants.`]
        : [k, v]);
}

const CLI = "docker compose -f docker/compose.dev.yml exec coordinator python docker/dev/competition.py";

/** Live only: who moves the competition next, and the command that does it until the web wallet signs. */
function NextStep({ c }: { c: Competition }) {
  const id = c.id;
  const steps: Record<string, { who: string; text: string; cmd?: string }> = {
    open: { who: "Entrants", text: `Entries close ${when(c)}. Commit your predictions; you can replace them until then.`, cmd: `${CLI} enter ${id} --name <you> --predictions <file>` },
    "awaiting-labels": { who: "The host", text: `Entries are closed. The host has ${span(c.revealWindow)} to reveal labels that match the commitment.`, cmd: `${CLI} reveal ${id}` },
    scoring: { who: "Entrants, or anyone with their files", text: "The labels are out. Each entry revealed now is scored by the contract.", cmd: `${CLI} reveal ${id}` },
    "ready-to-settle": { who: "Anyone", text: "Scoring is over. Settling pays the best score; usually the winner calls it.", cmd: `${CLI} settle ${id}` },
    "labels-hidden": { who: "Each entrant", text: "The host missed the window, so every entrant takes an equal part of the prize.", cmd: `${CLI} claim-share ${id} --name <you>` },
    refundable: { who: "Anyone", text: "Nobody entered. Settling returns the prize to the host.", cmd: `${CLI} settle ${id}` },
  };
  if (c.settled) {
    return (
      <section aria-label="Outcome" className="flex flex-col gap-2">
        <Eyebrow>Outcome</Eyebrow>
        <p className="text-sm text-muted">{c.settled.refunded ? "Refunded " : "Paid "}<Money units={c.settled.amount} /> to <AddressChip value={c.settled.to} />{c.settled.refunded ? ", the host: nothing was scored." : ", the best score."}</p>
      </section>
    );
  }
  const s = steps[c.stage ?? ""];
  if (!s) return null;
  return (
    <section aria-label="What happens next" className="flex flex-col gap-2">
      <Eyebrow>What happens next</Eyebrow>
      <p className="text-sm text-muted"><span className="text-ink">{s.who}:</span> {s.text}</p>
      {s.cmd && <Command cmd={s.cmd} label="Until the web wallet signs, from the host's machine" />}
    </section>
  );
}

function Rules({ c }: { c: Competition }) {
  const rows = rulesFor(c);
  return (
    <section aria-label="Rules" className="flex flex-col gap-3">
      <div className="flex items-center gap-2"><Eyebrow>Rules</Eyebrow>{c.live ? <Pill tone="ok">Enforced onchain</Pill> : <Pill tone="pending">Proposed</Pill>}</div>
      <dl className="flex flex-col">
        {rows.map(([k, v]) => (
          <div key={k} className="grid gap-1 border-t border-rule py-2.5 sm:grid-cols-4 sm:gap-4">
            <dt className="text-sm text-ink">{k}</dt>
            <dd className="text-sm text-muted sm:col-span-3">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Commitment({ c }: { c: Competition }) {
  const seed = c.labelsSeed;
  return (
    <section aria-label="Labels commitment" className="flex flex-col gap-3 rounded-xl border border-rule p-4">
      <div className="flex items-center gap-2"><Lock className="size-3.5 text-muted" strokeWidth={1.5} aria-hidden /><Eyebrow>Labels commitment</Eyebrow></div>
      <HashChip value={c.labelsHash} label="labels commitment" />
      <p className="text-xs text-muted">Committed at block {c.committedAt.toLocaleString()}, before entries opened. It can&apos;t change. This is <Term k="commit-reveal">commit, then reveal</Term> applied to the answer key.</p>
      {c.status === "finished" && seed !== null && (
        <ReVerify
          expected={c.labelsHash}
          what="the revealed labels"
          run={async (on) => {
            on({ phase: "download", bytes: ITEMS, total: ITEMS });
            return sha256(labelBytes(seed));
          }}
        />
      )}
    </section>
  );
}

const PAGE = 50;
const entrantHref = (c: Competition, op: string) => `/competitions/${c.id}/entries/${op}`;

/** Live standings: every entrant, scored ones ranked as the contract ranks them, the rest saying why they have no score. */
function Standings({ c, you }: { c: Competition; you: string | null }) {
  const [shown, setShown] = useState(PAGE);
  const scoring = c.stage === "scoring";
  const rows = [...c.entries].sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity));
  if (rows.length === 0) {
    return (
      <section aria-label="Leaderboard" className="flex flex-col gap-3">
        <Eyebrow>Leaderboard</Eyebrow>
        <p className="rounded-xl border border-rule px-4 py-6 text-center text-sm text-muted">Nobody entered this competition{c.settled?.refunded ? ", so the prize went back to the host" : ""}.</p>
      </section>
    );
  }
  const unscored = rows.filter((e) => e.rank === null || e.rank === undefined).length;
  return (
    <section aria-label="Leaderboard" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Eyebrow>Leaderboard</Eyebrow>
        {unscored > 0 && <span className="text-xs text-muted">{unscored} of {rows.length} {scoring ? "not revealed yet" : "never revealed, so not scored"}</span>}
      </div>
      <div className="overflow-x-auto rounded-xl border border-rule">
        <table className="w-full text-sm">
          <THead>
            <TH>Rank</TH>
            <TH>Entrant</TH>
            <TH className="text-right">Accuracy</TH>
            <TH className="text-right"><span className="sr-only">Entry</span></TH>
          </THead>
          <tbody>
            {rows.slice(0, shown).map((e) => {
              const mine = !!you && e.op.toLowerCase() === you.toLowerCase();
              const ranked = e.rank !== null && e.rank !== undefined;
              return (
                <tr key={e.op} className={cx(ROW, mine && "bg-brand-soft")}>
                  <TD className="tabular text-muted">{ranked ? <span className="inline-flex items-center gap-2">{e.rank}{e.tied && <Pill tone="neutral">Tie</Pill>}</span> : "-"}</TD>
                  <TD><AddressChip value={e.op} href={entrantHref(c, e.op)} you={mine} /></TD>
                  <TD className="text-right font-mono tabular text-ink">{e.score !== undefined ? pct(e.score) : <span className="font-sans text-xs text-muted">{scoring ? "Not revealed yet" : "Not revealed"}</span>}</TD>
                  <TD className="text-right"><Link href={entrantHref(c, e.op)} className="whitespace-nowrap text-xs text-muted underline decoration-subtle underline-offset-4 hover:text-ink">View entry</Link></TD>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > shown && (
        <Button variant="secondary" onClick={() => setShown((n) => n + PAGE)}>Show {Math.min(PAGE, rows.length - shown)} more of {rows.length - shown}</Button>
      )}
      {rows.some((e) => e.tied) && <p className="text-xs text-muted">Tied entries rank by when their latest commit landed, as the contract breaks ties.</p>}
    </section>
  );
}

function Leaderboard({ c, you }: { c: Competition; you: string | null }) {
  const [open, setOpen] = useState<string | null>(null);
  if (c.live) return <Standings c={c} you={you} />;
  // A live entry nobody revealed has no score; it isn't ranked.
  const ranked = c.entries.filter((e) => !c.live || e.score !== undefined).map((e) => ({ e, s: scoreOf(c, e) })).sort((a, b) => b.s - a.s);
  return (
    <section aria-label="Leaderboard" className="flex flex-col gap-3">
      <Eyebrow>Leaderboard</Eyebrow>
      <div className="overflow-hidden rounded-xl border border-rule">
        <table className="w-full text-sm">
          <THead>
            <TH>Rank</TH>
            <TH>Entrant</TH>
            <TH className="text-right">Accuracy</TH>
            <TH className="text-right">Check</TH>
          </THead>
          <tbody>
            {ranked.map(({ e, s }, i) => {
              const isOpen = open === e.op;
              return (
                <Fragment key={e.op}>
                  <tr className={ROW}>
                    <TD className="tabular text-muted">{i + 1}</TD>
                    <TD><AddressChip value={e.op} href={entrantHref(c, e.op)} /></TD>
                    <TD className="text-right font-mono tabular text-ink">{pct(s)}</TD>
                    <TD className="text-right">
                      {c.live ? <span className="text-xs text-muted">Scored onchain</span> : <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : e.op)} className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink">
                        Re-check this score <ChevronDown className={cx("size-3.5 transition-transform duration-150 ease-out", isOpen && "rotate-180")} aria-hidden />
                      </button>}
                    </TD>
                  </tr>
                  {isOpen && (
                    <tr className="border-t border-rule-row bg-band">
                      <td colSpan={4} className="px-4 py-3 md:px-6">
                        <div className="flex animate-step-in flex-col gap-2">
                          <p className="text-xs text-muted">Your browser rebuilds the revealed labels, checks them against the commitment, scores this entry&apos;s predictions and hashes the result. It should equal the score record on chain.</p>
                          <ReVerify
                            expected={e.scoreHash}
                            what="this score"
                            run={async (on) => (await rescore(c, e, (step, of) => on({ phase: "run", step, of }))).hash}
                          />
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DetailSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading competition" className="flex flex-col gap-8 px-4 py-6 md:px-6 lg:flex-row">
      <div className="flex flex-1 flex-col gap-3"><Skeleton className="h-6 w-40" /><Skeleton className="h-8 w-2/3" /><Skeleton className="h-4 w-full max-w-lede" /><Skeleton className="mt-6 h-48 w-full" /></div>
      <Skeleton className="h-64 w-full lg:w-80" />
    </div>
  );
}

export function CompetitionDetail({ id }: { id: string }) {
  const { c, w, state, stale, retry } = useCompetition(id);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!c) {
    if (!mounted || state === "loading") return <DetailSkeleton />;
    if (state === "error") return <ReadFailed stale={false} retry={retry} />;
    return (
      <EmptyState icon={Trophy} title="No competition with that id" action={<Link href="/competitions" className="text-sm text-ink underline decoration-subtle underline-offset-4">All competitions</Link>}>
        {isDemo ? "Competitions you host live in this browser in demo mode. Another browser won't have them." : `The Competitions contract has no competition ${id}.`}
      </EmptyState>
    );
  }
  const rel = mounted ? relationOf(c, w) : null;
  const gate = entryGate(c, w);
  const mine = w.entries.find((e) => e.competition === c.id);
  const isOpen = c.status === "open";
  const you = mounted ? w.address : null;
  return (
    <div className="flex min-h-full flex-col">
      <PageHeader title={<Crumbs items={[{ href: "/competitions", label: "competitions" }, { label: <span title={c.title} className="block max-w-56 truncate sm:max-w-md">{c.title}</span> }]} />}>
        {isOpen && rel === null && (isDemo && gate.ok ? <ButtonLink href={`/competitions/${c.id}/enter`} variant="primary" icon={Trophy}>Enter</ButtonLink> : <Disabled icon={Trophy}>Enter</Disabled>)}
      </PageHeader>
      <div className="flex flex-col gap-8 px-4 py-6 md:px-6 lg:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-8">
          {rel !== "host" && !c.live && <ExampleBanner />}
          {stale && <ReadFailed stale retry={retry} />}
          <header className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone={TONE[c.status]}>{LABEL[c.status]}</Pill>
              {rel && <Pill tone="brand">{REL[rel]}</Pill>}
              <span className="text-xs text-muted">Deadline {when(c)}</span>
              {isOpen && <Countdown to={Date.parse(c.deadline)} clock={() => chainTime(c)} />}
            </div>
            <h1 className="break-words text-xl font-medium text-ink">{c.title}</h1>
            <p className="max-w-lede whitespace-pre-line break-words text-sm text-muted">{c.task}</p>
            {isOpen && rel === null && <p id="not-live" className="text-xs text-muted">{gate.ok ? NOT_LIVE : gate.text}</p>}
          </header>
          {rel === "host" && isOpen && (
            <Banner tone="pending" title="You host this competition.">
              Keep the labels file you committed. After the deadline you have {c.live ? span(c.revealWindow) : "48 hours"} to reveal it; if it doesn&apos;t hash to the commitment, the prize is split between entrants.
            </Banner>
          )}
          {mine && (
            <section aria-label="Your entry" className="flex flex-col gap-3 rounded-xl border border-brand-line bg-brand-soft p-4">
              <Eyebrow>Your entry</Eyebrow>
              <p className="text-sm text-ink">{mine.fileName}, committed {date(new Date(mine.at).toISOString())}</p>
              <HashChip value={mine.predictionsHash} label="predictions commitment" />
              <p className="text-xs text-muted">Keep the file. After the deadline you upload it for scoring, and it must hash to this commitment.</p>
            </section>
          )}
          {c.status === "finished" && <Leaderboard c={c} you={you} />}
          {(isOpen || c.status === "closed" || c.status === "unrevealed") && (
            <section aria-label="Entries" className="flex flex-col gap-3">
              <Eyebrow>{c.entries.length === 0 ? (isOpen ? "No entries yet" : "Nobody entered") : `${c.entries.length} ${c.entries.length === 1 ? "entry" : "entries"}${isOpen ? " so far" : ""}`}</Eyebrow>
              <p className="text-sm text-muted">{isOpen
                ? "Scores appear after the deadline, when the host reveals the labels. A reveal that doesn't hash to the commitment is rejected, so the host can't pick a winner by editing the answers."
                : c.entries.length === 0 ? "Entries are closed and nobody committed one." : "Entries are closed. Scores appear once the host reveals the labels and each entry is revealed."}</p>
              {c.entries.length > 0 && <ul className="flex flex-wrap gap-2">{c.entries.map((e) => <li key={e.op}><AddressChip value={e.op} href={entrantHref(c, e.op)} you={!!you && e.op.toLowerCase() === you.toLowerCase()} /></li>)}</ul>}
            </section>
          )}
          <CompetitionNotebooks c={c} you={you} entered={rel === "entered"} />
          {c.status === "unrevealed" && (
            <Banner tone="danger" title="The host didn't reveal the labels.">
              The {c.live ? span(c.revealWindow) : "48-hour"} reveal window closed without labels matching the commitment, so no score can be trusted. Under the rules the prize is split between the {c.entries.length} entrants.
            </Banner>
          )}
          {c.live && <NextStep c={c} />}
          <Rules c={c} />
        </div>
        <aside className="flex shrink-0 flex-col gap-4 lg:w-80">
          <Commitment c={c} />
          <dl className="flex flex-col gap-2.5 rounded-xl border border-rule p-4 text-sm">
            <div className="flex justify-between gap-3"><dt className="text-muted">Prize</dt><dd><Money units={c.prize} /></dd></div>
            {c.live ? (
              <>
                <div className="flex justify-between gap-3"><dt className="text-muted">Items</dt><dd className="tabular text-ink">{(c.items ?? ITEMS).toLocaleString()}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-muted">Reveal window</dt><dd className="text-ink">{span(c.revealWindow)}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-muted">Entry fee</dt><dd className="text-ink">Free</dd></div>
              </>
            ) : (
              <>
                <div className="flex justify-between gap-3"><dt className="text-muted">Compute budget</dt><dd><Money units={c.budget} /></dd></div>
                <div className="flex justify-between gap-3"><dt className="text-muted">Entry fee</dt><dd>{c.fee === 0 ? <span className="text-ink">Free</span> : <Money units={c.fee} />}</dd></div>
              </>
            )}
            <div className="flex justify-between gap-3"><dt className="text-muted">Entries</dt><dd className="tabular text-ink">{c.entries.length}</dd></div>
            <div className="flex items-center justify-between gap-3"><dt className="text-muted">Host</dt><dd><AddressChip value={c.host} href={`/u/${c.host}`} you={rel === "host"} /></dd></div>
            {c.live && c.arkiv?.listing && <div className="flex items-center justify-between gap-3"><dt className="text-muted">Listed on Arkiv</dt><dd><HashChip value={c.arkiv.listing} label="Arkiv listing" /></dd></div>}
            {c.live && c.arkiv?.result && <div className="flex items-center justify-between gap-3"><dt className="text-muted">Result on Arkiv</dt><dd><HashChip value={c.arkiv.result} label="Arkiv result" /></dd></div>}
          </dl>
        </aside>
      </div>
    </div>
  );
}
