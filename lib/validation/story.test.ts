import { describe, expect, it } from "vitest";
import {
  isSafeHref,
  storyContentBlockSchema,
  storyContentSchema,
  storyContentText,
  markdownToStoryContent,
  imageBlockMediaIds,
  revisionInputSchema,
  submitRevisionSchema,
  createReportSchema,
} from "./story";

describe("isSafeHref", () => {
  it("accepts absolute https and http URLs", () => {
    expect(isSafeHref("https://example.com/path")).toBe(true);
    expect(isSafeHref("http://example.com")).toBe(true);
  });

  it("accepts a root-relative path", () => {
    expect(isSafeHref("/stories/some-story")).toBe(true);
  });

  it("rejects javascript: and other unsafe schemes", () => {
    expect(isSafeHref("javascript:alert(1)")).toBe(false);
    expect(isSafeHref("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isSafeHref("vbscript:msgbox(1)")).toBe(false);
    expect(isSafeHref("file:///etc/passwd")).toBe(false);
  });

  it("rejects mixed-case scheme tricks", () => {
    expect(isSafeHref("jAvAsCrIpT:alert(1)")).toBe(false);
  });

  it("rejects protocol-relative URLs", () => {
    expect(isSafeHref("//evil.com/steal")).toBe(false);
  });

  it("rejects control characters and backslashes", () => {
    expect(isSafeHref("https://example.com/\x00path")).toBe(false);
    expect(isSafeHref("https:\\\\example.com")).toBe(false);
  });

  it("rejects overlong URLs", () => {
    expect(isSafeHref(`https://example.com/${"a".repeat(3000)}`)).toBe(false);
  });

  it("rejects an empty or unparseable value", () => {
    expect(isSafeHref("")).toBe(false);
    expect(isSafeHref("not a url at all")).toBe(false);
  });
});

describe("storyContentBlockSchema", () => {
  it("accepts a markdown block with plain text", () => {
    const result = storyContentBlockSchema.safeParse({
      type: "markdown",
      text: "Hello world",
    });
    expect(result.success).toBe(true);
  });

  it("accepts headings, quotes, lists, checklists, links, tables, and image embeds", () => {
    const text = [
      "## Intro",
      "",
      "A paragraph with **bold** and *italic* text.",
      "",
      "> A quote",
      "",
      "- one",
      "- two",
      "",
      "- [ ] todo item",
      "- [x] done item",
      "",
      "[a link](https://example.com)",
      "",
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
      "",
      "![[11111111-1111-4111-8111-111111111111]]",
    ].join("\n");
    const result = storyContentBlockSchema.safeParse({
      type: "markdown",
      text,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a leading # (h1) heading -- reserved for the story title", () => {
    const result = storyContentBlockSchema.safeParse({
      type: "markdown",
      text: "# Not allowed",
    });
    expect(result.success).toBe(false);
  });

  it("allows a literal '#' that isn't followed by a space (not a heading)", () => {
    const result = storyContentBlockSchema.safeParse({
      type: "markdown",
      text: "Room #42 was great.",
    });
    expect(result.success).toBe(true);
  });

  it("rejects standard ![alt](url) image syntax -- images must use the embed token", () => {
    const result = storyContentBlockSchema.safeParse({
      type: "markdown",
      text: "![a photo](https://example.com/photo.jpg)",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a link with an unsafe href", () => {
    const result = storyContentBlockSchema.safeParse({
      type: "markdown",
      text: "[click me](javascript:alert(1))",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a link with a safe href", () => {
    const result = storyContentBlockSchema.safeParse({
      type: "markdown",
      text: "[click me](https://example.com)",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty or whitespace-only text", () => {
    expect(
      storyContentBlockSchema.safeParse({ type: "markdown", text: "" }).success,
    ).toBe(false);
    expect(
      storyContentBlockSchema.safeParse({ type: "markdown", text: "   " })
        .success,
    ).toBe(false);
  });

  it("rejects text over the document-wide character ceiling", () => {
    const result = storyContentBlockSchema.safeParse({
      type: "markdown",
      text: "x".repeat(50_001),
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown block type", () => {
    const result = storyContentBlockSchema.safeParse({
      type: "video",
      url: "x",
    });
    expect(result.success).toBe(false);
  });
});

describe("storyContentSchema / storyContentText / markdownToStoryContent", () => {
  it("accepts exactly one markdown block", () => {
    const result = storyContentSchema.safeParse(
      markdownToStoryContent("Hello world"),
    );
    expect(result.success).toBe(true);
  });

  it("rejects an empty content array", () => {
    const result = storyContentSchema.safeParse([]);
    expect(result.success).toBe(false);
  });

  it("rejects more than one block", () => {
    const result = storyContentSchema.safeParse([
      { type: "markdown", text: "a" },
      { type: "markdown", text: "b" },
    ]);
    expect(result.success).toBe(false);
  });

  it("round-trips text through markdownToStoryContent/storyContentText", () => {
    const blocks = markdownToStoryContent("Some **bold** text");
    expect(storyContentText(blocks)).toBe("Some **bold** text");
  });

  it("storyContentText returns '' for malformed content", () => {
    expect(storyContentText([])).toBe("");
  });
});

describe("imageBlockMediaIds", () => {
  it("extracts every embedded mediaId in order", () => {
    const blocks = markdownToStoryContent(
      "![[11111111-1111-4111-8111-111111111111]] and ![[22222222-2222-4222-8222-222222222222]]",
    );
    expect(imageBlockMediaIds(blocks)).toEqual([
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ]);
  });

  it("returns an empty array when there are no embeds", () => {
    expect(
      imageBlockMediaIds(markdownToStoryContent("No images here.")),
    ).toEqual([]);
  });
});

describe("revisionInputSchema", () => {
  it("accepts valid input with dates in order", () => {
    const result = revisionInputSchema.safeParse({
      title: "My trip",
      contentJson: markdownToStoryContent("Hello"),
      tripStartDate: "2024-01-01",
      tripEndDate: "2024-03-01",
    });
    expect(result.success).toBe(true);
  });

  it("rejects trip end date before start date", () => {
    const result = revisionInputSchema.safeParse({
      title: "My trip",
      contentJson: markdownToStoryContent("Hello"),
      tripStartDate: "2024-03-01",
      tripEndDate: "2024-01-01",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty title", () => {
    const result = revisionInputSchema.safeParse({
      title: "",
      contentJson: markdownToStoryContent("Hello"),
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty content", () => {
    const result = revisionInputSchema.safeParse({
      title: "My trip",
      contentJson: [],
    });
    expect(result.success).toBe(false);
  });
});

describe("submitRevisionSchema", () => {
  it("requires publicationConfirmed to be true", () => {
    const result = submitRevisionSchema.safeParse({
      revisionId: "11111111-1111-4111-8111-111111111111",
      expectedVersion: 1,
      confirmationMethod: "account",
      publicationConfirmed: false,
    });
    expect(result.success).toBe(false);
  });

  it("accepts a valid submission", () => {
    const result = submitRevisionSchema.safeParse({
      revisionId: "11111111-1111-4111-8111-111111111111",
      expectedVersion: 1,
      confirmationMethod: "account",
      publicationConfirmed: true,
      expectedTermsVersion: "whv-compass-terms-2026-08",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a submission missing expectedTermsVersion (Prompt 4 Sub-phase 4)", () => {
    const result = submitRevisionSchema.safeParse({
      revisionId: "11111111-1111-4111-8111-111111111111",
      expectedVersion: 1,
      confirmationMethod: "account",
      publicationConfirmed: true,
    });
    expect(result.success).toBe(false);
  });
});

describe("createReportSchema", () => {
  it("accepts a valid report", () => {
    const result = createReportSchema.safeParse({
      storyId: "11111111-1111-4111-8111-111111111111",
      category: "misinformation",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown category", () => {
    const result = createReportSchema.safeParse({
      storyId: "11111111-1111-4111-8111-111111111111",
      category: "not-a-real-category",
    });
    expect(result.success).toBe(false);
  });
});
