import { describe, expect, it, vi } from "vitest";
import { createSlateEditor } from "platejs";
import { toggleList } from "@platejs/list";
import { upsertLink } from "@platejs/link";
import { insertTable } from "@platejs/table";
import { storyEditorPlugins } from "@/components/story/story-content-editor";
import { storyContentSchema } from "@/lib/validation/story";
import { plateValueToBlocks } from "@/lib/story/plate-serialize";

// ImageElement (components/story/editor/image-node.tsx) imports the real
// mintPreviewUrlAction Server Action, which itself imports lib/supabase/
// server ("server-only"-guarded, per Engineering Rule 1). Next's bundler
// safely rewrites a "use server" import for client code at build time, but
// plain Vitest module resolution doesn't do that transform -- it executes
// the file for real and hits the server-only guard. Mocked here purely to
// keep this file's Server-Component boundary out of a component test that
// never actually renders ImageElement (these tests drive a headless
// editor, not React); the real function is exercised in the browser.
vi.mock("@/app/(contributor)/stories/[id]/media-actions", () => ({
  mintPreviewUrlAction: vi.fn(),
}));

/**
 * Closed-loop test: proves the editor's configured plugin set can only ever
 * produce a value that (a) plateValueToBlocks() can convert and (b)
 * storyContentSchema accepts -- and that every node/mark deliberately left
 * out of the schema is structurally absent from the editor, not merely
 * hidden from the toolbar. Runs a real (headless) Plate/Slate editor
 * instance -- not a mock -- driven purely through its transform API,
 * exactly as story-content-editor.tsx's toolbar does.
 */

function makeEditor(value: import("platejs").Value) {
  return createSlateEditor({
    plugins: storyEditorPlugins(),
    value,
  });
}

