/**
 * Rich paste: turns the `text/html` flavour of a clipboard payload into the
 * same Markdown a contributor would have typed by hand.
 *
 * Why this exists: CodeMirror pastes `text/plain`, so pasting a story out of
 * Google Docs / Word / Notion today loses every heading, bold, italic, link
 * and list. CLAUDE.md says contributor content already exists elsewhere, so
 * pasting is the first thing most contributors will do. See
 * docs/editor-competitive-research.md.
 *
 * Engineering Rule 7 (pasted/rich-text input is sanitized before storage and
 * rendered only through controlled components) is satisfied structurally,
 * not by trust:
 *
 *  - The HTML is parsed with `DOMParser.parseFromString(html, "text/html")`
 *    into a document with NO browsing context. Scripts in it never execute,
 *    subresources are never fetched, and the tree is never attached to the
 *    page. `innerHTML` is never assigned anywhere in this module, and
 *    `dangerouslySetInnerHTML` appears nowhere in this stack.
 *  - Nothing HTML-shaped survives the function. The only output is a plain
 *    Markdown string, which then travels the identical path as typed text:
 *    `content_json`'s one `{type:"markdown", text}` block, validated by
 *    `storyContentSchema` and rendered by `react-markdown` (no `rehype-raw`).
 *  - The tag policy, the link policy (`isSafeHref`) and the escaping
 *    (`lib/story/markdown-escape.ts`) are the SAME ones the editorial
 *    importer uses in `lib/story/content-import.ts`.
 *
 * Why it isn't just `sanitizeHtmlToBlocks()` from that importer: that module
 * measures its input with Node's `Buffer` and parses with `node-html-parser`
 * (~200 KB). Neither belongs in a browser bundle, and the browser already
 * ships a compliant HTML parser. The shared pieces (escaping, href policy,
 * schema) are imported rather than copied; the tag policy is restated here
 * because the two walkers traverse different node APIs.
 *
 * Never truncates. Any limit breach or parse failure returns
 * `{ ok: false }`, and the caller falls back to CodeMirror's ordinary
 * plain-text paste -- a downgrade the contributor can see and redo, never a
 * silently shortened story.
 */
import { storyContentSchema, isSafeHref } from "@/lib/validation/story";
import {
  escapeLeadingMarker,
  escapeMarkdownText,
} from "@/lib/story/markdown-escape";

// Node type constants rather than the `Node` global: this module is loaded
// by a client component, by Vitest's jsdom, and (harmlessly) by the server
// bundler while tree-shaking. The numbers are fixed by the DOM spec.
const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

/**
 * Caps. Deliberately looser than lib/story/content-import.ts's server-side
 * equivalents (2 MB / 5,000 nodes / depth 40): this runs in the
 * contributor's own browser on their own clipboard, so the threat model is
 * "don't hang the tab", not "don't let a request exhaust a server". Google
 * Docs in particular emits one `<span>` per formatting run, so a long story
 * legitimately blows past 5,000 nodes.
 *
 * Character length, not UTF-8 bytes: `Buffer` doesn't exist in the browser,
 * and measuring exactly would mean encoding the whole payload just to
 * reject it. Characters are the cheaper guard and the limit is a guard, not
 * a product rule -- the real content ceiling stays `storyContentSchema`'s
 * 50,000 characters, applied to the converted Markdown below.
 */
const MAX_PASTE_INPUT_CHARS = 2_000_000;
const MAX_PASTE_NODES = 20_000;
const MAX_PASTE_DEPTH = 60;

// Removed entirely -- never unwrapped, never inspected for text. Same list
// as lib/story/content-import.ts's DANGEROUS_TAGS.
const DANGEROUS_TAGS = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "form",
  "svg",
  "math",
  "noscript",
  "template",
]);

