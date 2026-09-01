/**
 * Editorial-import content conversion: plain text or pasted/rich HTML ->
 * the canonical Markdown content_json shape (lib/validation/story.ts).
 * Never produces raw HTML, never uses dangerouslySetInnerHTML anywhere in
 * this stack (Engineering Rules 6/7) -- this module's only job is to turn
 * arbitrary external text into the SAME Markdown text the live editor
 * itself produces, so downstream code never has to know the content came
 * from an import.
 *
 * Full rejection on any size/structural limit -- never truncation. A
 * truncated import would silently drop the tail of someone's story with no
 * indication anything was lost; a rejection is honest and re-triable (the
 * caller can split the paste, or an editor can decide the source needs
 * manual cleanup first).
 */
import { HTMLElement, NodeType, parse, type Node } from "node-html-parser";
import {
  storyContentSchema,
  isSafeHref,
  markdownToStoryContent,
  type StoryContentBlock,
} from "@/lib/validation/story";
import {
  escapeLeadingMarker,
  escapeMarkdownText,
} from "@/lib/story/markdown-escape";

// Server Action body limit (next.config.ts) is set to this value + 25%
// margin for JSON/wire-protocol overhead -- see next.config.ts's own
// comment, which cross-references this constant so the two can't silently
// drift apart. This is the authoritative, product-level limit; the
// framework ceiling is only there so an oversized request fails cleanly
// instead of hanging.
export const MAX_IMPORT_INPUT_BYTES = 2_000_000;

const MAX_IMPORT_NODES = 5_000;
const MAX_IMPORT_DEPTH = 40;
const MAX_UNSAFE_LINK_SAMPLE = 10;

// Removed entirely -- never unwrapped, never converted. Nothing inside one
// of these subtrees is ever inspected for text.
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

// Unwrapped to their children -- their own text contributes to the
// surrounding block stream, but they carry no block-level meaning of their
// own in the canonical schema.
const SAFE_CONTAINER_TAGS = new Set([
  "div",
  "span",
  "section",
  "article",
  "header",
  "footer",
  "nav",
  "main",
  "aside",
  "figure",
  "figcaption",
  "body",
  "html",
]);

// Presentational/unsupported leaf tags with no schema representation.
// Dropped entirely, but (unlike DANGEROUS_TAGS) counted separately in the
// report as "not converted," not "removed as unsafe" -- an editor should be
// able to tell the two apart. Images are deliberately never converted to an
// inline embed token -- images are attached through the real upload
// pipeline, never pasted-in.
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

// h1 collapses to "##" -- content_json's Markdown schema reserves a leading
// "#" for the story title (lib/validation/story.ts).
const HEADING_PREFIX: Record<string, string> = {
  h1: "## ",
  h2: "## ",
  h3: "### ",
  h4: "#### ",
  h5: "##### ",
  h6: "###### ",
};

export type ImportReport = {
  blocksProduced: number;
  /** Tag name -> count of dangerous subtrees removed entirely (never inspected for text). */
  droppedElements: Record<string, number>;
  /** Tag name -> count of unsupported leaf elements skipped (not dangerous, just not convertible). */
  unsupportedElements: Record<string, number>;
  /** <table> elements converted to a single plain-text paragraph. */
  convertedTables: number;
  /** <pre>/standalone <code> elements converted to a single plain-text paragraph. */
  convertedCodeBlocks: number;
  /** Count of non-href attributes encountered on surviving elements (never propagated regardless). */
  attributesStripped: number;
  /** Total count of href values rejected by isSafeHref() -- the link is dropped, the TEXT is kept. */
  unsafeLinksRemovedCount: number;
  /**
   * At most MAX_UNSAFE_LINK_SAMPLE raw href values, for UI display only.
   * Bounded and inert (never executed, never rendered as a link) -- and
   * never written to any server log; this module has no logging calls at
   * all.
   */
  unsafeLinksRemovedSample: string[];
};

export type ImportError =
  | "input_too_large"
  | "too_many_nodes"
  | "too_deeply_nested"
  | "empty_content"
  | "invalid_content";

export type ImportResult =
  | { ok: true; blocks: StoryContentBlock[]; report: ImportReport }
  | { ok: false; error: ImportError };

function emptyReport(): ImportReport {
  return {
    blocksProduced: 0,
    droppedElements: {},
    unsupportedElements: {},
    convertedTables: 0,
    convertedCodeBlocks: 0,
    attributesStripped: 0,
    unsafeLinksRemovedCount: 0,
    unsafeLinksRemovedSample: [],
  };
}

function bump(record: Record<string, number>, key: string) {
  record[key] = (record[key] ?? 0) + 1;
}

function finalize(blockLines: string[], report: ImportReport): ImportResult {
  if (blockLines.length === 0) {
    return { ok: false, error: "empty_content" };
  }
  const text = blockLines.join("\n\n").trim();
  const parsed = storyContentSchema.safeParse(markdownToStoryContent(text));
  if (!parsed.success) {
    return { ok: false, error: "invalid_content" };
  }
  report.blocksProduced = blockLines.length;
  return { ok: true, blocks: parsed.data, report };
}

