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
 * Kept as a separate route from /stories/new, which is the blank-story
 * path: both now ask for a title before anything is created, and each one
 * links across to the other, so a contributor who lands on the wrong one
 * is a single click from the right one.
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
