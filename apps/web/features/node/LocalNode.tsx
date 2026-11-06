"use client";
// The tod-node running on this machine, read live through /api/node or straight from the browser: its state, what it is doing, its event log, and a stop button.
import { useEffect, useRef, useState } from "react";
import { Activity, CirclePause, CircleStop, Laptop, PlugZap, TriangleAlert } from "lucide-react";
import { node, NodeError, onNodeMachine } from "@/lib/api/client";
import { useNodeHealth, useNodeStatus } from "@/lib/api/hooks";
import type { NodeEvent, NodeStatus, OwedReveal } from "@/lib/api/types";
import { formatToken } from "@/lib/money";
import { Command } from "@/components/flow";
import { AddressChip, Banner, Button, Card, EmptyState, Eyebrow, Pill, SectionTitle, Skeleton, cx } from "@/components/primitives";

const KEEP = 200; // events held in memory; the node keeps the full log in events.ndjson
const SHOW = 12;

/** What the node said about itself in its last node.started event: version, network, chain and mode. */
type Started = { version?: string; network?: string; chainId?: number; mode?: string };

/** Long-polls the node's event log from `since`, resuming where it left off after an error or a restart of this page. */
export function useNodeEvents(enabled: boolean) {
  const [events, setEvents] = useState<NodeEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const since = useRef(0);
  useEffect(() => {
    if (!enabled) return;
    let stop = false;
    (async () => {
      while (!stop) {
        try {
          const batch = await node.events(since.current, 20);
          if (stop) return;
          if (batch.length) {
            // The node's `since` is exclusive: it returns events with seq > since, so the cursor is the last seq seen.
            since.current = batch[batch.length - 1].seq;
            setEvents((prev) => [...prev, ...batch].slice(-KEEP));
          }
          setError(null);
        } catch (e) {
          if (stop) return;
          setError(e instanceof NodeError ? e.code : "node_unreachable");
          await new Promise((r) => setTimeout(r, 3000));
        }
      }
    })();
    return () => { stop = true; };
  }, [enabled]);
  return { events, error };
}

const ROUND = (e: NodeEvent) => (e.job !== null ? `job ${e.job}${e.round !== null ? `, round ${e.round}` : ""}` : "");

/** One event as a sentence. Unknown types still show, by name, so a newer node never renders as blank. */
export function describe(e: NodeEvent): { text: string; tone: "ok" | "warn" | "danger" | "neutral" } {
  const d = e.data;
  switch (e.type) {
    case "node.started": return { text: `Started ${d.version ?? ""} on ${d.network ?? "?"}${d.mode && d.mode !== "honest" ? `, mode ${d.mode}` : ""}`, tone: d.mode && d.mode !== "honest" ? "danger" : "ok" };
    case "node.stopping": return { text: d.source === "api" ? "Stop requested from the console" : `Stopping on ${d.signal ?? "a signal"}`, tone: "warn" };
    case "node.draining": return { text: `Finishing owed reveals before it stops: ${(d.pending as string[] | undefined)?.join(", ") || "none"}`, tone: "warn" };
    case "node.stopped": return { text: "Stopped", tone: "neutral" };
    case "api.listening": return { text: `Local API listening on ${d.bind}`, tone: "neutral" };
    case "round.committed": return { text: `Committed its update for ${ROUND(e)}`, tone: "ok" };
    case "round.revealed": return { text: `Revealed its update for ${ROUND(e)}`, tone: "ok" };
    case "reveal.at_risk": return { text: `The reveal for ${ROUND(e)} is running late, ${d.secondsLeft ?? "?"} s left`, tone: "danger" };
    case "round.skipped": return { text: `Skipped ${ROUND(e)}: ${d.reason ?? "no reason given"}`, tone: "warn" };
    case "tx.reverted": return { text: `The ${d.kind ?? ""} transaction for ${ROUND(e)} reverted${d.revert ? `: ${d.revert}` : ""}`, tone: "danger" };
    case "gas.topup": return { text: "The coordinator topped up its gas", tone: "ok" };
    case "error": return { text: `Error${d.what ? ` in ${d.what}` : ""}${d.code ? ` (${d.code})` : ""}${d.reason ? `: ${d.reason}` : ""}`, tone: "danger" };
    default: return { text: `${e.type}${ROUND(e) ? ` for ${ROUND(e)}` : ""}`, tone: "neutral" };
  }
}

/** Late-reveal warnings the node raised that no later reveal or skip for the same round has answered. */
export function lateReveals(events: NodeEvent[]): NodeEvent[] {
  const late = new Map<string, NodeEvent>();
  for (const e of events) {
    const k = `${e.job}:${e.round}`;
    if (e.type === "reveal.at_risk") late.set(k, e);
    else if (e.type === "round.revealed" || e.type === "round.skipped" || e.type === "node.started") late.delete(k);
  }
  // A restart clears everything the old process was tracking.
  const restart = [...events].reverse().find((e) => e.type === "node.started");
  return [...late.values()].filter((e) => !restart || e.seq > restart.seq);
}

