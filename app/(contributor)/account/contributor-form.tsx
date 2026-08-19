"use client";

import { useActionState } from "react";
import {
  createOwnContributorAction,
  updateOwnContributorAction,
  type AccountFormState,
} from "@/app/(contributor)/actions";
import { contributorAttributionTypes } from "@/lib/validation/profile";

const initialState: AccountFormState = {};

const attributionLabels: Record<
  (typeof contributorAttributionTypes)[number],
  string
> = {
  real_name: "My real name",
  display_name: "A display name",
  pseudonym: "A pseudonym",
  anonymous: "Anonymous",
};

export function ContributorForm({
  existing,
}: {
  existing: {
    displayName: string;
    attributionType: string;
    publicProfileEnabled: boolean;
    publicSlug: string;
  } | null;
}) {
  const action = existing
    ? updateOwnContributorAction
    : createOwnContributorAction;
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="mt-4 space-y-5" noValidate>
      <div>
        <label
          htmlFor="contributorDisplayName"
          className="block text-sm font-medium"
        >
          How your name appears on stories
        </label>
        <input
          id="contributorDisplayName"
          name="displayName"
          type="text"
          maxLength={120}
          required
          defaultValue={existing?.displayName ?? ""}
          className="mt-1 w-full rounded-xl border border-border-subtle bg-surface px-3 py-2 focus:border-accent focus:outline-none"
        />
      </div>

      <fieldset>
        <legend className="text-sm font-medium">Attribution type</legend>
        <div className="mt-2 space-y-2">
          {contributorAttributionTypes.map((type) => (
            <label key={type} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="attributionType"
                value={type}
                defaultChecked={
                  existing
                    ? existing.attributionType === type
                    : type === "display_name"
                }
                className="h-4 w-4 accent-accent"
              />
              {attributionLabels[type]}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex items-center gap-2">
        <input
          id="contributorPublicProfileEnabled"
          name="publicProfileEnabled"
          type="checkbox"
          defaultChecked={existing?.publicProfileEnabled ?? false}
          className="h-4 w-4 accent-accent"
        />
        <label
          htmlFor="contributorPublicProfileEnabled"
          className="text-sm font-medium"
        >
          List me in the Contributors directory
        </label>
      </div>

      <div>
        <label
          htmlFor="contributorPublicSlug"
          className="block text-sm font-medium"
        >
          Contributor page web address
        </label>
        <p className="mt-1 text-xs text-foreground/55">
          This is separate from the &ldquo;Public profile web address&rdquo;
          above — it controls whether you appear on{" "}
          <a
            href="/contributors"
            className="underline underline-offset-2"
            target="_blank"
            rel="noopener noreferrer"
          >
            /contributors
          </a>{" "}
          and get a byline page there. You also need at least one published
          story, and &ldquo;Anonymous&rdquo; attribution can&apos;t be listed.
        </p>
        <div className="mt-2 flex overflow-hidden rounded-xl border border-border-subtle focus-within:border-accent">
          <span className="flex items-center bg-surface-muted px-3 text-sm text-foreground/55">
            /contributors/
          </span>
          <input
            id="contributorPublicSlug"
            name="publicSlug"
            type="text"
            maxLength={60}
            defaultValue={existing?.publicSlug ?? ""}
            placeholder="your-name"
            className="w-full bg-surface px-3 py-2 focus:outline-none"
          />
        </div>
        <p className="mt-1 text-xs text-foreground/55">
          Required to list you in the directory. Lowercase letters, numbers, and
          hyphens only.
        </p>
      </div>

      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      {state.success && (
        <p role="status" className="text-sm text-fern">
          {state.success}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="journiq-button bg-accent text-sm text-accent-foreground disabled:opacity-60"
      >
        {pending
          ? "Saving…"
          : existing
            ? "Update contributor identity"
            : "Set up contributor identity"}
      </button>
    </form>
  );
}
