// Login layout A from the brand playground: the poster split. Any page that needs a wallet shows the crow on one
// side and what connecting unlocks on the other, with the one primary action. Replaces the plain "Connect to see" state.
"use client";

import type { ReactNode } from "react";
import { Wallet } from "lucide-react";
import { Button } from "@/components/primitives";
import { openConnect } from "@/components/connect";
import { PosterThumb } from "./PosterCard";
import { coverById } from "./figures";

export function ConnectGate({ title, children, figure = "crow", onConnect = openConnect }: { title: string; children: ReactNode; figure?: string; onConnect?: () => void }) {
  return (
    <section aria-label={title} className="mx-4 my-6 grid overflow-hidden border border-rule bg-card md:mx-6 md:grid-cols-2">
      <PosterThumb cover={coverById(figure)} live label={`${coverById(figure).title} poster`} cell={7} className="h-56 border-b border-rule md:h-auto md:min-h-96 md:border-b-0 md:border-r" />
      <div className="flex flex-col justify-center gap-4 p-6 md:p-10">
        <span className="font-mono text-xs uppercase tracking-wide text-mosaic">Sign in · one wallet, no account</span>
        <h2 className="text-2xl font-medium tracking-tight text-ink">{title}</h2>
        <p className="max-w-md text-sm leading-relaxed text-muted">{children}</p>
        <div>
          <Button variant="primary" icon={Wallet} onClick={onConnect}>Connect wallet</Button>
        </div>
        <p className="max-w-md font-mono text-xs leading-relaxed text-subtle">Tessera never asks for a seed phrase. Connecting shares your address only; every payment is a transaction you sign.</p>
      </div>
    </section>
  );
}
