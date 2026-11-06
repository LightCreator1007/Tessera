"use client";
// The live chain behind the wallet and every write: an injected EIP-1193 wallet through viem, contract addresses from the coordinator's /v1/config, and balances read straight from the contracts. Demo mode never touches this module.
import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError, createPublicClient, createWalletClient, custom, decodeAbiParameters, encodeAbiParameters, encodeFunctionData, parseAbi, type Address, type EIP1193Provider, type Hex } from "viem";
import { api } from "@/lib/api/client";
import { CREATE_JOB_ARGS } from "@/lib/api/draft";

/** Only the functions, events and errors the app calls, checked against contracts/src. */
export const marketAbi = parseAbi([
  "function claim()",
  "function claimable(address owner) view returns (uint256)",
  "function claimLeftover(uint256 jobId, address operator)",
  "function withdrawRefund(uint256 jobId)",
  "function abandonJob(uint256 jobId)",
  "error NotAuthorized()", "error WrongState()", "error TooEarly()", "error TooLate()", "error BadInput()", "error StakeTooLow()",
  "error InsufficientBalance()", "error NothingToClaim()",
]);
export const registryAbi = parseAbi([
  "struct Node { address owner; uint128 stake; uint256 busyJob; uint256 busyRound; bool joined; bool customCode; }",
  "function getNode(address operator) view returns (Node)",
  "function depositStake(address operator, uint128 amount)",
  "function withdrawStake(address operator, uint128 amount)",
  "error NotAuthorized()", "error NotJoined()", "error NodeIsBusy()", "error BadInput()",
]);
export const tokenAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);
export const faucetAbi = parseAbi(["function claim()", "error CooldownActive(uint256 nextClaim)", "error EmptyFaucet()"]);

export type Contracts = { chainId: number; market: Address; registry: Address; token: Address; faucet: Address | null };
export type ChainWallet = {
  address: Address | null;
  chainId: number | null;
  /** Connected, but to a network other than the coordinator's. */
  wrongNetwork: boolean;
  tod: number | null;
  eth: number | null;
  /** What JobMarket and NodeRegistry may each pull from the wallet. */
  allowance: { market: number; registry: number } | null;
  claimable: number | null;
  /** The stake on the operator this owner runs, once one is known. */
  stake: number | null;
  error: string | null;
};

const FAUCET = (process.env.NEXT_PUBLIC_FAUCET_ADDRESS || null) as Address | null;
const EMPTY: ChainWallet = { address: null, chainId: null, wrongNetwork: false, tod: null, eth: null, allowance: null, claimable: null, stake: null, error: null };

let contracts: Promise<Contracts> | null = null;
let state: ChainWallet = EMPTY;
let operator: Address | null = null;
let wired = false;
const subs = new Set<() => void>();

function provider(): EIP1193Provider | null {
  if (typeof window === "undefined") return null;
  return ((window as unknown as { ethereum?: EIP1193Provider }).ethereum) ?? null;
}

export function getContracts(): Promise<Contracts> {
  contracts ??= api.config().then(({ data: c }) => ({ chainId: c.chainId, market: c.jobMarket as Address, registry: c.nodeRegistry as Address, token: c.token as Address, faucet: FAUCET }))
    .catch((e) => { contracts = null; throw e; });
  return contracts;
}

function set(patch: Partial<ChainWallet>) {
  state = { ...state, ...patch };
  subs.forEach((f) => f());
}

export function subscribe(f: () => void) {
  wire();
  subs.add(f);
  return () => { subs.delete(f); };
}
export const snapshot = () => state;
export const serverSnapshot = () => EMPTY;

/** Listen to the wallet once: account and network changes re-read everything. */
function wire() {
  const p = provider();
  if (wired || !p) return;
  wired = true;
  p.on("accountsChanged", (a: string[]) => { set({ address: (a[0] as Address) ?? null }); void refresh(); });
  p.on("chainChanged", (id: string) => { set({ chainId: Number(id) }); void refresh(); });
  // Pick up a wallet that is already connected without prompting.
  void p.request({ method: "eth_accounts" }).then((a) => { if (a[0]) { set({ address: a[0] as Address }); void refresh(); } });
}

