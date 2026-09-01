/**
 * Turning a story's Markdown into "roughly what a reader sees," and the
 * word-count / reading-time figures derived from it.
 *
 * Extracted from lib/story/content-quality-checks.ts, which used to own the
 * stripping logic privately. It is shared now because the contributor's own
 * editor shows a live word count (components/story/editor/markdown-editor.tsx)
 * and moderation shows an advisory "this story is quite short" finding from
 * the same text -- a contributor being told 180 words while an editor's
 * check counted 150 would be a bug waiting to happen.
 *
 * Deliberately regex-based, not a Markdown parser: this is a heuristic for
 * counting, never a renderer. components/story/content-block-renderer.tsx is
 * the only thing that actually renders story content.
 */
import { MEDIA_EMBED_REGEX } from "@/lib/story/markdown-media";

/**
 * Strips Markdown syntax down to roughly what a reader would see. Image
 * embed tokens (`![[mediaId]]` / `![[mediaId|width]]`) contribute no words.
 */
export function markdownToPlainText(markdown: string): string {
  return (
    markdown
      // A fresh RegExp per call: MEDIA_EMBED_REGEX is a /g/ literal and
      // carries mutable `lastIndex` state, so reusing the shared instance
      // across calls would skip matches.
      .replace(new RegExp(MEDIA_EMBED_REGEX), "")
      .replace(/^ {0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, "")
      .replace(/(\*\*|__|~~|`)/g, "")
      .replace(/(?<!\*)\*(?!\*)|(?<!_)_(?!_)/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
  );
}

/** Words a reader would actually read, image embeds and syntax excluded. */
export function markdownWordCount(markdown: string): number {
  const text = markdownToPlainText(markdown).trim();
  return text.length === 0 ? 0 : text.split(/\s+/).length;
}

/** How many images are embedded in the document. */
export function markdownImageCount(markdown: string): number {
  return markdown.match(new RegExp(MEDIA_EMBED_REGEX))?.length ?? 0;
}

/**
 * Ghost's reading-time model, which is the most widely-copied one and the
 * only published formula among the comparators surveyed in
 * docs/editor-competitive-research.md: 275 words per minute, plus 12 seconds
 * for the first image, 11 for the second, 10 for the third, and 3 seconds
 * each from the tenth image on.
 */
const WORDS_PER_MINUTE = 275;

export function readingTimeMinutes(wordCount: number, imageCount = 0): number {
  if (wordCount === 0 && imageCount === 0) return 0;
  let seconds = (wordCount / WORDS_PER_MINUTE) * 60;
  for (let i = 0; i < imageCount; i++) seconds += Math.max(3, 12 - i);
  return Math.max(1, Math.round(seconds / 60));
}
