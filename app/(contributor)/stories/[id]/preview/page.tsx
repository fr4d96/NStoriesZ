import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getStoryPreview } from "@/lib/story/contributor-queries";
import { storyContentSchema } from "@/lib/validation/story";
import { ContentBlockRenderer } from "@/components/story/content-block-renderer";
import { PreviewGallery } from "@/components/story/preview-gallery";

// Never statically generated or cached — this can show unpublished,
// draft-only content, so every request must re-authorize against the live
// session (Engineering Rules 10-13). Cache-Control: no-store for this path
// is additionally set in proxy.ts, since a page component itself can only
// influence caching, not append arbitrary response headers.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Preview",
  robots: { index: false, follow: false },
};

export default async function StoryPreviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let preview;
  try {
    preview = await getStoryPreview(id);
  } catch {
    notFound();
  }
  if (!preview) notFound();

  const parsedContent = storyContentSchema.safeParse(preview.contentJson);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
      <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
        Private preview — this is exactly what your story looks like right now.
        This page is never public, and isn&apos;t indexed by search engines.
      </div>

      <h1 className="mt-6 text-2xl font-semibold tracking-tight sm:text-3xl">
        {preview.title}
      </h1>
      {preview.excerpt && (
        <p className="mt-2 text-black/70 dark:text-white/70">
          {preview.excerpt}
        </p>
      )}

      <p className="mt-4 text-sm text-black/60 dark:text-white/60">
        Personal experience, not advice — shared by {preview.attributionValue}.
      </p>

      {preview.media.length > 0 && (
        <div className="mt-6">
          <PreviewGallery media={preview.media} />
        </div>
      )}

      <div className="mt-8">
        {parsedContent.success ? (
          <ContentBlockRenderer blocks={parsedContent.data} />
        ) : (
          <p className="text-red-600 dark:text-red-400">
            This draft&apos;s content couldn&apos;t be rendered.
          </p>
        )}
      </div>
    </div>
  );
}
