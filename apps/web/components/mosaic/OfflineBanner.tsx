// The coordinator-unreachable banner with the OFFLINE poster going dark beside it. The page keeps its stale data.
"use client";

import { Banner, Button } from "@/components/primitives";
import { StatePoster } from "./StatePoster";

export function OfflineBanner({ onRetry, children }: { onRetry: () => void; children: React.ReactNode }) {
  return (
    <div className="flex items-stretch overflow-hidden rounded-xl border border-rule bg-surface">
      <StatePoster word="OFFLINE" kind="offline" className="hidden w-48 shrink-0 border-r border-rule sm:block" />
      <div className="min-w-0 flex-1 [&>div]:rounded-none [&>div]:border-0">
        <Banner tone="danger" title="Can't reach the coordinator." action={<Button onClick={onRetry}>Retry</Button>}>{children}</Banner>
      </div>
    </div>
  );
}