// Dropped, but not because they are dangerous -- they simply have no
// representation in the Markdown schema. Images are deliberately included:
// an image only ever enters story content as an `![[mediaId]]` embed token
// pointing at an already-uploaded, rights-confirmed, EXIF-stripped
// derivative (Engineering Rules 13/14), never from a paste.
const UNSUPPORTED_LEAF_TAGS = new Set([
  "img",
  "video",
  "audio",
  "hr",
  "input",
  "button",
  "select",
  "textarea",
  "canvas",
  "picture",
  "source",
  "track",
]);

// h1 collapses to "##" -- a leading "#" is reserved for the story title
// (lib/validation/story.ts rejects an h1 in the body).
const HEADING_PREFIX: Record<string, string> = {
  h1: "## ",
  h2: "## ",
  h3: "### ",
  h4: "#### ",
  h5: "##### ",
  h6: "###### ",
};

export type HtmlPasteFailure =
  | "unsupported_environment"
  | "input_too_large"
  | "too_many_nodes"
  | "too_deeply_nested"
  | "empty_content"
  | "invalid_content";

export type HtmlPasteResult =
  | { ok: true; markdown: string; unsafeLinksRemoved: number }
  | { ok: false; reason: HtmlPasteFailure };

type PasteState = { unsafeLinksRemoved: number };

function isElement(node: Node): node is Element {
  return node.nodeType === ELEMENT_NODE;
}

function tagNameOf(element: Element): string {
  return element.tagName.toLowerCase();
}

/**
 * Google Docs (and Word's web export) do not use `<strong>`/`<em>`. They
 * emit `<span style="font-weight:700">` and `<span style="font-style:italic">`,
 * and they wrap the WHOLE pasted document in
 * `<b style="font-weight:normal" id="docs-internal-guid-…">`. A converter
 * that only looks at tag names therefore loses every bit of emphasis from
 * the single most likely source, and a converter that only looks at tags
 * would render an entire Google Docs paste in bold because of that wrapper.
 *
 * Only these three declarations are read. No other CSS is interpreted, and
 * the style attribute is never propagated anywhere -- it is inspected and
 * discarded.
 */
type Emphasis = { bold?: boolean; italic?: boolean; strike?: boolean };

function inlineStyleEmphasis(element: Element): Emphasis {
  const style = element.getAttribute("style");
  if (!style) return {};
  const result: Emphasis = {};
  if (/font-weight\s*:\s*(bold(er)?|[6-9]00)\b/i.test(style)) {
    result.bold = true;
  } else if (/font-weight\s*:\s*(normal|lighter|[1-5]00)\b/i.test(style)) {
    result.bold = false;
  }
  if (/font-style\s*:\s*italic\b/i.test(style)) result.italic = true;
  else if (/font-style\s*:\s*normal\b/i.test(style)) result.italic = false;
  if (/text-decoration[^;]*:[^;]*\bline-through\b/i.test(style)) {
    result.strike = true;
  }
  return result;
}

function emphasisFor(element: Element, tag: string): Emphasis {
  const fromStyle = inlineStyleEmphasis(element);
  return {
    bold: fromStyle.bold ?? (tag === "strong" || tag === "b"),
    italic: fromStyle.italic ?? (tag === "em" || tag === "i"),
    // `<u>` has no Markdown equivalent and is deliberately not represented
    // (the 2026-08-11 rebuild dropped underline on purpose).
    strike:
      fromStyle.strike ?? (tag === "s" || tag === "del" || tag === "strike"),
  };
}

function applyEmphasis(inner: string, emphasis: Emphasis): string {
  // An all-whitespace run must never be wrapped: `** **` is not emphasis in
  // Markdown, it is literal asterisks.
  if (inner.trim().length === 0) return inner;
  let out = inner;
  if (emphasis.strike) out = `~~${out}~~`;
  if (emphasis.italic) out = `*${out}*`;
  if (emphasis.bold) out = `**${out}**`;
  return out;
}

