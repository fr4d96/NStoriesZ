"use client";

import { useState, type ReactNode } from "react";

/**
 * Prompt 7 bug fix: a Server Component page conditionally rendering
 * `{someServerComputedBoolean && <ClientPanel/>}` unmounts the whole panel
 * the instant a Server Action's revalidatePath() flips that boolean --
 * which happens on exactly the same submit that panel's own useActionState
 * was about to show a success/error message for, discarding it before
 * anyone (a human or Playwright) can observe it. This is the same failure
 * mode Prompt 6 Stage 3 already found and fixed in
 * app/(moderation)/moderation/stories/[id]/review-controls.tsx and
 * app/(moderation)/moderation/reports/[id]/resolve-form.tsx (see
 * docs/implementation-status.md "Post-Stage-3 live e2e verification") --
 * "render the confirmation unconditionally, above the branch that can
 * replace the rest of the section." This is the same fix, generalized: wrap
 * the panel in a client component whose OWN mount decision is taken once,
 * from the initial `show` value, and never re-derived from later prop
 * changes -- so a later server re-render that would have unmounted the
 * panel instead leaves it (and whatever it's currently showing) alone.
 *
 * Only appropriate for exactly this "confirmation must survive its own
 * cause" case -- not a general-purpose visibility toggle.
 */
export function StickyVisible({
  show,
  children,
}: {
  show: boolean;
  children: ReactNode;
}) {
  const [visible] = useState(show);
  if (!visible) return null;
  return <>{children}</>;
}
