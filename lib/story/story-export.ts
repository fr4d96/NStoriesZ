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
export function exportStatusLabel(
  lifecycleStatus: string,
  revisionStatus: string,
): string {
  switch (revisionStatus) {
    case "approved":
      return lifecycleStatus === "published" ? "Published" : "Approved";
    case "draft":
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
