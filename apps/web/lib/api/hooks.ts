"use client";
// Query hooks and keys. Poll intervals follow how fast each value changes: health and the current round fast, history slow.
import { useQuery } from "@tanstack/react-query";
import { api } from "./client";

const LIVE = 5_000;
const SLOW = 30_000;

export const useConfig = () => useQuery({ queryKey: ["config"], queryFn: api.config, staleTime: Infinity });
export const useHealth = () => useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 15_000, retry: 0 });
export const usePool = () => useQuery({ queryKey: ["pool"], queryFn: api.pool, refetchInterval: SLOW });
export const useJobs = () => useQuery({ queryKey: ["jobs"], queryFn: api.jobs, refetchInterval: SLOW });
export const useJob = (id: number) => useQuery({ queryKey: ["job", id], queryFn: () => api.job(id), refetchInterval: LIVE });
export const useJobState = (id: number) => useQuery({ queryKey: ["job", id, "state"], queryFn: () => api.jobState(id), refetchInterval: SLOW, enabled: Number.isFinite(id) });
export const useRounds = (id: number) => useQuery({ queryKey: ["job", id, "rounds"], queryFn: () => api.rounds(id), refetchInterval: LIVE });
export const useRound = (id: number, r: number | null) => useQuery({ queryKey: ["job", id, "round", r], queryFn: () => api.round(id, r!), enabled: r !== null, refetchInterval: LIVE });
export const useEvidence = (id: number, r: number) => useQuery({ queryKey: ["job", id, "round", r, "evidence"], queryFn: () => api.evidence(id, r) });
// The settlement only exists once the round is being settled, so a 404 or 409 before then is expected and not retried.
export const useSettlement = (id: number, r: number) => useQuery({ queryKey: ["job", id, "round", r, "settlement"], queryFn: () => api.settlement(id, r), refetchInterval: LIVE, retry: 0 });
export const useVerdicts = (id: number, r: number | null) => useQuery({ queryKey: ["job", id, "round", r, "verdicts"], queryFn: () => api.verdicts(id, r!), enabled: r !== null });
export const useSpec = (id: number) => useQuery({ queryKey: ["job", id, "spec"], queryFn: () => api.spec(id), staleTime: Infinity });
export const useNodes = () => useQuery({ queryKey: ["nodes"], queryFn: api.nodes, refetchInterval: SLOW });
export const useNodeChain = (op: string, enabled = true) => useQuery({ queryKey: ["nodeChain", op], queryFn: () => api.nodeChain(op), enabled });
