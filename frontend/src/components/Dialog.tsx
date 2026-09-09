"use client";

import { useEffect } from "react";

/**
 * A plain modal. No UI kit - the spec's scope discipline says depth over
 * breadth, and a dialog is a dialog.
 */
export function Dialog({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-zinc-900/40" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative w-full max-w-md rounded-lg border border-zinc-200 bg-white shadow-lg"
      >
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="px-4 py-4">{children}</div>
      </div>
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-zinc-700">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-[11px] text-zinc-500">{hint}</span>}
      {error && <span className="mt-1 block text-[11px] text-red-600">{error}</span>}
    </label>
  );
}

export const inputClass =
  "mt-1 w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm focus:border-zinc-900 focus:outline-none";

export function SubmitRow({
  pending,
  submitLabel,
  onCancel,
  disabled,
}: {
  pending: boolean;
  submitLabel: string;
  onCancel: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="mt-4 flex items-center justify-end gap-2">
      <button
        type="button"
        onClick={onCancel}
        className="rounded-md px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100"
      >
        Cancel
      </button>
      <button
        type="submit"
        // Disabled while pending is a convenience. The server's idempotency
        // key is the actual guarantee that a double-click writes once.
        disabled={pending || disabled}
        className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
      >
        {pending ? "Working…" : submitLabel}
      </button>
    </div>
  );
}
