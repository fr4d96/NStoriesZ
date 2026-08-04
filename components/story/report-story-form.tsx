"use client";

import { useActionState, useState } from "react";
import { reportCategories } from "@/lib/validation/story";
import {
  reportStoryAction,
  type ReportActionState,
} from "@/app/(public)/stories/[id]/actions";

const categoryLabels: Record<(typeof reportCategories)[number], string> = {
  misinformation: "Misinformation",
  unsafe_employment_advice: "Unsafe employment advice",
  harassment: "Harassment",
  copyright_privacy: "Copyright or privacy",
  spam_commercial: "Spam or commercial content",
  other: "Other",
};

const initialState: ReportActionState = { status: "idle" };

/**
 * Deliberately starts closed with no auth check at all -- the page this
 * renders on never calls getCurrentUser() (see actions.ts's doc comment),
 * so whether the visitor is signed in is only discovered when they actually
 * submit. A signed-out submission surfaces as "needs-sign-in" state here,
 * not a page-level redirect.
 */
export function ReportStoryForm({ storyId }: { storyId: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    reportStoryAction,
    initialState,
  );

  if (!open && state.status === "idle") {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm text-foreground/60 underline underline-offset-2 hover:text-foreground"
      >
        Report this story
      </button>
    );
  }

  if (state.status === "success") {
    return (
      <p className="text-sm text-foreground/70">
        Thanks — your report has been submitted for review.
      </p>
    );
  }

  if (state.status === "needs-sign-in") {
    return (
      <p className="text-sm text-foreground/70">
        Please{" "}
        <a
          href={`/sign-in?next=${encodeURIComponent(`/stories/${storyId}`)}`}
          className="underline underline-offset-2"
        >
          sign in
        </a>{" "}
        to report a story.
      </p>
    );
  }

  const fieldErrors =
    state.status === "validation-error" ? state.fieldErrors : undefined;

  return (
    <form action={formAction} className="max-w-sm space-y-3" noValidate>
      <input type="hidden" name="storyId" value={storyId} />
      <div>
        <label htmlFor="report-category" className="block text-sm font-medium">
          Reason
        </label>
        <select
          id="report-category"
          name="category"
          required
          defaultValue=""
          className="mt-1 w-full rounded-md border border-border-subtle bg-surface px-3 py-2 text-sm"
        >
          <option value="" disabled>
            Choose a reason
          </option>
          {reportCategories.map((category) => (
            <option key={category} value={category}>
              {categoryLabels[category]}
            </option>
          ))}
        </select>
        {fieldErrors?.category ? (
          <p className="mt-1 text-xs text-red-600">{fieldErrors.category[0]}</p>
        ) : null}
      </div>

      <div>
        <label htmlFor="report-details" className="block text-sm font-medium">
          Details (optional)
        </label>
        <textarea
          id="report-details"
          name="details"
          rows={3}
          maxLength={2000}
          className="mt-1 w-full rounded-md border border-border-subtle bg-surface px-3 py-2 text-sm"
        />
        {fieldErrors?.details ? (
          <p className="mt-1 text-xs text-red-600">{fieldErrors.details[0]}</p>
        ) : null}
      </div>

      {state.status === "error" ? (
        <p className="text-sm text-red-600">{state.message}</p>
      ) : null}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Submitting…" : "Submit report"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-sm text-foreground/60 hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
