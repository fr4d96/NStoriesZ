"use client";

import { useEffect, useId, useRef } from "react";

/**
 * A native <dialog>-based confirmation prompt, same shell mechanics as
 * components/auth/auth-modal.tsx (showModal()/close(), Escape, backdrop
 * click) but purpose-built for a single "are you sure?" decision rather
 * than hosting an arbitrary form. Used wherever an action needs a real,
 * unmissable confirmation step rather than an inline toggle.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  pending = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Styles the confirm button as a destructive action (solid red). */
  danger?: boolean;
  /** Disables both buttons and swaps the confirm label to a busy state. */
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onClose={onCancel}
      onClick={(event) => {
        // A click landing on the <dialog> element itself (not a child) hit
        // the backdrop -- native <dialog> doesn't close on that by default.
        if (event.target === dialogRef.current) onCancel();
      }}
      className="journiq-modal m-auto w-[min(92vw,24rem)] rounded-2xl border border-border-subtle bg-surface p-0 text-foreground shadow-2xl backdrop:bg-black/50 backdrop:backdrop-blur-sm"
    >
      <div className="px-6 py-6">
        <h2 id={titleId} className="text-lg font-semibold tracking-tight">
          {title}
        </h2>
        {description && (
          <p id={descriptionId} className="mt-2 text-sm text-foreground/70">
            {description}
          </p>
        )}
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="journiq-button border border-border-subtle text-sm disabled:opacity-60"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className={`journiq-button text-sm disabled:opacity-60 ${
              danger
                ? "bg-destructive text-destructive-foreground"
                : "bg-accent text-accent-foreground"
            }`}
          >
            {pending ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
