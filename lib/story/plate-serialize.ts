/**
 * Pure converters between Plate/Slate's document value (what the editor
 * produces) and the canonical block/run/mark content schema
 * (lib/validation/story.ts#storyContentSchema, Engineering Rule 6/7 --
 * controlled structured JSON, never raw HTML).
 *
 * No dependency on platejs/react or any DOM API -- this module only walks
 * plain JSON, so it can be unit-tested without a browser. Defensive
 * regardless: components/story/story-content-editor.tsx is configured to
 * only ever produce a value these converters can round-trip, but the actual
 * safety boundary is storyContentSchema.safeParse() on the result, not this
 * converter -- anything outside the allowed node/mark set is dropped rather
 * than throwing.
 *
 * Plate's list model (confirmed empirically against the installed
 * @platejs/list, not assumed from docs -- see the PR that added this file):
 * unlike a nested <ul>/<li> tree, a list item is just a flat paragraph node
 * carrying `indent: 1` and `listStyleType: "disc" | "decimal"` (etc.).
 * Consecutive same-indent, same-style-category nodes read as one visual
 * list; there is no wrapping list element at the data level. Converting
 * canonical -> Plate means expanding each `list` block's items into that
 * many flat indented paragraphs; converting Plate -> canonical means
 * grouping consecutive flat indented paragraphs of the same category back
 * into one `list` block.
 *
 * Plate also represents a link as an inline ELEMENT (`{ type: "a", url,
 * children }`), not a text mark the way Tiptap did -- bold/italic stay
 * boolean leaf properties either way.
 *
 * Blockquote is block-level, not a flat text-holding node: toggling it via
 * the real `editor.tf.blockquote.toggle()` (confirmed empirically -- an
 * earlier version of this file assumed a flat shape from hand-written
 * probe data, which was wrong and threw a live runtime error the first
 * time blockquote was toggled through the real editor) wraps the
 * paragraph being converted, producing `{ type: "blockquote", children:
 * [{ type: "p", children: [...] }] }` -- mirrors the old Tiptap
 * converter's own blockquote-is-block-level handling.
 */

import type {
  StoryContentBlock,
  StoryMark,
  StoryTextRun,
} from "@/lib/validation/story";
import { isSafeHref } from "@/lib/validation/story";

// --- Minimal Plate/Slate value shape ---------------------------------------

export type PlateText = {
  text: string;
  bold?: boolean;
  italic?: boolean;
};

export type PlateLinkNode = {
  type: "a";
  url: string;
  children: PlateText[];
};

export type PlateInline = PlateText | PlateLinkNode;

export type PlateParagraphNode = {
  type: "p";
  children: PlateInline[];
};

/**
 * Table shape (confirmed against the installed @platejs/table's
 * getEmptyCellNode/getEmptyRowNode/getEmptyTableNode): a table is `tr`
 * rows of `td` cells, and -- like blockquote -- each cell holds block
 * (paragraph) children rather than inline children directly. This app
 * never registers TableCellHeaderPlugin (the "th" variant), so header
 * cells are structurally absent, same reasoning as underline/strike/hr
 * being absent elsewhere in this editor configuration.
 */
export type PlateTableCellNode = {
  type: "td";
  children: PlateParagraphNode[];
};

export type PlateTableRowNode = {
  type: "tr";
  children: PlateTableCellNode[];
};

/**
 * A void node: no editable text of its own, so its `children` is the
 * single empty-text leaf Slate's void-element convention requires (there
 * is nothing for a user to type inside it -- the image is the whole node).
 */
export type PlateImageNode = {
  type: "image";
  mediaId: string;
  children: [PlateText];
};

export type PlateElement = {
  type: string;
  // Blockquote nests a paragraph child (see this file's header comment);
  // a table nests row/cell children; every other element type here holds
  // inline children directly.
  children:
    | PlateInline[]
    | PlateParagraphNode[]
    | PlateTableRowNode[]
    | PlateTableCellNode[]
    | [PlateText];
  indent?: number;
  listStyleType?: string;
  id?: string;
  [key: string]: unknown;
};

