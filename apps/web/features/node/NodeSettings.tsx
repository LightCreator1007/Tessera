"use client";
// A laptop's settings on its node page (UX-PHASE-2 §4): availability mode, pause after this round or stop now with its exact cost, the weekly schedule painter, resource limits and workloads, and the Requested, Applied, Rejected state of a change sent to the laptop. Runs on demo data until C1 to C5 land.
import { useEffect, useMemo, useRef, useState } from "react";
import { CirclePause, CirclePlay, CircleStop, Laptop, Lock } from "lucide-react";
import { useWallet } from "@/lib/wallet";
import { formatToken } from "@/lib/money";
import {
  DAYS, DEFAULTS, PAUSE_FOR, PRESETS, SLOTS, cancelRequest, cell, coversWindowsRestart, heartbeat, hoursPerWeek, next24h, paint, pauseUntil, preset, sendSettings,
  minuteLabel, setLaptop, setPause, slotLabel, stopCost, useNodeSettings, zoneSlot, type Mode, type NodeSettings as Settings, type RoundPhase, type Week,
} from "@/lib/node-settings";
import { Checkbox, NumField, SettingRow } from "@/components/fields";
import { Banner, Button, ButtonLink, EmptyState, MenuItem, Pill, Popover, Segmented, cx } from "@/components/primitives";
import { DemoChip, MIN_STAKE } from "./JoinFlow";

const TOD = 1_000_000;
const ROUND_MINUTES = 40;
const ROUND_PAY = 2.5 * TOD;
const WORKLOADS = [
  { id: "mlp-exact", label: "MLP, exact replay", hint: "Small CPU model; every round replays bit for bit" },
  { id: "cnn-torch", label: "CNN, PyTorch", hint: "Image model; needs about 2 GB of RAM per round" },
];
const MODES: { key: Mode; label: string; hint: string }[] = [
  { key: "always", label: "Always", hint: "Takes rounds whenever Docker is running. Timed pauses resume on their own." },
  { key: "schedule", label: "Schedule", hint: "Takes rounds only in the hours you paint below, in the laptop's time." },
  { key: "manual", label: "Manual", hint: "Takes rounds until you pause it. Nothing resumes on its own." },
];
const PHASES: { key: RoundPhase; label: string }[] = [
  { key: "idle", label: "idle" }, { key: "matched", label: "matched" }, { key: "committed", label: "committed" }, { key: "revealed", label: "revealed" }, { key: "uploading", label: "uploading" },
];

