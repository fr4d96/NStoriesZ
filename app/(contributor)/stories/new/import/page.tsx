import type { Metadata } from "next";
import Link from "next/link";
import { PdfImportPicker } from "../pdf-import-picker";

export const metadata: Metadata = {
  title: "Import from PDF",
};

export const dynamic = "force-dynamic";

/**
 * Contributor-facing entry point for the PDF/Canva import flow — the same
 * feature editors already have at /editorial/new (see
 * app/(editor)/editorial/new/pdf-import-picker.tsx), now available to any
 * signed-in contributor for their own story rather than staff-only.
 * Deliberately kept as a separate route from /stories/new (which stays a
 * zero-click "start a blank draft" redirect, per start-new-story.tsx's own
 * comment) so every existing "New Story" entry point's behavior is
 * unchanged; this page is linked from those same entry points as a second
 * option instead.
 */
export default function NewStoryImportPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        Import from PDF or Canva
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Upload a PDF (including a Canva export) and pick the pages to use as
        photos. Your story text is added afterwards in the editor.{" "}
        <Link href="/stories/new" className="underline underline-offset-2">
          Start a blank story instead
        </Link>
        .
      </p>
      <PdfImportPicker />
    </div>
  );
}
