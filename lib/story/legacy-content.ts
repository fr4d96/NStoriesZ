import {
  isSafeHref,
  markdownToStoryContent,
  storyContentSchema,
  type StoryContentBlock,
} from "@/lib/validation/story";
import { mediaEmbedToken } from "@/lib/story/markdown-media";

/**
 * Reads a revision's stored `content_json` in ANY shape this codebase has
 * ever written, and returns it in today's canonical one-Markdown-block form.
 *
 * `content_json` is deliberately loosely typed at the database layer (only
 * `jsonb_typeof(content_json) = 'array'` is checked -- see
 * supabase/migrations/20260803090200_story_revisions.sql), and an approved
 * revision's content is immutable, so revisions written before
 * 20260811090000_markdown_content_json.sql still hold the older
 * paragraph/heading/quote/list/table/image block union -- and the oldest of
 * those hold plain-string block text, from before block text became
 * `TextRun[]`. Nothing rewrote them, and nothing could: they are published.
 * Without this, today's schema rejects them outright and the reader is shown
 * "This story's content couldn't be rendered" on a real, approved story.
 *
 * Conversion is on READ only -- no stored row is touched here. The converted
 * Markdown is passed back through the real `storyContentSchema`, so a legacy
 * document gets exactly the same validation (no h1, no `![alt](url)` image
 * syntax, only safe link hrefs, length ceilings) as anything written today;
 * a legacy document that can't satisfy that still returns null rather than
 * being waved through. Legacy run text is Markdown-escaped, so a literal
 * `*`, `_` or `[` that was plain text in the old block model can never
 * become markup in the converted document.
 */

type LegacyMark = "bold" | "italic" | { type: "link"; href?: unknown };
type LegacyRun = { text?: unknown; marks?: unknown };

// Characters remark would otherwise read as markup anywhere in a line.
const INLINE_MARKDOWN_SPECIALS = /[\\`*_[\]<>|~]/g;
// Characters that only start markup at the beginning of a line (a heading,
// blockquote, list bullet, or setext rule).
const LINE_LEADING_MARKDOWN = /^(\s*)([#>+\-=]|\d+[.)])/;

function escapeMarkdown(text: string): string {
  return text
    .replace(INLINE_MARKDOWN_SPECIALS, (char) => `\\${char}`)
    .split("\n")
    .map((line) => line.replace(LINE_LEADING_MARKDOWN, "$1\\$2"))
    .join("\n");
}

function isLinkMark(mark: unknown): mark is { type: "link"; href?: unknown } {
  return (
    typeof mark === "object" &&
    mark !== null &&
    (mark as { type?: unknown }).type === "link"
  );
}

/** One legacy run -> escaped Markdown text wrapped in its marks. */
function runToMarkdown(run: LegacyRun): string {
  const raw = typeof run?.text === "string" ? run.text : "";
  if (raw === "") return "";

  let out = escapeMarkdown(raw);
  const marks: LegacyMark[] = Array.isArray(run?.marks)
    ? (run.marks as LegacyMark[])
    : [];

  // Emphasis first, link outermost -- `[**a**](href)` is well-formed
  // Markdown, `**[a](href)**` is too, but only the former survives a run
  // whose text is entirely whitespace-padded.
  if (marks.some((mark) => mark === "bold")) out = `**${out}**`;
  if (marks.some((mark) => mark === "italic")) out = `*${out}*`;

  const link = marks.find(isLinkMark);
  if (link) {
    const href = typeof link.href === "string" ? link.href : "";
    // An unsafe href is dropped, never rendered -- the run's text is kept.
    // isSafeHref() is the same check the live schema applies, so a converted
    // document can never smuggle in a link today's editor would refuse.
    if (isSafeHref(href)) out = `[${out}](${href})`;
  }

  return out;
}

/**
 * Legacy block text: `TextRun[]` (Sub-phase 1 onward) or a plain string
 * (Prompt 3's original shape).
 */
function textToMarkdown(text: unknown): string {
  if (typeof text === "string") return escapeMarkdown(text);
  if (!Array.isArray(text)) return "";
  return text.map((run) => runToMarkdown(run as LegacyRun)).join("");
}

function prefixEveryLine(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

function legacyBlockToMarkdown(block: Record<string, unknown>): string | null {
  switch (block.type) {
    case "markdown":
      // Already current-shape; nothing to convert.
      return typeof block.text === "string" ? block.text : null;

    case "paragraph":
      return textToMarkdown(block.text);

    case "heading": {
      // Levels were constrained to 2-3; anything else is clamped rather than
      // dropped, and never becomes an h1 (reserved for the story title).
      const level = block.level === 3 ? 3 : 2;
      return `${"#".repeat(level)} ${textToMarkdown(block.text)}`;
    }

    case "quote":
      return prefixEveryLine(textToMarkdown(block.text), "> ");

    case "list": {
      const items = Array.isArray(block.items) ? block.items : [];
      if (items.length === 0) return null;
      const ordered = block.style === "ordered";
      return items
        .map((item, index) => {
          const marker = ordered ? `${index + 1}.` : "-";
          return `${marker} ${textToMarkdown(item)}`;
        })
        .join("\n");
    }

    case "table": {
      const rows = Array.isArray(block.rows) ? block.rows : [];
      if (rows.length === 0) return null;
      const cells = (row: unknown): string[] =>
        Array.isArray(row) ? row.map((cell) => textToMarkdown(cell)) : [];
      const header = cells(rows[0]);
      if (header.length === 0) return null;
      // GFM tables need a header row and a delimiter row; the legacy block
      // had no separate header concept, so the first row becomes one.
      const lines = [
        `| ${header.join(" | ")} |`,
        `| ${header.map(() => "---").join(" | ")} |`,
        ...rows.slice(1).map((row) => {
          const values = cells(row);
          // Pad/trim to the header's width -- a ragged GFM table drops
          // cells silently, which would lose real content.
          const padded = Array.from(
            { length: header.length },
            (_, index) => values[index] ?? "",
          );
          return `| ${padded.join(" | ")} |`;
        }),
      ];
      return lines.join("\n");
    }

    case "image":
      return typeof block.mediaId === "string"
        ? mediaEmbedToken(block.mediaId)
        : null;

    default:
      // An unrecognized block type is dropped, never thrown on -- the same
      // "never throw on bad data" posture the renderer itself takes.
      return null;
  }
}

/**
 * `content_json` (any historical shape) -> today's canonical blocks, or null
 * if it can't be read as story content at all. Try this instead of calling
 * `storyContentSchema.safeParse()` directly wherever stored content is read
 * back for rendering or editing.
 */
export function normalizeStoryContentJson(
  raw: unknown,
): StoryContentBlock[] | null {
  const current = storyContentSchema.safeParse(raw);
  if (current.success) return current.data;

  if (!Array.isArray(raw)) return null;

  const parts: string[] = [];
  for (const block of raw) {
    if (typeof block !== "object" || block === null) continue;
    const markdown = legacyBlockToMarkdown(block as Record<string, unknown>);
    if (markdown && markdown.trim() !== "") parts.push(markdown);
  }
  if (parts.length === 0) return null;

  const converted = storyContentSchema.safeParse(
    markdownToStoryContent(parts.join("\n\n")),
  );
  return converted.success ? converted.data : null;
}