function useNow(ms = 15_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

const timeIn = (ms: number, zone: string) => new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(ms);

/** Field names that differ between two settings, for the save bar count. */
function changed(a: Settings, b: Settings) {
  return (Object.keys(a) as (keyof Settings)[]).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}

export function NodeSettings() {
  const w = useWallet();
  const s = useNodeSettings();
  const now = useNow();
  const [draft, setDraft] = useState<Settings>(s.applied);
  const appliedKey = JSON.stringify(s.applied);
  useEffect(() => setDraft(JSON.parse(appliedKey)), [appliedKey]);

  const online = Boolean(w.node?.running);
  useEffect(() => {
    if (s.sync.phase !== "requested" || !online) return;
    const t = setTimeout(heartbeat, 2500);
    return () => clearTimeout(t);
  }, [s.sync.phase, online]);

  if (!w.node) {
    return <EmptyState icon={Laptop} poster="EMPTY" title="No node on this wallet" action={<ButtonLink href="/nodes/add" variant="primary">Add a node</ButtonLink>}>Schedule, pause and limits appear here once a laptop is paired with this wallet.</EmptyState>;
  }
  if (!w.node.joined) {
    return <EmptyState icon={Laptop} poster="WAIT" title="Setup isn't finished" action={<ButtonLink href="/nodes/add" variant="primary">Finish setup</ButtonLink>}>The laptop is paired. Verify, stake and join, then set its hours here.</EmptyState>;
  }

  const diff = changed(draft, s.applied);
  const patch = (p: Partial<Settings>) => setDraft((d) => ({ ...d, ...p }));
  const midRound = s.laptop.phase !== "idle";

  return (
    <div className="flex flex-col gap-8 pb-4">
      <Banner tone="demo" title="Mocked until the node reports its schedule">Pause, schedule and remote settings need heartbeat fields, matcher filters and a signed-settings relay (C1 to C5). This section runs on demo data.</Banner>

      <SyncLine online={online} />

      <Availability now={now} midRound={midRound} />

      <section className="flex flex-col">
        <h3 className="text-sm font-medium text-ink">When it takes rounds</h3>
        <SettingRow label="Mode" hint={MODES.find((m) => m.key === draft.mode)?.hint}>
          <Segmented label="Availability mode" items={MODES} value={draft.mode} onChange={(mode) => patch({ mode })} />
        </SettingRow>
        {draft.mode === "schedule" && <ScheduleEditor week={draft.week} onChange={(week) => patch({ week })} zone={s.laptop.zone} now={now} midRound={midRound} />}
      </section>

      <section className="flex flex-col">
        <h3 className="text-sm font-medium text-ink">Limits</h3>
        <SettingRow label="CPU threads" htmlFor="threads" hint={`Tessera uses at most this many of the laptop's ${s.laptop.cores} cores. Jobs that need more aren't offered.`} note={midRound && draft.threads !== s.applied.threads ? "Applies after this round" : undefined}>
          <NumField id="threads" value={draft.threads} min={1} max={s.laptop.cores} unit={`of ${s.laptop.cores}`} onChange={(v) => patch({ threads: v ?? 1 })} />
        </SettingRow>
        <SettingRow label="Memory" htmlFor="ram" hint={`Of ${s.laptop.ramGb} GB. The node refuses workloads that need more.`}>
          <NumField id="ram" value={draft.ramGb} min={1} max={s.laptop.ramGb} unit="GB" onChange={(v) => patch({ ramGb: v ?? 1 })} />
        </SettingRow>
        <SettingRow label="Disk cache" htmlFor="disk" hint="Shards and checkpoints kept between rounds. A full disk makes the node miss a commit, so keep headroom.">
          <NumField id="disk" value={draft.diskGb} min={1} max={200} unit="GB" onChange={(v) => patch({ diskGb: v ?? 1 })} />
        </SettingRow>
        <SettingRow label="Hours per day" htmlFor="hours" hint="Stops taking rounds once it has worked this long today.">
          <NumField id="hours" value={draft.maxHoursDay} min={1} max={24} unit="h" empty="No cap" onChange={(v) => patch({ maxHoursDay: v })} />
        </SettingRow>
        <SettingRow label="Minimum pay per round" htmlFor="minpay" hint="Skips jobs whose budget per node per round is below this.">
          <NumField id="minpay" value={draft.minPay === null ? null : draft.minPay / TOD} min={0} step={0.1} unit="TOD" empty="Any" onChange={(v) => patch({ minPay: v === null ? null : Math.round(v * TOD) })} />
        </SettingRow>
        <SettingRow label="Workloads" hint="What this laptop agrees to run. Custom code needs a separate opt-in per environment.">
          <div className="flex flex-col gap-2.5">
            {WORKLOADS.map((wl) => (
              <Checkbox
                key={wl.id}
                label={<span className="font-mono text-xs">{wl.id}</span>}
                hint={wl.hint}
                checked={draft.workloads.includes(wl.id)}
                onChange={(on) => patch({ workloads: on ? [...draft.workloads, wl.id] : draft.workloads.filter((x) => x !== wl.id) })}
              />
            ))}
          </div>
          {draft.workloads.length === 0 && <p className="text-xs text-warn">With no workloads ticked, this node is never drawn into a round.</p>}
        </SettingRow>
      </section>

      <SaveBar
        count={diff.length}
        busy={s.sync.phase === "signing"}
        onDiscard={() => setDraft(s.applied)}
        onReset={() => setDraft(DEFAULTS)}
        onSend={() => sendSettings(draft)}
      />
    </div>
  );
}

function SyncLine({ online }: { online: boolean }) {
  const s = useNodeSettings();
  const zone = s.laptop.zone;
  const sync = s.sync;
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-rule bg-surface px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {sync.phase === "applied" && <Pill tone="ok">On the laptop</Pill>}
        {sync.phase === "signing" && <Pill tone="pending" live>Sign in your wallet</Pill>}
        {sync.phase === "requested" && <Pill tone="pending" live>Requested</Pill>}
        {sync.phase === "rejected" && <Pill tone="warn">Rejected</Pill>}
        <p className="min-w-0 flex-1 text-sm text-muted">
          {sync.phase === "applied" && (sync.by === "web" ? `Applied on the laptop at ${timeIn(sync.at, zone)}.` : "These are the settings the laptop reported in its last heartbeat.")}
          {sync.phase === "signing" && "Signing is free and nothing goes on chain. The coordinator only relays it; the laptop checks your signature."}
          {sync.phase === "requested" && (online ? `Signed at ${timeIn(sync.at, zone)}. Waiting for the laptop's next heartbeat.` : "Signed. The laptop is offline, so it applies when it comes back.")}
          {sync.phase === "rejected" && sync.reason}
        </p>
        {sync.phase === "requested" && <Button variant="ghost" onClick={cancelRequest}>Cancel request</Button>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs text-muted"><Lock className="size-3.5" strokeWidth={1.5} aria-hidden />Local lock {s.laptop.localLock ? "on: the laptop ignores changes from here" : "off"}</span>
        <DemoChip onClick={() => setLaptop({ localLock: !s.laptop.localLock })}>{s.laptop.localLock ? "unlock on laptop" : "lock on laptop"}</DemoChip>
      </div>
    </div>
  );
}

function Availability({ now, midRound }: { now: number; midRound: boolean }) {
  const s = useNodeSettings();
  const w = useWallet();
  const dialog = useRef<HTMLDialogElement>(null);
  const zone = s.laptop.zone;
  const p = s.pause;
  const expired = p.kind === "paused" && p.until !== null && p.until <= now;
  const drained = p.kind === "draining" && p.settlesAt <= now;
  useEffect(() => {
    if (expired) setPause({ kind: "none" });
    if (drained && p.kind === "draining") setPause({ kind: "paused", until: p.until, at: now });
  }, [expired, drained, p, now]);

  const manual = s.applied.mode === "manual";
  const cost = stopCost(s.laptop.phase, { pay: ROUND_PAY, stakePerNode: MIN_STAKE, missesInRow: s.laptop.missesInRow, revealInMin: 6, uploadPct: 80, fmt: (u) => formatToken(u) ?? "" });
  const stake = w.node ? w.node.stake : null;
  const lowStake = stake !== null && stake < MIN_STAKE / 2;

  const pause = (until: number | null) => setPause(midRound ? { kind: "draining", until, settlesAt: now + 12 * 60_000 } : { kind: "paused", until, at: now });
  const stopNow = () => {
    setPause({ kind: "paused", until: null, at: Date.now() });
    if (cost.kind === "pay" || cost.kind === "slash") setLaptop({ phase: "idle", missesInRow: s.laptop.missesInRow + 1 });
    else setLaptop({ phase: "idle" });
    dialog.current?.close();
  };

  const status =
    p.kind === "paused" ? { tone: "warn" as const, label: "Paused", line: p.until === null ? "Until you resume it." : `Until ${timeIn(p.until, zone)} laptop time, then it takes rounds again.` }
    : p.kind === "draining" ? { tone: "pending" as const, label: "Pausing", line: `In about ${Math.max(1, Math.round((p.settlesAt - now) / 60_000))} min, when this round settles. Pausing this way is free.` }
    : { tone: "ok" as const, label: "Taking rounds", line: midRound ? `In a round now (${s.laptop.phase}).` : "Idle and eligible for the next round." };

  return (
    <section aria-label="Availability" className="flex flex-col gap-3 rounded-xl border border-rule bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="flex items-center gap-2"><Pill tone={status.tone} live={status.tone === "pending"}>{status.label}</Pill></span>
          <p className="text-sm text-muted">{status.line}</p>
          {p.kind !== "none" && lowStake && <p className="text-sm text-danger">Also inactive: stake {formatToken(stake)} of {formatToken(MIN_STAKE / 2)} TOD needed.</p>}
          {p.kind === "paused" && <p className="text-xs text-muted">The proving period stops counting while paused. It doesn&apos;t reset.</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {p.kind === "none" && (
            <Popover
              align="end"
              width="w-menu"
              trigger={({ open, toggle, ref }) => (
                <Button ref={ref} onClick={toggle} aria-expanded={open} aria-haspopup="menu" icon={CirclePause}>{midRound ? "Pause after this round" : "Pause"}</Button>
              )}
            >
              {(close) => (
                <div role="menu" className="flex flex-col">
                  {PAUSE_FOR.filter((o) => !manual || o.key === "resume").map((o) => (
                    <MenuItem key={o.key} title={o.label} onClick={() => { pause(pauseUntil(o.key, Date.now())); close(); }} />
                  ))}
                </div>
              )}
            </Popover>
          )}
          {p.kind !== "none" && <Button icon={CirclePlay} onClick={() => setPause({ kind: "none" })}>{p.kind === "draining" ? "Keep taking rounds" : "Resume"}</Button>}
          {midRound && p.kind !== "paused" && (
            <Button variant="ghost" icon={CircleStop} onClick={() => (cost.kind === "free" ? stopNow() : dialog.current?.showModal())}>{p.kind === "draining" ? "Stop now instead" : "Stop now"}</Button>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted">Round phase on the laptop:</span>
        {PHASES.map((ph) => <DemoChip key={ph.key} onClick={() => setLaptop({ phase: ph.key })}>{ph.key === s.laptop.phase ? `[${ph.label}]` : ph.label}</DemoChip>)}
      </div>

      <dialog ref={dialog} aria-labelledby="stop-title" onClick={(e) => { if (e.target === e.currentTarget) e.currentTarget.close(); }} className="connect-dialog m-auto w-dialog rounded-xl border border-rule bg-surface p-0 text-ink shadow-2xl">
        <div className="flex flex-col gap-5 p-6">
          <div className="flex flex-col gap-2">
            <h2 id="stop-title" className="text-lg font-semibold text-ink">{cost.title}</h2>
            <p className="text-sm text-muted">{cost.body}</p>
          </div>
          {(cost.kind === "pay" || cost.kind === "slash") && (
            <dl className="flex flex-col gap-1.5 rounded-lg bg-band px-3 py-2.5 text-sm">
              <div className="flex justify-between"><dt className="text-muted">This round&apos;s pay</dt><dd className="font-mono text-danger">-{formatToken(cost.pay)} TOD</dd></div>
              {cost.kind === "slash" && <div className="flex justify-between"><dt className="text-muted">Stake slashed</dt><dd className="font-mono text-danger">-{formatToken(cost.slash)} TOD</dd></div>}
              <div className="flex justify-between"><dt className="text-muted">Pause after this round</dt><dd className="font-mono text-ok">free</dd></div>
            </dl>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={stopNow}>Stop now anyway</Button>
            <Button variant="primary" onClick={() => { pause(null); dialog.current?.close(); }}>Pause after this round</Button>
          </div>
        </div>
      </dialog>
    </section>
  );
}

function ScheduleEditor({ week, onChange, zone, now, midRound }: { week: Week; onChange: (w: Week) => void; zone: string; now: number; midRound: boolean }) {
  const browserZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const here = zoneSlot(now, zone);
  const strip = next24h(week, here, ROUND_MINUTES);
  const hours = hoursPerWeek(week);
  const [focus, setFocus] = useState(cell(Math.max(0, here.day), here.slot));
  const drag = useRef<{ from: [number, number]; on: boolean; base: Week } | null>(null);
  const grid = useRef<HTMLDivElement>(null);

  const at = (el: Element | null): [number, number] | null => {
    const t = el instanceof HTMLElement ? el.closest<HTMLElement>("[data-cell]") : null;
    return t ? [Number(t.dataset.d), Number(t.dataset.s)] : null;
  };
  const moveFocus = (i: number) => {
    setFocus(i);
    grid.current?.querySelector<HTMLElement>(`[data-cell="${i}"]`)?.focus();
  };
  const onKey = (e: React.KeyboardEvent, d: number, sl: number) => {
    const step: Record<string, [number, number]> = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] };
    if (e.key === " " || e.key === "Enter") { e.preventDefault(); onChange(paint(week, [d, sl], [d, sl], !week[cell(d, sl)])); return; }
    const m = step[e.key];
    if (!m) return;
    e.preventDefault();
    const nd = Math.min(DAYS.length - 1, Math.max(0, d + m[0]));
    const ns = Math.min(SLOTS - 1, Math.max(0, sl + m[1]));
    if (e.shiftKey) onChange(paint(week, [nd, ns], [nd, ns], week[cell(d, sl)]));
    moveFocus(cell(nd, ns));
  };

  return (
    <div className="flex flex-col gap-5 border-b border-rule-row py-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs text-muted">Start from</span>
        {PRESETS.map((p) => <Chip key={p.key} title={p.hint} onClick={() => onChange(preset(p.key))}>{p.label}</Chip>)}
        <Chip onClick={() => onChange(paint(week, [0, 0], [DAYS.length - 1, SLOTS - 1], false))}>Clear</Chip>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-xs text-muted">Next 24 hours, from now</p>
        <div className="relative grid grid-cols-48 gap-px overflow-hidden rounded-sm" aria-hidden>
          {strip.on.map((on, i) => <span key={i} className={cx("h-4", on ? "bg-ink" : "bg-band", i === 0 && "ring-2 ring-inset ring-pending")} />)}
        </div>
        <p className="text-xs text-muted">
          {strip.lastStart
            ? `Next window closes at ${slotLabel(strip.lastStart.ends)}. The last round starts by ${minuteLabel(strip.lastStart.minute)} so it finishes in time.`
            : strip.on.every(Boolean) ? "Available for the whole next day." : strip.on.some(Boolean) ? "The current window runs past the next 24 hours." : "Not available in the next 24 hours."}
          {midRound && " A change that ends a window inside the current round takes effect after it settles."}
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="grid grid-cols-sched-labels items-end gap-x-2 text-xs text-subtle" aria-hidden>
          <span />
          <div className="grid grid-cols-4">{[0, 6, 12, 18].map((h) => <span key={h} className="font-mono">{String(h).padStart(2, "0")}:00</span>)}</div>
        </div>
        <div
          ref={grid}
          role="grid"
          aria-label="Weekly schedule, half-hour cells. Arrow keys move, space toggles, shift and arrow paints."
          className="flex touch-none select-none flex-col gap-px"
          onPointerMove={(e) => {
            if (!drag.current) return;
            const to = at(document.elementFromPoint(e.clientX, e.clientY));
            if (to) onChange(paint(drag.current.base, drag.current.from, to, drag.current.on));
          }}
          onPointerUp={() => { drag.current = null; }}
          onPointerLeave={() => { drag.current = null; }}
        >
          {DAYS.map((day, d) => (
            <div key={day} role="row" className="grid grid-cols-sched-labels items-center gap-x-2">
              <span role="rowheader" className="font-mono text-xs text-muted">{day}</span>
              <div className="grid grid-cols-48 gap-px">
                {Array.from({ length: SLOTS }, (_, sl) => {
                  const i = cell(d, sl);
                  const on = week[i];
                  const isNow = d === here.day && sl === here.slot;
                  return (
                    <button
                      key={sl}
                      type="button"
                      role="gridcell"
                      data-cell={i}
                      data-d={d}
                      data-s={sl}
                      tabIndex={i === focus ? 0 : -1}
                      aria-selected={on}
                      aria-label={`${day} ${slotLabel(sl)}, ${on ? "available" : "off"}`}
                      onPointerDown={(e) => { e.preventDefault(); drag.current = { from: [d, sl], on: !on, base: week }; setFocus(i); onChange(paint(week, [d, sl], [d, sl], !on)); }}
                      onKeyDown={(e) => onKey(e, d, sl)}
                      className={cx("h-6 transition-colors duration-100 focus-visible:relative focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-focus", on ? "bg-ink hover:opacity-80" : "bg-band hover:bg-hover", sl % 12 === 0 && "ml-px", isNow && "ring-2 ring-inset ring-pending")}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1 text-xs text-muted">
        <p><span className="font-mono text-ink">{hours} h</span> a week available.{hours === 0 && <span className="text-warn"> With nothing painted, this node is never drawn into a round.</span>}</p>
        <p>Shown in the laptop&apos;s time ({zone}).{timeIn(now, browserZone) !== timeIn(now, zone) && ` Your browser is in ${browserZone}.`}</p>
        {coversWindowsRestart(week) && <p className="text-warn">Windows Update restarts at 03:00 by default. Change its active hours, or leave 03:00 out, so a restart doesn&apos;t cost a round.</p>}
      </div>
    </div>
  );
}

function Chip({ children, onClick, title }: { children: React.ReactNode; onClick: () => void; title?: string }) {
  return <button type="button" title={title} onClick={onClick} className="inline-flex h-7 items-center rounded-full border border-rule px-3 text-xs text-ink transition-colors duration-150 hover:border-rule-strong hover:bg-hover">{children}</button>;
}

function SaveBar({ count, busy, onDiscard, onReset, onSend }: { count: number; busy: boolean; onDiscard: () => void; onReset: () => void; onSend: () => void }) {
  return (
    <div className={cx("flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rule px-4 py-3", count > 0 ? "sticky bottom-0 -mx-1 bg-raised shadow-popover" : "bg-surface")}>
      <p className="text-sm text-muted">{count === 0 ? "No changes." : `${count} change${count === 1 ? "" : "s"}, not sent yet.`}<span className="hidden sm:inline"> Your wallet signs them and the laptop applies them on its next heartbeat.</span></p>
      <div className="flex gap-2">
        {count === 0 ? <Button variant="ghost" onClick={onReset}>Reset to defaults</Button> : <Button variant="ghost" onClick={onDiscard}>Discard</Button>}
        <Button variant="primary" disabled={count === 0 || busy} onClick={onSend}>{busy ? "Signing" : "Sign and send to laptop"}</Button>
      </div>
    </div>
  );
}
