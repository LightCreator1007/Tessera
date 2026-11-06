"use client";
// Right-side drawer for the round receipt. Escape and backdrop close it; focus moves in on open and returns to the opener on close.
import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

export function Drawer({ title, onClose, children, footer }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 animate-fade-in bg-sunken/60" onClick={onClose} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        tabIndex={-1}
        className="absolute inset-y-0 right-0 flex w-full max-w-2xl animate-drawer-in flex-col border-l border-rule bg-surface shadow-drawer outline-none md:inset-y-2 md:right-2 md:rounded-xl md:border"
      >
        <div className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-rule px-5">
          <div id="drawer-title" className="min-w-0">{title}</div>
          <button type="button" onClick={onClose} aria-label="Close" className="inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-ink">
            <X className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
        {footer && <div className="shrink-0 border-t border-rule px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}