export type PlateValue = PlateElement[];

const ORDERED_LIST_STYLE = "decimal";
const UNORDERED_LIST_STYLE = "disc";

function isOrderedListStyle(listStyleType: string | undefined): boolean {
  return listStyleType === ORDERED_LIST_STYLE;
}

// --- Plate -> canonical blocks ----------------------------------------------

function isLinkNode(node: PlateInline): node is PlateLinkNode {
  return (
    typeof node === "object" &&
    node !== null &&
    "type" in node &&
    (node as { type?: unknown }).type === "a"
  );
}

function textToMarks(text: PlateText): StoryMark[] {
  const marks: StoryMark[] = [];
  if (text.bold) marks.push("bold");
  if (text.italic) marks.push("italic");
  return marks;
}

/** Converts one inline child (a plain text leaf or a link-wrapped leaf) into zero-or-one canonical run. */
function convertInlineNode(node: PlateInline): StoryTextRun | null {
  if (isLinkNode(node)) {
    const inner = node.children[0];
    if (!inner || inner.text.length === 0) return null;
    if (!isSafeHref(node.url)) {
      // Unsafe href -- drop the link wrapper but keep the text itself
      // (mirrors the old Tiptap converter's "silently drop the mark, keep
      // the text" behavior for anything the schema wouldn't accept).
      const marks = textToMarks(inner);
      return marks.length > 0
        ? { text: inner.text, marks }
        : { text: inner.text };
    }
    const marks = [
      ...textToMarks(inner),
      { type: "link" as const, href: node.url },
    ];
    return { text: inner.text, marks };
  }
  if (node.text.length === 0) return null;
  const marks = textToMarks(node);
  return marks.length > 0 ? { text: node.text, marks } : { text: node.text };
}

function convertInlineChildren(children: PlateInline[]): StoryTextRun[] {
  const runs: StoryTextRun[] = [];
  for (const child of children) {
    const run = convertInlineNode(child);
    if (run) runs.push(run);
  }
  return runs;
}

/**
 * Converts a Plate value to the canonical block array. Nodes with no
 * extractable text (e.g. an empty paragraph) are dropped -- the canonical
 * schema requires at least one non-empty run per block/list item.
 */
