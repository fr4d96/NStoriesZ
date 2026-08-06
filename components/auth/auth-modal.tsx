"use client";

import { useEffect, useId, useRef } from "react";

/**
 * Native <dialog>-based modal shell -- showModal() gets us focus trapping,
 * top-layer rendering above everything else on the page (including the
 * sticky header), and Escape-to-close for free. Closing it (Escape,
 * backdrop click, or the visible close button) never navigates anywhere;
 * whatever page was open underneath (the landing page or otherwise) is
 * still there and unaffected. Reused for both sign-in and sign-up so the
 * open/close mechanics live in exactly one place.
 */
export function AuthModal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

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
      onClose={onClose}
      onClick={(event) => {
        // A click that lands on the <dialog> element itself (not any of
        // its children) means it hit the backdrop area -- native <dialog>
        // doesn't close on backdrop click by default, so this adds it.
        if (event.target === dialogRef.current) onClose();
      }}
      className="m-auto w-[min(92vw,26rem)] rounded-2xl border border-border-subtle bg-surface p-0 text-foreground shadow-2xl backdrop:bg-black/50 backdrop:backdrop-blur-sm"
    >
      <div className="flex items-center justify-between border-b border-border-subtle px-6 py-4">
        <h2 id={titleId} className="text-lg font-semibold tracking-tight">
          {title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-8 w-8 items-center justify-center rounded-full text-foreground/60 transition-colors hover:bg-surface-muted hover:text-foreground"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
      <div className="px-6 py-6">{children}</div>
    </dialog>
  );
}