function inlineToMarkdown(node: Node, state: PasteState): string {
  if (node.nodeType === TEXT_NODE) {
    return escapeMarkdownText((node.nodeValue ?? "").replace(/\s+/g, " "));
  }
  if (!isElement(node)) return "";

  const tag = tagNameOf(node);
  if (DANGEROUS_TAGS.has(tag)) return "";
  // A hard line break inside a paragraph. Two trailing spaces are Markdown's
  // hard break -- a bare "\n" would be a SOFT break and render as a space,
  // silently running two deliberately separate lines together. This is a
  // considered difference from lib/story/content-import.ts, which predates
  // the concern; the trailing spaces are invisible in the live editor,
  // whereas CommonMark's other hard-break form (a trailing backslash) would
  // show up as stray punctuation while writing.
  if (tag === "br") return "  \n";
  if (UNSUPPORTED_LEAF_TAGS.has(tag)) return "";

  const inner = Array.from(node.childNodes)
    .map((child) => inlineToMarkdown(child, state))
    .join("");

  if (tag === "a") {
    const href = node.getAttribute("href");
    if (href && isSafeHref(href) && inner.trim().length > 0) {
      return `[${inner}](${href})`;
    }
    if (href && !isSafeHref(href)) state.unsafeLinksRemoved += 1;
    // The link is dropped; the words the contributor wrote are kept.
    return inner;
  }

  return applyEmphasis(inner, emphasisFor(node, tag));
}

function collectPlainText(node: Node): string {
  if (node.nodeType === TEXT_NODE) return node.nodeValue ?? "";
  if (!isElement(node)) return "";
  if (DANGEROUS_TAGS.has(tagNameOf(node))) return "";
  return Array.from(node.childNodes).map(collectPlainText).join(" ");
}

function buildInline(element: Element, state: PasteState): string {
  return Array.from(element.childNodes)
    .map((child) => inlineToMarkdown(child, state))
    .join("")
    .trim();
}

/** Nested `<ul>`/`<ol>` inside an `<li>` are flattened into the SAME items. */
function collectListItems(
  list: Element,
  items: string[],
  state: PasteState,
): void {
  for (const child of Array.from(list.childNodes)) {
    if (!isElement(child) || tagNameOf(child) !== "li") continue;

    const parts: string[] = [];
    for (const grandchild of Array.from(child.childNodes)) {
      if (
        isElement(grandchild) &&
        (tagNameOf(grandchild) === "ul" || tagNameOf(grandchild) === "ol")
      ) {
        const text = parts.join("").trim();
        if (text.length > 0) items.push(text.replace(/\s*\n\s*/g, " "));
        parts.length = 0;
        collectListItems(grandchild, items, state);
        continue;
      }
      parts.push(inlineToMarkdown(grandchild, state));
    }
    const text = parts.join("").trim();
    if (text.length > 0) items.push(text.replace(/\s*\n\s*/g, " "));
  }
}

/**
 * Converts one block-level node into zero or more Markdown block chunks,
 * appended to `out` (joined with blank lines by the caller). Nested lists
 * and blockquotes are flattened, matching the editorial importer.
 */
