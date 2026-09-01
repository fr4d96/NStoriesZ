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

/**
 * Default display width (CSS px) for a freshly-uploaded inline image,
 * matching the ~320px an aspect-square tile actually renders at in
 * components/story/image-upload-manager.tsx's gallery grid (max-w-5xl
 * container, grid-cols-3 with gaps, on desktop) -- so a newly inserted
 * image starts out looking consistent with that panel instead of ballooning
 * to the editor's full text-column width. Still just a starting point: the
 * live editor's drag handle (markdown-live-decorations.ts) can resize it
 * afterward, same as any embed with a stored `|width`.
 */
export const DEFAULT_EMBED_WIDTH = 320;

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

/**
 * Moves the embed token occupying `[tokenFrom, tokenTo)` so it sits on its
 * own line at `targetPos` (a line boundary in the same document), and
 * returns the new document. Returns the input unchanged when the move is a
 * no-op or the range does not hold a token.
 *
 * A pure string transform, deliberately, rather than a pair of positional
 * CodeMirror changes. Two changes in one transaction have to reason about
 * whether the insertion point shifts when the deletion applies -- in both
 * directions, and differently again depending on whether the token owned
 * its line. Getting any of that subtly wrong corrupts the story text
 * silently instead of failing loudly, and none of it is testable without a
 * live editor. This is.
 *
 * If the token was alone on its line, the whole line moves with it
 * (including its newline), so a photo never leaves a blank gap behind.
 *
 * `mode` decides what the photo lands as. "line" puts it in a paragraph of
 * its own — the stacked layout, and the right answer for a drop between
 * paragraphs. A *blank* line either side, not a single newline: consecutive
 * non-blank lines are one Markdown paragraph, so photos separated by single
 * newlines are inline siblings and the published page packs as many onto a
 * row as fit. That made "stacked" a lie the editor told — it draws one
 * document line per row, the published page did not. A blank line makes
 * each stacked photo its own block, which is what the editor already
 * showed.
 * "inline" places it directly beside whatever is at `targetPos`, separated
 * by a single space, which is how two photos end up side by side: two
 * embed tokens on one Markdown line render as two inline-block images,
 * in the editor and on the published page alike (see
 * components/story/content-block-renderer.tsx's `frameClassName`, which is
 * already `inline-block` for any embed with a stored width).
 */
export function moveMediaEmbed(
  markdown: string,
  tokenFrom: number,
  tokenTo: number,
  targetPos: number,
  mode: "line" | "inline" = "line",
): string {
  const token = markdown.slice(tokenFrom, tokenTo);
  if (!token || !new RegExp(`^${MEDIA_EMBED_REGEX.source}$`, "i").test(token)) {
    return markdown;
  }

  const lineStart = markdown.lastIndexOf("\n", tokenFrom - 1) + 1;
  const lineEndIndex = markdown.indexOf("\n", tokenTo);
  const lineEnd = lineEndIndex === -1 ? markdown.length : lineEndIndex;
  const ownsLine = markdown.slice(lineStart, lineEnd).trim() === token;

  const removeFrom = ownsLine ? lineStart : tokenFrom;
  const removeTo = ownsLine ? Math.min(markdown.length, lineEnd + 1) : tokenTo;

  // Dropped back inside the range it came from: nothing to do, and a
  // whole-document replace for a no-op would still push an undo entry.
  if (targetPos >= removeFrom && targetPos <= removeTo) return markdown;

  const without = markdown.slice(0, removeFrom) + markdown.slice(removeTo);
  let insertAt = targetPos;
  if (targetPos > removeFrom) insertAt -= removeTo - removeFrom;
  insertAt = Math.max(0, Math.min(without.length, insertAt));

  const before = without.slice(0, insertAt);
  const after = without.slice(insertAt);

  if (mode === "inline") {
    // A single space, and only where there is not already whitespace: two
    // tokens jammed together (`![[a]]![[b]]`) still parse, but render with
    // their images touching, and a growing run of spaces after a few
    // reorders would be its own kind of mess.
    const gapBefore = before.length > 0 && !/\s$/.test(before) ? " " : "";
    const gapAfter = after.length > 0 && !/^\s/.test(after) ? " " : "";
    return before + gapBefore + token + gapAfter + after;
  }

  // Top up to a blank line on each side, without stacking newlines onto
  // separators that are already there.
  const padBefore =
    before.length === 0 || before.endsWith("\n\n")
      ? ""
      : before.endsWith("\n")
        ? "\n"
        : "\n\n";
  const padAfter =
    after.length === 0 || after.startsWith("\n\n")
      ? ""
      : after.startsWith("\n")
        ? "\n"
        : "\n\n";

  // Same normalisation removeMediaEmbeds() applies, for the same reason:
  // a move can leave three newlines where a removed line met an existing
  // paragraph break, and runs of blank lines accumulate over many moves.
  return (before + padBefore + token + padAfter + after).replace(
    /\n{3,}/g,
    "\n\n",
  );
}
