"use client";
// The "one person" step inside another flow: verified shows the credential, otherwise one action that goes to the World ID page and comes back here.
import { usePathname } from "next/navigation";
import { ScanFace } from "lucide-react";
import { ButtonLink, Pill } from "@/components/primitives";
import { CREDENTIAL_LABEL, useHuman } from "@/lib/identity";

export function HumanGate({ intro }: { intro: string }) {
  const h = useHuman();
  const here = usePathname();
  if (h.loading) return <span className="font-mono text-xs text-subtle">checking</span>;
  if (h.verified) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone="ok">one person</Pill>
        {h.status?.credential && <span className="font-mono text-xs text-muted">{CREDENTIAL_LABEL[h.status.credential]}</span>}
      </div>
    );
  }
  return (
    <div className="flex flex-col items-start gap-3">
      <p className="max-w-md text-sm leading-relaxed text-muted">{intro}</p>
      <ButtonLink variant="primary" icon={ScanFace} href={`/join/verify?next=${encodeURIComponent(here)}`}>Verify with World ID</ButtonLink>
      <span className="text-xs text-subtle">A selfie in World App, about a minute. You come back here after.</span>
    </div>
  );
}
