"use client";
// The live chain behind the wallet and every write: the browser wallet the person picked (found through EIP-6963) through viem, contract addresses from the coordinator's /v1/config, and balances read straight from the contracts. Demo mode never touches this module.
import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError, createPublicClient, createWalletClient, custom, decodeAbiParameters, encodeAbiParameters, encodeFunctionData, parseAbi, type Address, type EIP1193Provider, type Hex } from "viem";
import { api } from "@/lib/api/client";
import { CREATE_JOB_ARGS } from "@/lib/api/draft";
import { NETWORKS, networkName, providerFor, startDiscovery, whenFound, type Found, type WalletInfo } from "./discover";

export { networkName, type WalletInfo } from "./discover";

/** Only the functions, events and errors the app calls, checked against contracts/src. */
export const marketAbi = parseAbi([
  "function claim()",
  "function claimable(address owner) view returns (uint256)",
  "function claimLeftover(uint256 jobId, address operator)",
  "function withdrawRefund(uint256 jobId)",
  "function abandonJob(uint256 jobId)",
  "function cancelJob(uint256 jobId)",
  "error NotAuthorized()", "error WrongState()", "error TooEarly()", "error TooLate()", "error BadInput()", "error StakeTooLow()",
  "error InsufficientBalance()", "error NothingToClaim()",
]);
export const registryAbi = parseAbi([
  "struct Node { address owner; uint128 stake; uint256 busyJob; uint256 busyRound; bool joined; bool customCode; }",
  "function getNode(address operator) view returns (Node)",
  "function join(address operator, bytes32 nullifier, uint64 inviteDeadline, uint64 consentDeadline, bytes inviteSig, bytes consentSig)",
  "function depositStake(address operator, uint128 amount)",
  "function withdrawStake(address operator, uint128 amount)",
  "error NotAuthorized()", "error NotJoined()", "error NodeIsBusy()", "error BadInput()",
  "error AlreadyJoined()", "error NullifierUsed()", "error Expired()", "error BadSignature()",
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
  /** Reconnecting silently to the wallet used last time; pages wait on this before deciding the person is signed out. */
  restoring: boolean;
  /** The extension this session is using, from EIP-6963. */
  wallet: WalletInfo | null;
  /** The coordinator's network, once read. */
  targetChainId: number | null;
  /** Connected, but to a network other than the coordinator's. */
  wrongNetwork: boolean;
  tod: number | null;
  eth: number | null;
  /** What JobMarket and NodeRegistry may each pull from the wallet. */
  allowance: { market: number; registry: number } | null;
  claimable: number | null;
  /** The stake on the operator this owner runs, once one is known. */
  stake: number | null;
  /** Whether that operator has joined the registry under this owner, once one is known. */
  joined: boolean | null;
  error: string | null;
  /** Why the last connect or network switch didn't go through, sorted for the dialog. */
  connectError: ConnectError | null;
};
export type ConnectError = { kind: "rejected" | "pending" | "missing" | "failed"; message: string };

const FAUCET = (process.env.NEXT_PUBLIC_FAUCET_ADDRESS || null) as Address | null;
const EMPTY: ChainWallet = { restoring: false, wallet: null, targetChainId: null, connectError: null, address: null, chainId: null, wrongNetwork: false, tod: null, eth: null, allowance: null, claimable: null, stake: null, joined: null, error: null };

let contracts: Promise<Contracts> | null = null;
let state: ChainWallet = EMPTY;
let operator: Address | null = null;
let active: Found | null = null;
let unwire: (() => void) | null = null;
let booted = false;
const subs = new Set<() => void>();
/** The wallet picked last time, so a reload reconnects without asking. Cleared on disconnect. */
const REMEMBER = "tod-wallet";

function provider(): EIP1193Provider | null {
  return active?.provider ?? null;
}

const remembered = () => { try { return localStorage.getItem(REMEMBER); } catch { return null; } };
const remember = (rdns: string | null) => {
  try { if (rdns) localStorage.setItem(REMEMBER, rdns); else localStorage.removeItem(REMEMBER); } catch { /* Private mode: a reload asks again, nothing else breaks. */ }
};

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
  boot();
  subs.add(f);
  return () => { subs.delete(f); };
}
export const snapshot = () => state;
export const serverSnapshot = () => EMPTY;

