"use client";
// Settings as a near-full-page modal (master-detail), preferences only: Wallet, Nodes (each laptop's settings live on its node page), Notifications, Display and, in demo mode, Demo. Opened from the sidebar row under Activity or by openSettings(section); the section is kept in the URL hash so a link can open it.
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Bell, FlaskConical, Laptop, MonitorCog, UserRound, Wallet, X, type LucideIcon } from "lucide-react";
import { setWallet, useWallet, resetWallet } from "@/lib/wallet";
import { calls } from "@/lib/chain";
import { useTx } from "@/lib/tx";
import { applyMotion, applyTxOutcome, setPrefs, usePrefs, type Motion, type NotifyEvent, type TxOutcome } from "@/lib/prefs";
import { resetNodeSettings } from "@/lib/node-settings";
import { isDemo } from "@/lib/api/client";
import { formatToken, TOKEN_SYMBOL } from "@/lib/money";
import { openConnect } from "./connect";
import { Checkbox, SettingRow } from "./fields";
import { TxButton } from "./flow";
import { StatePoster } from "./mosaic/StatePoster";
import { Button, EmptyState, Identicon, Pill, Segmented, cx, short } from "./primitives";
import { networkName } from "@/lib/chain/discover";

type Section = "wallet" | "node" | "notifications" | "display" | "demo";
const SECTIONS: { key: Section; label: string; icon: LucideIcon; hint: string }[] = [
  { key: "wallet", label: "Wallet", icon: Wallet, hint: "Network, token approvals" },
  { key: "node", label: "Nodes", icon: Laptop, hint: "Your laptops and their settings" },
  { key: "notifications", label: "Notifications", icon: Bell, hint: "What tells you, and where" },
  { key: "display", label: "Display", icon: MonitorCog, hint: "Motion, start screen" },
  { key: "demo", label: "Demo", icon: FlaskConical, hint: "Simulated outcomes, reset" },
];
const HASH = "#settings";

let current: Section | null = null;
const subs = new Set<() => void>();
const emit = (s: Section | null) => { current = s; subs.forEach((f) => f()); };

export function openSettings(section: Section = "wallet") {
  history.replaceState(null, "", `${location.pathname}${location.search}${HASH}/${section}`);
  emit(section);
}
function closeSettings() {
  if (location.hash.startsWith(HASH)) history.replaceState(null, "", `${location.pathname}${location.search}`);
  emit(null);
}
function fromHash(): Section | null {
  if (!location.hash.startsWith(HASH)) return null;
  const s = location.hash.slice(HASH.length + 1) as Section;
  return SECTIONS.some((x) => x.key === s) ? s : "wallet";
}

