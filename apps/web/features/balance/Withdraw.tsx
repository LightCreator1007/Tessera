"use client";
// Withdraw: an in-app summary built from the real call comes before the wallet prompt, so the one signature is spent on a decision the reader already understands.
import { useEffect, useRef } from "react";
import { ArrowUpRight, Download, X } from "lucide-react";
import { Button, Money, PropRow, short } from "@/components/primitives";
import { TxButton, TxStatus } from "@/components/flow";
import type { useTx } from "@/lib/tx";

export function WithdrawDialog({ open, onClose, amount, to, bond, tx, onConfirm, onExport }: {
  open: boolean;
  onClose: () => void;
  amount: number;
  to: string;
  bond: number | null;
  tx: ReturnType<typeof useTx>;
  onConfirm: () => void;
  onExport: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby="wd-title" className="connect-dialog m-auto w-dialog rounded-xl border border-rule bg-surface p-0 text-ink shadow-2xl">
      <div className="flex items-center justify-between border-b border-rule px-5 py-3">
        <h2 id="wd-title" className="text-lg font-semibold">Withdraw to your wallet</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-ink"><X className="size-4" /></button>
      </div>
      <div className="flex flex-col gap-4 px-5 py-4">
        <dl className="flex flex-col divide-y divide-rule-row">
          <PropRow label="Amount"><Money units={amount} /></PropRow>
          <PropRow label="To"><span className="font-mono text-xs">{short(to)} <span className="text-subtle">(this wallet)</span></span></PropRow>
          <PropRow label="Network"><span className="text-xs">Base Sepolia</span></PropRow>
          <PropRow label="Bond">{bond === null ? <span className="text-xs text-subtle">No node</span> : <span className="text-xs">Your <Money units={bond} /> stake stays in the registry</span>}</PropRow>
        </dl>
        <p className="text-xs text-muted">Withdrawals go to the connected wallet only. After this, the amount is yours and can&apos;t be slashed.</p>
        <p className="text-xs text-muted">
          Crypto income in India is taxed at 30%, plus 1% TDS.{" "}
          <button type="button" onClick={onExport} className="inline-flex items-center gap-1 text-ink underline decoration-subtle underline-offset-4 hover:decoration-ink"><Download className="size-3" aria-hidden />Export your ledger as CSV</button>
        </p>
        <TxStatus tx={tx} />
      </div>
      <div className="flex justify-end gap-2 border-t border-rule px-5 py-3">
        <Button variant="ghost" onClick={onClose} disabled={tx.busy}>Cancel</Button>
        <TxButton tx={tx} label="Sign and withdraw" onRun={onConfirm} />
      </div>
    </dialog>
  );
}

export function WithdrawButton({ disabled, why, onClick }: { disabled: boolean; why: string; onClick: () => void }) {
  return (
    <span className="flex flex-col items-end gap-1">
      <Button icon={ArrowUpRight} onClick={onClick} disabled={disabled} aria-describedby={disabled ? "wd-why" : undefined}>Withdraw to wallet</Button>
      {disabled && <span id="wd-why" className="text-xs text-subtle">{why}</span>}
    </span>
  );
}
