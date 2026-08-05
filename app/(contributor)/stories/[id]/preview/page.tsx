import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getStoryPreview } from "@/lib/story/contributor-queries";
import { storyContentSchema } from "@/lib/validation/story";
import { ContentBlockRenderer } from "@/components/story/content-block-renderer";
import { PreviewGallery } from "@/components/story/preview-gallery";
import { SubmitConsentPanel } from "@/components/story/submit-consent-panel";
import { ContributorReviewPanel } from "@/components/story/contributor-review-panel";
import { WhatsPublicSummary } from "@/components/story/whats-public-summary";
import { StickyVisible } from "@/components/sticky-visible";

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

  // Contributor-review "approve"/request-changes/decline (Prompt 4
  // Sub-phase 4): shown only to the linked contributor, only while the
  // story is awaiting THEIR approval of an editor-prepared draft.
  const isAwaitingThisContributorsApproval =
    preview.viewerRelationship === "linked_contributor" &&
    preview.lifecycleStatus === "awaiting_contributor_approval";

  // Ordinary consent-at-submission: owner (self-service) or linked
  // contributor (editorial import, once out of contributor-review limbo),
  // only while the current revision is still a submittable draft -- not
  // already submitted/approved/rejected/etc. Mirrors the server-side
  // submittability rule in submit_revision_with_consent() closely enough
  // for a "should we show this button at all" UI decision; the RPC itself
  // remains the authoritative check regardless of what this renders.
  const canSubmitOwnConsent =
    !isAwaitingThisContributorsApproval &&
    (preview.viewerRelationship === "owner" ||
      preview.viewerRelationship === "linked_contributor") &&
    preview.revisionStatus === "draft" &&
    (preview.lifecycleStatus === "draft" ||
      preview.lifecycleStatus === "published");

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

      <StickyVisible
        show={isAwaitingThisContributorsApproval || canSubmitOwnConsent}
      >
        <div className="mt-8">
          <WhatsPublicSummary
            attributionType={preview.attributionType}
            attributionValue={preview.attributionValue}
            hasExcerpt={Boolean(preview.excerpt)}
            imageCount={preview.media.length}
            decorativeImageCount={
              preview.media.filter((m) => m.decorative).length
            }
          />
        </div>
      </StickyVisible>

      <StickyVisible show={isAwaitingThisContributorsApproval}>
        <div className="mt-8">
          <ContributorReviewPanel
            storyId={preview.storyId}
            revisionId={preview.revisionId}
            expectedVersion={preview.version}
            hasMedia={preview.media.length > 0}
          />
        </div>
      </StickyVisible>

      <StickyVisible show={canSubmitOwnConsent}>
        <div className="mt-8">
          <SubmitConsentPanel
            storyId={preview.storyId}
            revisionId={preview.revisionId}
            expectedVersion={preview.version}
            hasMedia={preview.media.length > 0}
            isEditorialImport={preview.sourceKind === "editorial_import"}
            submitLabel={
              preview.lifecycleStatus === "published"
                ? "Submit correction for review"
                : "Submit for review"
            }
          />
        </div>
      </StickyVisible>
    </div>
  );
}
