"use client";
// Query hooks and keys. Poll intervals follow how fast each value changes: health and the current round fast, history slow.
import { useQuery } from "@tanstack/react-query";
import { api, ApiError, node } from "./client";

const LIVE = 5_000;
const SLOW = 30_000;

// Only an unreachable coordinator or a 5xx is worth retrying; a 404, a 503 "switched off" or a bad request will say the same again.
export const retry = (n: number, e: unknown) => n < 2 && e instanceof ApiError && (e.kind === "unreachable" || e.kind === "server");

export const useConfig = () => useQuery({ queryKey: ["config"], queryFn: api.config, staleTime: Infinity });
export const useHealth = () => useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 15_000, retry: 0 });
export const usePool = () => useQuery({ queryKey: ["pool"], queryFn: api.pool, refetchInterval: SLOW , retry });
export const useJobs = () => useQuery({ queryKey: ["jobs"], queryFn: api.jobs, refetchInterval: SLOW , retry });
export const useJob = (id: number) => useQuery({ queryKey: ["job", id], queryFn: () => api.job(id), refetchInterval: LIVE , retry });
export const useJobState = (id: number) => useQuery({ queryKey: ["job", id, "state"], queryFn: () => api.jobState(id), refetchInterval: SLOW, enabled: Number.isFinite(id) , retry });
export const useRounds = (id: number) => useQuery({ queryKey: ["job", id, "rounds"], queryFn: () => api.rounds(id), refetchInterval: LIVE , retry });
export const useRound = (id: number, r: number | null) => useQuery({ queryKey: ["job", id, "round", r], queryFn: () => api.round(id, r!), enabled: r !== null, refetchInterval: LIVE , retry });
export const useEvidence = (id: number, r: number) => useQuery({ queryKey: ["job", id, "round", r, "evidence"], queryFn: () => api.evidence(id, r) , retry });
// The settlement only exists once the round is being settled, so a 404 or 409 before then is expected and not retried.
export const useSettlement = (id: number, r: number) => useQuery({ queryKey: ["job", id, "round", r, "settlement"], queryFn: () => api.settlement(id, r), refetchInterval: LIVE, retry: 0 });
export const useVerdicts = (id: number, r: number | null) => useQuery({ queryKey: ["job", id, "round", r, "verdicts"], queryFn: () => api.verdicts(id, r!), enabled: r !== null });
export const useSpec = (id: number, want: string) => useQuery({ queryKey: ["job", id, "spec", want], queryFn: () => api.spec(id, want), staleTime: Infinity, retry });
export const useWorkloads = () => useQuery({ queryKey: ["workloads"], queryFn: api.workloads, staleTime: 300_000, retry });
export const useModels = () => useQuery({ queryKey: ["models"], queryFn: api.models, refetchInterval: SLOW, retry });

// The local node. Polled fast because it is on this machine; no retries, the next poll is the retry.
export const useNodeStatus = () => useQuery({ queryKey: ["node", "status"], queryFn: node.status, refetchInterval: 3_000, retry: 0 });
export const useNodeHealth = () => useQuery({ queryKey: ["node", "health"], queryFn: node.health, refetchInterval: 5_000, retry: 0 });
export const useNodes = () => useQuery({ queryKey: ["nodes"], queryFn: api.nodes, refetchInterval: SLOW , retry });
export const useNodeChain = (op: string, enabled = true) => useQuery({ queryKey: ["nodeChain", op], queryFn: () => api.nodeChain(op), enabled });
