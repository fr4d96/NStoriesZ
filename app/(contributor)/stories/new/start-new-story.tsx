"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createDraftAction, type NewStoryFormState } from "./actions";
import { Spinner } from "@/components/ui/spinner";

/**
 * Skips the old "type a working title, then click Start writing" page --
 * lands straight on the real editor, where Title is already a required,
 * clearly-marked field (see story-edit-form.tsx's RequiredMark). Fires
 * createDraftAction() itself, once, on mount, with a fixed placeholder
 * title -- calling a "use server" action directly as a function (not via a
 * <form action>) is a supported pattern and behaves identically, including
 * `redirect()` inside it, which is what actually navigates away once the
 * draft exists.
 *
 * `started` is a ref, not state -- React 18 Strict Mode's dev-only
 * double-invoke of effects would otherwise create two draft stories per
 * visit; a ref survives that because it isn't reset between the two calls
 * the way component state would be by a remount.
 *
 * A GET-navigated page.tsx doing this mutation directly (no client
 * component, no explicit action call) was deliberately avoided: Next.js
 * Link prefetching could then create a story every time this route's link
 * scrolls into view, not only on an actual click.
 *
 * Kept as the zero-click default for `/stories/new` -- every existing entry
 * point ("New Story" in the header/nav/my-stories, e2e tests) expects an
 * immediate redirect to a real draft's edit page. The PDF/Canva import
 * option lives at the separate `/stories/new/import` route
 * (pdf-import-picker.tsx) instead of replacing this behavior in place.
 */
export function StartNewStory() {
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const formData = new FormData();
    formData.set("title", "Untitled story");
    createDraftAction({} as NewStoryFormState, formData).then((result) => {
      if (result.error) setError(result.error);
      // No redirect() reached: the action itself already navigated away on
      // success, so there is nothing further to do here in that case.
    });
  }, []);

  if (error) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center sm:px-6">
        <p role="alert" className="text-destructive">
          {error}
        </p>
        <Link
          href="/my-stories"
          className="mt-4 inline-block text-sm underline underline-offset-2"
        >
          Back to My Stories
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-24 text-center sm:px-6">
      <Spinner className="h-6 w-6 text-foreground/60" />
      <p className="text-foreground/70">Starting your story…</p>
    </div>
  );
}
