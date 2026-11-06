// One place that turns a failed read into words: missing, switched off, a broken upstream, or no answer at all.
"use client";
import type { ReactNode } from "react";
import { CircleOff, CloudOff, SearchX, ServerCrash, type LucideIcon } from "lucide-react";
import { ApiError, type ErrorKind } from "@/lib/api/client";
import { Button, EmptyState } from "./primitives";

const COPY: Record<ErrorKind, { icon: LucideIcon; title: string; body: string }> = {
  not_found: { icon: SearchX, title: "Not here", body: "The coordinator has no record of this." },
  off: { icon: CircleOff, title: "Switched off on this coordinator", body: "This coordinator runs without this feature. Nothing is broken." },
  upstream: { icon: ServerCrash, title: "A service behind the coordinator failed", body: "The coordinator answered, but something it depends on didn't. Try again in a minute." },
  unreachable: { icon: CloudOff, title: "No answer from the coordinator", body: "It may be restarting, or this machine may be offline. Contract data is still on chain." },
  bad_input: { icon: SearchX, title: "The coordinator refused this request", body: "This usually means a malformed link." },
  server: { icon: ServerCrash, title: "The coordinator hit an error", body: "Its log has the details. Try again in a minute." },
};

export const errorKind = (e: unknown): ErrorKind => (e instanceof ApiError ? e.kind : "server");

/** Empty state for a failed query. `overrides` lets a screen say "Job #12 isn't here" instead of "Not here". */
export function Problem({ error, retry, overrides, action }: {
  error: unknown;
  retry?: () => void;
  overrides?: Partial<Record<ErrorKind, { title?: string; body?: ReactNode }>>;
  action?: ReactNode;
}) {
  const kind = errorKind(error);
  const c = COPY[kind];
  const o = overrides?.[kind];
  const canRetry = retry && (kind === "unreachable" || kind === "upstream" || kind === "server");
  return (
    <EmptyState icon={c.icon} title={o?.title ?? c.title} action={action ?? (canRetry ? <Button onClick={retry}>Try again</Button> : undefined)}>
      {o?.body ?? c.body}
    </EmptyState>
  );
}
