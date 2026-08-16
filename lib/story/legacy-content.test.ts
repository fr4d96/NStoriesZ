import { describe, expect, it } from "vitest";
import { normalizeStoryContentJson } from "./legacy-content";
import { storyContentText } from "@/lib/validation/story";

const MEDIA_ID = "450d23d7-28ac-4101-96bf-c6f43f5f65d5";

function text(raw: unknown): string | null {
  const blocks = normalizeStoryContentJson(raw);
  return blocks ? storyContentText(blocks) : null;
}

describe("normalizeStoryContentJson", () => {
  it("passes today's Markdown shape straight through", () => {
    const current = [{ type: "markdown", text: "Hello **there**." }];
    expect(normalizeStoryContentJson(current)).toEqual(current);
  });

  it("returns null for content that is not an array at all", () => {
    expect(normalizeStoryContentJson(null)).toBeNull();
    expect(normalizeStoryContentJson("nope")).toBeNull();
    expect(normalizeStoryContentJson([])).toBeNull();
  });

  // This is the shape the published story
  // working-holiday-in-new-zealand-with-jeng-2c24729a actually holds.
  it("converts a legacy paragraph block whose text is a run array", () => {
    expect(
      text([{ type: "paragraph", text: [{ text: "Went to Jack's Point" }] }]),
    ).toBe("Went to Jack's Point");
  });

  it("converts the oldest shape, where block text was a plain string", () => {
    expect(text([{ type: "paragraph", text: "Plain old string" }])).toBe(
      "Plain old string",
    );
  });

  it("carries bold, italic, and safe links across as Markdown", () => {
    expect(
      text([
        {
          type: "paragraph",
          text: [
            { text: "picking " },
            { text: "apples", marks: ["bold"] },
            { text: " in " },
            { text: "Hawke's Bay", marks: ["italic"] },
            { text: " — " },
            {
              text: "the guide",
              marks: [{ type: "link", href: "https://example.com/guide" }],
            },
          ],
        },
      ]),
    ).toBe(
      "picking **apples** in *Hawke's Bay* — [the guide](https://example.com/guide)",
    );
  });

  it("drops an unsafe link href but keeps the run's text", () => {
    expect(
      text([
        {
          type: "paragraph",
          text: [
            {
              text: "click me",
              marks: [{ type: "link", href: "javascript:alert(1)" }],
            },
          ],
        },
      ]),
    ).toBe("click me");
  });

  it("escapes text that would otherwise become Markdown markup", () => {
    const converted = text([
      {
        type: "paragraph",
        text: [{ text: "5 * 3 and _underscored_ and [x]" }],
      },
    ]);
    expect(converted).toBe("5 \\* 3 and \\_underscored\\_ and \\[x\\]");
  });

  it("never lets a legacy heading become an h1", () => {
    expect(text([{ type: "heading", level: 2, text: [{ text: "Two" }] }])).toBe(
      "## Two",
    );
    expect(
      text([{ type: "heading", level: 3, text: [{ text: "Three" }] }]),
    ).toBe("### Three");
    // An out-of-range level is clamped to h2, not emitted as `# `, which the
    // schema rejects outright (the title is the only h1).
    expect(text([{ type: "heading", level: 1, text: [{ text: "One" }] }])).toBe(
      "## One",
    );
  });

  it("converts quotes and both list styles", () => {
    expect(text([{ type: "quote", text: [{ text: "Quoted" }] }])).toBe(
      "> Quoted",
    );
    expect(
      text([
        {
          type: "list",
          style: "unordered",
          items: [[{ text: "one" }], [{ text: "two" }]],
        },
      ]),
    ).toBe("- one\n- two");
    expect(
      text([
        {
          type: "list",
          style: "ordered",
          items: [[{ text: "first" }], [{ text: "second" }]],
        },
      ]),
    ).toBe("1. first\n2. second");
  });

  it("converts a table to GFM, padding short rows to the header width", () => {
    expect(
      text([
        {
          type: "table",
          rows: [
            [[{ text: "Region" }], [{ text: "Weeks" }]],
            [[{ text: "Otago" }]],
          ],
        },
      ]),
    ).toBe("| Region | Weeks |\n| --- | --- |\n| Otago |  |");
  });

  it("converts a legacy image block to today's embed token", () => {
    expect(text([{ type: "image", mediaId: MEDIA_ID }])).toBe(
      `![[${MEDIA_ID}]]`,
    );
  });

  it("joins multiple blocks with a blank line and drops unknown ones", () => {
    expect(
      text([
        { type: "paragraph", text: [{ text: "First" }] },
        { type: "somethingNew", text: [{ text: "ignored" }] },
        { type: "paragraph", text: [{ text: "Second" }] },
      ]),
    ).toBe("First\n\nSecond");
  });

  it("returns null when nothing in the document converts to real content", () => {
    expect(normalizeStoryContentJson([{ type: "unknown" }])).toBeNull();
    expect(
      normalizeStoryContentJson([{ type: "paragraph", text: [] }]),
    ).toBeNull();
  });
});