/** First subscriber: find the wallets, and if one was used last time, reconnect to it silently (eth_accounts never prompts). */
function boot() {
  if (booted || typeof window === "undefined") return;
  booted = true;
  startDiscovery();
  void getContracts().then((c) => set({ targetChainId: c.chainId })).catch(() => { /* refresh() reports a coordinator that's down */ });
  const last = remembered();
  if (!last) return;
  set({ restoring: true });
  whenFound(last, (w) => {
    use(w);
    void w.provider.request({ method: "eth_accounts" })
      .then((a) => { if (a[0]) { set({ address: a[0] as Address, restoring: false }); void refresh(); } else { remember(null); set({ restoring: false }); } })
      .catch(() => { remember(null); set({ restoring: false }); });
  }, () => set({ restoring: false }));
}

/** Make this wallet the one every read and write goes through, and follow its account and network changes. */
function use(w: Found) {
  if (active?.provider === w.provider) return;
  unwire?.();
  active = w;
  set({ wallet: { id: w.id, name: w.name, icon: w.icon, rdns: w.rdns } });
  const onAccounts = (a: string[]) => {
    // An empty list means the person disconnected this site from inside the wallet.
    if (!a[0]) { remember(null); set({ ...EMPTY, wallet: state.wallet, targetChainId: state.targetChainId }); return; }
    set({ address: a[0] as Address });
    void refresh();
  };
  const onChain = (id: string) => { set({ chainId: Number(id) }); void refresh(); };
  w.provider.on("accountsChanged", onAccounts);
  w.provider.on("chainChanged", onChain);
  unwire = () => { w.provider.removeListener("accountsChanged", onAccounts); w.provider.removeListener("chainChanged", onChain); };
}

const units = (v: bigint) => Number(v);

/** Re-read balances, allowances, claimable and stake. Every write calls this after its receipt. */
export async function refresh() {
  const p = provider();
  if (!p || !state.address) return;
  try {
    const [c, chainHex] = await Promise.all([getContracts(), p.request({ method: "eth_chainId" })]);
    const chainId = Number(chainHex);
    if (chainId !== c.chainId) { set({ chainId, targetChainId: c.chainId, wrongNetwork: true, tod: null, eth: null, allowance: null, claimable: null, stake: null, joined: null, error: null }); return; }
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
      chainId, targetChainId: c.chainId, wrongNetwork: false, connectError: null, tod: units(tod), eth: Number(eth) / 1e18, claimable: units(claimable),
      allowance: { market: units(aMarket), registry: units(aRegistry) },
      stake: node && node.owner.toLowerCase() === me.toLowerCase() ? units(node.stake) : null,
      // An operator not joined under this wallet reads as false, so a stale "joined" saved in the browser can't skip the Join step.
      joined: node ? node.joined && node.owner.toLowerCase() === me.toLowerCase() : null, error: null,
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

const codeOf = (e: unknown): number | undefined => {
  const x = e as { code?: unknown; data?: { originalError?: { code?: unknown } }; cause?: unknown };
  if (typeof x?.code === "number") return x.code;
  if (typeof x?.data?.originalError?.code === "number") return x.data.originalError.code;
  return x?.cause ? codeOf(x.cause) : undefined;
};

/** Sorts a wallet's refusal by its EIP-1193 code: 4001 is the person saying no, -32002 a request already open in the extension. */
function walletError(e: unknown, fallback: string): ConnectError {
  const code = codeOf(e);
  if (code === 4001) return { kind: "rejected", message: "You closed the request in your wallet." };
  if (code === -32002) return { kind: "pending", message: "A request is already waiting in your wallet. Open the extension to finish it." };
  return { kind: "failed", message: e instanceof BaseError ? e.shortMessage : e instanceof Error ? e.message.split("\n")[0] : fallback };
}

/** Ask one wallet (by its EIP-6963 rdns) for an account. Refusals land in connectError for the dialog to show. */
export async function connect(rdns?: string) {
  boot();
  const w = rdns ? providerFor(rdns) : active;
  if (!w) return set({ connectError: { kind: "missing", message: "That wallet isn't installed in this browser." } });
  use(w);
  set({ connectError: null, error: null });
  try {
    const a = await w.provider.request({ method: "eth_requestAccounts" });
    if (!a[0]) return set({ connectError: { kind: "failed", message: "The wallet didn't share an account." } });
    remember(w.rdns);
    set({ address: a[0] as Address });
    await refresh();
  } catch (e) {
    set({ connectError: walletError(e, "The wallet didn't connect.") });
  }
}

/** Forget this site inside the wallet where it can (MetaMask has wallet_revokePermissions), and always here, so a reload doesn't reconnect. */
export async function disconnect() {
  const p = provider();
  remember(null);
  set({ ...EMPTY, wallet: state.wallet, targetChainId: state.targetChainId });
  if (p) await p.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] } as never).catch(() => { /* Not every wallet has it; forgetting here is enough. */ });
}