// Escaping now lives in lib/story/markdown-escape.ts (imported above), shared
// with the browser-side paste converter (lib/story/html-paste.ts) so the two
// "external text -> our Markdown" paths can never drift apart. Behaviour is
// byte-for-byte what it was when both functions were defined here.

// --- Plain text --------------------------------------------------------

/**
 * Blank-line-separated paragraphs; a single newline within a paragraph
 * collapses to a space (plain text carries no other structural signal).
 */
export function plainTextToBlocks(text: string): ImportResult {
  if (Buffer.byteLength(text, "utf8") > MAX_IMPORT_INPUT_BYTES) {
    return { ok: false, error: "input_too_large" };
  }

  const report = emptyReport();
  const blockLines = text
    .split(/\r?\n\s*\r?\n/)
    .map((para) => para.replace(/\r?\n/g, " ").trim())
    .filter((para) => para.length > 0)
    .map((para) => escapeLeadingMarker(escapeMarkdownText(para)));

  return finalize(blockLines, report);
}

// --- HTML ----------------------------------------------------------------

/**
 * Counts every attribute on a surviving element except `href` on `<a>`
 * (which is read, not stripped -- its VALUE is still validated by
 * isSafeHref() before ever being used). Called for every element this
 * module processes, whether handled at block level (walkBlock) or inline
 * level (inlineToMarkdown) -- attributes are never propagated into the
 * canonical schema either way, only counted for the report.
 */
function countAttributes(tag: string, node: HTMLElement, report: ImportReport) {
  const keys = Object.keys(node.attributes);
  const ignorable = tag === "a" && "href" in node.attributes ? 1 : 0;
  report.attributesStripped += Math.max(0, keys.length - ignorable);
}

function inlineToMarkdown(node: Node, report: ImportReport): string {
  if (node.nodeType === NodeType.TEXT_NODE) {
    return escapeMarkdownText(node.rawText.replace(/\s+/g, " "));
  }
  if (!(node instanceof HTMLElement)) return "";

  const tag = node.rawTagName?.toLowerCase() ?? "";
  if (DANGEROUS_TAGS.has(tag)) {
    bump(report.droppedElements, tag);
    return "";
  }
  countAttributes(tag, node, report);

  if (tag === "br") return "\n";
  if (UNSUPPORTED_LEAF_TAGS.has(tag)) {
    bump(report.unsupportedElements, tag);
    return "";
  }

  const inner = node.childNodes
    .map((c) => inlineToMarkdown(c, report))
    .join("");
  if (inner.trim().length === 0) return inner;

  if (tag === "strong" || tag === "b") return `**${inner}**`;
  if (tag === "em" || tag === "i") return `*${inner}*`;
  if (tag === "a") {
    const href = node.getAttribute("href");
    if (href && isSafeHref(href)) return `[${inner}](${href})`;
    if (href) {
      report.unsafeLinksRemovedCount += 1;
      if (report.unsafeLinksRemovedSample.length < MAX_UNSAFE_LINK_SAMPLE) {
        report.unsafeLinksRemovedSample.push(href);
      }
    }
    return inner;
  }
  return inner;
}

function collectPlainText(node: Node): string {
  if (node.nodeType === NodeType.TEXT_NODE) {
    return node.rawText;
  }
  if (!(node instanceof HTMLElement)) return "";
  const tag = node.rawTagName?.toLowerCase() ?? "";
  if (DANGEROUS_TAGS.has(tag)) return "";
  return node.childNodes.map(collectPlainText).join(" ");
}

function buildInline(node: HTMLElement, report: ImportReport): string {
  return node.childNodes
    .map((c) => inlineToMarkdown(c, report))
    .join("")
    .trim();
}

/**
 * Converts one block-level element's children into zero or more Markdown
 * block chunks, appended to `out` (joined with blank lines by finalize()).
 * Nested lists/blockquotes are flattened (their items/text join the SAME
 * enclosing list/quote block) rather than represented as nesting, matching
 * this module's pre-Markdown behavior.
 */
