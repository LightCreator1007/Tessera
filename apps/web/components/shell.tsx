"use client";
// App frame in the Neatlogs layout: an 8px inset, the sidebar (brand, the New job split button, get started, one nav for everyone, docs, the activity link, settings, status line, wallet) and one bordered main panel. One workspace (REVAMP-3): "yours" is a scope on each page, not a nav group.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Bell, BookOpen, ChevronDown, ChevronsUpDown, Coins, Cpu, House, Laptop, Layers, LogOut, Trophy, Menu,
  PanelLeftClose, PanelLeftOpen, Plus, Rocket, Settings, Terminal, UserRound, Wallet, X, Boxes, type LucideIcon,
} from "lucide-react";
import { useWallet } from "@/lib/wallet";
import { ConnectDialog, openConnect } from "./connect";
import { SettingsDialog, openSettings } from "./settings";
import { useHealth } from "@/lib/api/hooks";
import { useActivity, useSeen } from "@/features/activity/useActivity";
import { isDemo } from "@/lib/api/client";
import { formatToken, TOKEN_SYMBOL } from "@/lib/money";
import { Button, Count, Identicon, MenuItem, Money, Popover, cx, short } from "./primitives";
import { Flap, useGain } from "./mosaic/Flap";
import { BrandMark } from "./brand";

export function Providers({ children }: { children: ReactNode }) {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 4_000, refetchOnWindowFocus: false } } }));
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

type NavItem = { href: string; label: string; icon: LucideIcon; match: (p: string) => boolean };
const NAV: NavItem[] = [
  { href: "/", label: "home", icon: House, match: (p) => p === "/" },
  { href: "/jobs", label: "jobs", icon: Layers, match: (p) => p.startsWith("/jobs") && p !== "/jobs/new" },
  { href: "/nodes", label: "nodes", icon: Cpu, match: (p) => p.startsWith("/nodes") && p !== "/nodes/add" },
  { href: "/models", label: "models", icon: Boxes, match: (p) => p.startsWith("/models") },
  { href: "/competitions", label: "competitions", icon: Trophy, match: (p) => p.startsWith("/competitions") && p !== "/competitions/new" },
  { href: "/balance", label: "balance", icon: Coins, match: (p) => p.startsWith("/balance") },
];
const HELP: NavItem[] = [
  { href: "/docs", label: "docs", icon: BookOpen, match: (p) => p.startsWith("/docs") && p !== "/docs/cli" },
  { href: "/docs/cli", label: "cli", icon: Terminal, match: (p) => p === "/docs/cli" },
];

/** Window event the playground's Sidebar dials fire to toggle the rail. */
export const RAIL_TOGGLE = "tod:rail-toggle";
const root = () => document.documentElement;
const peekEnabled = () => root().dataset.railPeek !== "off";

function useCollapsed() {
  const [c, setC] = useState(false);
  useEffect(() => setC(root().dataset.rail === "collapsed"), []);
  const set = (v: boolean) => {
    setC(v);
    root().dataset.rail = v ? "collapsed" : "open";
    localStorage.setItem("rail", v ? "1" : "0");
  };
  return [c, set] as const;
}

/** narrow: the rail is showing icons only (collapsed and not peeking). Tooltips and inert labels key off it. */
const Rail = createContext({ narrow: false });