function walkBlock(node: Node, out: string[], state: PasteState): void {
  if (node.nodeType === TEXT_NODE) {
    const text = (node.nodeValue ?? "").trim();
    if (text.length > 0) {
      out.push(
        escapeLeadingMarker(escapeMarkdownText(text.replace(/\s+/g, " "))),
      );
    }
    return;
  }
  if (!isElement(node)) return;

  const tag = tagNameOf(node);
  if (DANGEROUS_TAGS.has(tag)) return;

  if (tag in HEADING_PREFIX) {
    const inline = buildInline(node, state);
    if (inline.length > 0) {
      out.push(`${HEADING_PREFIX[tag]}${inline.replace(/\s*\n\s*/g, " ")}`);
    }
    return;
  }

  if (tag === "p") {
    const inline = buildInline(node, state);
    if (inline.length > 0) out.push(escapeLeadingMarker(inline));
    return;
  }

  if (tag === "blockquote") {
    const inline = buildInline(node, state);
    if (inline.length > 0) {
      out.push(
        inline
          .split("\n")
          .map((line) => `> ${line.trimEnd()}`)
          .join("\n"),
      );
    }
    return;
  }

  if (tag === "ul" || tag === "ol") {
    const items: string[] = [];
    collectListItems(node, items, state);
    if (items.length > 0) {
      out.push(
        items
          .map((item, i) => (tag === "ol" ? `${i + 1}. ${item}` : `- ${item}`))
          .join("\n"),
      );
    }
    return;
  }

  // Tables and code blocks collapse to one plain-text paragraph, exactly as
  // the editorial importer does -- the Markdown schema supports GFM tables,
  // but reconstructing a real table from arbitrary pasted markup (colspans,
  // nested tables, layout tables) is guesswork, and guessing wrong produces
  // a broken table instead of readable prose.
  if (tag === "table" || tag === "pre" || tag === "code") {
    const text = collectPlainText(node).replace(/\s+/g, " ").trim();
    if (text.length > 0) {
      out.push(escapeLeadingMarker(escapeMarkdownText(text)));
    }
    return;
  }

  if (UNSUPPORTED_LEAF_TAGS.has(tag)) return;

  // Everything else -- known containers (`div`, `section`, `figure`, …) and
  // unrecognised tags alike -- is unwrapped rather than dropped, so no text
  // is ever lost to a tag this module has not heard of.
  for (const child of Array.from(node.childNodes)) {
    walkBlock(child, out, state);
  }
}

function measure(
  node: Node,
  depth: number,
  counters: { nodes: number; maxDepth: number },
): void {
  counters.nodes += 1;
  counters.maxDepth = Math.max(counters.maxDepth, depth);
  if (counters.nodes > MAX_PASTE_NODES || counters.maxDepth > MAX_PASTE_DEPTH) {
    return;
  }
  for (const child of Array.from(node.childNodes)) {
    measure(child, depth + 1, counters);
    if (
      counters.nodes > MAX_PASTE_NODES ||
      counters.maxDepth > MAX_PASTE_DEPTH
    ) {
      return;
    }
  }
}

/**
 * The whole conversion. Returns Markdown ready to insert at the cursor, or
 * a reason the caller should fall back to a plain-text paste.
 */
export function htmlPasteToMarkdown(html: string): HtmlPasteResult {
  if (typeof DOMParser === "undefined") {
    return { ok: false, reason: "unsupported_environment" };
  }
  if (html.length > MAX_PASTE_INPUT_CHARS) {
    return { ok: false, reason: "input_too_large" };
  }

  let body: HTMLElement | null = null;
  try {
    body = new DOMParser().parseFromString(html, "text/html").body;
  } catch {
    return { ok: false, reason: "invalid_content" };
  }
  if (!body) return { ok: false, reason: "empty_content" };

  const counters = { nodes: 0, maxDepth: 0 };
  measure(body, 0, counters);
  if (counters.nodes > MAX_PASTE_NODES) {
    return { ok: false, reason: "too_many_nodes" };
  }
  if (counters.maxDepth > MAX_PASTE_DEPTH) {
    return { ok: false, reason: "too_deeply_nested" };
  }

  const state: PasteState = { unsafeLinksRemoved: 0 };
  const blocks: string[] = [];
  for (const child of Array.from(body.childNodes)) {
    walkBlock(child, blocks, state);
  }
  if (blocks.length === 0) return { ok: false, reason: "empty_content" };

  const markdown = blocks.join("\n\n").trim();

  // The converted text goes through the very same schema the editor's own
  // typed content does -- h1 rejected, raw `![alt](url)` rejected, every
  // link href re-checked, 50,000-character ceiling. A fragment that cannot
  // pass it must not be inserted, even though it is only a fragment.
  const parsed = storyContentSchema.safeParse([
    { type: "markdown", text: markdown },
  ]);
  if (!parsed.success) return { ok: false, reason: "invalid_content" };

  return { ok: true, markdown, unsafeLinksRemoved: state.unsafeLinksRemoved };
}