function walkBlock(node: Node, out: string[], report: ImportReport): void {
  if (node.nodeType === NodeType.TEXT_NODE) {
    const text = node.rawText.trim();
    if (text.length > 0) {
      out.push(
        escapeLeadingMarker(escapeMarkdownText(text.replace(/\s+/g, " "))),
      );
    }
    return;
  }
  if (!(node instanceof HTMLElement)) return;

  const tag = node.rawTagName?.toLowerCase() ?? "";

  if (DANGEROUS_TAGS.has(tag)) {
    bump(report.droppedElements, tag);
    return;
  }
  countAttributes(tag, node, report);

  if (tag in HEADING_PREFIX) {
    const inline = buildInline(node, report);
    if (inline.length > 0) {
      out.push(`${HEADING_PREFIX[tag]}${inline.replace(/\n/g, " ")}`);
    }
    return;
  }

  if (tag === "p") {
    const inline = buildInline(node, report);
    if (inline.length > 0) {
      out.push(escapeLeadingMarker(inline));
    }
    return;
  }

  if (tag === "blockquote") {
    // Flatten nested blockquotes: collect every run across the whole
    // subtree into ONE quote block, rather than a quote block per level.
    const inline = buildInline(node, report);
    if (inline.length > 0) {
      out.push(
        inline
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n"),
      );
    }
    return;
  }

  if (tag === "ul" || tag === "ol") {
    const items: string[] = [];
    collectListItems(node, items, report);
    if (items.length > 0) {
      out.push(
        items
          .map((item, i) => (tag === "ol" ? `${i + 1}. ${item}` : `- ${item}`))
          .join("\n"),
      );
    }
    return;
  }

  if (tag === "table") {
    const text = collectPlainText(node).replace(/\s+/g, " ").trim();
    report.convertedTables += 1;
    if (text.length > 0) {
      out.push(escapeLeadingMarker(escapeMarkdownText(text)));
    }
    return;
  }

  if (tag === "pre" || tag === "code") {
    const text = collectPlainText(node).trim();
    report.convertedCodeBlocks += 1;
    if (text.length > 0) {
      out.push(
        escapeLeadingMarker(escapeMarkdownText(text.replace(/\s+/g, " "))),
      );
    }
    return;
  }

  if (UNSUPPORTED_LEAF_TAGS.has(tag)) {
    bump(report.unsupportedElements, tag);
    return;
  }

  if (SAFE_CONTAINER_TAGS.has(tag) || true) {
    // Unwrap: this element carries no block meaning of its own, or is an
    // unrecognized tag -- either way, recurse into its children rather than
    // dropping their text. (The `|| true` makes "unrecognized tag" behave
    // the same as "known safe container": unwrap, never drop text.)
    for (const child of node.childNodes) {
      walkBlock(child, out, report);
    }
  }
}

/** Nested <ul>/<ol> inside an <li> are flattened into the SAME items array. */
function collectListItems(
  listNode: HTMLElement,
  items: string[],
  report: ImportReport,
): void {
  for (const child of listNode.childNodes) {
    if (!(child instanceof HTMLElement)) continue;
    const tag = child.rawTagName?.toLowerCase() ?? "";
    if (tag !== "li") continue;

    const parts: string[] = [];
    for (const grandchild of child.childNodes) {
      if (
        grandchild instanceof HTMLElement &&
        (grandchild.rawTagName?.toLowerCase() === "ul" ||
          grandchild.rawTagName?.toLowerCase() === "ol")
      ) {
        // Nested list: flush what we have as one item, then recurse to add
        // the nested items as further flat items of the SAME list.
        const text = parts.join("").trim();
        if (text.length > 0) items.push(text.replace(/\n/g, " "));
        parts.length = 0;
        collectListItems(grandchild, items, report);
        continue;
      }
      parts.push(inlineToMarkdown(grandchild, report));
    }
    const text = parts.join("").trim();
    if (text.length > 0) items.push(text.replace(/\n/g, " "));
  }
}

function measureTree(
  node: Node,
  depth: number,
  counters: { nodes: number; maxDepth: number },
) {
  counters.nodes += 1;
  counters.maxDepth = Math.max(counters.maxDepth, depth);
  if (
    counters.nodes > MAX_IMPORT_NODES ||
    counters.maxDepth > MAX_IMPORT_DEPTH
  ) {
    return;
  }
  if (node instanceof HTMLElement) {
    for (const child of node.childNodes) {
      measureTree(child, depth + 1, counters);
      if (
        counters.nodes > MAX_IMPORT_NODES ||
        counters.maxDepth > MAX_IMPORT_DEPTH
      ) {
        return;
      }
    }
  }
}

export function sanitizeHtmlToBlocks(html: string): ImportResult {
  if (Buffer.byteLength(html, "utf8") > MAX_IMPORT_INPUT_BYTES) {
    return { ok: false, error: "input_too_large" };
  }

  const root = parse(html, {
    lowerCaseTagName: false,
    comment: false,
    blockTextElements: {
      script: false,
      noscript: false,
      style: false,
      pre: true,
    },
  });

  const counters = { nodes: 0, maxDepth: 0 };
  measureTree(root, 0, counters);
  if (counters.nodes > MAX_IMPORT_NODES) {
    return { ok: false, error: "too_many_nodes" };
  }
  if (counters.maxDepth > MAX_IMPORT_DEPTH) {
    return { ok: false, error: "too_deeply_nested" };
  }

  const report = emptyReport();
  const blockLines: string[] = [];
  for (const child of root.childNodes) {
    walkBlock(child, blockLines, report);
  }

  return finalize(blockLines, report);
}
