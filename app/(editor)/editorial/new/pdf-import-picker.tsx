"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ContributorForEditorial } from "@/lib/story/editorial-queries";
import {
  MAX_PDF_IMPORT_INPUT_BYTES,
  isPdfMagicBytes,
} from "@/lib/story/pdf-validation";
import { MAX_IMAGES_PER_REVISION } from "@/lib/story/image-validation";
import { TitleAndContributorFields } from "./contributor-fieldset";

type PreviewPage = {
  pageNumber: number;
  width: number;
  height: number;
  dataUrl: string;
};

const MAX_MB = Math.round(MAX_PDF_IMPORT_INPUT_BYTES / (1024 * 1024));

/**
 * Stage 5 (docs/pdf-canva-import-plan.md): the PDF/Canva-file mode of the
 * editorial "new import" page, alongside the existing blank-draft form
 * (`new-import-form.tsx`). Drives the two-phase flow Stage 4 already built:
 *
 *   1. Upload the PDF to `POST /editorial/new/pdf-preview` (Phase A) and
 *      render the returned page thumbnails as a selectable grid, up to
 *      MAX_IMAGES_PER_REVISION (12).
 *   2. Collect required alt text for every selected page.
 *   3. Re-submit the SAME File object (kept in this component's state,
 *      never re-picked by the user) plus the selection and alt text to
 *      `POST /editorial/new/pdf-attach` (Phase B), which creates the draft.
 *   4. Land directly in the real editor (`/editorial/:id/edit`) — no
 *      separate "done" screen, so the placeholder body text
 *      ("Imported from PDF — add your story text here.") is the first
 *      thing the editor sees, making it obvious the draft still needs
 *      real narrative text (the plan's "mandatory review step").
 *
 * Client-side checks throughout (file type/size, required alt text, the
 * 12-page limit) are UX niceties only — every one of them is re-enforced
 * server-side (`pdfImportFileSchema`, `pdfImportPageNumbersSchema`,
 * `attachPdfPagesToRevision()`'s capacity check) per Engineering Rule 2.
 */
