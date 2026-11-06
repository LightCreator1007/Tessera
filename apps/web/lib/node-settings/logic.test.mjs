// Runnable check for the schedule and stop-cost rules: node --test lib/node-settings/logic.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { cell, coversWindowsRestart, emptyWeek, hoursPerWeek, next24h, paint, preset, stopCost, zoneSlot } from "./logic.ts";

const fmt = (u) => (u / 1e6).toFixed(2);
const o = { pay: 2_500_000, stakePerNode: 15_000_000, missesInRow: 0, revealInMin: 6, uploadPct: 80, fmt };

test("presets cover the hours they name", () => {
  assert.equal(hoursPerWeek(preset("nights")), 8 * 7);
  assert.equal(hoursPerWeek(preset("weekends")), 48);
  assert.equal(hoursPerWeek(preset("always")), 168);
  assert.equal(hoursPerWeek(preset("workoff")), 168 - 9 * 5);
});

test("paint fills the dragged rectangle", () => {
  const w = paint(emptyWeek(), [2, 10], [0, 12], true);
  assert.equal(hoursPerWeek(w), 3 * 3 / 2);
  assert.ok(w[cell(1, 11)]);
  assert.ok(!w[cell(3, 11)]);
});

test("drain lead: a window ending 07:00 takes its last 40-minute round by 06:20", () => {
  const s = next24h(preset("nights"), { day: 0, slot: 2 }, 40);
  assert.equal(s.lastStart?.ends, 14);
  assert.equal(s.lastStart?.minute, 6 * 60 + 20);
  assert.equal(next24h(preset("always"), { day: 0, slot: 0 }, 40).lastStart, null);
  assert.equal(next24h(emptyWeek(), { day: 0, slot: 0 }, 40).lastStart, null);
});

test("stop cost follows the round phase", () => {
  assert.equal(stopCost("idle", o).kind, "free");
  assert.equal(stopCost("revealed", o).kind, "free");
  assert.equal(stopCost("matched", o).kind, "pay");
  const first = stopCost("committed", o);
  assert.equal(first.kind === "slash" && first.slash, 150_000);
  const third = stopCost("committed", { ...o, missesInRow: 5 });
  assert.equal(third.kind === "slash" && third.slash, 7_500_000);
  assert.equal(stopCost("uploading", o).kind, "risk");
});

test("windows restart warning and laptop time zone", () => {
  assert.ok(coversWindowsRestart(preset("nights")));
  assert.ok(!coversWindowsRestart(preset("weekends").map((v, i) => v && i % 48 !== 6)));
  assert.deepEqual(zoneSlot(Date.UTC(2026, 10, 2, 0, 0), "Asia/Kolkata"), { day: 0, slot: 11 });
});
