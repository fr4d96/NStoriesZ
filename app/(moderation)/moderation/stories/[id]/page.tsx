import type { Metadata } from "next";
import Link from "next/link";
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
import { imageBlockMediaIds, storyContentText } from "@/lib/validation/story";
import {
  ContentBlockRenderer,
  type ContentBlockMediaMap,
} from "@/components/story/content-block-renderer";
import { PreviewContentBody } from "@/components/story/preview-content-body";
import { PreviewGallery } from "@/components/story/preview-gallery";
import {
  SOURCE_KIND_LABELS,
  CONSENT_METHOD_LABELS,
  labelFor,
  relativeTime,
  absoluteTime,
} from "@/lib/story/moderation-queue-view";
import { AlertCircleIcon, CheckCircleIcon } from "@/components/icons";
import { ReviewControls } from "./review-controls";

export const metadata: Metadata = {
  title: "Review Story",
  robots: { index: false, follow: false },
};

// Staff review content -- may reflect draft/pending state -- never
// cached/pre-rendered.
export const dynamic = "force-dynamic";

const SECTION_HEADING =
  "font-mono text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground";

/**
 * One fact in the review sidebar. `ok` drives an icon and colour, so a
 * moderator can scan the column for red rather than read six sentences;
 * `ok: null` means "informational, there is nothing to pass or fail here".
 */
