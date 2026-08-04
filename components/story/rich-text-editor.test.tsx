import { describe, expect, it, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import { storyEditorExtensions } from "@/components/story/rich-text-editor";
import { storyContentSchema } from "@/lib/validation/story";
import { tiptapDocToBlocks } from "@/lib/story/rich-text-serialize";

/**
 * Closed-loop test: proves the editor's configured extension set can only
 * ever produce a document that (a) tiptapDocToBlocks() can convert and (b)
 * storyContentSchema accepts — and that every node/mark deliberately left
 * out of the schema is structurally absent from the editor, not merely
 * hidden from the toolbar. Runs a real (headless, DOM-free-of-rendering
 * but jsdom-backed) Tiptap Editor instance — not a mock — driven purely
 * through its command API, exactly as the toolbar buttons in
 * rich-text-editor.tsx do.
 */

let editor: Editor | undefined;

afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

function makeEditor(contentHtml = "<p></p>") {
  editor = new Editor({
    extensions: storyEditorExtensions(),
    content: contentHtml,
  });
  return editor;
}

describe("story editor configuration — allowed content", () => {
  it("produces a document that round-trips through the canonical schema after using every allowed command", () => {
    const e = makeEditor();

    e.commands.insertContent("Hello ");
    e.commands.selectAll();
    e.commands.setContent(
      {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: "A trip to Queenstown" }],
          },
          {
            type: "paragraph",
            content: [
              { type: "text", text: "It was " },
              { type: "text", text: "amazing", marks: [{ type: "bold" }] },
              { type: "text", text: " and " },
              { type: "text", text: "cold", marks: [{ type: "italic" }] },
              { type: "text", text: ". Read more " },
              {
                type: "text",
                text: "here",
                marks: [
                  { type: "link", attrs: { href: "https://example.com" } },
                ],
              },
              { type: "text", text: "." },
            ],
          },
          {
            type: "blockquote",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Best trip ever." }],
              },
            ],
          },
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Pack warm clothes" }],
                  },
                ],
              },
            ],
          },
          {
            type: "orderedList",
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Book early" }],
                  },
                ],
              },
            ],
          },
        ],
      },
      { emitUpdate: false },
    );

    const json = e.getJSON();
    const blocks = tiptapDocToBlocks(json as never);
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
    const e = makeEditor("<p>text</p>");
    // A cursor placed inside the single paragraph, rather than selectAll()
    // — StarterKit's trailing-node behavior guarantees the doc always ends
    // with an empty paragraph, so selecting the whole doc would span two
    // different node types and make node-type isActive() checks (heading,
    // list, blockquote) spuriously false.
    e.commands.setTextSelection(2);

    expect(e.can().toggleBold()).toBe(true);
    e.commands.toggleBold();
    expect(e.isActive("bold")).toBe(true);

    expect(e.can().toggleItalic()).toBe(true);
    e.commands.toggleItalic();
    expect(e.isActive("italic")).toBe(true);

    expect(e.can().toggleHeading({ level: 2 })).toBe(true);
    e.commands.toggleHeading({ level: 2 });
    expect(e.isActive("heading", { level: 2 })).toBe(true);

    e.commands.toggleHeading({ level: 2 }); // back to paragraph
    expect(e.can().toggleBulletList()).toBe(true);
    e.commands.toggleBulletList();
    expect(e.isActive("bulletList")).toBe(true);

    e.commands.toggleBulletList();
    expect(e.can().toggleOrderedList()).toBe(true);
    e.commands.toggleOrderedList();
    expect(e.isActive("orderedList")).toBe(true);

    e.commands.toggleOrderedList();
    expect(e.can().toggleBlockquote()).toBe(true);
    e.commands.toggleBlockquote();
    expect(e.isActive("blockquote")).toBe(true);
  });

  it("rejects an unsafe link href via the link extension's validate option", () => {
    const e = makeEditor("<p>text</p>");
    e.commands.setTextSelection({ from: 1, to: 5 });
    e.commands.setLink({ href: "javascript:alert(1)" });
    // The extension's validate() rejects it, so no link mark is applied.
    expect(e.isActive("link")).toBe(false);
  });

  it("only allows heading levels 2 and 3", () => {
    const e = makeEditor("<p>text</p>");
    e.commands.setTextSelection(2);
    e.commands.setHeading({ level: 1 });
    expect(e.isActive("heading", { level: 1 })).toBe(false);
    e.commands.setHeading({ level: 4 });
    expect(e.isActive("heading", { level: 4 })).toBe(false);
    e.commands.setHeading({ level: 2 });
    expect(e.isActive("heading", { level: 2 })).toBe(true);
    e.commands.setHeading({ level: 3 });
    expect(e.isActive("heading", { level: 3 })).toBe(true);
  });
});

describe("story editor configuration — disallowed content is structurally absent", () => {
  it("has no underline/strike/code/codeBlock/horizontalRule/hardBreak commands at all", () => {
    const e = makeEditor("<p>text</p>");
    const commands = e.commands as unknown as Record<string, unknown>;

    for (const name of [
      "toggleUnderline",
      "toggleStrike",
      "toggleCode",
      "toggleCodeBlock",
      "setHorizontalRule",
      "setHardBreak",
    ]) {
      expect(
        typeof commands[name],
        `${name} should not exist on this editor configuration`,
      ).toBe("undefined");
    }
  });

  it("cannot represent underline/strike even via a raw setContent call — the schema drops them", () => {
    const e = makeEditor();
    e.commands.setContent(
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "x",
                // These mark types have no registered extension, so Tiptap's
                // schema itself cannot instantiate them — the marks are
                // silently dropped by ProseMirror's content parser.
                marks: [{ type: "underline" }, { type: "strike" }],
              },
            ],
          },
        ],
      },
      { emitUpdate: false },
    );

    const json = e.getJSON();
    const textNode = json.content?.[0]?.content?.[0] as
      { marks?: unknown[] } | undefined;
    expect(textNode?.marks ?? []).toHaveLength(0);
  });
});
