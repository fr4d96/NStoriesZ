/**
 * Pure converters between Tiptap/ProseMirror JSON (what the editor produces)
 * and the canonical block/run/mark content schema
 * (lib/validation/story.ts#storyContentSchema, Engineering Rule 6/7 —
 * controlled structured JSON, never raw HTML).
 *
 * No dependency on @tiptap/react or any DOM API — this module only walks
 * plain JSON, so it can be unit-tested without a browser and reused from a
 * Server Action if ever needed. rich-text-editor.tsx is configured to only
 * ever produce a document these converters can round-trip (see its
 * closed-loop test); this module is defensive anyway — anything outside the
 * allowed node/mark set is dropped rather than throwing, since the actual
 * safety boundary is storyContentSchema.safeParse() on the result, not this
 * converter.
 */

import type {
  StoryContentBlock,
  StoryMark,
  StoryTextRun,
} from "@/lib/validation/story";
import { isSafeHref } from "@/lib/validation/story";

// --- Minimal Tiptap/ProseMirror JSON shape ---------------------------------

export type TiptapMark =
  | { type: "bold" }
  | { type: "italic" }
  | { type: "link"; attrs: { href: string } }
  | { type: string; attrs?: Record<string, unknown> };

export type TiptapNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  text?: string;
  marks?: TiptapMark[];
};

export type TiptapDoc = {
  type: "doc";
  content: TiptapNode[];
};

// --- Tiptap -> canonical blocks --------------------------------------------

function convertMarks(marks: TiptapMark[] | undefined): StoryMark[] {
  if (!marks || marks.length === 0) return [];
  const out: StoryMark[] = [];
  const seen = new Set<string>();
  for (const mark of marks) {
    if (mark.type === "bold" && !seen.has("bold")) {
      out.push("bold");
      seen.add("bold");
    } else if (mark.type === "italic" && !seen.has("italic")) {
      out.push("italic");
      seen.add("italic");
    } else if (
      mark.type === "link" &&
      !seen.has("link") &&
      typeof mark.attrs?.href === "string" &&
      isSafeHref(mark.attrs.href)
    ) {
      out.push({ type: "link", href: mark.attrs.href });
      seen.add("link");
    }
    // Anything else (code, strike, underline, ...) is silently dropped —
    // the editor is configured not to produce these, this is defense in
    // depth only.
  }
  return out;
}

/** Flattens a Tiptap inline-content array (text + hardBreak nodes) into runs. */
function convertInlineContent(nodes: TiptapNode[] | undefined): StoryTextRun[] {
  if (!nodes) return [];
  const runs: StoryTextRun[] = [];
  for (const node of nodes) {
    if (node.type === "text" && typeof node.text === "string") {
      const text = node.text;
      if (text.length === 0) continue;
      const marks = convertMarks(node.marks);
      runs.push(marks.length > 0 ? { text, marks } : { text });
    }
    // hardBreak and other inline node types have no representation in the
    // canonical schema and are dropped.
  }
  return runs;
}

function convertParagraphLike(node: TiptapNode): StoryTextRun[] {
  return convertInlineContent(node.content);
}

/** Converts a bulletList/orderedList node's listItems into items: runs[]. */
function convertListItems(node: TiptapNode): StoryTextRun[][] {
  if (!node.content) return [];
  const items: StoryTextRun[][] = [];
  for (const item of node.content) {
    if (item.type !== "listItem") continue;
    // A listItem's content is block-level (normally a single paragraph);
    // flatten every paragraph's runs into one item.
    const runs: StoryTextRun[] = [];
    for (const child of item.content ?? []) {
      runs.push(...convertInlineContent(child.content));
    }
    if (runs.length > 0) items.push(runs);
  }
  return items;
}

/**
 * Converts a Tiptap document to the canonical block array. Nodes with no
 * extractable text (e.g. an empty paragraph) are dropped — the canonical
 * schema requires at least one non-empty run per block/list item.
 */
export function tiptapDocToBlocks(doc: TiptapDoc): StoryContentBlock[] {
  const blocks: StoryContentBlock[] = [];
  for (const node of doc.content ?? []) {
    switch (node.type) {
      case "paragraph": {
        const text = convertParagraphLike(node);
        if (text.length > 0) blocks.push({ type: "paragraph", text });
        break;
      }
      case "heading": {
        const levelRaw = node.attrs?.level;
        const level = levelRaw === 3 ? 3 : 2; // only H2/H3 are allowed
        const text = convertParagraphLike(node);
        if (text.length > 0) blocks.push({ type: "heading", level, text });
        break;
      }
      case "blockquote": {
        // A blockquote's content is block-level; flatten every child
        // paragraph's runs into one quote block.
        const text: StoryTextRun[] = [];
        for (const child of node.content ?? []) {
          text.push(...convertInlineContent(child.content));
        }
        if (text.length > 0) blocks.push({ type: "quote", text });
        break;
      }
      case "bulletList":
      case "orderedList": {
        const items = convertListItems(node);
        if (items.length > 0) {
          blocks.push({
            type: "list",
            style: node.type === "orderedList" ? "ordered" : "unordered",
            items,
          });
        }
        break;
      }
      default:
        // Unsupported node type (e.g. codeBlock, horizontalRule) — dropped.
        break;
    }
  }
  return blocks;
}

// --- Canonical blocks -> Tiptap --------------------------------------------

function marksToTiptap(
  marks: StoryMark[] | undefined,
): TiptapMark[] | undefined {
  if (!marks || marks.length === 0) return undefined;
  const out: TiptapMark[] = marks.map((mark) =>
    typeof mark === "string"
      ? { type: mark }
      : { type: "link", attrs: { href: mark.href } },
  );
  return out;
}

function runsToTiptap(runs: StoryTextRun[]): TiptapNode[] {
  return runs.map((run) => {
    const marks = marksToTiptap(run.marks);
    return marks
      ? { type: "text", text: run.text, marks }
      : { type: "text", text: run.text };
  });
}

function paragraphFromRuns(runs: StoryTextRun[]): TiptapNode {
  return { type: "paragraph", content: runsToTiptap(runs) };
}

/** Converts the canonical block array to a Tiptap document, for loading an existing draft into the editor. */
export function blocksToTiptapDoc(blocks: StoryContentBlock[]): TiptapDoc {
  const content: TiptapNode[] = blocks.map((block) => {
    switch (block.type) {
      case "paragraph":
        return paragraphFromRuns(block.text);
      case "heading":
        return {
          type: "heading",
          attrs: { level: block.level },
          content: runsToTiptap(block.text),
        };
      case "quote":
        return {
          type: "blockquote",
          content: [paragraphFromRuns(block.text)],
        };
      case "list":
        return {
          type: block.style === "ordered" ? "orderedList" : "bulletList",
          content: block.items.map((item) => ({
            type: "listItem",
            content: [paragraphFromRuns(item)],
          })),
        };
    }
  });
  return {
    type: "doc",
    content:
      content.length > 0 ? content : [{ type: "paragraph", content: [] }],
  };
}
