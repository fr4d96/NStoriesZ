// Custom, non-standard-Markdown embed token for images: `![[<mediaId>]]`, or
// `![[<mediaId>|<width>]]` once resized -- never a real `![alt](url)`.
// Keeping the syntax off-spec means a URL can never be typed directly into
// story content, so the private-bucket / approval / EXIF-strip workflow
// around story_revision_media (Engineering Rules 13/14) stays the only way
// an image reaches published content. See lib/validation/story.ts for the
// paired rule that rejects standard `![...](...)` syntax outright.
//
// `|<width>` is the image's stored display width in CSS pixels, written by
// the editor's drag-to-resize handle (components/story/editor/
// markdown-live-decorations.ts) -- optional; absent means "natural/default
// size." Bounded to MIN_EMBED_WIDTH..MAX_EMBED_WIDTH, matching
// MAX_PROCESSED_DIMENSION in lib/story/image-validation.ts (no point storing
// a width larger than the processed image actually is).
export const MIN_EMBED_WIDTH = 60;
export const MAX_EMBED_WIDTH = 2000;

export const MEDIA_EMBED_REGEX =
  /!\[\[([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\|(\d{2,4}))?\]\]/gi;

/** Every image mediaId embedded in a Markdown document, in document order. */
export function extractMediaIds(markdown: string): string[] {
  const ids: string[] = [];
  for (const match of markdown.matchAll(MEDIA_EMBED_REGEX)) {
    ids.push(match[1].toLowerCase());
  }
  return ids;
}

export type MediaEmbed = { mediaId: string; width?: number };

/** Every image embed (mediaId + optional stored display width), in document order. */
export function extractMediaEmbeds(markdown: string): MediaEmbed[] {
  const embeds: MediaEmbed[] = [];
  for (const match of markdown.matchAll(MEDIA_EMBED_REGEX)) {
    const width = match[2] ? Number(match[2]) : undefined;
    embeds.push({ mediaId: match[1].toLowerCase(), width });
  }
  return embeds;
}

export function clampEmbedWidth(width: number): number {
  return Math.round(
    Math.min(MAX_EMBED_WIDTH, Math.max(MIN_EMBED_WIDTH, width)),
  );
}

/**
 * Removes every embed token for one mediaId (with or without a `|width`
 * suffix) from a Markdown document.
 *
 * Used when an image is detached from a revision: the embed token must go
 * with it, or the content would keep pointing at an image the revision no
 * longer carries -- which renders as nothing at all on the published page,
 * while still looking fine in the editor (the editor resolves an embed by
 * mediaId through the private-preview signed URL, not through the
 * revision's media list). The database enforces the same clean-up
 * authoritatively inside detach_story_media(); this is the client-side half
 * that keeps the open editor in step. A token that was alone on its line
 * leaves that line empty, so the emptied line is collapsed rather than left
 * as a stray blank.
 */
export function removeMediaEmbeds(markdown: string, mediaId: string): string {
  const escapedId = mediaId.toLowerCase().replace(/[^0-9a-f-]/g, "");
  if (!escapedId) return markdown;
  const tokenPattern = new RegExp(
    `!\\[\\[${escapedId}(?:\\|\\d{2,4})?\\]\\]`,
    "gi",
  );
  return markdown
    .replace(tokenPattern, "")
    .replace(/^[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n");
}

export function mediaEmbedToken(mediaId: string, width?: number): string {
  return width
    ? `![[${mediaId}|${clampEmbedWidth(width)}]]`
    : `![[${mediaId}]]`;
}
