import { describe, expect, it } from "vitest";
import { storyContentSchema } from "@/lib/validation/story";
import {
  tiptapDocToBlocks,
  blocksToTiptapDoc,
  type TiptapDoc,
} from "@/lib/story/rich-text-serialize";

describe("tiptapDocToBlocks", () => {
  it("converts paragraphs with bold/italic/link runs", () => {
    const doc: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Hello " },
            { type: "text", text: "bold", marks: [{ type: "bold" }] },
            { type: "text", text: " and " },
            {
              type: "text",
              text: "a link",
              marks: [{ type: "link", attrs: { href: "https://example.com" } }],
            },
          ],
        },
      ],
    };

    const blocks = tiptapDocToBlocks(doc);
    expect(blocks).toEqual([
      {
        type: "paragraph",
        text: [
          { text: "Hello " },
          { text: "bold", marks: ["bold"] },
          { text: " and " },
          {
            text: "a link",
            marks: [{ type: "link", href: "https://example.com" }],
          },
        ],
      },
    ]);
    expect(storyContentSchema.safeParse(blocks).success).toBe(true);
  });

  it("converts headings, only accepting level 2 or 3", () => {
    const doc: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Title" }],
        },
        {
          type: "heading",
          attrs: { level: 3 },
          content: [{ type: "text", text: "Subtitle" }],
        },
      ],
    };

    const blocks = tiptapDocToBlocks(doc);
    // level 1 collapses to level 2 (the highest allowed level), never crashes.
    expect(blocks).toEqual([
      { type: "heading", level: 2, text: [{ text: "Title" }] },
      { type: "heading", level: 3, text: [{ text: "Subtitle" }] },
    ]);
  });

  it("converts blockquote and both list styles", () => {
    const doc: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "blockquote",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "A quote" }],
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
                  content: [{ type: "text", text: "item one" }],
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
                  content: [{ type: "text", text: "step one" }],
                },
              ],
            },
          ],
        },
      ],
    };

    const blocks = tiptapDocToBlocks(doc);
    expect(blocks).toEqual([
      { type: "quote", text: [{ text: "A quote" }] },
      {
        type: "list",
        style: "unordered",
        items: [[{ text: "item one" }]],
      },
      {
        type: "list",
        style: "ordered",
        items: [[{ text: "step one" }]],
      },
    ]);
    expect(storyContentSchema.safeParse(blocks).success).toBe(true);
  });

  it("drops empty paragraphs and unsafe link hrefs", () => {
    const doc: TiptapDoc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [] },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "danger",
              marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
            },
          ],
        },
      ],
    };

    const blocks = tiptapDocToBlocks(doc);
    expect(blocks).toEqual([{ type: "paragraph", text: [{ text: "danger" }] }]);
  });

  it("drops unsupported node types and duplicate mark kinds", () => {
    const doc: TiptapDoc = {
      type: "doc",
      content: [
        { type: "horizontalRule" },
        {
          type: "codeBlock",
          content: [{ type: "text", text: "code" }],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "x",
              marks: [{ type: "bold" }, { type: "bold" }],
            },
          ],
        },
      ],
    };

    const blocks = tiptapDocToBlocks(doc);
    expect(blocks).toEqual([
      { type: "paragraph", text: [{ text: "x", marks: ["bold"] }] },
    ]);
  });
});

describe("blocksToTiptapDoc round trip", () => {
  it("round-trips every block/mark type through tiptapDocToBlocks", () => {
    const original = [
      {
        type: "paragraph" as const,
        text: [
          { text: "Hello " },
          { text: "bold", marks: ["bold" as const] },
          {
            text: "link",
            marks: [{ type: "link" as const, href: "https://example.com" }],
          },
        ],
      },
      { type: "heading" as const, level: 2 as const, text: [{ text: "H2" }] },
      { type: "quote" as const, text: [{ text: "quoted" }] },
      {
        type: "list" as const,
        style: "ordered" as const,
        items: [[{ text: "one" }], [{ text: "two" }]],
      },
    ];

    expect(storyContentSchema.safeParse(original).success).toBe(true);

    const doc = blocksToTiptapDoc(original);
    const roundTripped = tiptapDocToBlocks(doc);
    expect(roundTripped).toEqual(original);
  });

  it("produces a minimal empty-paragraph doc for an empty block array", () => {
    const doc = blocksToTiptapDoc([]);
    expect(doc).toEqual({
      type: "doc",
      content: [{ type: "paragraph", content: [] }],
    });
  });
});