export function SettingsDialog() {
  const section = useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => current, () => null);
  const ref = useRef<HTMLDialogElement>(null);
  const sections = SECTIONS.filter((s) => s.key !== "demo" || isDemo);
  const prefs = usePrefs();
  useEffect(() => { document.documentElement.dataset.txOutcome = prefs.txOutcome === "confirm" ? "" : prefs.txOutcome; }, [prefs.txOutcome]);

  useEffect(() => {
    const sync = () => emit(fromHash());
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (section && !d.open) d.showModal();
    if (!section && d.open) d.close();
  }, [section]);

  // On a phone the sections are one horizontal tab row; keep the open one in view when a link jumps to it.
  useEffect(() => { ref.current?.querySelector("[aria-current=page]")?.scrollIntoView({ block: "nearest", inline: "nearest" }); }, [section]);

  const active = SECTIONS.find((s) => s.key === section) ?? SECTIONS[0];
  return (
    <dialog
      ref={ref}
      aria-labelledby="settings-title"
      onClose={closeSettings}
      onClick={(e) => { if (e.target === e.currentTarget) closeSettings(); }}
      className="connect-dialog m-auto size-settings overflow-hidden rounded-xl border border-rule bg-surface p-0 text-ink shadow-2xl"
    >
      <div className="flex h-full flex-col md:flex-row">
        <nav aria-label="Settings sections" className="flex shrink-0 flex-col gap-1 border-b border-rule bg-sunken p-3 md:w-sidebar md:border-b-0 md:border-r">
          <div className="flex items-center justify-between px-2 pb-2 pt-1">
            <h2 id="settings-title" className="text-lg font-semibold text-ink">Settings</h2>
            <button type="button" onClick={closeSettings} aria-label="Close settings" className="inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-ink md:hidden">
              <X className="size-4" aria-hidden />
            </button>
          </div>
          <ul className="no-scrollbar -m-0.5 flex gap-1 overflow-x-auto p-0.5 md:flex-col">
            {sections.map((s) => {
              const on = s.key === active.key;
              return (
                <li key={s.key} className="shrink-0">
                  <button
                    type="button"
                    aria-current={on ? "page" : undefined}
                    onClick={() => openSettings(s.key)}
                    className={cx("flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors duration-150", on ? "bg-band font-medium text-ink" : "text-muted hover:bg-hover hover:text-ink")}
                  >
                    <s.icon className="size-4 shrink-0" strokeWidth={1.5} aria-hidden />
                    <span className="flex flex-col">
                      {s.label}
                      <span className="hidden text-xs font-normal text-subtle md:block">{s.hint}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <NavAccount />
        </nav>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="flex h-14 shrink-0 items-center justify-between border-b border-rule px-6">
            <h3 className="text-lg font-semibold text-ink">{active.label}</h3>
            <button type="button" onClick={closeSettings} aria-label="Close settings" className="hidden size-8 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-ink md:inline-flex">
              <X className="size-4" aria-hidden />
            </button>
          </header>
          <div key={active.key} className="animate-step-in relative min-h-0 flex-1 overflow-y-auto px-6 pt-5">
            <div className="mx-auto max-w-3xl pb-6">
              {section && active.key === "wallet" && <WalletSection />}
              {section && active.key === "node" && <Nodes />}
              {section && active.key === "notifications" && <Notifications />}
              {section && active.key === "display" && <Display />}
              {section && active.key === "demo" && <Demo />}
            </div>
          </div>
        </div>
      </div>
    </dialog>
  );
}

/** The wallet these settings belong to, with the way to its profile. Desktop only: on a phone the nav is one tab row. */
function NavAccount() {
  const w = useWallet();
  if (!w.connected || !w.address) return null;
  return (
    <Link href="/me" onClick={closeSettings} className="mt-auto hidden items-center gap-2.5 border-t border-rule px-2 pt-3 text-sm hover:text-ink md:flex">
      <Identicon value={w.address} className="size-7" />
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="truncate font-mono text-xs text-ink">{short(w.address)}</span>
        <span className="text-xs text-muted">View profile</span>
      </span>
    </Link>
  );
}

function Group({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col">
      {title && <h4 className="pb-1 text-sm font-medium text-ink">{title}</h4>}
      {children}
    </section>
  );
}

function WalletSection() {
  const w = useWallet();
  if (!w.connected || !w.address) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <StatePoster word="EMPTY" kind="empty" className="h-24 w-full max-w-sm" />
        <p className="text-sm font-medium text-ink">No wallet connected</p>
        <p className="max-w-sm text-sm text-muted">Connect to see the network, your balances and where earnings are paid.</p>
        <Button variant="primary" icon={Wallet} onClick={openConnect}>Connect wallet</Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-8">
      <Group>
        <SettingRow label="Connected wallet">
          <span className="inline-flex items-center gap-2 font-mono text-sm text-ink"><Identicon value={w.address} className="size-5" />{short(w.address, 6, 4)}</span>
          <span className="text-xs text-muted">{formatToken(w.usdc)} {TOKEN_SYMBOL} in the wallet · {formatToken(w.claimable)} earned, unclaimed</span>
          <Link href="/me" onClick={closeSettings} className="inline-flex w-fit items-center gap-1.5 text-xs text-ink underline decoration-subtle underline-offset-4 hover:decoration-ink"><UserRound className="size-3.5" aria-hidden />View profile</Link>
        </SettingRow>
        <SettingRow label="Network" hint="Tessera runs on Base Sepolia while it's a testnet.">
          {w.wrongNetwork ? (
            <span className="flex flex-wrap items-center gap-2"><Pill tone="warn">Wrong network</Pill><Button onClick={w.switchNetwork}>Switch to {networkName(w.targetChainId)}</Button></span>
          ) : <Pill tone="neutral">{networkName(w.targetChainId)}</Pill>}
        </SettingRow>
        <SettingRow label="Token approvals" hint="What the contracts may move from this wallet. Posting a job or adding stake asks for the exact amount; anything left over can be revoked here.">
          <Approval spender="market" label="Job market" />
          <Approval spender="registry" label="Node registry" />
        </SettingRow>
        <SettingRow label="Disconnect" hint="Your node keeps running on the laptop. Reconnect the same wallet to manage it.">
          <Button onClick={w.disconnect}>Disconnect</Button>
        </SettingRow>
      </Group>
    </div>
  );
}

const EVENTS: { key: NotifyEvent; label: string; hint: string; who: "node" | "job" }[] = [
  { key: "penalised", label: "Slashed or missed a reveal", hint: "Your node lost stake or pay", who: "node" },
  { key: "stakeLow", label: "Stake below the minimum", hint: "Rounds stop drawing your node", who: "node" },
  { key: "offline", label: "Offline for 5 minutes", hint: "During a window it promised to work", who: "node" },
  { key: "matched", label: "Drawn into a round", hint: "Can be many a day", who: "node" },
  { key: "paid", label: "Paid for a round", hint: "Once both verifiers replay it", who: "node" },
  { key: "jobDone", label: "Your job finished", hint: "Model and receipts ready", who: "job" },
  { key: "refund", label: "Refund available", hint: "Unspent budget came back", who: "job" },
];
function Notifications() {
  const p = usePrefs();
  const toggle = (e: NotifyEvent, on: boolean) => setPrefs((x) => ({ notify: { ...x.notify, [e]: on ? [...new Set([...x.notify[e], "inApp" as const])] : x.notify[e].filter((y) => y !== "inApp") } }));
  return (
    <div className="flex flex-col gap-8">
      <Group title="In Activity">
        <ul className="flex flex-col">
          {EVENTS.map((e) => (
            <li key={e.key} className="flex items-center justify-between gap-4 border-b border-rule-row py-3 last:border-b-0">
              <span className="flex flex-col gap-0.5 text-sm"><span className="text-ink">{e.label}</span><span className="text-xs text-muted">{e.who === "node" ? "Node" : "Job"} · {e.hint}</span></span>
              <Checkbox label={<span className="sr-only">{`${e.label} in Activity`}</span>} checked={p.notify[e.key].includes("inApp")} onChange={(on) => toggle(e.key, on)} />
            </li>
          ))}
        </ul>
      </Group>
      <p className="text-xs text-muted">Browser push and signed webhooks come next, then email. They need a notification service that doesn&apos;t exist yet, so they aren&apos;t offered here until it does.</p>
    </div>
  );
}

function Display() {
  const p = usePrefs();
  return (
    <div className="flex flex-col gap-8">
      <Group>
        <SettingRow label="Motion" hint="The word mosaic dissolves in and a share of its tiles keep changing words. Reduced draws each poster once and holds it. System follows your device's reduce-motion setting.">
          <Segmented<Motion> label="Motion" items={[{ key: "system", label: "System" }, { key: "full", label: "Full" }, { key: "reduced", label: "Reduced" }]} value={p.motion} onChange={applyMotion} />
        </SettingRow>
        <SettingRow label="Start screen" hint="Once per browser session the app opens on the crow developing while it checks the chain, the coordinator and the blob store.">
          <Checkbox label="Show it" checked={p.splash} onChange={(on) => setPrefs({ splash: on })} />
          {p.splash && p.motion === "reduced" && <p className="text-xs text-muted">Hidden while motion is reduced.</p>}
        </SettingRow>
      </Group>
    </div>
  );
}

function Demo() {
  const p = usePrefs();
  return (
    <Group>
      <SettingRow label="Wallet transactions" hint="What the simulated wallet does when you send a transaction, so every outcome can be walked.">
        <Segmented<TxOutcome> label="Simulated transaction outcome" items={[{ key: "confirm", label: "Confirm" }, { key: "reject", label: "Reject" }, { key: "revert", label: "Revert" }]} value={p.txOutcome} onChange={applyTxOutcome} />
      </SettingRow>
      <SettingRow label="Reset demo data" hint="Clears the demo wallet, your node and its settings in this browser.">
        <Button onClick={() => { resetWallet(); resetNodeSettings(); }}>Reset</Button>
      </SettingRow>
    </Group>
  );
}

/** This wallet's laptops. Schedule, pause and limits are per laptop, so each one's settings live on its node page. */
function Nodes() {
  const w = useWallet();
  if (!w.node) return <EmptyState icon={Laptop} poster="EMPTY" title="No node on this wallet" action={<Link href="/nodes/add" onClick={closeSettings} className="text-sm text-ink underline decoration-subtle underline-offset-4">Add a node</Link>}>A laptop&apos;s schedule, pause and limits appear on its node page once it&apos;s paired.</EmptyState>;
  const n = w.node;
  return (
    <ul className="flex flex-col divide-y divide-rule-row rounded-xl border border-rule">
      <li>
        <Link href={n.joined ? `/nodes/${n.operator}#node-settings` : "/nodes/add"} onClick={closeSettings} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-hover">
          <Identicon value={n.operator} className="size-5" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="font-mono text-sm text-ink">{short(n.operator, 6, 4)}</span>
            <span className="text-xs text-muted">{n.joined ? "Schedule, pause, limits and workloads" : "Paired, not joined. Finish setup first."}</span>
          </span>
          {n.joined ? <Pill tone={n.running ? "ok" : "neutral"} live={n.running}>{n.running ? "running" : "paused"}</Pill> : <Pill tone="warn">setup</Pill>}
          <ArrowRight className="size-4 text-subtle" aria-hidden />
        </Link>
      </li>
    </ul>
  );
}

/** One contract's allowance with a revoke. Revoking sets it to zero; the next job or stake asks again. */
function Approval({ spender, label }: { spender: "market" | "registry"; label: string }) {
  const w = useWallet();
  const tx = useTx();
  const left = w.allowanceTo[spender];
  return (
    <span className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <span className="flex flex-col"><span className="text-ink">{label}</span><span className="font-mono text-xs text-muted">{left > 0 ? `${formatToken(left)} ${TOKEN_SYMBOL} allowed` : "nothing allowed"}</span></span>
      {left > 0 && <TxButton tx={tx} variant="secondary" label="Revoke" onRun={() => tx.send(() => calls.approve(spender, 0), () => setWallet({ allowance: 0 }))} />}
    </span>
  );
}
