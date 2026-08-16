"use client";

import { useActionState } from "react";
import {
  recordLaunchVerificationAction,
  type VerificationActionState,
} from "./actions";

const initialState: VerificationActionState = {};

export type VerifyFormProps = {
  storyId: string;
  lastVerifiedAt: string | null;
  lastVerifiedDesktop: boolean | null;
  lastVerifiedMobile: boolean | null;
};

/**
 * Purely observational -- recording a verification never changes the
 * story's lifecycle_status or publication state (see
 * record_story_launch_verification() in
 * supabase/migrations/20260806090000_content_readiness_and_metrics.sql).
 * Shown only for published stories (see page.tsx).
 */
export function VerifyForm({
  storyId,
  lastVerifiedAt,
  lastVerifiedDesktop,
  lastVerifiedMobile,
}: VerifyFormProps) {
  const [state, formAction, pending] = useActionState(
    recordLaunchVerificationAction,
    initialState,
  );

  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer text-muted-foreground">
        {lastVerifiedAt
          ? `Last verified ${new Date(lastVerifiedAt).toLocaleDateString("en-NZ")} (desktop: ${lastVerifiedDesktop ? "yes" : "no"}, mobile: ${lastVerifiedMobile ? "yes" : "no"})`
          : "Not yet verified live"}
      </summary>
      <form action={formAction} className="mt-2 flex flex-col gap-2">
        <input type="hidden" name="storyId" value={storyId} />
        <label className="flex items-center gap-1.5">
          <input type="checkbox" name="desktopChecked" />
          Checked on desktop
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" name="mobileChecked" />
          Checked on mobile
        </label>
        <textarea
          name="note"
          rows={2}
          placeholder="Optional note"
          className="w-full rounded-md border border-border-subtle px-2 py-1 text-xs dark:bg-transparent"
        />
        <button
          type="submit"
          disabled={pending}
          className="w-fit rounded-md border border-border-subtle px-2 py-1 text-xs font-medium disabled:opacity-60"
        >
          {pending ? "Recording…" : "Record verification"}
        </button>
        {state.error && (
          <p role="alert" className="text-destructive">
            {state.error}
          </p>
        )}
        {state.success && (
          <p className="text-green-700 dark:text-green-400">{state.success}</p>
        )}
      </form>
    </details>
  );
}