const units = (v: bigint) => Number(v);

/** Re-read balances, allowances, claimable and stake. Every write calls this after its receipt. */
export async function refresh() {
  const p = provider();
  if (!p || !state.address) return;
  try {
    const [c, chainHex] = await Promise.all([getContracts(), p.request({ method: "eth_chainId" })]);
    const chainId = Number(chainHex);
    if (chainId !== c.chainId) { set({ chainId, wrongNetwork: true, tod: null, eth: null, allowance: null, claimable: null, stake: null, error: null }); return; }
    const pub = createPublicClient({ transport: custom(p) });
    const me = state.address;
    const [tod, eth, aMarket, aRegistry, claimable, node] = await Promise.all([
      pub.readContract({ address: c.token, abi: tokenAbi, functionName: "balanceOf", args: [me] }),
      pub.getBalance({ address: me }),
      pub.readContract({ address: c.token, abi: tokenAbi, functionName: "allowance", args: [me, c.market] }),
      pub.readContract({ address: c.token, abi: tokenAbi, functionName: "allowance", args: [me, c.registry] }),
      pub.readContract({ address: c.market, abi: marketAbi, functionName: "claimable", args: [me] }),
      operator ? pub.readContract({ address: c.registry, abi: registryAbi, functionName: "getNode", args: [operator] }) : Promise.resolve(null),
    ]);
    set({
      chainId, wrongNetwork: false, tod: units(tod), eth: Number(eth) / 1e18, claimable: units(claimable),
      allowance: { market: units(aMarket), registry: units(aRegistry) },
      stake: node && node.owner.toLowerCase() === me.toLowerCase() ? units(node.stake) : null, error: null,
    });
  } catch (e) {
    set({ error: e instanceof Error ? e.message.split("\n")[0] : "Couldn't read the chain." });
  }
}

/** The operator whose stake the wallet should show; the owner panel sets it from the paired node. */
export function watchOperator(op: string | null) {
  const next = (op as Address | null) ?? null;
  if (next === operator) return;
  operator = next;
  void refresh();
}

/** Ask the wallet for an account. A refusal or a missing extension lands in `error` for the connect dialog to show. */
export async function connect() {
  const p = provider();
  if (!p) return set({ error: "No browser wallet found. Install MetaMask or Rabby, then try again." });
  try {
    const a = await p.request({ method: "eth_requestAccounts" });
    set({ address: (a[0] as Address) ?? null, error: null });
    await refresh();
  } catch (e) {
    set({ error: e instanceof BaseError ? e.shortMessage : "The wallet didn't connect." });
  }
}

/** Injected wallets have no disconnect; forgetting the address here is the closest honest thing. */
export function disconnect() {
  set(EMPTY);
}