function Check({
  label,
  value,
  ok,
}: {
  label: string;
  value: React.ReactNode;
  ok?: boolean | null;
}) {
  return (
    <div className="flex items-start gap-2.5 py-2">
      {ok === true && (
        <CheckCircleIcon
          aria-hidden="true"
          className="mt-0.5 h-4 w-4 shrink-0 text-accent"
        />
      )}
      {ok === false && (
        <AlertCircleIcon
          aria-hidden="true"
          className="mt-0.5 h-4 w-4 shrink-0 text-destructive"
        />
      )}
      {(ok === undefined || ok === null) && (
        <span
          aria-hidden="true"
          className="mt-2 h-1 w-1 shrink-0 rounded-full bg-muted-foreground"
        />
      )}
      <div className="min-w-0">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd
          className={`text-sm ${ok === false ? "font-semibold text-destructive" : ""}`}
        >
          {value}
        </dd>
      </div>
    </div>
  );
}

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

  // Two DIFFERENT failures were previously collapsed into one dead-end
  // message ("Could not render submitted content."), which is why a
  // moderator hitting the queue saw it over and over with nothing to do
  // about it:
  //
  //   * The revision genuinely has no content -- content_json is `[]`, the
  //     shape create_self_service_draft() starts every story with. That is
  //     not a rendering failure at all; it is a complete, reviewable fact
  //     about the submission, and the right response is "request changes".
  //     (submit_revision_with_consent() refuses these as of migration
  //     20260902090000, but revisions submitted before that migration are
  //     still sitting in the queue and must remain reviewable.)
  //   * The revision HAS content that today's storyContentSchema cannot
  //     read back even after legacy conversion -- a real, rare defect worth
  //     naming as one.
  const rawContentIsEmpty =
    !Array.isArray(detail.content_json) || detail.content_json.length === 0;
  const contentIsEmpty =
    rawContentIsEmpty ||
    (parsedContent !== null && storyContentText(parsedContent).trim() === "");
  const contentFailedToParse = !contentIsEmpty && parsedContent === null;

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
  const regionNames = detail.region_names ?? [];
  const tagNames = detail.tag_names ?? [];
  const now = new Date();
  const submittedRelative = relativeTime(detail.submitted_at, now);

  // The body the moderator is actually deciding on, rendered once and
  // reused by both the single-column and side-by-side layouts below.
  const submittedBody = contentIsEmpty ? (
    <div className="rounded-lg border border-destructive/40 bg-destructive/[0.06] p-5">
      <p className="flex items-center gap-2 text-sm font-semibold text-destructive">
        <AlertCircleIcon aria-hidden="true" className="h-4 w-4 shrink-0" />
        This submission has no story content.
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        The contributor submitted a title without writing the story. Nothing
        here can be published as-is — request changes with a note asking them to
        write the story, and it will come back to this queue.
      </p>
    </div>
  ) : contentFailedToParse ? (
    <div className="rounded-lg border border-destructive/40 bg-destructive/[0.06] p-5">
      <p className="flex items-center gap-2 text-sm font-semibold text-destructive">
        <AlertCircleIcon aria-hidden="true" className="h-4 w-4 shrink-0" />
        This revision&rsquo;s stored content could not be read.
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        It is not empty, but it does not match any content shape this app can
        render. Do not approve it — this is a defect worth reporting rather than
        a contributor mistake.
      </p>
    </div>
  ) : (
    <PreviewContentBody blocks={parsedContent!} media={media} />
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      <Link
        href="/moderation/stories"
        className="text-sm underline underline-offset-4 hover:text-accent"
      >
        ← Back to the queue
      </Link>

      <header className="mt-4">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <span className="rounded-full border border-border-subtle px-2.5 py-0.5 font-mono text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {labelFor(SOURCE_KIND_LABELS, detail.source_kind)}
          </span>
          <span className="rounded-full border border-border-subtle px-2.5 py-0.5 font-mono text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Revision #{detail.revision_number} · {detail.revision_status}
          </span>
          {isReplacement && (
            <span className="rounded-full bg-tag-background px-2.5 py-0.5 font-mono text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-tag-foreground">
              Replaces a live story
            </span>
          )}
        </div>

        <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
          {detail.title}
        </h1>

        <p className="mt-2 text-sm text-muted-foreground">
          <span className="text-foreground/80">
            {detail.contributor_display_name ?? "Unknown contributor"}
          </span>
          {submittedRelative && (
            <>
              {" · submitted "}
              <span title={absoluteTime(detail.submitted_at) ?? undefined}>
                {submittedRelative}
              </span>
            </>
          )}
        </p>
        <p className="mt-0.5 font-mono text-xs text-muted-foreground">
          /{detail.slug}
        </p>
      </header>

      {detail.contributor_note && (
        <section className="mt-6 rounded-xl border border-border-subtle bg-surface-muted p-4 sm:p-5">
          <h2 className={SECTION_HEADING}>Note from the contributor</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm">
            {detail.contributor_note}
          </p>
        </section>
      )}

      {openReports.length > 0 && (
        <section className="mt-6 rounded-xl border border-destructive/40 bg-destructive/[0.06] p-4 sm:p-5">
          <h2 className="font-mono text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-destructive">
            Open reports ({openReports.length})
          </h2>
          <ul className="mt-3 space-y-2 text-sm">
            {openReports.map((r) => (
              <li
                key={r.id}
                className="rounded-lg border border-destructive/30 px-3 py-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">{r.category}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {r.status} · {absoluteTime(r.created_at)}
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

      {/*
        Two columns from `lg` (The Two Shapes Rule: one grid, not two
        layouts) -- the story to read on the left, the facts to check on the
        right. Below `lg` this is a single column in reading order: story
        first, checks second, decision last, which is the order a moderator
        works in on a phone.
      */}
      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <main className="min-w-0">
          <h2 className={SECTION_HEADING}>
            {isReplacement
              ? "Submitted revision (replacement)"
              : "Submitted revision"}
          </h2>

          {isReplacement ? (
            <div className="mt-3 grid grid-cols-1 gap-4 xl:grid-cols-2">
              <div className="rounded-xl border border-border-subtle p-4">
                <h3 className={SECTION_HEADING}>Currently published</h3>
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
                      The published revision has no readable content.
                    </p>
                  )}
                </div>
              </div>
              <div className="rounded-xl border border-accent/50 p-4">
                <h3 className="font-mono text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-accent">
                  Submitted (under review)
                </h3>
                <p className="mt-2 text-lg font-semibold">{detail.title}</p>
                <div className="mt-3">{submittedBody}</div>
              </div>
            </div>
          ) : (
            <div className="mt-3 rounded-xl border border-border-subtle p-4 sm:p-6">
              {submittedBody}
            </div>
          )}

          {media.length > 0 && (
            // Collapsed by default -- a moderator lands here to read the
            // story first, not to see thumbnails before anything else.
            <details className="mt-6 rounded-xl border border-border-subtle">
              <summary
                className={`cursor-pointer select-none px-4 py-3 ${SECTION_HEADING}`}
              >
                Media ({media.length})
              </summary>
              <div className="border-t border-border-subtle p-4">
                <PreviewGallery media={media} />
                <ul className="mt-3 space-y-2 text-sm">
                  {media.map((m) => (
                    <li
                      key={m.mediaId}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border-subtle px-3 py-2"
                    >
                      <span>
                        {m.isCover ? "Cover — " : ""}
                        {m.caption || m.altText || "(no caption)"}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {m.processingState}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </details>
          )}

          <ReviewControls
            revisionId={detail.revision_id}
            storyId={detail.story_id}
            storyVersion={detail.story_version}
            revisionStatus={detail.revision_status}
            contentIsEmpty={contentIsEmpty || contentFailedToParse}
          />
        </main>

        <aside className="min-w-0 space-y-6 lg:sticky lg:top-6 lg:self-start">
          <section className="rounded-xl border border-border-subtle p-4">
            <h2 className={SECTION_HEADING}>Consent &amp; rights</h2>
            <dl className="mt-2 divide-y divide-border-subtle">
              <Check
                label="Consent on file"
                value={detail.consent_valid ? "Valid" : "Missing or invalid"}
                ok={detail.consent_valid}
              />
              <Check
                label="Attributed as"
                value={`${detail.attribution_value ?? "—"} (${detail.attribution_type ?? "unknown"})`}
              />
              <Check
                label="Confirmed by"
                value={
                  labelFor(CONSENT_METHOD_LABELS, detail.confirmation_method) ??
                  "—"
                }
              />
              <Check
                label="Image rights"
                value={
                  detail.image_rights_confirmed_at
                    ? (absoluteTime(detail.image_rights_confirmed_at) ??
                      "Confirmed")
                    : media.length === 0
                      ? "No images attached"
                      : "Not confirmed"
                }
                ok={
                  media.length === 0
                    ? null
                    : Boolean(detail.image_rights_confirmed_at)
                }
              />
              <Check
                label="Identifiable people"
                value={detail.identifiable_people_state ?? "—"}
                ok={
                  media.length === 0
                    ? null
                    : detail.identifiable_people_state === "confirmed" ||
                      detail.identifiable_people_state === "not_applicable"
                }
              />
              <Check
                label="Images processed"
                value={
                  media.length === 0
                    ? "No images attached"
                    : detail.media_processed
                      ? "All processed"
                      : "Some still processing"
                }
                ok={media.length === 0 ? null : detail.media_processed}
              />
            </dl>
          </section>

          <section className="rounded-xl border border-border-subtle p-4">
            <h2 className={SECTION_HEADING}>What this story claims</h2>
            <dl className="mt-2 divide-y divide-border-subtle">
              <Check
                label="Places"
                value={
                  regionNames.length > 0 ? regionNames.join(", ") : "None set"
                }
                ok={regionNames.length > 0 ? null : false}
              />
              <Check
                label="Tags"
                value={tagNames.length > 0 ? tagNames.join(", ") : "None set"}
                ok={tagNames.length > 0 ? null : false}
              />
              <Check
                label="Trip"
                value={
                  detail.trip_start_date && detail.trip_end_date
                    ? `${detail.trip_start_date} → ${detail.trip_end_date}`
                    : (detail.trip_year?.toString() ?? "Not given")
                }
              />
              <Check
                label="Travel style"
                value={detail.travel_style ?? "Not given"}
              />
            </dl>
          </section>

          <section className="rounded-xl border border-border-subtle p-4">
            <h2 className={SECTION_HEADING}>Moderation history</h2>
            {moderationHistory.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                No prior moderation decisions.
              </p>
            ) : (
              <ul className="mt-2 space-y-3 text-sm">
                {moderationHistory.map((h) => (
                  <li key={h.action_id}>
                    <span className="font-semibold">
                      {h.previous_status} → {h.new_status}
                    </span>
                    <p className="font-mono text-xs text-muted-foreground">
                      {absoluteTime(h.created_at)}
                    </p>
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

          {editorialHistory.length > 0 && (
            <section className="rounded-xl border border-border-subtle p-4">
              <h2 className={SECTION_HEADING}>Editorial history</h2>
              <ul className="mt-2 space-y-3 text-sm">
                {editorialHistory.map((h) => (
                  <li key={h.id}>
                    <span className="font-semibold">{h.action_type}</span>
                    <p className="font-mono text-xs text-muted-foreground">
                      {absoluteTime(h.created_at)}
                    </p>
                    <p className="mt-1 text-muted-foreground">{h.summary}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