/** Move the wallet to the coordinator's network, adding the network first when the wallet has never seen it (error 4902). */
export async function switchNetwork() {
  const p = provider();
  if (!p) return;
  set({ connectError: null });
  let chainId: number;
  try {
    chainId = (await getContracts()).chainId;
  } catch {
    return set({ connectError: { kind: "failed", message: "Couldn't read which network the app runs on." } });
  }
  const hex = `0x${chainId.toString(16)}` as Hex;
  try {
    await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
  } catch (e) {
    const net = NETWORKS[chainId];
    if (codeOf(e) !== 4902 || !net) return set({ connectError: walletError(e, "The wallet didn't switch networks.") });
    try {
      await p.request({
        method: "wallet_addEthereumChain",
        params: [{ chainId: hex, chainName: net.name, rpcUrls: [net.rpc], nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, blockExplorerUrls: net.explorer ? [net.explorer] : undefined }],
      });
    } catch (e2) {
      set({ connectError: walletError(e2, `The wallet didn't add ${networkName(chainId)}.`) });
    }
  }
}

/** A write ready to send: where, what, and the ABI its errors decode against. */
export type Call = { to: Address; data: Hex; abi: readonly unknown[] };

export const calls = {
  claim: async (): Promise<Call> => { const c = await getContracts(); return { to: c.market, abi: marketAbi, data: encodeFunctionData({ abi: marketAbi, functionName: "claim" }) }; },
  claimLeftover: async (job: number, op: string): Promise<Call> => { const c = await getContracts(); return { to: c.market, abi: marketAbi, data: encodeFunctionData({ abi: marketAbi, functionName: "claimLeftover", args: [BigInt(job), op as Address] }) }; },
  withdrawRefund: async (job: number): Promise<Call> => { const c = await getContracts(); return { to: c.market, abi: marketAbi, data: encodeFunctionData({ abi: marketAbi, functionName: "withdrawRefund", args: [BigInt(job)] }) }; },
  cancelJob: async (job: number): Promise<Call> => { const c = await getContracts(); return { to: c.market, abi: marketAbi, data: encodeFunctionData({ abi: marketAbi, functionName: "cancelJob", args: [BigInt(job)] }) }; },
  abandonJob: async (job: number): Promise<Call> => { const c = await getContracts(); return { to: c.market, abi: marketAbi, data: encodeFunctionData({ abi: marketAbi, functionName: "abandonJob", args: [BigInt(job)] }) }; },
  approve: async (spender: "market" | "registry", amount: number): Promise<Call> => { const c = await getContracts(); return { to: c.token, abi: tokenAbi, data: encodeFunctionData({ abi: tokenAbi, functionName: "approve", args: [c[spender], BigInt(amount)] }) }; },
  join: async (i: { operator: string; nullifier: string; inviteDeadline: number; consentDeadline: number; inviteSig: string; consentSig: string }): Promise<Call> => {
    const c = await getContracts();
    return { to: c.registry, abi: registryAbi, data: encodeFunctionData({ abi: registryAbi, functionName: "join", args: [i.operator as Address, i.nullifier as Hex, BigInt(i.inviteDeadline), BigInt(i.consentDeadline), i.inviteSig as Hex, i.consentSig as Hex] }) };
  },
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