export function AppFrame({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useCollapsed();
  const [peek, setPeek] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const path = usePathname();
  useEffect(() => { setOpen(false); setPeek(false); }, [path]);

  const toggle = () => { setPeek(false); setCollapsed(!collapsed); };
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "Escape") setPeek(false);
      if (e.key !== "[" || e.metaKey || e.ctrlKey || e.altKey || t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      e.preventDefault();
      toggleRef.current();
    };
    const ext = () => toggleRef.current();
    window.addEventListener("keydown", key);
    window.addEventListener(RAIL_TOGGLE, ext);
    return () => { window.removeEventListener("keydown", key); window.removeEventListener(RAIL_TOGGLE, ext); };
  }, []);

  // Hover intent: a pass over the rail on the way to the page should not open it; resting on it should.
  const enter = () => {
    if (!collapsed || !peekEnabled()) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setPeek(true), Number(root().dataset.railPeekDelay || 350));
  };
  const leave = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setPeek(false), 120);
  };

  // The marketing site renders full-bleed, outside the app rail.
  if (path?.startsWith("/landing")) return <>{children}</>;

  return (
    <div className="min-h-dvh bg-sunken md:flex md:h-dvh md:gap-0 md:p-2">
      <aside data-peek={peek || undefined} className="rail-aside relative hidden shrink-0 md:block">
        <div onMouseEnter={enter} onMouseLeave={leave} className="rail-panel absolute inset-y-0 left-0 z-40 bg-sunken">
          <Rail.Provider value={{ narrow: collapsed && !peek }}>
            <Sidebar collapsed={collapsed} onToggle={toggle} />
          </Rail.Provider>
        </div>
      </aside>
      <MobileBar onMenu={() => setOpen(true)} />
      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 animate-fade-in bg-sunken/70" onClick={() => setOpen(false)} aria-hidden />
          <aside className="absolute inset-y-0 left-0 w-sidebar animate-fade-in border-r border-rule bg-sunken">
            <button type="button" onClick={() => setOpen(false)} aria-label="Close menu" className="absolute right-3 top-3 z-10 inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-band">
              <X className="size-4" />
            </button>
            <Sidebar collapsed={false} />
          </aside>
        </div>
      )}
      <main id="main" className="min-w-0 flex-1 bg-surface md:overflow-y-auto md:rounded-xl md:border md:border-rule">
        {children}
      </main>
      <ConnectDialog />
      <SettingsDialog />
    </div>
  );
}

function MobileBar({ onMenu }: { onMenu: () => void }) {
  const w = useWallet();
  return (
    <header className="sticky top-0 z-30 flex h-11 items-center gap-2 border-b border-rule bg-sunken px-3 md:hidden">
      <button type="button" onClick={onMenu} aria-label="Open menu" className="inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-band">
        <Menu className="size-4" />
      </button>
      <Link href="/" className="flex items-center gap-2">
        <BrandMark className="size-6 p-1" />
        <span className="text-sm font-medium text-ink">Tessera</span>
      </Link>
      <span className="ml-auto">
        {w.connected && w.address ? <Link href="/me" aria-label="Your profile"><Identicon value={w.address} className="size-6" /></Link> : <Button onClick={openConnect}>Connect</Button>}
      </span>
    </header>
  );
}

/** Every rail row: a fixed 20px icon slot 12px from the edge, then a label that fades. Same geometry in both states. */
const ROW = "flex h-8 w-full items-center gap-2.5 overflow-hidden whitespace-nowrap rounded-sm px-3 text-sm";
const HOVER = "transition-colors duration-150 hover:bg-band hover:text-ink";

function Slot({ children }: { children: ReactNode }) {
  return <span className="relative grid size-5 shrink-0 place-items-center">{children}</span>;
}

function Label({ children, className }: { children: ReactNode; className?: string }) {
  const { narrow } = useContext(Rail);
  return <span inert={narrow} className={cx("rail-label flex min-w-0 flex-1 items-center gap-2", className)}>{children}</span>;
}

// Warm tooltips: once one has shown, the next opens at once, so scanning the rail reads like a list, not a wait per icon.
let warmUntil = 0;

