"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { createDraftAction, type NewStoryFormState } from "./actions";

const initialState: NewStoryFormState = {};

const MAX_TITLE_LENGTH = 200;

/**
 * Asks for a real title BEFORE any draft row exists.
 *
 * This deliberately replaces the previous zero-click behavior, where
 * visiting /stories/new fired createDraftAction() from a mount effect with
 * a hardcoded "Untitled story" and redirected straight into the editor.
 * That created a story on every visit -- including accidental ones -- and
 * every such story carried a placeholder title that had to be noticed and
 * cleaned up later, in My Stories, in the delete-empty-draft flow, and in
 * the editor's own required-Title field. A title is the one thing a
 * contributor always already has in mind when they click "New Story", so
 * asking for it is the cheapest possible gate and it means no untitled
 * draft is ever written.
 *
 * Nothing is created until submit. `createDraftAction` still owns the whole
 * server side unchanged -- auth, createDraftSchema validation (title
 * trimmed, 1-200 chars), the contributor-identity error, and the
 * `redirect()` into /stories/:id/edit on success. Submitting through
 * `<form action={formAction}>` (rather than calling the action from an
 * effect, as before) is what lets that redirect navigate normally and what
 * makes a double-submit impossible: `pending` disables the button, and
 * there is no Strict-Mode double-invoke to guard with a ref any more.
 *
 * The PDF/Canva import option still lives at /stories/new/import
 * (pdf-import-picker.tsx), which has always asked for a title first too --
 * the two entry points now behave the same way.
 */
export function StartNewStory() {
  const [state, formAction, pending] = useActionState(
    createDraftAction,
    initialState,
  );
  const [title, setTitle] = useState("");

  const trimmedLength = title.trim().length;
  const canSubmit = trimmedLength > 0 && !pending;

  return (
    <div className="mx-auto max-w-md px-4 py-12 sm:px-6 sm:py-16">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        Name your story
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Give it a working title to start. You can change it any time while you
        write.
      </p>

      <form action={formAction} className="mt-8 space-y-5" noValidate>
        <div>
          <label
            htmlFor="new-story-title"
            className="block text-sm font-medium"
          >
            Title
            <span className="text-destructive">
              <span aria-hidden="true"> *</span>
              <span className="sr-only"> required</span>
            </span>
          </label>
          <input
            id="new-story-title"
            name="title"
            type="text"
            required
            autoFocus
            maxLength={MAX_TITLE_LENGTH}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Six months picking kiwifruit in Te Puke"
            className="mt-1 w-full rounded-md border border-border-subtle px-3 py-2 dark:bg-transparent"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            {trimmedLength}/{MAX_TITLE_LENGTH}
          </p>
        </div>

        {state.error && (
          <p role="alert" className="text-sm text-destructive">
            {state.error}
          </p>
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full rounded-md bg-accent px-3 py-2 text-accent-foreground hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Starting…" : "Start writing"}
        </button>

        <p className="text-sm text-muted-foreground">
          Have it as a PDF or Canva export?{" "}
          <Link
            href="/stories/new/import"
            className="underline underline-offset-2"
          >
            Import it instead
          </Link>
          .
        </p>
        <p className="text-sm text-muted-foreground">
          <Link href="/my-stories" className="hover:underline">
            Back to My Stories
          </Link>
        </p>
      </form>
    </div>
  );
}
