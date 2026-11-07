// Competitions contract calls and the commitments they take, encoded the way Competitions.sol hashes them.
import { encodeAbiParameters, encodeFunctionData, keccak256, parseAbi, type Address, type Hex } from "viem";
import { getContracts, tokenAbi, type Call } from "./index";

export const competitionsAbi = parseAbi([
  "function create(uint256 prize, bytes32 labelsHash, uint64 deadline, uint32 revealWindow, uint32 items, string meta, bytes32 nullifier, uint64 passDeadline, bytes passSig) returns (uint256)",
  "function enter(uint256 id, bytes32 commit, bytes32 nullifier, uint64 passDeadline, bytes passSig)",
  "function revealLabels(uint256 id, bytes labels, bytes32 salt)",
  "function revealEntry(uint256 id, address entrant, bytes predictions, bytes32 salt)",
  "function settle(uint256 id)",
  "function claimShare(uint256 id)",
  "error BadInput()", "error BadPass()", "error NotOpen()", "error Closed()", "error NotYet()", "error TooLate()",
  "error HostCannotEnter()", "error AlreadyEntered()", "error NotEntered()", "error WrongReveal()", "error AlreadyDone()",
]);

/** Limits Competitions.sol enforces, checked here first so a bad value never costs a wallet prompt. */
export const LIMITS = { minPrize: 1_000_000, maxItems: 10_000, minWindow: 60, maxWindow: 7 * 86400 } as const;

export type Pass = { wallet: string; nullifier: Hex; deadline: number; signature: Hex };

export function randomSalt(): Hex {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return `0x${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`;
}

/** keccak256(abi.encode(id, entrant, keccak256(predictions), salt)): names the competition and wallet, so it can't be copied. */
export const entryCommit = (id: number, entrant: Address, predictions: Uint8Array, salt: Hex) =>
  keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "address" }, { type: "bytes32" }, { type: "bytes32" }], [BigInt(id), entrant, keccak256(predictions), salt]));

/** keccak256(abi.encode(keccak256(labels), salt)): the answer key's commitment, public until the deadline. */
export const labelsCommit = (labels: Uint8Array, salt: Hex) =>
  keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [keccak256(labels), salt]));

const toHex = (b: Uint8Array): Hex => `0x${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`;

async function at(): Promise<Address> {
  const c = await getContracts();
  if (!c.competitions) throw new Error("This network has no Competitions contract.");
  return c.competitions;
}

const call = async (data: Hex): Promise<Call> => ({ to: await at(), abi: competitionsAbi, data });

export const competitionCalls = {
  approvePrize: async (amount: number): Promise<Call> => {
    const c = await getContracts();
    return { to: c.token, abi: tokenAbi, data: encodeFunctionData({ abi: tokenAbi, functionName: "approve", args: [await at(), BigInt(amount)] }) };
  },
  create: (a: { prize: number; labelsHash: Hex; deadline: number; revealWindow: number; items: number; meta: string; pass: Pass }) =>
    call(encodeFunctionData({ abi: competitionsAbi, functionName: "create", args: [BigInt(a.prize), a.labelsHash, BigInt(a.deadline), a.revealWindow, a.items, a.meta, a.pass.nullifier, BigInt(a.pass.deadline), a.pass.signature] })),
  enter: (id: number, commit: Hex, pass: Pass) =>
    call(encodeFunctionData({ abi: competitionsAbi, functionName: "enter", args: [BigInt(id), commit, pass.nullifier, BigInt(pass.deadline), pass.signature] })),
  revealLabels: (id: number, labels: Uint8Array, salt: Hex) =>
    call(encodeFunctionData({ abi: competitionsAbi, functionName: "revealLabels", args: [BigInt(id), toHex(labels), salt] })),
  revealEntry: (id: number, entrant: Address, predictions: Uint8Array, salt: Hex) =>
    call(encodeFunctionData({ abi: competitionsAbi, functionName: "revealEntry", args: [BigInt(id), entrant, toHex(predictions), salt] })),
  settle: (id: number) => call(encodeFunctionData({ abi: competitionsAbi, functionName: "settle", args: [BigInt(id)] })),
  claimShare: (id: number) => call(encodeFunctionData({ abi: competitionsAbi, functionName: "claimShare", args: [BigInt(id)] })),
};
