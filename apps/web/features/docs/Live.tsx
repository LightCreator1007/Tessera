"use client";
// Docs pieces that read live state: the pair command filled from the connected wallet and the coordinator config, the OS switch for install lines, and the contract table.
import { useState } from "react";
import { useConfig } from "@/lib/api/hooks";
import { useWallet } from "@/lib/wallet";
import { openConnect } from "@/components/connect";
import { AddressChip, CodePanel, Null, Segmented, Skeleton } from "@/components/primitives";
import { INSTALL, SETUP, pairCommand } from "./cli";

export function InstallCommand({ withSetup = false }: { withSetup?: boolean }) {
  const [os, setOs] = useState<"unix" | "windows">("unix");
  return (
    <div className="flex flex-col gap-2">
      <Segmented label="Operating system" items={[{ key: "unix", label: "macOS / Linux" }, { key: "windows", label: "Windows" }]} value={os} onChange={setOs} />
      <CodePanel code={withSetup ? `${INSTALL[os]}\n${SETUP}` : INSTALL[os]} />
    </div>
  );
}

/** The one command that needs values only this page knows. Copy gives a line that runs as is once a wallet is connected. */
export function PairCommand() {
  const w = useWallet();
  const cfg = useConfig();
  if (cfg.isPending) return <Skeleton className="h-14 w-full rounded-xl" />;
  const chainId = cfg.data?.data.chainId ?? 84532;
  const registry = cfg.data?.data.nodeRegistry ?? "<NodeRegistry address>";
  const owner = w.address ?? "<your wallet address>";
  return (
    <div className="flex flex-col gap-2">
      <CodePanel code={pairCommand(owner, chainId, registry)} />
      {!w.connected ? (
        <p className="text-xs text-muted">
          <button type="button" onClick={openConnect} className="text-ink underline decoration-rule-strong underline-offset-4 hover:decoration-ink">Connect a wallet</button> to fill in your address.
        </p>
      ) : (
        <p className="text-xs text-muted">Filled in with your wallet, chain {chainId} and the live NodeRegistry.</p>
      )}
    </div>
  );
}

export function ContractTable() {
  const cfg = useConfig();
  if (cfg.isPending) return <Skeleton className="h-40 w-full rounded-xl" />;
  if (!cfg.data) return <Null>The coordinator did not return its config.</Null>;
  const c = cfg.data.data;
  const rows: [string, React.ReactNode][] = [
    ["Chain", <span key="c" className="font-mono">Base Sepolia · {c.chainId}</span>],
    ["JobMarket", <AddressChip key="j" value={c.jobMarket} />],
    ["NodeRegistry", <AddressChip key="n" value={c.nodeRegistry} />],
    ["Token (TOD)", <AddressChip key="t" value={c.token} />],
    ["Coordinator", <AddressChip key="o" value={c.coordinator} />],
    ["Verifiers", <span key="v" className="font-mono">{c.threshold} of {c.verifiers.length} sign each round</span>],
  ];
  return (
    <dl className="flex flex-col divide-y divide-rule rounded-xl border border-rule text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="flex h-11 items-center justify-between gap-4 px-4">
          <dt className="text-muted">{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
