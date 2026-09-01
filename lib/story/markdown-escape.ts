/**
 * Markdown escaping shared by every "external text -> our Markdown" path.
 *
 * Extracted from lib/story/content-import.ts (the editorial HTML/plain-text
 * importer) so the browser-side paste converter (lib/story/html-paste.ts)
 * can use the exact same rules without pulling `node-html-parser` and
 * Node's `Buffer` into the client bundle. Two converters that escape
 * differently would produce two different documents from the same source,
 * which is precisely the drift this module exists to prevent.
 *
 * No imports on purpose -- this file must stay safe to load in a Server
 * Component, a Client Component, and a bare test runner alike.
 */

/**
 * Escapes literal Markdown syntax characters in text taken from an external
 * source, so they render as themselves rather than being reinterpreted as
 * formatting. `\` is escaped first (it is in the character class), which is
 * what stops a source containing a literal backslash from turning into an
 * escape sequence of its own.
 */
export function escapeMarkdownText(text: string): string {
  return text.replace(/[\\`*_[\]~]/g, "\\$&");
}

/**
 * A paragraph/list-item/quote line starting with a character sequence that
 * LOOKS like a block marker (heading/list/quote/fence) would silently
 * become one when rendered -- escape just the first character to prevent
 * that, matching how a real Markdown editor would type it.
 */
const LEADING_MARKER_RE = /^(#{1,6}\s|>|[-*+]\s|\d+[.)]\s|```|~~~)/;

export function escapeLeadingMarker(line: string): string {
  return LEADING_MARKER_RE.test(line) ? `\\${line}` : line;
}
