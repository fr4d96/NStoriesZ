import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  getStoryForModerator,
  getPublishedRevisionSnapshot,
  getStoryModerationHistory,
  getStoryEditorialHistory,
  listReportsForStaff,
  parseModeratorMedia,
} from "@/lib/story/moderation";
import { normalizeStoryContentJson } from "@/lib/story/legacy-content";
import { getPublishedStoryMedia } from "@/lib/story/public-queries";
import { getPublicImageUrl } from "@/lib/story/public-image-url";
import { imageBlockMediaIds } from "@/lib/validation/story";
import {
  ContentBlockRenderer,
  type ContentBlockMediaMap,
} from "@/components/story/content-block-renderer";
import { PreviewContentBody } from "@/components/story/preview-content-body";
import { PreviewGallery } from "@/components/story/preview-gallery";
import { ReviewControls } from "./review-controls";

export const metadata: Metadata = {
  title: "Review Story",
  robots: { index: false, follow: false },
};

// Staff review content -- may reflect draft/pending state -- never
// cached/pre-rendered.
export const dynamic = "force-dynamic";

/**
 * URL param decision: `[id]` is a REVISION id, not a story id.
 *
 * get_story_for_moderator()'s own key is revision_id, and the brief itself
 * emphasizes reviewing "the exact submitted revision" -- a story can have
 * more than one revision across its lifetime (rejected, changes_requested,
 * resubmitted), so a story-id URL would be ambiguous about which
 * revision's content is actually being displayed, and would need an extra
 * "current submitted revision for this story" lookup that doesn't exist as
 * a moderator-scoped function today. A revision-id URL is unambiguous and
 * matches this page's primary data source directly. story_id (needed for
 * moderation/editorial history and reports, none of which are keyed by
 * revision) is derived from the fetched row, not re-parsed from the URL.
 */