export function plateValueToBlocks(value: PlateValue): StoryContentBlock[] {
  const blocks: StoryContentBlock[] = [];
  let i = 0;
  while (i < value.length) {
    const node = value[i];

    // A flat, indented node is a list item -- consume this node and every
    // immediately-following node that shares the same ordered/unordered
    // category as one `list` block, then continue past all of them.
    if ((node.indent ?? 0) > 0 && node.listStyleType) {
      const ordered = isOrderedListStyle(node.listStyleType);
      const items: StoryTextRun[][] = [];
      while (
        i < value.length &&
        (value[i].indent ?? 0) > 0 &&
        !!value[i].listStyleType &&
        isOrderedListStyle(value[i].listStyleType) === ordered
      ) {
        const runs = convertInlineChildren(value[i].children as PlateInline[]);
        if (runs.length > 0) items.push(runs);
        i++;
      }
      if (items.length > 0) {
        blocks.push({
          type: "list",
          style: ordered ? "ordered" : "unordered",
          items,
        });
      }
      continue;
    }

    switch (node.type) {
      case "p": {
        const text = convertInlineChildren(node.children as PlateInline[]);
        if (text.length > 0) blocks.push({ type: "paragraph", text });
        break;
      }
      case "h2":
      case "h3": {
        const text = convertInlineChildren(node.children as PlateInline[]);
        if (text.length > 0) {
          blocks.push({
            type: "heading",
            level: node.type === "h3" ? 3 : 2,
            text,
          });
        }
        break;
      }
      case "blockquote": {
        // Block-level: flatten every child paragraph's runs into one
        // quote block, same as the old Tiptap converter did.
        const text: StoryTextRun[] = [];
        for (const child of node.children as PlateParagraphNode[]) {
          text.push(...convertInlineChildren(child.children));
        }
        if (text.length > 0) blocks.push({ type: "quote", text });
        break;
      }
      case "table": {
        // Cells are kept even when empty (unlike paragraphs/list items) --
        // a blank cell is part of the grid's shape, not "no content" to
        // drop, and storyContentBlockSchema's table rows must all be the
        // same length.
        const rows: StoryTextRun[][][] = [];
        for (const rowNode of node.children as PlateTableRowNode[]) {
          const cells: StoryTextRun[][] = [];
          for (const cellNode of rowNode.children as PlateTableCellNode[]) {
            const cellRuns: StoryTextRun[] = [];
            for (const child of cellNode.children) {
              cellRuns.push(...convertInlineChildren(child.children));
            }
            cells.push(cellRuns);
          }
          if (cells.length > 0) rows.push(cells);
        }
        if (rows.length > 0) blocks.push({ type: "table", rows });
        break;
      }
      case "image": {
        // mediaId shape (a real UUID referencing this revision's attached
        // media) is validated by storyContentSchema.safeParse() -- the
        // actual safety boundary, per this file's header comment -- and
        // re-verified server-side against story_revision_media on save
        // (see the migration that added this block type). This converter
        // only guards against a structurally wrong value crashing it.
        const mediaId = (node as unknown as PlateImageNode).mediaId;
        if (typeof mediaId === "string" && mediaId.length > 0) {
          blocks.push({ type: "image", mediaId });
        }
        break;
      }
      default:
        // Unsupported node type -- dropped.
        break;
    }
    i++;
  }
  return blocks;
}

// --- Canonical blocks -> Plate ----------------------------------------------

function runToPlateInline(run: StoryTextRun): PlateInline {
  const linkMark = (run.marks ?? []).find(
    (mark): mark is Extract<StoryMark, { type: "link" }> =>
      typeof mark !== "string" && mark.type === "link",
  );
  const leaf: PlateText = { text: run.text };
  for (const mark of run.marks ?? []) {
    if (mark === "bold") leaf.bold = true;
    else if (mark === "italic") leaf.italic = true;
  }
  if (linkMark) {
    return { type: "a", url: linkMark.href, children: [leaf] };
  }
  return leaf;
}

function runsToPlateChildren(runs: StoryTextRun[]): PlateInline[] {
  return runs.map(runToPlateInline);
}

/** Converts the canonical block array to a Plate value, for loading an existing draft into the editor. */
export function blocksToPlateValue(blocks: StoryContentBlock[]): PlateValue {
  const value: PlateValue = [];
  for (const block of blocks) {
    switch (block.type) {
      case "paragraph":
        value.push({ type: "p", children: runsToPlateChildren(block.text) });
        break;
      case "heading":
        value.push({
          type: block.level === 3 ? "h3" : "h2",
          children: runsToPlateChildren(block.text),
        });
        break;
      case "quote":
        value.push({
          type: "blockquote",
          children: [{ type: "p", children: runsToPlateChildren(block.text) }],
        });
        break;
      case "list":
        for (const item of block.items) {
          value.push({
            type: "p",
            children: runsToPlateChildren(item),
            indent: 1,
            listStyleType:
              block.style === "ordered"
                ? ORDERED_LIST_STYLE
                : UNORDERED_LIST_STYLE,
          });
        }
        break;
      case "table":
        value.push({
          type: "table",
          children: block.rows.map((row): PlateTableRowNode => ({
            type: "tr",
            children: row.map((cell): PlateTableCellNode => ({
              type: "td",
              children: [{ type: "p", children: runsToPlateChildren(cell) }],
            })),
          })),
        });
        break;
      case "image":
        value.push({
          type: "image",
          mediaId: block.mediaId,
          children: [{ text: "" }],
        });
        break;
    }
  }
  return value.length > 0 ? value : [{ type: "p", children: [{ text: "" }] }];
}
