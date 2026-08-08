import { describe, expect, it } from "vitest";
import { storyContentSchema } from "@/lib/validation/story";
import {
  plateValueToBlocks,
  blocksToPlateValue,
  type PlateValue,
} from "@/lib/story/plate-serialize";

describe("plateValueToBlocks", () => {
  it("converts paragraphs with bold/italic/link runs", () => {
    const value: PlateValue = [
      {
        type: "p",
        children: [
          { text: "Hello " },
          { text: "bold", bold: true },
          { text: " and " },
          {
            type: "a",
            url: "https://example.com",
            children: [{ text: "a link" }],
          },
        ],
      },
    ];

    const blocks = plateValueToBlocks(value);
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

  it("converts h2/h3 headings and drops any other heading-like type", () => {
    const value: PlateValue = [
      { type: "h1", children: [{ text: "Not allowed" }] },
      { type: "h2", children: [{ text: "Title" }] },
      { type: "h3", children: [{ text: "Subtitle" }] },
    ];

    const blocks = plateValueToBlocks(value);
    expect(blocks).toEqual([
      { type: "heading", level: 2, text: [{ text: "Title" }] },
      { type: "heading", level: 3, text: [{ text: "Subtitle" }] },
    ]);
  });

  it("converts blockquote (block-level, paragraph child) and groups flat indented paragraphs into both list styles", () => {
    const value: PlateValue = [
      {
        type: "blockquote",
        children: [{ type: "p", children: [{ text: "A quote" }] }],
      },
      {
        type: "p",
        children: [{ text: "item one" }],
        indent: 1,
        listStyleType: "disc",
      },
      {
        type: "p",
        children: [{ text: "step one" }],
        indent: 1,
        listStyleType: "decimal",
      },
    ];

    const blocks = plateValueToBlocks(value);
    expect(blocks).toEqual([
      { type: "quote", text: [{ text: "A quote" }] },
      { type: "list", style: "unordered", items: [[{ text: "item one" }]] },
      { type: "list", style: "ordered", items: [[{ text: "step one" }]] },
    ]);
    expect(storyContentSchema.safeParse(blocks).success).toBe(true);
  });

  it("groups only consecutive same-style list items into one block, restarting on style change", () => {
    const value: PlateValue = [
      {
        type: "p",
        children: [{ text: "a" }],
        indent: 1,
        listStyleType: "disc",
      },
      {
        type: "p",
        children: [{ text: "b" }],
        indent: 1,
        listStyleType: "disc",
      },
      {
        type: "p",
        children: [{ text: "c" }],
        indent: 1,
        listStyleType: "decimal",
      },
      {
        type: "p",
        children: [{ text: "d" }],
        indent: 1,
        listStyleType: "disc",
      },
    ];

    const blocks = plateValueToBlocks(value);
    expect(blocks).toEqual([
      {
        type: "list",
        style: "unordered",
        items: [[{ text: "a" }], [{ text: "b" }]],
      },
      { type: "list", style: "ordered", items: [[{ text: "c" }]] },
      { type: "list", style: "unordered", items: [[{ text: "d" }]] },
    ]);
  });

  it("drops empty paragraphs and unsafe link hrefs (keeping the text)", () => {
    const value: PlateValue = [
      { type: "p", children: [] },
      {
        type: "p",
        children: [
          {
            type: "a",
            url: "javascript:alert(1)",
            children: [{ text: "danger" }],
          },
        ],
      },
    ];

    const blocks = plateValueToBlocks(value);
    expect(blocks).toEqual([{ type: "paragraph", text: [{ text: "danger" }] }]);
  });

  it("converts a table's rows/cells, keeping empty cells (grid shape matters)", () => {
    const value: PlateValue = [
      {
        type: "table",
        children: [
          {
            type: "tr",
            children: [
              {
                type: "td",
                children: [
                  {
                    type: "p",
                    children: [{ text: "bold", bold: true }],
                  },
                ],
              },
              { type: "td", children: [{ type: "p", children: [] }] },
            ],
          },
        ],
      },
    ];

    const blocks = plateValueToBlocks(value);
    expect(blocks).toEqual([
      {
        type: "table",
        rows: [[[{ text: "bold", marks: ["bold"] }], []]],
      },
    ]);
    expect(storyContentSchema.safeParse(blocks).success).toBe(true);
  });

  it("converts an image node to an image block, keyed on mediaId", () => {
    const value: PlateValue = [
      {
        type: "image",
        mediaId: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
        children: [{ text: "" }],
      },
    ];

    const blocks = plateValueToBlocks(value);
    expect(blocks).toEqual([
      { type: "image", mediaId: "3fa85f64-5717-4562-b3fc-2c963f66afa6" },
    ]);
    expect(storyContentSchema.safeParse(blocks).success).toBe(true);
  });

  it("drops an image node with a missing/non-string mediaId instead of throwing", () => {
    const value: PlateValue = [
      { type: "image", children: [{ text: "" }] } as never,
      { type: "image", mediaId: 42, children: [{ text: "" }] } as never,
      { type: "p", children: [{ text: "still here" }] },
    ];

    const blocks = plateValueToBlocks(value);
    expect(blocks).toEqual([
      { type: "paragraph", text: [{ text: "still here" }] },
    ]);
  });

  it("drops unsupported node types", () => {
    const value: PlateValue = [
      { type: "hr", children: [] },
      { type: "code_block", children: [{ text: "code" }] },
      { type: "p", children: [{ text: "x", bold: true }] },
    ];

    const blocks = plateValueToBlocks(value);
    expect(blocks).toEqual([
      { type: "paragraph", text: [{ text: "x", marks: ["bold"] }] },
    ]);
  });
});

describe("blocksToPlateValue round trip", () => {
  it("round-trips every block/mark type through plateValueToBlocks", () => {
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
      {
        type: "table" as const,
        rows: [
          [[{ text: "a" }], [{ text: "b" }]],
          [[{ text: "c" }], [{ text: "d" }]],
        ],
      },
      {
        type: "image" as const,
        mediaId: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      },
    ];

    expect(storyContentSchema.safeParse(original).success).toBe(true);

    const value = blocksToPlateValue(original);
    const roundTripped = plateValueToBlocks(value);
    expect(roundTripped).toEqual(original);
  });

  it("produces a minimal empty-paragraph value for an empty block array", () => {
    const value = blocksToPlateValue([]);
    expect(value).toEqual([{ type: "p", children: [{ text: "" }] }]);
  });

  it("expands a list block's items into flat indented paragraphs", () => {
    const value = blocksToPlateValue([
      {
        type: "list",
        style: "unordered",
        items: [[{ text: "one" }], [{ text: "two" }]],
      },
    ]);
    expect(value).toEqual([
      {
        type: "p",
        children: [{ text: "one" }],
        indent: 1,
        listStyleType: "disc",
      },
      {
        type: "p",
        children: [{ text: "two" }],
        indent: 1,
        listStyleType: "disc",
      },
    ]);
  });
});