const where = (o: { job: number | null; round: number | null }) => `job ${o.job}, round ${o.round}`;
const due = (deadline: number | null | undefined) => {
  if (!deadline) return null;
  const s = Math.round(deadline - Date.now() / 1000);
  return s > 0 ? `due in about ${s} s` : "past its deadline by this machine's clock";
};

/** The stop confirm's line: what stopping now waits for, and what a forced stop would cost. */
function stopLine(owed: OwedReveal[] | null | undefined) {
  if (!owed) return "Stop after owed reveals?";
  if (owed.length === 0) return "No reveal owed right now, so stopping costs nothing.";
  const cost = owed.reduce((sum, o) => (o.penalty === null || sum === null ? null : sum + o.penalty), 0 as number | null);
  const when = owed.map((o) => [where(o), due(o.revealDeadline)].filter(Boolean).join(", ")).join("; ");
  return `Your node owes a reveal in ${when}. Stop waits for it to land. A forced stop from the terminal would be slashed ${cost === null ? "for a missed reveal" : `${formatToken(cost)} TOD`}.`;
}

const TONE_DOT = { ok: "bg-ok", warn: "bg-warn", danger: "bg-danger", neutral: "bg-band" } as const;

function clock(ts: number) {
  return new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** The node's state in one word plus the command that moves it on, so every screen ends in something to do. */
function stateOf(st: NodeStatus | undefined, loopOk: boolean | undefined, draining: boolean) {
  if (!st) return null;
  if (!st.initialized) return { word: "Not set up", tone: "pending", next: "tod-node init --network anvil", why: "This machine has no node key or config yet." } as const;
  if (st.daemon.state !== "running") return { word: "Stopped", tone: "neutral", next: "tod-node run", why: "The node is set up but not running, so rounds can't draw it." } as const;
  if (draining) return { word: "Stopping", tone: "warn", next: null, why: "It finishes the reveals it owes first, so its stake isn't slashed for a missed reveal." } as const;
  if (loopOk === false) return { word: "Stalled", tone: "danger", next: "tod-node doctor", why: "The process is up but its loop hasn't ticked for over 30 seconds." } as const;
  return { word: "Running", tone: "ok", next: null, why: null } as const;
}

export function LocalNode({ compact }: { compact?: boolean }) {
  const status = useNodeStatus();
  const health = useNodeHealth();
  const running = status.data?.daemon.state === "running";
  const { events, error: feedError } = useNodeEvents(!!status.data);
  const [showAll, setShowAll] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [stopping, setStopping] = useState<"idle" | "sent" | { error: string }>("idle");

  if (status.isPending) return <Card className="p-4"><Skeleton className="h-24 w-full" /></Card>;
  if (status.isError) {
    const code = status.error instanceof NodeError ? status.error.code : "node_unreachable";
    // A hosted console can never see a visitor's laptop; say so instead of showing a broken panel.
    if (code === "no_local_node") {
      return compact ? null : (
        <EmptyState icon={Laptop} title="Your node isn't visible from here">
          Live node status shows in the console running on the node&apos;s own machine. Open it at localhost:3100/node, or use the CLI.
        </EmptyState>
      );
    }
    // From a hosted page, a node started without this site in TOD_WEB_ORIGINS refuses the browser, which looks the same as no node.
    const hosted = !onNodeMachine();
    return (
      <Card className="flex flex-col gap-3 p-4">
        <SectionTitle title="No node on this machine" sub="nothing answered on 127.0.0.1:7777" />
        <p className="text-sm text-muted">
          Start it, and this panel picks it up within a few seconds.
          {hosted ? " The node only answers this website if you start it with this site's address." : " If it runs in Docker, check the wrapper published port 7777."}
        </p>
        <Command cmd={hosted ? `TOD_WEB_ORIGINS=${window.location.origin} tod-node run` : "tod-node run"} />
      </Card>
    );
  }

  const st = status.data;
  const started = ([...events].reverse().find((e) => e.type === "node.started")?.data ?? {}) as Started;
  const lastStop = [...events].reverse().find((e) => e.type === "node.stopping" || e.type === "node.started");
  const draining = running && lastStop?.type === "node.stopping";
  const s = stateOf(st, health.data?.ok, draining);
  const testMode = !!started.mode && started.mode !== "honest";
  const late = running ? lateReveals(events) : [];
  const shown = showAll ? [...events].reverse() : [...events].reverse().slice(0, SHOW);

  async function stop() {
    setConfirm(false);
    setStopping("sent");
    try {
      await node.stop();
      status.refetch();
    } catch (e) {
      setStopping({ error: e instanceof NodeError ? e.code : "node_unreachable" });
    }
  }

  return (
    <section aria-label="This machine's node" className="flex flex-col gap-3">
      <Card className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <Eyebrow>this machine · tod-node</Eyebrow>
            <div className="flex flex-wrap items-center gap-2">
              {s && <Pill tone={s.tone} live={s.word === "Running"}>{s.word}</Pill>}
              {testMode && <Pill tone="danger">test mode: {started.mode}</Pill>}
              {started.network && <span className="text-xs text-muted">{started.network}{started.version ? ` · v${started.version}` : ""}</span>}
            </div>
            {s?.why && <p className="text-sm text-muted">{s.why}</p>}
          </div>
          {running && !draining && (
            confirm ? (
              <div className="flex max-w-md flex-wrap items-center justify-end gap-2">
                <span className={cx("text-sm", st.owed?.length ? "text-warn" : "text-muted")}>{stopLine(st.owed)}</span>
                <Button variant="primary" icon={CircleStop} onClick={stop}>{st.owed?.length ? "Stop after the reveal" : "Stop"}</Button>
                <Button onClick={() => setConfirm(false)}>Keep running</Button>
              </div>
            ) : (
              <Button icon={CirclePause} onClick={() => setConfirm(true)} disabled={stopping === "sent"}>Stop node</Button>
            )
          )}
        </div>
        {testMode && (
          <Banner tone="danger" title="This node is cheating on purpose">
            It runs in {started.mode} mode, which only test chains allow. Verifiers should catch it and slash its stake. That is the point of the demo.
          </Banner>
        )}
        {late.map((e) => {
          const d = e.data as { secondsLeft?: number; revealDeadline?: number; penalty?: number | null };
          return (
            <Banner key={e.seq} tone="danger" title={`The reveal for ${where(e)} is running late`}>
              It still hasn&apos;t landed{due(d.revealDeadline) ? `, and it is ${due(d.revealDeadline)}` : ""}. Keep this machine awake and online until it does. Missing it costs {d.penalty != null ? `${formatToken(d.penalty)} TOD of stake` : "stake"}.
            </Banner>
          );
        })}
        {typeof stopping === "object" && (
          <Banner tone="warn" title="The console couldn't stop the node">
            {stopping.error === "token_unreadable"
              ? "The stop token in ~/.tod/api.token isn't readable from here. That is normal when the node runs in Docker. Stop it from a terminal instead."
              : stopping.error === "bad_token" ? "The node refused the stop token. It may have been recreated. Stop it from a terminal."
              : stopping.error === "stop_from_terminal" ? "Only the console on the node's own machine can stop it. Stop it from a terminal."
              : "The node didn't answer. Stop it from a terminal."}
            <div className="mt-2"><Command cmd="tod-node stop" /></div>
          </Banner>
        )}
        {s?.next && <Command cmd={s.next} label="next" />}
        <dl className={cx("grid gap-x-6 gap-y-2 text-sm", compact ? "grid-cols-2" : "grid-cols-2 md:grid-cols-4")}>
          <div><dt className="text-xs text-subtle">Operator</dt><dd>{st.operator ? <AddressChip value={st.operator} href={`/nodes/${st.operator}`} /> : <span className="text-muted">none yet</span>}</dd></div>
          <div><dt className="text-xs text-subtle">Process</dt><dd className="font-mono text-ink">{st.daemon.pid ? `pid ${st.daemon.pid}` : "not running"}</dd></div>
          <div><dt className="text-xs text-subtle">Loop</dt><dd className="font-mono text-ink">{health.data?.loopAgeSeconds != null ? `${health.data.loopAgeSeconds.toFixed(0)} s since last tick` : "no tick yet"}</dd></div>
          <div><dt className="text-xs text-subtle">Data</dt><dd className="truncate font-mono text-ink" title={st.dataDir}>{st.dataDir}</dd></div>
        </dl>
      </Card>

      <Card className="flex flex-col gap-2 p-4">
        <SectionTitle title="Activity" sub="the node's own log, newest first">
          {feedError && <span className="inline-flex items-center gap-1 text-xs text-warn"><PlugZap className="size-3.5" aria-hidden /> reconnecting</span>}
        </SectionTitle>
        {events.length === 0 ? (
          <p className="flex items-center gap-2 py-4 text-sm text-muted"><Activity className="size-4" aria-hidden /> Nothing logged yet. Events appear here as the node starts, commits and reveals.</p>
        ) : (
          <ol className="flex flex-col" aria-live="polite">
            {shown.map((e) => {
              const d = describe(e);
              return (
                <li key={e.seq} className="flex items-baseline gap-3 border-t border-rule-row py-1.5 text-sm first:border-t-0">
                  <span className={cx("mt-1.5 size-1.5 shrink-0 rounded-full", TONE_DOT[d.tone])} aria-hidden />
                  <span className="w-20 shrink-0 font-mono text-xs text-subtle tabular">{clock(e.ts)}</span>
                  <span className={cx("min-w-0 flex-1", d.tone === "danger" ? "text-danger" : "text-ink")}>
                    {d.tone === "danger" && <TriangleAlert className="mr-1 inline size-3.5" aria-hidden />}
                    {d.text}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
        {events.length > SHOW && (
          <button type="button" className="self-start text-sm text-muted underline underline-offset-4" onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Show fewer" : `Show all ${events.length}`}
          </button>
        )}
        <p className="text-xs text-subtle">The full log is on disk: <code className="font-mono">tod-node logs -f</code>. Or watch it in the terminal UI: <code className="font-mono">tod-tui</code>.</p>
      </Card>
    </section>
  );
}
