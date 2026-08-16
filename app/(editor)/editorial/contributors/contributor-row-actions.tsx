"use client";

import { useActionState, useState } from "react";
import {
  linkContributorAction,
  unlinkContributorAction,
  type ContributorsFormState,
} from "./actions";

const initialState: ContributorsFormState = {};

export function ContributorRowActions({
  contributorId,
  isLinked,
}: {
  contributorId: string;
  isLinked: boolean;
}) {
  const [linkState, linkFormAction, linkPending] = useActionState(
    linkContributorAction,
    initialState,
  );
  const [unlinkState, unlinkFormAction, unlinkPending] = useActionState(
    unlinkContributorAction,
    initialState,
  );
  const [showLinkForm, setShowLinkForm] = useState(false);

  if (isLinked) {
    return (
      <form action={unlinkFormAction} className="flex flex-col items-end gap-1">
        <input type="hidden" name="contributorId" value={contributorId} />
        <input
          type="text"
          name="note"
          placeholder="Reason (optional)"
          className="w-40 rounded border border-border-subtle px-2 py-1 text-xs dark:bg-transparent"
        />
        <button
          type="submit"
          disabled={unlinkPending}
          className="text-xs text-destructive underline underline-offset-2 disabled:opacity-60"
        >
          {unlinkPending ? "Unlinking…" : "Unlink"}
        </button>
        {unlinkState.error && (
          <p role="alert" className="text-xs text-destructive">
            {unlinkState.error}
          </p>
        )}
      </form>
    );
  }

  if (!showLinkForm) {
    return (
      <button
        type="button"
        onClick={() => setShowLinkForm(true)}
        className="text-xs underline underline-offset-2"
      >
        Link to account…
      </button>
    );
  }

  return (
    <form action={linkFormAction} className="flex flex-col items-end gap-1">
      <input type="hidden" name="contributorId" value={contributorId} />
      <input
        type="text"
        name="userId"
        required
        placeholder="Account user id (UUID)"
        className="w-48 rounded border border-border-subtle px-2 py-1 text-xs dark:bg-transparent"
      />
      <input
        type="text"
        name="note"
        placeholder="Note (optional)"
        className="w-48 rounded border border-border-subtle px-2 py-1 text-xs dark:bg-transparent"
      />
      <button
        type="submit"
        disabled={linkPending}
        className="text-xs underline underline-offset-2 disabled:opacity-60"
      >
        {linkPending ? "Linking…" : "Link"}
      </button>
      {linkState.error && (
        <p role="alert" className="text-xs text-destructive">
          {linkState.error}
        </p>
      )}
    </form>
  );
}
