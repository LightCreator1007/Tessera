// Pure rules behind the node Settings tab (UX-PHASE-2 §4): the weekly schedule grid, the next-24-hour strip with drain lead, presets, and what "Stop now" costs in each round phase.

export const SLOTS = 48;
export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export type Week = boolean[];

export const emptyWeek = (): Week => Array.from({ length: DAYS.length * SLOTS }, () => false);
export const cell = (day: number, slot: number) => day * SLOTS + slot;

export function hoursPerWeek(week: Week) {
  return week.filter(Boolean).length / 2;
}

export type Preset = "nights" | "weekends" | "workoff" | "always";
export const PRESETS: { key: Preset; label: string; hint: string }[] = [
  { key: "nights", label: "Nights", hint: "23:00 to 07:00" },
  { key: "weekends", label: "Weekends", hint: "all of Saturday and Sunday" },
  { key: "workoff", label: "Outside work hours", hint: "everything except 09:00 to 18:00 on weekdays" },
  { key: "always", label: "Always", hint: "every half hour" },
];

export function preset(p: Preset): Week {
  const w = emptyWeek();
  for (let d = 0; d < DAYS.length; d++) {
    for (let s = 0; s < SLOTS; s++) {
      const on =
        p === "always" ? true
        : p === "weekends" ? d >= 5
        : p === "nights" ? s >= 46 || s < 14
        : d >= 5 || s < 18 || s >= 36;
      w[cell(d, s)] = on;
    }
  }
  return w;
}

/** Paint the rectangle between two cells, the way a click-drag across days and times does. */
export function paint(week: Week, from: [number, number], to: [number, number], on: boolean): Week {
  const next = week.slice();
  const [d0, d1] = [Math.min(from[0], to[0]), Math.max(from[0], to[0])];
  const [s0, s1] = [Math.min(from[1], to[1]), Math.max(from[1], to[1])];
  for (let d = d0; d <= d1; d++) for (let s = s0; s <= s1; s++) next[cell(d, s)] = on;
  return next;
}

/** Weekday (Monday 0) and half-hour slot of an instant, in the laptop's time zone rather than the browser's. */
export function zoneSlot(at: number, zone: string): { day: number; slot: number } {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: zone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const day = DAYS.indexOf(get("weekday") as (typeof DAYS)[number]);
  return { day, slot: Number(get("hour")) * 2 + (Number(get("minute")) >= 30 ? 1 : 0) };
}

export const minuteLabel = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
export const slotLabel = (slot: number) => minuteLabel(slot * 30);

export type Strip = { on: boolean[]; startSlot: number; lastStart: { minute: number; ends: number } | null };

/**
 * The next 48 half hours from now. A window stops taking new rounds one round-length before it closes,
 * so the matcher never hands the laptop a round it can't finish.
 */
export function next24h(week: Week, now: { day: number; slot: number }, roundMinutes: number): Strip {
  const on = Array.from({ length: SLOTS }, (_, i) => {
    const abs = now.day * SLOTS + now.slot + i;
    return week[abs % week.length];
  });
  const firstEnd = on.findIndex((v, i) => v && (i === SLOTS - 1 || !on[i + 1]));
  const lastStart = firstEnd === -1 || firstEnd === SLOTS - 1
    ? null
    : (() => { const ends = (now.slot + firstEnd + 1) % SLOTS; return { ends, minute: (ends * 30 - roundMinutes + 1440) % 1440 }; })();
  return { on, startSlot: now.slot, lastStart };
}

/** Windows Update restarts at 03:00 by default; a painted 03:00 slot is where overnight rounds get lost. */
export function coversWindowsRestart(week: Week) {
  return DAYS.some((_, d) => week[cell(d, 6)]);
}

export type RoundPhase = "idle" | "matched" | "committed" | "revealed" | "uploading";
export type StopCost =
  | { kind: "free"; title: string; body: string }
  | { kind: "pay"; title: string; body: string; pay: number }
  | { kind: "slash"; title: string; body: string; pay: number; slash: number }
  | { kind: "risk"; title: string; body: string };

const SLASH_LADDER = [0.01, 0.1, 0.5];

/** Cost of stopping at this exact moment (§4.3). `missesInRow` counts missed commits or reveals before this one. */
export function stopCost(phase: RoundPhase, o: { pay: number; stakePerNode: number; missesInRow: number; revealInMin: number; uploadPct: number; fmt: (units: number) => string }): StopCost {
  switch (phase) {
    case "idle":
      return { kind: "free", title: "Stops right away", body: "No round is assigned to this laptop, so stopping costs nothing." };
    case "revealed":
      return { kind: "free", title: "Safe to stop", body: "Your work for this round is in. Pay still lands when the round settles." };
    case "matched":
      return {
        kind: "pay",
        pay: o.pay,
        title: `You'll miss this round's ${o.fmt(o.pay)} TOD`,
        body: o.missesInRow >= 1
          ? "This is a second missed commit in a row. The node is benched until the team re-arms it."
          : "It also counts 1 missed commit. One more in a row benches this node until the team re-arms it.",
      };
    case "committed": {
      const slash = Math.round(o.stakePerNode * SLASH_LADDER[Math.min(o.missesInRow, SLASH_LADDER.length - 1)]);
      return {
        kind: "slash",
        pay: o.pay,
        slash,
        title: `Stopping now costs ${o.fmt(slash)} TOD of stake and this round's pay`,
        body: `Reveal is due in ${o.revealInMin} min. Pause after this round is free.`,
      };
    }
    case "uploading":
      return { kind: "risk", title: `Upload ${o.uploadPct}% done`, body: "Stopping now may make your work unverifiable, which verifiers treat as data unavailable." };
  }
}

export type PauseFor = "resume" | "1h" | "8h" | "tomorrow";
export const PAUSE_FOR: { key: PauseFor; label: string }[] = [
  { key: "resume", label: "Until I resume" },
  { key: "1h", label: "For 1 hour" },
  { key: "8h", label: "For 8 hours" },
  { key: "tomorrow", label: "Until tomorrow 08:00" },
];

export function pauseUntil(p: PauseFor, now: number): number | null {
  if (p === "resume") return null;
  if (p === "1h") return now + 3_600_000;
  if (p === "8h") return now + 8 * 3_600_000;
  const t = new Date(now);
  t.setDate(t.getDate() + 1);
  t.setHours(8, 0, 0, 0);
  return t.getTime();
}