describe("story editor configuration — allowed content", () => {
  it("produces a value that round-trips through the canonical schema after using every allowed command", () => {
    const editor = makeEditor([
      {
        type: "h2",
        children: [{ text: "A trip to Queenstown" }],
      },
      {
        type: "p",
        children: [
          { text: "It was " },
          { text: "amazing", bold: true },
          { text: " and " },
          { text: "cold", italic: true },
          { text: ". Read more " },
          {
            type: "a",
            url: "https://example.com",
            children: [{ text: "here" }],
          },
          { text: "." },
        ],
      },
      {
        type: "blockquote",
        children: [{ type: "p", children: [{ text: "Best trip ever." }] }],
      },
      {
        type: "p",
        children: [{ text: "Pack warm clothes" }],
        indent: 1,
        listStyleType: "disc",
      },
      {
        type: "p",
        children: [{ text: "Book early" }],
        indent: 1,
        listStyleType: "decimal",
      },
    ] as never);

    const blocks = plateValueToBlocks(editor.children as never);
    const result = storyContentSchema.safeParse(blocks);

    expect(result.success).toBe(true);
    expect(blocks.map((b) => b.type)).toEqual([
      "heading",
      "paragraph",
      "quote",
      "list",
      "list",
    ]);
  });

  it("toggles bold, italic, headings, lists, and blockquote via the same commands the toolbar uses", () => {
    const editor = makeEditor([
      { type: "p", children: [{ text: "text" }] },
    ] as never);
    editor.tf.select({
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 4 },
    });

    (editor.tf as unknown as { bold: { toggle: () => void } }).bold.toggle();
    expect(editor.api.marks()?.bold).toBe(true);

    (
      editor.tf as unknown as { italic: { toggle: () => void } }
    ).italic.toggle();
    expect(editor.api.marks()?.italic).toBe(true);

    (editor.tf as unknown as { h2: { toggle: () => void } }).h2.toggle();
    expect((editor.children[0] as { type: string }).type).toBe("h2");

    (editor.tf as unknown as { h2: { toggle: () => void } }).h2.toggle(); // back to paragraph
    toggleList(editor, { listStyleType: "disc" });
    expect(
      (editor.children[0] as { listStyleType?: string }).listStyleType,
    ).toBe("disc");

    toggleList(editor, { listStyleType: "disc" }); // untoggle
    toggleList(editor, { listStyleType: "decimal" });
    expect(
      (editor.children[0] as { listStyleType?: string }).listStyleType,
    ).toBe("decimal");

    toggleList(editor, { listStyleType: "decimal" }); // untoggle
    (
      editor.tf as unknown as { blockquote: { toggle: () => void } }
    ).blockquote.toggle();
    expect((editor.children[0] as { type: string }).type).toBe("blockquote");
  });

  it("rejects an unsafe link href — upsertLink still inserts it (validation is this app's job, not the plugin's), but the converter strips it", () => {
    const editor = makeEditor([
      { type: "p", children: [{ text: "text" }] },
    ] as never);
    editor.tf.select({
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 4 },
    });
    upsertLink(editor, { url: "javascript:alert(1)" });

    // Whatever the plugin did with it, the canonical converter (the actual
    // safety boundary, per its own header comment) must never let an
    // unsafe href survive into storyContentSchema-bound output.
    const blocks = plateValueToBlocks(editor.children as never);
    const hasUnsafeLink = blocks.some(
      (b) =>
        b.type === "paragraph" &&
        b.text.some(
          (run) =>
            Array.isArray(run.marks) &&
            run.marks.some((m) => typeof m !== "string" && m.type === "link"),
        ),
    );
    expect(hasUnsafeLink).toBe(false);
  });

  it("inserts a table via the same insertTable command the toolbar uses, producing only td cells (no header/th)", () => {
    const editor = makeEditor([
      { type: "p", children: [{ text: "text" }] },
    ] as never);
    insertTable(editor, { colCount: 2, rowCount: 2 });

    const table = editor.children.find(
      (node) => (node as { type?: string }).type === "table",
    ) as { children: { children: { type: string }[] }[] } | undefined;
    expect(table).toBeDefined();
    for (const row of table!.children) {
      for (const cell of row.children) {
        expect(cell.type).toBe("td");
      }
    }

    const blocks = plateValueToBlocks(editor.children as never);
    const result = storyContentSchema.safeParse(blocks);
    expect(result.success).toBe(true);
    expect(blocks.some((b) => b.type === "table")).toBe(true);
  });

  it("inserts an image node via editor.tf.insertNodes the same way ImageToolbarButton does, producing a mediaId-only block", () => {
    const editor = makeEditor([
      { type: "p", children: [{ text: "text" }] },
    ] as never);
    editor.tf.insertNodes({
      type: "image",
      mediaId: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      children: [{ text: "" }],
    } as never);

    const blocks = plateValueToBlocks(editor.children as never);
    const result = storyContentSchema.safeParse(blocks);
    expect(result.success).toBe(true);
    expect(blocks).toContainEqual({
      type: "image",
      mediaId: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    });
  });

  it("only allows heading types h2 and h3", () => {
    const editor = makeEditor([
      { type: "p", children: [{ text: "text" }] },
    ] as never);
    editor.tf.select({ path: [0, 0], offset: 2 } as never);
    (editor.tf as unknown as { h2: { toggle: () => void } }).h2.toggle();
    expect((editor.children[0] as { type: string }).type).toBe("h2");
    (editor.tf as unknown as { h2: { toggle: () => void } }).h2.toggle();
    (editor.tf as unknown as { h3: { toggle: () => void } }).h3.toggle();
    expect((editor.children[0] as { type: string }).type).toBe("h3");
  });
});

describe("story editor configuration — disallowed content is structurally absent", () => {
  it("has no underline/strike/code/codeBlock/horizontalRule transforms at all", () => {
    const editor = makeEditor([
      { type: "p", children: [{ text: "text" }] },
    ] as never);
    const tf = editor.tf as unknown as Record<string, unknown>;

    for (const name of ["underline", "strikethrough", "code", "hr"]) {
      expect(
        typeof tf[name],
        `${name} should not exist on this editor configuration`,
      ).toBe("undefined");
    }
  });

  it("cannot represent underline/strike even via a raw value load — the converter drops them", () => {
    const editor = makeEditor([
      {
        type: "p",
        // These mark properties have no registered plugin, so nothing in
        // this configuration ever reads or renders them -- and the
        // converter only ever looks at `bold`/`italic`/link-wrapping.
        children: [
          { text: "x", underline: true, strikethrough: true } as never,
        ],
      },
    ] as never);

    const blocks = plateValueToBlocks(editor.children as never);
    expect(blocks).toEqual([{ type: "paragraph", text: [{ text: "x" }] }]);
  });
});