export function PdfImportPicker({
  contributors,
}: {
  contributors: ContributorForEditorial[];
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [pages, setPages] = useState<PreviewPage[] | null>(null);
  const [selectedPages, setSelectedPages] = useState<number[]>([]);
  const [altText, setAltText] = useState<Record<number, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const limitReached = selectedPages.length >= MAX_IMAGES_PER_REVISION;
  const allAltTextFilled = selectedPages.every(
    (p) => (altText[p] ?? "").trim().length > 0,
  );
  const canSubmit = selectedPages.length > 0 && allAltTextFilled && !submitting;

  function resetPreviewState() {
    setPages(null);
    setSelectedPages([]);
    setAltText({});
    setPreviewError(null);
    setSubmitError(null);
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    resetPreviewState();
    setFile(e.target.files?.[0] ?? null);
  }

  async function handlePreview() {
    setSubmitError(null);
    if (!file) {
      setPreviewError("Choose a PDF file first.");
      return;
    }
    const isPdfExtension = /\.pdf$/i.test(file.name);
    const isPdfType = file.type === "application/pdf" || file.type === "";
    if (!isPdfExtension || !isPdfType) {
      setPreviewError("Choose a PDF file.");
      return;
    }
    if (file.size > MAX_PDF_IMPORT_INPUT_BYTES) {
      setPreviewError(`The PDF file is too large (max ${MAX_MB} MB).`);
      return;
    }
    // A fast client-side sniff on top of the extension/type check above —
    // still only a courtesy; lib/validation/pdf-import.ts's
    // pdfImportFileSchema re-checks the real magic bytes server-side
    // regardless (Engineering Rule 2).
    const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
    if (!isPdfMagicBytes(head)) {
      setPreviewError("That file doesn't look like a PDF.");
      return;
    }

    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const formData = new FormData();
      formData.set("file", file);
      const response = await fetch("/editorial/new/pdf-preview", {
        method: "POST",
        body: formData,
      });
      const body = (await response.json()) as {
        pageCount?: number;
        pages?: PreviewPage[];
        error?: string;
      };
      if (!response.ok || !body.pages) {
        setPreviewError(body.error ?? "Could not read that PDF.");
        return;
      }
      setPages(body.pages);
      setSelectedPages([]);
      setAltText({});
    } catch {
      setPreviewError("That upload couldn't be sent. Try again.");
    } finally {
      setPreviewLoading(false);
    }
  }

  function toggleSelect(pageNumber: number) {
    setSelectedPages((prev) => {
      if (prev.includes(pageNumber)) {
        return prev.filter((p) => p !== pageNumber);
      }
      if (prev.length >= MAX_IMAGES_PER_REVISION) return prev;
      return [...prev, pageNumber];
    });
  }

  async function handleAttachSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitError(null);
    if (!file) {
      setSubmitError("Choose a PDF file first.");
      return;
    }
    if (selectedPages.length === 0) {
      setSubmitError("Select at least one page.");
      return;
    }
    if (!allAltTextFilled) {
      setSubmitError("Add alt text for every selected page.");
      return;
    }

    const formData = new FormData(e.currentTarget);
    // formData already carries `file`, `title`, and the contributor fields
    // from TitleAndContributorFields' inputs (same <form>) — only the
    // selection and alt text need to be added explicitly.
    formData.set("pageNumbers", JSON.stringify(selectedPages));
    formData.set(
      "altText",
      JSON.stringify(
        Object.fromEntries(
          selectedPages.map((p) => [String(p), (altText[p] ?? "").trim()]),
        ),
      ),
    );

    setSubmitting(true);
    try {
      const response = await fetch("/editorial/new/pdf-attach", {
        method: "POST",
        body: formData,
      });
      const body = (await response.json()) as {
        storyId?: string;
        error?: string;
      };
      if (!response.ok || !body.storyId) {
        setSubmitError(body.error ?? "Could not create the import draft.");
        setSubmitting(false);
        return;
      }
      router.push(`/editorial/${body.storyId}/edit`);
    } catch {
      setSubmitError("That request couldn't be sent. Try again.");
      setSubmitting(false);
    }
  }

  return (
    <form
      ref={formRef}
      onSubmit={handleAttachSubmit}
      className="mt-6 space-y-6"
    >
      {submitError && (
        <p role="alert" className="text-sm text-destructive">
          {submitError}
        </p>
      )}

      <TitleAndContributorFields
        contributors={contributors}
        idPrefix="pdf-import"
      />

      <div>
        <label htmlFor="pdf-import-file" className="block text-sm font-medium">
          PDF file
        </label>
        <input
          id="pdf-import-file"
          name="file"
          type="file"
          accept=".pdf,application/pdf"
          // Deliberately not `required`: this component's own submit
          // handler already rejects a missing file with a clear
          // role="alert" message (see handleAttachSubmit's `if (!file)`
          // check) -- native file-input constraint validation is redundant
          // with that, and unlike a real browser's, isn't reliably
          // satisfied by a programmatically-assigned FileList (e.g. in
          // component tests).
          onChange={onFileChange}
          className="mt-1 w-full rounded-md border border-border-subtle px-3 py-2 text-sm dark:bg-transparent"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Up to {MAX_MB} MB. Select the pages to attach as images after
          uploading — the story text is added afterwards in the editor.
        </p>
        <button
          type="button"
          onClick={handlePreview}
          disabled={!file || previewLoading}
          className="mt-2 rounded-md border border-border-subtle px-3 py-1.5 text-sm font-medium disabled:opacity-60"
        >
          {previewLoading ? "Reading PDF…" : "Upload & preview pages"}
        </button>
        {previewError && (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {previewError}
          </p>
        )}
      </div>

      {pages && pages.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Select pages to attach</h2>
            <p
              aria-live="polite"
              className={`text-sm ${limitReached ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}
            >
              {selectedPages.length} of {MAX_IMAGES_PER_REVISION} selected
              {limitReached ? " — limit reached" : ""}
            </p>
          </div>

          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {pages.map((page) => {
              const selected = selectedPages.includes(page.pageNumber);
              const disabled = !selected && limitReached;
              return (
                <li key={page.pageNumber} className="space-y-2">
                  <button
                    type="button"
                    onClick={() => toggleSelect(page.pageNumber)}
                    disabled={disabled}
                    aria-pressed={selected}
                    aria-label={
                      disabled
                        ? `Page ${page.pageNumber}, limit of ${MAX_IMAGES_PER_REVISION} pages reached`
                        : `Page ${page.pageNumber}${selected ? ", selected" : ""}`
                    }
                    title={
                      disabled
                        ? `Limit of ${MAX_IMAGES_PER_REVISION} pages reached`
                        : undefined
                    }
                    className={`relative aspect-[3/4] w-full overflow-hidden rounded-md border-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40 ${
                      selected
                        ? "border-accent ring-2 ring-accent"
                        : "border-border-subtle hover:bg-surface-muted"
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- a base64 data URL, not an optimizable static asset */}
                    <img
                      src={page.dataUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                    <span className="absolute left-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-xs text-white">
                      {page.pageNumber}
                    </span>
                    {selected && (
                      <span className="absolute right-1 top-1 rounded-full bg-accent px-1.5 py-0.5 text-xs font-semibold text-accent-foreground">
                        ✓
                      </span>
                    )}
                  </button>

                  {selected && (
                    <div>
                      <label
                        htmlFor={`pdf-alt-text-${page.pageNumber}`}
                        className="block text-xs font-medium"
                      >
                        Alt text for page {page.pageNumber} (required)
                      </label>
                      <input
                        id={`pdf-alt-text-${page.pageNumber}`}
                        type="text"
                        required
                        value={altText[page.pageNumber] ?? ""}
                        onChange={(e) =>
                          setAltText((prev) => ({
                            ...prev,
                            [page.pageNumber]: e.target.value,
                          }))
                        }
                        maxLength={500}
                        placeholder="Describe this page"
                        className="mt-1 w-full rounded border border-border-subtle px-2 py-1 text-xs dark:bg-transparent"
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <button
        type="submit"
        disabled={!canSubmit}
        className="inline-flex items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground disabled:opacity-60"
      >
        {submitting ? "Creating…" : "Create Import Draft"}
      </button>
    </form>
  );
}
