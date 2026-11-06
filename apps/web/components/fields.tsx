"use client";
// Form pieces for settings: a labelled setting row, number and text fields, and a checkbox. Settings is the first surface with many inputs, so they live here instead of being restyled per screen.
import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { cx } from "./primitives";

/** Label and help on the left, control on the right; stacks under the md breakpoint. */
export function SettingRow({ label, hint, htmlFor, children, note }: { label: string; hint?: ReactNode; htmlFor?: string; children: ReactNode; note?: ReactNode }) {
  return (
    <div className="grid gap-x-8 gap-y-2 border-b border-rule-row py-4 last:border-b-0 md:grid-split">
      <div className="flex min-w-0 flex-col gap-0.5">
        {htmlFor ? <label htmlFor={htmlFor} className="text-sm text-ink">{label}</label> : <span className="text-sm text-ink">{label}</span>}
        {hint && <p className="text-xs text-muted">{hint}</p>}
      </div>
      <div className="flex min-w-0 flex-col items-start gap-1.5">
        {children}
        {note && <p className="text-xs text-warn">{note}</p>}
      </div>
    </div>
  );
}

const INPUT = "h-8 rounded-md border border-field bg-surface px-2 text-sm text-ink outline-none transition-colors duration-150 placeholder:text-subtle focus:border-muted aria-invalid:border-danger";

export function NumField({ id, value, onChange, min, max, step = 1, unit, empty }: {
  id: string; value: number | null; onChange: (v: number | null) => void; min: number; max?: number; step?: number; unit?: string;
  /** When set, clearing the field means "no limit" and shows this placeholder. */
  empty?: string;
}) {
  const bad = value !== null && (value < min || (max !== undefined && value > max));
  return (
    <span className="inline-flex items-center gap-2">
      <input
        id={id}
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={value ?? ""}
        placeholder={empty}
        aria-invalid={bad || undefined}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") return onChange(empty !== undefined ? null : min);
          const n = Number(raw);
          if (Number.isFinite(n)) onChange(n);
        }}
        className={cx(INPUT, "w-24 font-mono")}
      />
      {unit && <span className="text-sm text-muted">{unit}</span>}
      {bad && <span className="text-xs text-danger">{max !== undefined ? `${min} to ${max}` : `At least ${min}`}</span>}
    </span>
  );
}

export function TextField({ id, value, onChange, placeholder, invalid, mono, type = "text" }: { id: string; value: string; onChange: (v: string) => void; placeholder?: string; invalid?: boolean; mono?: boolean; type?: string }) {
  return <input id={id} type={type} value={value} placeholder={placeholder} aria-invalid={invalid || undefined} onChange={(e) => onChange(e.target.value)} className={cx(INPUT, "w-full max-w-sm", mono && "font-mono")} />;
}

export function Checkbox({ checked, onChange, label, disabled, hint }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean; hint?: ReactNode }) {
  return (
    <label className={cx("group relative inline-flex items-start gap-2.5 text-sm", disabled ? "cursor-not-allowed text-subtle" : "cursor-pointer text-ink")}>
      <input type="checkbox" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span aria-hidden className={cx("mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-xs border transition-colors duration-150 peer-focus-visible:ring-2 peer-focus-visible:ring-focus", checked ? "border-ink bg-ink text-surface" : "border-rule-strong bg-surface")}>
        {checked && <Check className="size-3" strokeWidth={2.5} />}
      </span>
      <span className="flex flex-col gap-0.5">
        {label}
        {hint && <span className="text-xs text-muted">{hint}</span>}
      </span>
    </label>
  );
}