export default async function ModerationReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: revisionId } = await params;

  const rows = await getStoryForModerator(revisionId).catch(() => null);
  const detail = rows?.[0];
  if (!detail) notFound();

  const [
    snapshotRows,
    moderationHistory,
    editorialHistory,
    reports,
    publishedMedia,
  ] = await Promise.all([
    getPublishedRevisionSnapshot(detail.story_id),
    getStoryModerationHistory(detail.story_id),
    getStoryEditorialHistory(detail.story_id),
    listReportsForStaff({ storyId: detail.story_id, limit: 50 }),
    // Anonymous-safe (get_published_story_media requires visibility =
    // 'public' AND lifecycle_status = 'published'): during a replacement
    // review the story stays published throughout, so this is exactly the
    // currently-live media set to compare against -- and it's already
    // promoted to the public bucket, so unlike `media` below (the
    // submitted revision's, still private) it needs no signed-URL mint,
    // just a plain public URL.
    getPublishedStoryMedia(detail.story_id),
  ]);
  const publishedSnapshot = snapshotRows[0] ?? null;
  const isReplacement = publishedSnapshot !== null;

  const parsedContent = normalizeStoryContentJson(detail.content_json);
  const parsedPublishedContent = publishedSnapshot
    ? normalizeStoryContentJson(publishedSnapshot.content_json)
    : null;

  const publishedContentMedia: ContentBlockMediaMap = {};
  if (parsedPublishedContent) {
    const inlineIds = new Set(imageBlockMediaIds(parsedPublishedContent));
    for (const m of publishedMedia) {
      if (!inlineIds.has(m.media_id)) continue;
      const url = getPublicImageUrl(m.public_url);
      if (url) {
        publishedContentMedia[m.media_id] = {
          url,
          altText: m.alt_text,
          decorative: m.decorative,
        };
      }
    }
  }

  const media = parseModeratorMedia(detail.media);
  const openReports = reports.filter(
    (r) => r.status === "open" || r.status === "reviewing",
  );

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 sm:py-16">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {detail.title}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            /{detail.slug} — revision #{detail.revision_number} (
            {detail.revision_status}){isReplacement ? " — replacement" : ""}
          </p>
        </div>
      </div>

      <section className="mt-8 rounded-md border border-border-subtle p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Attribution, consent &amp; image rights
        </h2>
        <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Attribution</dt>
            <dd>
              {detail.attribution_value ?? "—"} (
              {detail.attribution_type ?? "unknown"})
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Consent valid</dt>
            <dd>{detail.consent_valid ? "Yes" : "No"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Confirmation method</dt>
            <dd>{detail.confirmation_method ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Image rights confirmed</dt>
            <dd>
              {detail.image_rights_confirmed_at
                ? new Date(detail.image_rights_confirmed_at).toLocaleString(
                    "en-NZ",
                  )
                : "Not confirmed"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Identifiable people</dt>
            <dd>{detail.identifiable_people_state ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">All media processed</dt>
            <dd>{detail.media_processed ? "Yes" : "No"}</dd>
          </div>
        </dl>
      </section>

      {media.length > 0 && (
        // Collapsed by default -- a moderator lands here to read the story
        // first, not to see thumbnails before anything else; opening this
        // is a deliberate choice, not the first thing on the page.
        <details className="mt-6 rounded-md border border-border-subtle">
          <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Media ({media.length})
          </summary>
          <div className="border-t border-border-subtle p-4">
            <PreviewGallery media={media} />
            <ul className="mt-3 space-y-2 text-sm">
              {media.map((m) => (
                <li
                  key={m.mediaId}
                  className="flex flex-wrap items-center justify-between gap-2 rounded border border-border-subtle px-3 py-2"
                >
                  <span>
                    {m.isCover ? "Cover — " : ""}
                    {m.caption || m.altText || "(no caption)"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {m.processingState}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </details>
      )}

      <section className="mt-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {isReplacement
            ? "Submitted revision (replacement)"
            : "Submitted revision"}
        </h2>
        {isReplacement ? (
          <div className="mt-3 grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="rounded-md border border-border-subtle p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Currently published
              </h3>
              <p className="mt-2 text-lg font-semibold">
                {publishedSnapshot?.title}
              </p>
              <div className="mt-3">
                {parsedPublishedContent ? (
                  <ContentBlockRenderer
                    blocks={parsedPublishedContent}
                    media={publishedContentMedia}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Could not render published content.
                  </p>
                )}
              </div>
            </div>
            <div className="rounded-md border border-amber-300 p-4 dark:border-amber-700">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                Submitted (under review)
              </h3>
              <p className="mt-2 text-lg font-semibold">{detail.title}</p>
              <div className="mt-3">
                {parsedContent ? (
                  <PreviewContentBody blocks={parsedContent} media={media} />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Could not render submitted content.
                  </p>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-3 rounded-md border border-border-subtle p-4">
            {parsedContent ? (
              <PreviewContentBody blocks={parsedContent} media={media} />
            ) : (
              <p className="text-sm text-muted-foreground">
                Could not render submitted content.
              </p>
            )}
          </div>
        )}
      </section>

      {openReports.length > 0 && (
        <section className="mt-6 rounded-md border border-red-300 p-4 dark:border-red-700">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-destructive">
            Open reports ({openReports.length})
          </h2>
          <ul className="mt-3 space-y-2 text-sm">
            {openReports.map((r) => (
              <li
                key={r.id}
                className="rounded border border-red-200 px-3 py-2 dark:border-red-800"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{r.category}</span>
                  <span className="text-xs text-muted-foreground">
                    {r.status} —{" "}
                    {new Date(r.created_at).toLocaleDateString("en-NZ")}
                  </span>
                </div>
                {r.details && (
                  <p className="mt-1 text-muted-foreground">{r.details}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-6 rounded-md border border-border-subtle p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Moderation history
        </h2>
        {moderationHistory.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            No prior moderation decisions.
          </p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {moderationHistory.map((h) => (
              <li
                key={h.action_id}
                className="border-b border-border-subtle pb-2"
              >
                <span className="font-medium">
                  {h.previous_status} → {h.new_status}
                </span>{" "}
                <span className="text-muted-foreground">
                  {new Date(h.created_at).toLocaleString("en-NZ")}
                </span>
                {h.user_facing_reason && (
                  <p className="mt-1 text-muted-foreground">
                    {h.user_facing_reason}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6 rounded-md border border-border-subtle p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Editorial history
        </h2>
        {editorialHistory.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            No editorial preparation history.
          </p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {editorialHistory.map((h) => (
              <li key={h.id} className="border-b border-border-subtle pb-2">
                <span className="font-medium">{h.action_type}</span>{" "}
                <span className="text-muted-foreground">
                  {new Date(h.created_at).toLocaleString("en-NZ")}
                </span>
                <p className="mt-1 text-muted-foreground">{h.summary}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ReviewControls
        revisionId={detail.revision_id}
        storyId={detail.story_id}
        storyVersion={detail.story_version}
        revisionStatus={detail.revision_status}
      />
    </div>
  );
}
