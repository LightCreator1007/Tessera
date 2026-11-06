"use client";
// The excluded-owner notice (spans only: Banner wraps its body in a <p>): why the team keeps this owner out of new rounds, the confirmed failures behind it, what still works, and how to dispute it.
import Link from "next/link";
import { useOwnerIdentity } from "@/lib/api/hooks";
import { Banner } from "@/components/primitives";

const DISPUTE = "https://github.com/LightCreator1007/ToD/issues/new";
const KIND: Record<string, string> = { ReplayMismatch: "replay didn't match", DataUnavailable: "upload couldn't be fetched", ReplayDrift: "replay drifted" };

/** What this owner can still do, worded for the screen it sits on. */
const STILL = {
  node: "Rounds already in progress settle as normal, and your stake can be withdrawn once the node is idle.",
  join: "A new laptop or a new wallet won't get round this: the exclusion follows the World ID behind it.",
  balance: "Pay you already earned is still yours. Claiming and withdrawing work as before.",
} as const;

/** Renders nothing unless the coordinator reports this owner excluded. A coordinator without the identity route also renders nothing. */
export function ExcludedNotice({ owner, on }: { owner: string | null; on: keyof typeof STILL }) {
  const id = useOwnerIdentity(owner);
  const ex = id.data?.data.excluded;
  if (!ex) return null;
  return (
    <Banner tone="danger" title={on === "join" ? "This wallet can't join the pool" : "This owner is excluded from new rounds"}>
      <span className="flex w-full flex-col gap-2 text-sm">
        <span className="block text-ink">{ex.reason}</span>
        {ex.evidence.length > 0 && (
          <span className="block text-muted">
            Verifiers confirmed {ex.evidence.length === 1 ? "this failure" : "these failures"} on chain:{" "}
            {ex.evidence.map((e, i) => (
              <span key={`${e.job}:${e.round}:${e.operator}`}>
                {i > 0 && ", "}
                <Link href={`/jobs/${e.job}/rounds/${e.round}`} className="text-ink underline decoration-subtle underline-offset-4">job #{e.job}, round {e.round}</Link>
                {` (${KIND[e.kind] ?? e.kind})`}
              </span>
            ))}
            .
          </span>
        )}
        <span className="block text-muted">{STILL[on]} This is the team&apos;s call, not an onchain ban, and they can lift it.{" "}
          <a href={DISPUTE} target="_blank" rel="noreferrer" className="text-ink underline decoration-subtle underline-offset-4">Dispute it with the rounds above</a>.
        </span>
      </span>
    </Banner>
  );
}
