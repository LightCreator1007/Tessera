// RLCompetitions contract calls and the commitments they take, encoded the way RLCompetitions.sol hashes them.
import { encodeAbiParameters, encodeFunctionData, keccak256, parseAbi, type Address, type Hex } from "viem";
import { getContracts, tokenAbi, type Call } from "./index";
import type { Pass } from "./competitions";

export const rlAbi = parseAbi([
  "function create(uint256 prize, bytes32 env, uint16 episodes, uint32 maxSteps, bytes32 seedsHash, uint64 deadline, uint32 revealWindow, string meta, bytes32 nullifier, uint64 passDeadline, bytes passSig) returns (uint256)",
  "function enter(uint256 id, bytes32 commit, bytes32 nullifier, uint64 passDeadline, bytes passSig)",
  "function revealSeeds(uint256 id, uint64[] seeds, bytes32 salt)",
  "function revealPolicy(uint256 id, address entrant, bytes32 policy, bytes32 salt)",
  "function submitScore(uint256 id, address entrant, int64 score, bytes[] sigs)",
  "function settle(uint256 id)",
  "function claimShare(uint256 id)",
  "error BadInput()", "error BadPass()", "error BadSignature()", "error NotOpen()", "error Closed()", "error NotYet()", "error TooLate()",
  "error HostCannotEnter()", "error AlreadyEntered()", "error NotEntered()", "error WrongReveal()", "error AlreadyDone()",
]);

/** Limits RLCompetitions.sol enforces, checked here first so a bad value never costs a wallet prompt. */
export const RL_LIMITS = { minPrize: 1_000_000, minWindow: 60, maxWindow: 7 * 86400, maxSeeds: 64, maxEpisodes: 100, maxSteps: 1_000_000, scale: 1000 } as const;

export async function sha256Of(bytes: Uint8Array): Promise<Hex> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
  return `0x${Array.from(d, (x) => x.toString(16).padStart(2, "0")).join("")}`;
}

/** keccak256(abi.encode(keccak256(abi.encode(seeds)), salt)): the hidden evaluation seeds' commitment. */
export const seedsCommit = (seeds: number[], salt: Hex) =>
  keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [keccak256(encodeAbiParameters([{ type: "uint64[]" }], [seeds.map(BigInt)])), salt]));

/** keccak256(abi.encode(id, entrant, policySha256, salt)): names the competition and wallet, so it can't be copied. */
export const policyCommit = (id: number, entrant: Address, policy: Hex, salt: Hex) =>
  keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "address" }, { type: "bytes32" }, { type: "bytes32" }], [BigInt(id), entrant, policy, salt]));

async function at(): Promise<Address> {
  const c = await getContracts();
  if (!c.rlCompetitions) throw new Error("This network has no RLCompetitions contract.");
  return c.rlCompetitions;
}

const call = async (data: Hex): Promise<Call> => ({ to: await at(), abi: rlAbi, data });

export const rlCalls = {
  approvePrize: async (amount: number): Promise<Call> => {
    const c = await getContracts();
    return { to: c.token, abi: tokenAbi, data: encodeFunctionData({ abi: tokenAbi, functionName: "approve", args: [await at(), BigInt(amount)] }) };
  },
  create: (a: { prize: number; env: Hex; episodes: number; maxSteps: number; seedsHash: Hex; deadline: number; revealWindow: number; meta: string; pass: Pass }) =>
    call(encodeFunctionData({ abi: rlAbi, functionName: "create", args: [BigInt(a.prize), a.env, a.episodes, a.maxSteps, a.seedsHash, BigInt(a.deadline), a.revealWindow, a.meta, a.pass.nullifier, BigInt(a.pass.deadline), a.pass.signature] })),
  enter: (id: number, commit: Hex, pass: Pass) =>
    call(encodeFunctionData({ abi: rlAbi, functionName: "enter", args: [BigInt(id), commit, pass.nullifier, BigInt(pass.deadline), pass.signature] })),
  revealSeeds: (id: number, seeds: number[], salt: Hex) =>
    call(encodeFunctionData({ abi: rlAbi, functionName: "revealSeeds", args: [BigInt(id), seeds.map(BigInt), salt] })),
  revealPolicy: (id: number, entrant: Address, policy: Hex, salt: Hex) =>
    call(encodeFunctionData({ abi: rlAbi, functionName: "revealPolicy", args: [BigInt(id), entrant, policy, salt] })),
  submitScore: (id: number, entrant: Address, score: number, sigs: Hex[]) =>
    call(encodeFunctionData({ abi: rlAbi, functionName: "submitScore", args: [BigInt(id), entrant, BigInt(score), sigs] })),
  settle: (id: number) => call(encodeFunctionData({ abi: rlAbi, functionName: "settle", args: [BigInt(id)] })),
  claimShare: (id: number) => call(encodeFunctionData({ abi: rlAbi, functionName: "claimShare", args: [BigInt(id)] })),
};
