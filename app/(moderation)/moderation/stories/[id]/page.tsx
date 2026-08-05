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
import { storyContentSchema } from "@/lib/validation/story";
import { ContentBlockRenderer } from "@/components/story/content-block-renderer";
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

  const [snapshotRows, moderationHistory, editorialHistory, reports] =
    await Promise.all([
      getPublishedRevisionSnapshot(detail.story_id),
      getStoryModerationHistory(detail.story_id),
      getStoryEditorialHistory(detail.story_id),
      listReportsForStaff({ storyId: detail.story_id, limit: 50 }),
    ]);
  const publishedSnapshot = snapshotRows[0] ?? null;
  const isReplacement = publishedSnapshot !== null;

  const parsedContent = storyContentSchema.safeParse(detail.content_json);
  const parsedPublishedContent = publishedSnapshot
    ? storyContentSchema.safeParse(publishedSnapshot.content_json)
    : null;

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
          <p className="mt-1 text-sm text-black/60 dark:text-white/60">
            /{detail.slug} — revision #{detail.revision_number} (
            {detail.revision_status}){isReplacement ? " — replacement" : ""}
          </p>
        </div>
      </div>

      <section className="mt-8 rounded-md border border-black/10 p-4 dark:border-white/10">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">
          Attribution, consent &amp; image rights
        </h2>
        <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-black/50 dark:text-white/50">Attribution</dt>
            <dd>
              {detail.attribution_value ?? "—"} (
              {detail.attribution_type ?? "unknown"})
            </dd>
          </div>
          <div>
            <dt className="text-black/50 dark:text-white/50">Consent valid</dt>
            <dd>{detail.consent_valid ? "Yes" : "No"}</dd>
          </div>
          <div>
            <dt className="text-black/50 dark:text-white/50">
              Confirmation method
            </dt>
            <dd>{detail.confirmation_method ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-black/50 dark:text-white/50">
              Image rights confirmed
            </dt>
            <dd>
              {detail.image_rights_confirmed_at
                ? new Date(detail.image_rights_confirmed_at).toLocaleString(
                    "en-NZ",
                  )
                : "Not confirmed"}
            </dd>
          </div>
          <div>
            <dt className="text-black/50 dark:text-white/50">
              Identifiable people
            </dt>
            <dd>{detail.identifiable_people_state ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-black/50 dark:text-white/50">
              All media processed
            </dt>
            <dd>{detail.media_processed ? "Yes" : "No"}</dd>
          </div>
        </dl>
      </section>

      {media.length > 0 && (
        <section className="mt-6 rounded-md border border-black/10 p-4 dark:border-white/10">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">
            Media ({media.length})
          </h2>
          <ul className="mt-3 space-y-2 text-sm">
            {media.map((m) => (
              <li
                key={m.mediaId}
                className="flex flex-wrap items-center justify-between gap-2 rounded border border-black/10 px-3 py-2 dark:border-white/10"
              >
                <span>
                  {m.isCover ? "Cover — " : ""}
                  {m.caption || m.altText || "(no caption)"}
                </span>
                <span className="text-xs text-black/50 dark:text-white/50">
                  {m.processingState}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">
          {isReplacement
            ? "Submitted revision (replacement)"
            : "Submitted revision"}
        </h2>
        {isReplacement ? (
          <div className="mt-3 grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="rounded-md border border-black/10 p-4 dark:border-white/10">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-black/50 dark:text-white/50">
                Currently published
              </h3>
              <p className="mt-2 text-lg font-semibold">
                {publishedSnapshot?.title}
              </p>
              <div className="mt-3">
                {parsedPublishedContent?.success ? (
                  <ContentBlockRenderer blocks={parsedPublishedContent.data} />
                ) : (
                  <p className="text-sm text-black/50">
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
                {parsedContent.success ? (
                  <ContentBlockRenderer blocks={parsedContent.data} />
                ) : (
                  <p className="text-sm text-black/50">
                    Could not render submitted content.
                  </p>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-3 rounded-md border border-black/10 p-4 dark:border-white/10">
            {parsedContent.success ? (
              <ContentBlockRenderer blocks={parsedContent.data} />
            ) : (
              <p className="text-sm text-black/50">
                Could not render submitted content.
              </p>
            )}
          </div>
        )}
      </section>

      {openReports.length > 0 && (
        <section className="mt-6 rounded-md border border-red-300 p-4 dark:border-red-700">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-red-700 dark:text-red-400">
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
                  <span className="text-xs text-black/50 dark:text-white/50">
                    {r.status} —{" "}
                    {new Date(r.created_at).toLocaleDateString("en-NZ")}
                  </span>
                </div>
                {r.details && (
                  <p className="mt-1 text-black/70 dark:text-white/70">
                    {r.details}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-6 rounded-md border border-black/10 p-4 dark:border-white/10">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">
          Moderation history
        </h2>
        {moderationHistory.length === 0 ? (
          <p className="mt-2 text-sm text-black/50 dark:text-white/50">
            No prior moderation decisions.
          </p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {moderationHistory.map((h) => (
              <li
                key={h.action_id}
                className="border-b border-black/5 pb-2 dark:border-white/5"
              >
                <span className="font-medium">
                  {h.previous_status} → {h.new_status}
                </span>{" "}
                <span className="text-black/50 dark:text-white/50">
                  {new Date(h.created_at).toLocaleString("en-NZ")}
                </span>
                {h.user_facing_reason && (
                  <p className="mt-1 text-black/70 dark:text-white/70">
                    {h.user_facing_reason}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6 rounded-md border border-black/10 p-4 dark:border-white/10">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">
          Editorial history
        </h2>
        {editorialHistory.length === 0 ? (
          <p className="mt-2 text-sm text-black/50 dark:text-white/50">
            No editorial preparation history.
          </p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {editorialHistory.map((h) => (
              <li
                key={h.id}
                className="border-b border-black/5 pb-2 dark:border-white/5"
              >
                <span className="font-medium">{h.action_type}</span>{" "}
                <span className="text-black/50 dark:text-white/50">
                  {new Date(h.created_at).toLocaleString("en-NZ")}
                </span>
                <p className="mt-1 text-black/70 dark:text-white/70">
                  {h.summary}
                </p>
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
