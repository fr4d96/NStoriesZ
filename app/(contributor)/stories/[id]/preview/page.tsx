import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getStoryPreview,
  getRevisionSelections,
} from "@/lib/story/contributor-queries";
import { imageBlockMediaIds, storyContentText } from "@/lib/validation/story";
import { normalizeStoryContentJson } from "@/lib/story/legacy-content";
import { PreviewContentBody } from "@/components/story/preview-content-body";
import { PreviewGallery } from "@/components/story/preview-gallery";
import { SubmitConsentPanel } from "@/components/story/submit-consent-panel";
import { ContributorReviewPanel } from "@/components/story/contributor-review-panel";
import { WhatsPublicSummary } from "@/components/story/whats-public-summary";
import { StickyVisible } from "@/components/sticky-visible";
import { StoryStepProgress } from "@/components/story/story-steps";
import {
  EDITING_STORY_STEPS,
  missingStoryRequirements,
  type StoryStepId,
} from "@/lib/story/steps";

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

  const parsedContent = normalizeStoryContentJson(preview.contentJson);

  // Same "don't show an inline-placed image twice" rule as the public page
  // (app/(public)/stories/[id]/page.tsx) -- see
  // components/story/story-gallery.tsx's header comment.
  const inlineMediaIds = new Set(
    parsedContent ? imageBlockMediaIds(parsedContent) : [],
  );
  const galleryMedia = preview.media.filter(
    (m) => !inlineMediaIds.has(m.mediaId),
  );

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

  // Mirrors _revision_is_editable() (supabase/migrations/20260803090250_story_internal_helpers.sql):
  // the previewed revision is the story's editable draft only when its own
  // status is still "draft" and the story is in ordinary or replacement
  // authoring -- not frozen for contributor review or any other lifecycle
  // state. get_story_preview() always resolves revisionId to
  // coalesce(current_draft_revision_id, published_revision_id), so a
  // "draft" revisionStatus here can only mean that resolved to the current
  // draft.
  const canEdit =
    preview.revisionStatus === "draft" &&
    (preview.lifecycleStatus === "draft" ||
      preview.lifecycleStatus === "published");

  // Required-before-submit gate: Title/Story content already have their own
  // stricter server-side enforcement (revisionInputSchema rejects an empty
  // title or content on every save), but this is the one place a story
  // could still legitimately reach with an empty title/content -- right
  // after /stories/new creates the shell (content_json defaults to `[]`,
  // which normalizeStoryContentJson() correctly refuses to treat as real
  // content) and before the contributor has written anything yet. Location
  // and tags have no such save-time enforcement at all -- set_locations/
  // set_tags accept an empty selection, by design, since a contributor adds
  // them incrementally. This is deliberately a UI-only gate (SubmitConsentPanel
  // stays hidden, the RPC itself is untouched) rather than a new DB
  // constraint: `submit_revision_with_consent()` is exercised by
  // tests/integration/story-rls.integration.test.ts's `publishOwnerStory()`
  // helper across dozens of fixtures that never call set_revision_locations/
  // set_revision_tags, so a hard requirement there would break test:rls, not
  // just this form.
  const selections = canSubmitOwnConsent
    ? await getRevisionSelections(preview.revisionId)
    : null;
  // missingStoryRequirements() (lib/story/steps.ts) rather than an inline
  // list: the editor gates its own "Review & submit" button on the same
  // function, so it can never send a contributor here only for this page to
  // turn them away with a differently-worded complaint. The gate itself is
  // unchanged -- still computed server-side, from this request's own fresh
  // getStoryPreview()/getRevisionSelections() reads, and still only a UI
  // gate on top of submit_revision_with_consent()'s authoritative check.
  const missingRequirements = canSubmitOwnConsent
    ? missingStoryRequirements({
        title: preview.title,
        hasContent: Boolean(
          parsedContent && storyContentText(parsedContent).trim(),
        ),
        locationCount: selections?.locations.length ?? 0,
        tagCount: selections?.tags.length ?? 0,
      })
    : [];

  // This page is the LAST step of the editor's timeline (see
  // components/story/story-steps.tsx), so it shows the same progress bar,
  // with every earlier step linking back into the editor at that exact
  // step. Only while the draft is still editable -- once it has been
  // submitted there is no step to go back to, and the bar would be
  // offering navigation that 404s on arrival.
  //
  // Completeness is read from the data this page already fetched, not
  // recomputed from a second source: the first three entries are literally
  // the inverse of `missingRequirements` above, so a tick here can never
  // disagree with what the submit gate says.
  const doneSteps: StoryStepId[] = (
    [
      [Boolean(preview.title.trim()), "title"],
      [
        Boolean(parsedContent && storyContentText(parsedContent).trim()),
        "story",
      ],
      [preview.media.length > 0, "photos"],
      [Boolean(preview.tripYear ?? preview.tripStartDate), "trip"],
      [
        Boolean(selections?.locations.length && selections?.tags.length),
        "places",
      ],
    ] as const
  )
    .filter(([filled]) => filled)
    .map(([, id]) => id);

  // The step behind the FIRST unmet requirement -- what the "Add a title,
  // at least one tag before you can submit" notice links to, so the fix is
  // one click away instead of a hunt through the timeline. Read straight
  // off the list the notice renders, so the link always points at the first
  // thing that notice actually names.
  const firstMissingStep: StoryStepId = missingRequirements[0]?.step ?? "title";

  const stepHrefs = Object.fromEntries(
    EDITING_STORY_STEPS.map((s) => [
      s.id,
      `/stories/${preview.storyId}/edit?step=${s.id}`,
    ]),
  ) as Partial<Record<StoryStepId, string>>;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      <div className="flex items-center justify-between gap-4 text-sm font-bold">
        {canEdit ? (
          <Link
            href={`/stories/${preview.storyId}/edit?step=places`}
            className="text-accent underline underline-offset-2"
          >
            ← Back to editing
          </Link>
        ) : (
          <span />
        )}
        <Link
          href="/my-stories"
          className="text-foreground/70 underline underline-offset-2"
        >
          Back to My Stories
        </Link>
      </div>

      {canEdit && (
        <div className="mt-4 border-b border-border-subtle pb-4">
          <StoryStepProgress
            currentStep="review"
            doneSteps={doneSteps}
            hrefs={stepHrefs}
          />
        </div>
      )}

      <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
        Private preview — this is exactly what your story looks like right now.
        This page is never public, and isn&apos;t indexed by search engines.
      </div>

      <h1 className="mt-6 text-2xl font-semibold tracking-tight sm:text-3xl">
        {preview.title}
      </h1>
      {preview.excerpt && (
        <p className="mt-2 text-muted-foreground">{preview.excerpt}</p>
      )}

      <p className="mt-4 text-sm text-muted-foreground">
        Personal experience, not advice — shared by {preview.attributionValue}.
      </p>

      {galleryMedia.length > 0 && (
        <div className="mt-6">
          <PreviewGallery media={galleryMedia} />
        </div>
      )}

      <div className="mt-8">
        {parsedContent ? (
          <PreviewContentBody blocks={parsedContent} media={preview.media} />
        ) : (
          <p className="text-destructive">
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
          {missingRequirements.length > 0 ? (
            <div
              role="status"
              className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
            >
              <p className="font-medium">
                Add {missingRequirements.map((r) => r.label).join(", ")} before
                you can submit.
              </p>
              {canEdit && (
                <Link
                  href={`/stories/${preview.storyId}/edit?step=${firstMissingStep}`}
                  className="mt-1 inline-block underline underline-offset-2"
                >
                  Go to that step
                </Link>
              )}
            </div>
          ) : (
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
          )}
        </div>
      </StickyVisible>
    </div>
  );
}
