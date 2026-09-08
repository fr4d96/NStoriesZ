/**
 * Pure labelling helpers for the contributor PDF export
 * (app/(contributor)/stories/[id]/export/route.ts).
 *
 * Kept out of the route handler so they can be tested without a request, a
 * session or a database, and out of lib/story/story-pdf.ts so that module
 * stays a renderer that knows nothing about this product's lifecycle enums.
 */

/**
 * What this copy actually is, printed on the PDF so a downloaded file can
 * never be mistaken for the live published story.
 *
 * `get_story_preview()` resolves the revision as
 * `coalesce(current_draft_revision_id, published_revision_id)`, so a
 * published story with an edit in flight exports the DRAFT — and saying
 * "Published" there would be a lie about the very thing Engineering Rule 11
 * exists to keep separate.
 */
/**
 * Whether a story may be exported as a PDF at all.
 *
 * The rule: a story that is still a PLAIN, NEVER-SUBMITTED DRAFT cannot be
 * downloaded. Everything else can — in review, published, published with an
 * edit in flight, sent back for changes, rejected, archived, and private.
 *
 * The reasoning is that a download is a copy of a *finished* thing. A draft
 * nobody has ever done anything with is half-written by definition, and the
 * contributor already has the editor open on it; a PDF of it is a copy of
 * work in progress, which is not what "keep a copy" means.
 *
 * The two cases that look like drafts but are NOT, both deliberate:
 *
 *   * A PUBLISHED story being edited again previews its in-flight draft
 *     (`revisionStatus === "draft"`, `lifecycleStatus === "published"`), but
 *     the story itself has been submitted and published — so it exports.
 *     exportStatusLabel() already has a name for precisely this state,
 *     "Unpublished draft update", and it would be unreachable otherwise.
 *   * A PRIVATE story's revision stays `draft` forever by design
 *     (20260907100100_private_stories.sql) — that is the mechanism keeping
 *     it out of moderation, not a sign it is unfinished. It is a completed
 *     story its author chose to keep, which makes "let me keep a copy" the
 *     strongest case there is. exportStatusLabel() labels it "Private".
 *
 * Both conditions are checked, not just the lifecycle: `lifecycleStatus`
 * can be `draft` while the revision is not (withdraw_unstarted_submission()
 * reverts the story to `draft` and the revision to `withdrawn`), and this
 * should describe the revision actually being exported.
 *
 * NOT an authorization decision on its own. The preview page uses it to
 * decide whether to draw the link, and app/(contributor)/stories/[id]/export
 * uses it to decide whether to answer at all — the route is the boundary
 * that matters, since it is reachable by typing the URL (Engineering Rule
 * 2). One function so those two can never drift into disagreeing.
 */
export function canExportStory(
  lifecycleStatus: string,
  revisionStatus: string,
): boolean {
  return !(lifecycleStatus === "draft" && revisionStatus === "draft");
}

export function exportStatusLabel(
  lifecycleStatus: string,
  revisionStatus: string,
): string {
  switch (revisionStatus) {
    case "approved":
      return lifecycleStatus === "published" ? "Published" : "Approved";
    case "draft":
      // A private story's revision stays a DRAFT forever -- that is what
      // keeps it out of the moderation queue and its images out of public
      // delivery (20260907100100_private_stories.sql). So "Draft" is where
      // it would land by default, and that would be misleading in the one
      // place this label exists to be honest: a downloaded PDF, read later,
      // with none of the app around it to say otherwise.
      if (lifecycleStatus === "private") return "Private";
      return lifecycleStatus === "published"
        ? "Unpublished draft update"
        : "Draft";
    case "submitted":
      return lifecycleStatus === "published" ? "Update in review" : "In review";
    case "changes_requested":
      return "Changes requested";
    case "rejected":
      return "Not published";
    case "withdrawn":
      return "Withdrawn";
    case "superseded":
      return "Superseded";
    default:
      // A status added to the enum without updating this map should read as
      // unknown rather than silently as "Published".
      return "Unpublished";
  }
}

/**
 * "2025-03-01 – 2026-02-28", or the bare year, or nothing. Mirrors the public
 * story page's own `tripLabel` (app/(public)/stories/[id]/page.tsx) so the
 * export and the live page never describe the same trip differently.
 */
export function tripLabel(
  tripStartDate: string | null,
  tripEndDate: string | null,
  tripYear: number | null,
): string | null {
  if (tripStartDate && tripEndDate) return `${tripStartDate} – ${tripEndDate}`;
  if (tripYear) return String(tripYear);
  return null;
}

/** "midRange" -> "Mid range", matching the editor's own display helper. */
export function travelStyleLabel(value: string | null): string | null {
  if (!value) return null;
  const spaced = value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * `filename=` must stay ASCII for older clients, while `filename*` carries the
 * real, possibly non-ASCII name (RFC 5987). Both are emitted, ASCII first, so
 * every client picks the best one it understands.
 */
export function contentDispositionAttachment(
  asciiFilename: string,
  utf8Filename: string,
): string {
  const encoded = encodeURIComponent(utf8Filename);
  return `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encoded}`;
}
