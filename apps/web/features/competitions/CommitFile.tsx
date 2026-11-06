"use client";
// Pick a file, hash it in the browser and show the commitment. The file never leaves the browser here; only its hash goes on chain. A sample stands in when the person has no file yet.
import { useId, useRef, useState } from "react";
import { FileUp, Loader2 } from "lucide-react";
import { HashChip, TileBusy } from "@/components/primitives";
import { commitFile, type Committed } from "./model";

const kb = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);

export function CommitFile({ what, value, onChange, sample }: { what: string; value: Committed | null; onChange: (v: Committed | null) => void; sample: () => Promise<Committed> }) {
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const take = async (get: () => Promise<Committed | string>) => {
    setBusy(true);
    setError(null);
    const r = await get();
    setBusy(false);
    if (typeof r === "string") return setError(r);
    onChange(r);
  };

  if (value) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-rule bg-raised p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="min-w-0 truncate text-sm text-ink">{value.name}</span>
          <span className="text-xs text-muted">{kb(value.bytes)}{value.sample ? ", sample" : ""}</span>
        </div>
        <HashChip value={value.hash} label={`${what} hash`} land />
        <button type="button" onClick={() => onChange(null)} className="inline-flex min-h-6 items-center self-start text-sm text-muted underline decoration-rule-strong underline-offset-4 hover:text-ink">
          Use a different file
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <input ref={input} id={id} type="file" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) take(() => commitFile(f)); }} />
      <button
        type="button"
        disabled={busy}
        onClick={() => input.current?.click()}
        aria-describedby={error ? `${id}-err` : undefined}
        className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-field bg-sunken px-4 py-8 text-center transition-colors hover:border-rule-strong hover:bg-hover disabled:cursor-wait"
      >
        {busy ? <TileBusy className="text-muted" /> : <FileUp className="size-5 text-muted" strokeWidth={1.5} aria-hidden />}
        <span className="text-sm text-ink">{busy ? "Hashing in your browser" : `Choose the ${what} file`}</span>
        <span className="text-xs text-muted">It stays on this device. Only its hash is committed.</span>
      </button>
      {error && <p id={`${id}-err`} role="alert" className="text-sm text-danger">{error}</p>}
      <button type="button" disabled={busy} onClick={() => take(sample)} className="inline-flex min-h-6 items-center self-start text-sm text-muted underline decoration-rule-strong underline-offset-4 hover:text-ink">
        No file yet? Use a sample
      </button>
    </div>
  );
}