export async function switchNetwork() {
  const p = provider();
  if (!p) return;
  try {
    const { chainId } = await getContracts();
    await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${chainId.toString(16)}` }] });
  } catch (e) {
    set({ error: e instanceof BaseError ? e.shortMessage : "The wallet didn't switch networks." });
  }
}

/** A write ready to send: where, what, and the ABI its errors decode against. */
export type Call = { to: Address; data: Hex; abi: readonly unknown[] };

export const calls = {
  claim: async (): Promise<Call> => { const c = await getContracts(); return { to: c.market, abi: marketAbi, data: encodeFunctionData({ abi: marketAbi, functionName: "claim" }) }; },
  claimLeftover: async (job: number, op: string): Promise<Call> => { const c = await getContracts(); return { to: c.market, abi: marketAbi, data: encodeFunctionData({ abi: marketAbi, functionName: "claimLeftover", args: [BigInt(job), op as Address] }) }; },
  withdrawRefund: async (job: number): Promise<Call> => { const c = await getContracts(); return { to: c.market, abi: marketAbi, data: encodeFunctionData({ abi: marketAbi, functionName: "withdrawRefund", args: [BigInt(job)] }) }; },
  abandonJob: async (job: number): Promise<Call> => { const c = await getContracts(); return { to: c.market, abi: marketAbi, data: encodeFunctionData({ abi: marketAbi, functionName: "abandonJob", args: [BigInt(job)] }) }; },
  approve: async (spender: "market" | "registry", amount: number): Promise<Call> => { const c = await getContracts(); return { to: c.token, abi: tokenAbi, data: encodeFunctionData({ abi: tokenAbi, functionName: "approve", args: [c[spender], BigInt(amount)] }) }; },
  depositStake: async (op: string, amount: number): Promise<Call> => { const c = await getContracts(); return { to: c.registry, abi: registryAbi, data: encodeFunctionData({ abi: registryAbi, functionName: "depositStake", args: [op as Address, BigInt(amount)] }) }; },
  withdrawStake: async (op: string, amount: number): Promise<Call> => { const c = await getContracts(); return { to: c.registry, abi: registryAbi, data: encodeFunctionData({ abi: registryAbi, functionName: "withdrawStake", args: [op as Address, BigInt(amount)] }) }; },
  faucet: async (): Promise<Call> => {
    const c = await getContracts();
    if (!c.faucet) throw new Error("This app has no faucet address set (NEXT_PUBLIC_FAUCET_ADDRESS).");
    return { to: c.faucet, abi: faucetAbi, data: encodeFunctionData({ abi: faucetAbi, functionName: "claim" }) };
  },
  /** The draft's createJob calldata, re-encoded when part of the budget comes from earnings. */
  createJob: async (calldata: string, fromBalance: number): Promise<Call> => {
    const c = await getContracts();
    const selector = calldata.slice(0, 10) as Hex;
    const [params] = decodeAbiParameters(CREATE_JOB_ARGS, `0x${calldata.slice(10)}`);
    const data = (selector + encodeAbiParameters(CREATE_JOB_ARGS, [params, BigInt(fromBalance)]).slice(2)) as Hex;
    return { to: c.market, abi: marketAbi, data };
  },
};

export type Sent = { phase: "confirmed" | "reverted"; hash: Hex; reason: string | null };
export class Rejected extends Error {}
/** The contract refused before anything was signed: the decoded custom error name, if there is one. */
export class Refused extends Error { constructor(public errorName: string | null, msg: string) { super(msg); } }

/** Simulate, sign, then wait for the receipt. Simulation first means a revert is caught with its reason and never costs gas. */
export async function send(make: () => Promise<Call>, onHash?: (hash: Hex) => void): Promise<Sent> {
  const p = provider();
  if (!p || !state.address) throw new Error("Connect a wallet first.");
  const call = await make();
  const pub = createPublicClient({ transport: custom(p) });
  try {
    await pub.call({ account: state.address, to: call.to, data: call.data });
  } catch (e) {
    throw refusal(e, call.abi);
  }
  const wallet = createWalletClient({ account: state.address, transport: custom(p) });
  let hash: Hex;
  try {
    hash = await wallet.sendTransaction({ to: call.to, data: call.data, chain: null });
  } catch (e) {
    if (e instanceof BaseError && e.walk((x) => x instanceof UserRejectedRequestError)) throw new Rejected("rejected");
    throw e;
  }
  onHash?.(hash);
  const r = await pub.waitForTransactionReceipt({ hash });
  void refresh();
  return r.status === "success" ? { phase: "confirmed", hash, reason: null } : { phase: "reverted", hash, reason: "The transaction reverted on chain after it was sent." };
}

function refusal(e: unknown, abi: readonly unknown[]): Refused {
  if (e instanceof BaseError) {
    const raw = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    if (raw?.data?.errorName) return new Refused(raw.data.errorName, raw.shortMessage);
    const data = (e.walk((x) => typeof (x as { data?: unknown }).data === "string") as { data?: Hex } | null)?.data;
    if (data && data.length >= 10) {
      try {
        const err = new ContractFunctionRevertedError({ abi: abi as never, data, functionName: "call" });
        if (err.data?.errorName) return new Refused(err.data.errorName, err.shortMessage);
      } catch { /* not one of our errors: fall through to the wallet's own words */ }
    }
    return new Refused(null, e.shortMessage);
  }
  return new Refused(null, e instanceof Error ? e.message : "The contract refused this.");
}
