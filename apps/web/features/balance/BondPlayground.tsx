"use client";
// Every earned-bond state on one sheet: empty, partway, pending on top, at the line, past it, and a slash that drops it back under.
import { BondMeter } from "./BondMeter";
import { WithdrawButton } from "./Withdraw";
import { Card, Eyebrow, PageHeader } from "@/components/primitives";
import { formatToken } from "@/lib/money";

const U = 1_000_000;
const T = 10 * U;
const SCENES = [
  { name: "Nothing earned", held: 0, pending: 0 },
  { name: "Partway", held: 6.4 * U, pending: 0 },
  { name: "Partway, round pending", held: 6.4 * U, pending: 0.42 * U },
  { name: "At the threshold", held: 10 * U, pending: 0 },
  { name: "Past it", held: 13.8 * U, pending: 0.42 * U },
  { name: "Slashed back under", held: 7.2 * U, pending: 0, slashes: [{ amount: 3.1 * U, href: "/jobs/12/rounds/7", label: "job #12, round 7: failed replay" }] },
];

export function BondPlayground() {
  return (
    <div className="flex min-h-full flex-col">
      <PageHeader title="Bond playground" heading="Bond playground" meta={<span className="text-xs text-muted">earned-bond model, threshold {formatToken(T)} TOD</span>} />
      <div className="grid gap-4 px-4 py-6 md:grid-cols-2 md:px-6">
        {SCENES.map((s) => {
          const free = Math.max(0, s.held - T);
          return (
            <Card key={s.name} className="flex flex-col gap-4 p-5">
              <div className="flex items-center justify-between gap-3">
                <Eyebrow>{s.name}</Eyebrow>
                <WithdrawButton disabled={free === 0} why={s.held >= T ? "Nothing above the bond yet" : `${formatToken(T - s.held)} TOD to go`} onClick={() => undefined} />
              </div>
              <BondMeter held={s.held} threshold={T} pending={s.pending} slashes={s.slashes} />
            </Card>
          );
        })}
      </div>
    </div>
  );
}
