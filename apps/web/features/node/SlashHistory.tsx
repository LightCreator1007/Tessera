"use client";
// Slash history on the owner's node panel: one row per round where stake was taken or a failure was confirmed, opening a drawer with the reason in plain words, where the stake went and how to avoid it next time.
import Link from "next/link";
import { useMemo, useState } from "react";
import { ExternalLink, ShieldCheck } from "lucide-react";
import { useOwnerHistory } from "@/lib/api/hooks";
import { isDemo } from "@/lib/api/client";
import { formatToken } from "@/lib/money";
import { Drawer } from "@/components/drawer";
import { Command } from "@/components/flow";
import { Card, Eyebrow, Money, Null, SectionTitle, Skeleton } from "@/components/primitives";
import { REASON_COPY, demoSlashEvents, slashesFor, type Slash } from "./slashes";

const SHOWN = 5;

export function SlashHistory({ owner, operator, stake, minStake }: { owner: string | null; operator: string; stake: number; minStake: number }) {
  const hist = useOwnerHistory(owner, !isDemo);
  const [now] = useState(() => Date.now() / 1000);
  const [open, setOpen] = useState<Slash | null>(null);
  const [all, setAll] = useState(false);
  const live = hist.data?.data.events ?? null;
  const slashes = useMemo(() => {
    const events = isDemo ? demoSlashEvents(operator, now) : live;
    return events === null ? null : slashesFor(events, operator);
  }, [live, operator, now]);
  const benched = stake < minStake;

  let body;
  if (slashes === null) {
    body = hist.isError
      ? <p className="text-sm text-muted">This coordinator doesn&apos;t serve chain history, so slashes can&apos;t be listed here yet. <Null>Not reported</Null></p>
      : <div className="flex flex-col gap-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>;
  } else if (slashes.length === 0) {
    body = <p className="flex items-center gap-2 text-sm text-muted"><ShieldCheck className="size-4 text-ok" aria-hidden />No slashes on record for this node.</p>;
  } else {
    const rows = all ? slashes : slashes.slice(0, SHOWN);
    body = (
      <>
        <ul className="flex flex-col divide-y divide-rule">
          {rows.map((s) => (
            <li key={s.key}>
              <button type="button" onClick={() => setOpen(s)} className="flex w-full items-center justify-between gap-3 py-2.5 text-left hover:bg-hover focus-visible:bg-hover">
                <span className="min-w-0">
                  <span className={s.taken !== null && s.taken > 0 ? "text-sm text-danger" : "text-sm text-ink"}>{headline(s)}</span>
                  <span className="block text-xs text-muted">{s.reason ? REASON_COPY[s.reason].title : "Reason not reported"} · {ago(s.at, now)}</span>
                </span>
                <span className="shrink-0 text-xs text-muted">Why</span>
              </button>
            </li>
          ))}
        </ul>
        {slashes.length > SHOWN && (
          <button type="button" onClick={() => setAll((a) => !a)} className="self-start text-sm text-muted underline decoration-subtle underline-offset-4 hover:text-ink">
            {all ? "Show fewer" : `Show all ${slashes.length}`}
          </button>
        )}
      </>
    );
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <SectionTitle title="Slashes" sub="stake taken for missed or failed work" />
      {benched && slashes !== null && slashes.length > 0 && (
        <p className="text-sm text-danger">Benched until you stake {formatToken(minStake - stake)} TOD more. Add it in Stake above.</p>
      )}
      {body}
      {open && <SlashDrawer s={open} onClose={() => setOpen(null)} />}
    </Card>
  );
}

function headline(s: Slash) {
  const where = `job #${s.job}, round ${s.round}`;
  if (s.taken === null) return `Slashed in ${where}`;
  if (s.taken === 0) return `Flagged in ${where}, no stake taken`;
  return `Slashed ${formatToken(s.taken)} TOD in ${where}`;
}

function ago(at: number, now: number) {
  const h = Math.max(0, Math.round((now - at) / 3600));
  return h < 1 ? "just now" : h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

function SlashDrawer({ s, onClose }: { s: Slash; onClose: () => void }) {
  const copy = s.reason ? REASON_COPY[s.reason] : null;
  return (
    <Drawer
      title={<><Eyebrow>slash · job #{s.job} · round {s.round}</Eyebrow><p className="truncate text-sm text-ink">{copy ? copy.title : "Reason not reported"}</p></>}
      onClose={onClose}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href={`/jobs/${s.job}/rounds/${s.round}`} className="text-sm text-ink underline decoration-subtle underline-offset-4">Open the round receipt and its evidence</Link>
          <a href={`https://sepolia.basescan.org/tx/${s.tx}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-xs text-muted hover:text-ink">{s.tx.slice(0, 10)}… <ExternalLink className="size-3" aria-hidden /></a>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <section className="flex flex-col gap-1.5">
          <Eyebrow>what happened</Eyebrow>
          <p className="text-sm text-ink">{copy ? copy.what : "The chain shows stake taken in this round, but the history this coordinator holds doesn't include the event that says why. The round receipt has the verifiers' reports."}</p>
          {s.reason === "noReveal" && s.missed !== null && (
            <p className="text-sm text-muted">This was miss {s.missed} in this job. The penalty grows with each one: 1% of the job&apos;s stake for the first, 10% for the second, then 50% for every miss after.</p>
          )}
        </section>

        <section className="flex flex-col gap-1.5">
          <Eyebrow>where the stake went</Eyebrow>
          {s.taken === 0 ? (
            <p className="text-sm text-muted">Nothing. This job&apos;s rules take no stake for this kind of failure.</p>
          ) : (
            <dl className="flex flex-col gap-1 text-sm">
              <div className="flex justify-between gap-6"><dt className="text-muted">Taken from your stake</dt><dd className="text-danger"><Money units={s.taken} /></dd></div>
              <div className="flex justify-between gap-6"><dt className="text-muted">{s.reason === "noReveal" ? "Back to the job's budget" : "Added to this round's pay"}</dt><dd className="text-ink">{s.toPot === null ? <Null /> : <Money units={s.toPot} />}</dd></div>
              <div className="flex justify-between gap-6"><dt className="text-muted">Locked for good</dt><dd className="text-ink">{s.burned === null ? <Null /> : <Money units={s.burned} />}</dd></div>
            </dl>
          )}
          <p className="text-xs text-muted">Half of every slash goes to the honest side and half is locked, so a verifier gains nothing by inventing failures.</p>
        </section>

        {copy && (
          <section className="flex flex-col gap-1.5">
            <Eyebrow>how to avoid this</Eyebrow>
            <p className="text-sm text-ink">{copy.avoid}</p>
            {s.reason === "noReveal" && <Command cmd="tod-node stop" />}
          </section>
        )}
      </div>
    </Drawer>
  );
}
