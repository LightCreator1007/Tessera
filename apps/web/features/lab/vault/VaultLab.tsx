// The vault playground page: six motion studies on the mosaic engine, each with its own DialKit panel.
"use client";

import { DialRoot } from "dialkit";
import "dialkit/styles.css";
import { BandLab } from "./BandLab";
import { MisprintLab } from "./MisprintLab";
import { RippleLab } from "./RippleLab";
import { TyperLab } from "./TyperLab";
import { VerdictLab } from "./VerdictLab";
import { WakeLab } from "./WakeLab";

const INDEX = [
  ["V1", "wake", "Pointer wake"],
  ["V2", "verdict", "Verdict grid"],
  ["V3", "misprint", "Misprint"],
  ["V4", "typer", "Typer resolve"],
  ["V5", "ripple", "Accept ripple"],
  ["V6", "band", "Progress band"],
] as const;

export function VaultLab() {
  return (
    <div className="mx-auto max-w-6xl space-y-10 px-4 py-8 md:px-8">
      <header className="space-y-3">
        <p className="font-mono text-xs uppercase tracking-wide text-subtle">Lab · dev only</p>
        <h1 className="text-3xl font-medium tracking-tight text-ink">Vault studies</h1>
        <p className="max-w-2xl text-muted">
          Six techniques from design.how/vault, rebuilt on the mosaic engine in the red ramp. Each one is bound to a value the app already has and plays once per change. Tune them with the dials (top right), then pick what goes into the app.
        </p>
        <nav aria-label="Studies" className="flex flex-wrap gap-2 pt-1">
          {INDEX.map(([n, id, name]) => (
            <a key={id} href={`#${id}`} className="border border-rule px-2.5 py-1 font-mono text-xs text-muted hover:bg-hover hover:text-ink">
              <span className="text-mosaic">{n}</span> {name}
            </a>
          ))}
        </nav>
      </header>
      <WakeLab />
      <VerdictLab />
      <MisprintLab />
      <TyperLab />
      <RippleLab />
      <BandLab />
      <DialRoot position="top-right" theme="dark" defaultOpen={false} />
    </div>
  );
}
