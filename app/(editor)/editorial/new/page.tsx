import type { Metadata } from "next";
import { listContributorsForEditorial } from "@/lib/story/editorial-queries";
import { NewImportForm } from "./new-import-form";

export const metadata: Metadata = {
  title: "New Editorial Import",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function NewEditorialImportPage() {
  const contributors = await listContributorsForEditorial();

  return (
    <div className="mx-auto max-w-xl px-4 py-12 sm:px-6 sm:py-16">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        New Editorial Import
      </h1>
      <p className="mt-2 text-sm text-black/60 dark:text-white/60">
        Start a founding-catalogue import for an existing or new contributor
        record. You&apos;ll add the story content, images, and attribution
        details on the next page.
      </p>
      <NewImportForm contributors={contributors} />
    </div>
  );
}
