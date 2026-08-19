"use client";

import { useActionState, useState } from "react";
import type { ContributorForEditorial } from "@/lib/story/editorial-queries";
import {
  createEditorialImportAction,
  type NewImportFormState,
} from "./actions";
import { TitleAndContributorFields } from "./contributor-fieldset";
import { PdfImportPicker } from "./pdf-import-picker";

const initialState: NewImportFormState = {};

/**
 * Stage 5 (docs/pdf-canva-import-plan.md) added the "PDF/Canva file" mode
 * below, alongside the pre-existing blank-draft path (title + contributor,
 * then paste/import the body text later inside the editor via
 * components/story/content-import-panel.tsx). The two modes end up in
 * different places by design: a blank draft still needs its content_json
 * filled in from scratch, while a PDF import produces both the draft AND
 * its (image-only, placeholder-text) content_json in one submit — see
 * PdfImportPicker's own doc comment.
 */
export function NewImportForm({
  contributors,
}: {
  contributors: ContributorForEditorial[];
}) {
  const [state, formAction, pending] = useActionState(
    createEditorialImportAction,
    initialState,
  );
  const [importMode, setImportMode] = useState<"blank" | "pdf">("blank");

  return (
    <div className="mt-6">
      <fieldset>
        <legend className="text-sm font-medium">Import type</legend>
        <div className="mt-1 flex gap-4 text-sm">
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              name="importMode"
              value="blank"
              checked={importMode === "blank"}
              onChange={() => setImportMode("blank")}
            />
            Blank draft (add text and images later)
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              name="importMode"
              value="pdf"
              checked={importMode === "pdf"}
              onChange={() => setImportMode("pdf")}
            />
            PDF / Canva file
          </label>
        </div>
      </fieldset>

      {importMode === "blank" ? (
        <form action={formAction} className="mt-6 space-y-6">
          {state.error && (
            <p role="alert" className="text-sm text-destructive">
              {state.error}
            </p>
          )}

          <TitleAndContributorFields
            contributors={contributors}
            idPrefix="new-import"
          />

          <button
            type="submit"
            disabled={pending}
            className="inline-flex items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground disabled:opacity-60"
          >
            {pending ? "Creating…" : "Create Import Draft"}
          </button>
        </form>
      ) : (
        <PdfImportPicker contributors={contributors} />
      )}
    </div>
  );
}