/** Tooltip for the icon-only rail. Hover shows it only when peek is off (peek already reveals the labels); keyboard focus always shows it. */
function Tip({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  const { narrow } = useContext(Rail);
  const [show, setShow] = useState(false);
  const t = useRef<number | undefined>(undefined);
  useEffect(() => { if (!narrow) setShow(false); }, [narrow]);
  const open = (delay: number) => {
    window.clearTimeout(t.current);
    t.current = window.setTimeout(() => setShow(true), delay);
  };
  const close = () => {
    window.clearTimeout(t.current);
    if (show) warmUntil = Date.now() + 300;
    setShow(false);
  };
  return (
    <div
      className={cx("relative", className)}
      onMouseEnter={() => { if (narrow && !peekEnabled()) open(Date.now() < warmUntil ? 0 : 450); }}
      onMouseLeave={close}
      onMouseDown={close}
      onFocus={(e) => { if (narrow && (e.target as HTMLElement).matches(":focus-visible")) open(0); }}
      onBlur={close}
    >
      {children}
      {narrow && show && (
        <span aria-hidden className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 flex animate-tip-in items-center gap-2 whitespace-nowrap rounded-md border border-rule bg-raised px-2 py-1 text-xs text-ink shadow-popover">
          {label}
          {hint && <span className="text-subtle">{hint}</span>}
        </span>
      )}
    </div>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-xs border border-rule px-1 font-mono text-xs text-muted">{children}</kbd>;
}

function NavLink({ item }: { item: NavItem }) {
  const path = usePathname();
  const on = item.match(path);
  return (
    <Tip label={item.label}>
      <Link href={item.href} aria-current={on ? "page" : undefined} className={cx(ROW, on ? "bg-band font-medium text-ink" : cx("text-muted", HOVER))}>
        <Slot><item.icon className="size-5" strokeWidth={1} aria-hidden /></Slot>
        <Label>{item.label}</Label>
      </Link>
    </Tip>
  );
}

function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle?: () => void }) {
  const w = useWallet();
  const { narrow } = useContext(Rail);
  // Training first: connect, then post a job. Adding a node is offered, never required, so it is not a step here.
  const done = [w.connected, w.postedJobs.length > 0];
  const doneCount = done.filter(Boolean).length;
  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;
  const toggleLabel = collapsed ? "Expand sidebar" : "Collapse sidebar";
  return (
    <div className="flex h-full min-h-dvh flex-col gap-3 px-2 pb-2 pt-1.5 md:min-h-0 md:pl-0 md:pr-2">
      <div className="flex h-10 items-center">
        {narrow && onToggle ? (
          <Tip label={toggleLabel} hint={<Kbd>[</Kbd>} className="min-w-0 flex-1">
            <button type="button" onClick={onToggle} aria-label={toggleLabel} className={cx(ROW, "group/brand text-muted", HOVER)}>
              <Slot>
                <BrandMark className="-m-0.5 size-6 p-1 transition-opacity duration-150 group-hover/brand:opacity-0 group-focus-visible/brand:opacity-0" />
                <ToggleIcon className="absolute size-4 opacity-0 transition-opacity duration-150 group-hover/brand:opacity-100 group-focus-visible/brand:opacity-100" strokeWidth={1.5} aria-hidden />
              </Slot>
            </button>
          </Tip>
        ) : (
          <Link href="/" aria-label="Tessera home" className={cx(ROW, "min-w-0 flex-1 rounded-md")}>
            <Slot><BrandMark className="-m-0.5 size-6 p-1" /></Slot>
            <Label className="text-lg font-semibold tracking-tight text-ink">Tessera</Label>
          </Link>
        )}
        {onToggle && (
          <span inert={narrow} className="rail-label rail-wide">
            <button type="button" onClick={onToggle} aria-label={toggleLabel} title={`${toggleLabel} ( [ )`} className="inline-flex size-7 items-center justify-center rounded-sm text-muted transition-colors duration-150 hover:bg-band hover:text-ink">
              <ToggleIcon className="size-4" strokeWidth={1.5} />
            </button>
          </span>
        )}
      </div>

      <NewMenu />

      {doneCount < 2 && (
        <Tip label="get started" hint={`${doneCount}/2`}>
          <Link
            href="/docs/train"
            title={narrow ? undefined : "Connect a wallet, then post your first training job"}
            className={cx(ROW, "h-9 rounded-md border border-brand-line bg-brand-soft text-ink transition-opacity duration-150 hover:opacity-90")}
          >
            <Slot><Rocket className="size-4 text-brand" strokeWidth={1.5} aria-hidden /></Slot>
            <Label>get started<Count className="ml-auto">{doneCount}/2</Count></Label>
          </Link>
        </Tip>
      )}

      <nav className="flex flex-col gap-1" aria-label="Primary">
        {NAV.map((n) => <NavLink key={n.href} item={n} />)}
      </nav>

      <nav className="flex flex-col gap-1 border-t border-rule pt-3" aria-label="Help">
        {HELP.map((n) => <NavLink key={n.href} item={n} />)}
      </nav>

      <div className="mt-auto flex flex-col gap-1">
        <Activity />
        <SettingsRow />
        <StatusLine />
        <WalletRow />
      </div>
    </div>
  );
}

/** Split button: the primary action is always a training job; the chevron holds the secondary path, adding a node. On the rail the chevron folds away and the tile is the primary action alone. */
function NewMenu() {
  const w = useWallet();
  const { narrow } = useContext(Rail);
  const earnings = w.connected && w.claimable > 0 ? `${formatToken(w.claimable)} ${TOKEN_SYMBOL} of earnings can pay for it` : "Lock a budget; idle laptops train it";
  const shell = "flex h-8 items-center bg-accent text-sm font-medium text-accent-ink shadow-cta transition-opacity duration-150 hover:opacity-90";
  return (
    <Popover
      width="w-menu"
      trigger={({ open, toggle, ref }) => (
        <div className="flex w-full">
          <Tip label="New job" className="min-w-0 flex-1">
            <Link href="/jobs/new" className={cx(shell, "w-full gap-2.5 overflow-hidden whitespace-nowrap rounded-l-md px-3", narrow && "rounded-r-md")}>
              <Slot><Plus className="size-4" strokeWidth={1.5} aria-hidden /></Slot>
              <Label>New job</Label>
            </Link>
          </Tip>
          <button ref={ref} type="button" onClick={toggle} aria-expanded={open} aria-haspopup="menu" aria-label="More ways to start" className={cx(shell, "rail-wide rounded-r-md border-l border-accent-ink/15 px-2")}>
            <ChevronDown className="size-3.5" aria-hidden />
          </button>
        </div>
      )}
    >
      {(close) => (
        <div role="menu" className="flex flex-col">
          <MenuItem icon={Layers} title="New training job" hint={earnings} href="/jobs/new" onClick={close} />
          <MenuItem icon={Laptop} title="Add a node" hint="Your laptop trains verified jobs; earnings pay for your own" href="/nodes/add" onClick={close} />
          <MenuItem icon={Trophy} title="Host a competition" hint="Commit your labels; nobody can change the scoring after" href="/competitions/new" onClick={close} />
        </div>
      )}
    </Popover>
  );
}

/** Activity is a page now; the row carries what is new since your last visit there. */
function Activity() {
  const path = usePathname();
  const on = path.startsWith("/activity");
  const seen = useSeen();
  const n = useActivity(seen).unread;
  return (
    <Tip label="activity" hint={n > 0 ? `${n} new` : undefined}>
      <Link href="/activity" aria-current={on ? "page" : undefined} aria-label={n > 0 ? `activity, ${n} new` : "activity"} className={cx(ROW, on ? "bg-band font-medium text-ink" : cx("text-muted", HOVER))}>
        <Slot>
          <Bell className="size-5" strokeWidth={1} aria-hidden />
          {n > 0 && <span className="rail-dot absolute -right-0.5 -top-0.5 size-2 rounded-full bg-brand ring-2 ring-sunken" aria-hidden />}
        </Slot>
        <Label>
          activity
          {n > 0 && <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-soft px-1.5 font-mono text-xs text-brand">{n}</span>}
        </Label>
      </Link>
    </Tip>
  );
}

function SettingsRow() {
  return (
    <Tip label="settings">
      <button type="button" onClick={() => openSettings()} aria-haspopup="dialog" className={cx(ROW, "text-muted", HOVER)}>
        <Slot><Settings className="size-4" strokeWidth={1.5} aria-hidden /></Slot>
        <Label>settings</Label>
      </button>
    </Tip>
  );
}

const CHAINS: Record<number, string> = { 84532: "Base Sepolia", 8453: "Base", 31337: "Local Anvil" };
export const chainName = (id: number | undefined) => (id === undefined ? "Base Sepolia" : CHAINS[id] ?? `Chain ${id}`);

function StatusLine() {
  const h = useHealth();
  const state = h.isPending ? "checking" : h.isError || !h.data.data.ok ? "down" : "up";
  const block = h.data?.data.block ?? null;
  // The chain comes from the coordinator; a local stack runs on Anvil, not Base Sepolia.
  const net = chainName(h.data?.data.chainId);
  const dot = { checking: "bg-subtle", down: "bg-danger", up: "bg-ok" }[state];
  const title = { checking: "Checking the coordinator", down: "Coordinator unreachable. Chain history is still readable.", up: "Coordinator live" }[state];
  return (
    <Tip label={state === "down" ? "Coordinator offline" : net}>
      <p title={title} className={cx(ROW, "h-6 font-mono text-xs text-subtle")}>
        <Slot><span className={cx("size-1.5 rounded-full", dot)} aria-hidden /></Slot>
        <Label>
          <span className="truncate">{net}{block !== null && <> · #<Flap text={block.toLocaleString("en-US")} /></>}</span>
          {state === "down" && <span className="ml-auto shrink-0 text-danger">offline</span>}
        </Label>
        <span className="sr-only">{title}</span>
      </p>
    </Tip>
  );
}

function WalletRow() {
  const w = useWallet();
  if (!w.connected || !w.address) {
    return (
      <div className="border-t border-rule pt-2">
        <Tip label="Connect wallet">
          <button type="button" onClick={openConnect} className={cx(ROW, "h-9 rounded-md border border-rule bg-surface text-ink", HOVER)}>
            <Slot><Wallet className="size-4" strokeWidth={1.5} aria-hidden /></Slot>
            <Label>Connect wallet</Label>
          </button>
        </Tip>
      </div>
    );
  }
  return <ConnectedWalletRow address={w.address} />;
}

/** The connected row. When round pay lands, its second line says so for three seconds instead of the balance. */
function ConnectedWalletRow({ address }: { address: string }) {
  const w = useWallet();
  const gain = useGain(w.claimable);
  return (
    <div className="border-t border-rule pt-2">
      <Popover
        width="w-menu"
        side="top"
        trigger={({ open, toggle, ref }) => (
          <Tip label={short(address)} hint={w.wrongNetwork ? "wrong network" : `${formatToken(w.usdc)} ${TOKEN_SYMBOL}`}>
            <button ref={ref} type="button" onClick={toggle} aria-expanded={open} aria-label={`Wallet ${short(address)}`} className={cx(ROW, "h-10 rounded-md text-left", HOVER)}>
              <Slot><Identicon value={address} className="-m-0.5 size-6" /></Slot>
              <Label>
                <span className="flex min-w-0 flex-col leading-tight">
                  <span className="truncate font-mono text-xs text-ink">{short(address)}</span>
                  {gain !== null && !w.wrongNetwork ? (
                    <span role="status" className="animate-glint truncate font-mono text-xs text-ink">+{formatToken(gain)} earned</span>
                  ) : (
                    <span className={cx("truncate text-xs", w.wrongNetwork ? "text-warn" : "text-subtle")}>{w.wrongNetwork ? "wrong network" : `${formatToken(w.usdc)} ${TOKEN_SYMBOL}`}</span>
                  )}
                </span>
                <ChevronsUpDown className="ml-auto size-3.5 shrink-0 text-muted" aria-hidden />
              </Label>
            </button>
          </Tip>
        )}
      >
        {(close) => (
          <div className="flex flex-col">
            <dl className="flex flex-col gap-1 px-2 py-1.5 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-muted">Wallet</dt><dd><Money units={w.usdc} /></dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Earned, unclaimed</dt><dd><Money units={w.claimable} live /></dd></div>
            </dl>
            <div className="my-1 h-px bg-rule" />
            {w.wrongNetwork && <MenuItem title="Switch to Base Sepolia" onClick={() => { w.switchNetwork(); close(); }} />}
            <MenuItem icon={UserRound} title="Profile" hint="Roles, identity, posters" href="/me" onClick={close} />
            <MenuItem icon={Coins} title="Balance" hint="Wallet, earnings, what paid for what" href="/balance" onClick={close} />
            <MenuItem icon={Settings} title="Settings" onClick={() => { openSettings("wallet"); close(); }} />
            <MenuItem icon={LogOut} title="Disconnect" onClick={() => { w.disconnect(); close(); }} />
          </div>
        )}
      </Popover>
    </div>
  );
}

export const themeScript = `try{var d=document.documentElement;localStorage.removeItem("theme");d.dataset.rail=localStorage.getItem("rail")==="1"?"collapsed":"open";var p=JSON.parse(localStorage.getItem("tod.prefs.v1")||"{}");if(p.motion&&p.motion!=="system")d.dataset.motion=p.motion}catch(e){}`;
