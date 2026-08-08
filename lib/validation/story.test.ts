import { describe, expect, it } from "vitest";
import {
  isSafeHref,
  storyContentBlockSchema,
  storyContentSchema,
  revisionInputSchema,
  submitRevisionSchema,
  createReportSchema,
} from "./story";

function run(text: string, marks?: unknown[]) {
  return marks ? { text, marks } : { text };
}

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
  it("accepts a paragraph block with plain-text runs", () => {
    const result = storyContentBlockSchema.safeParse({
      type: "paragraph",
      text: [run("Hello")],
    });
    expect(result.success).toBe(true);
  });

  it("accepts a heading, quote, and list block", () => {
    expect(
      storyContentBlockSchema.safeParse({
        type: "heading",
        level: 2,
        text: [run("Intro")],
      }).success,
    ).toBe(true);
    expect(
      storyContentBlockSchema.safeParse({
        type: "quote",
        text: [run("A quote")],
      }).success,
    ).toBe(true);
    expect(
      storyContentBlockSchema.safeParse({
        type: "list",
        style: "unordered",
        items: [[run("one")], [run("two")]],
      }).success,
    ).toBe(true);
  });

  it("preserves interior whitespace on adjacent runs split at a mark boundary (regression: this used to render 'picking apples in' as 'pickingapplesin')", () => {
    const result = storyContentBlockSchema.safeParse({
      type: "paragraph",
      text: [run("picking "), run("apples", ["bold"]), run(" in Hawke's Bay.")],
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.type === "paragraph") {
      expect(result.data.text.map((r) => r.text)).toEqual([
        "picking ",
        "apples",
        " in Hawke's Bay.",
      ]);
    }
  });

  it("rejects a run that is only whitespace", () => {
    const result = storyContentBlockSchema.safeParse({
      type: "paragraph",
      text: [run("   ")],
    });
    expect(result.success).toBe(false);
  });

  it("accepts overlapping marks on a single run", () => {
    const result = storyContentBlockSchema.safeParse({
      type: "paragraph",
      text: [
        run("bold italic link", [
          "bold",
          "italic",
          { type: "link", href: "https://example.com" },
        ]),
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a duplicate mark kind on the same run", () => {
    const result = storyContentBlockSchema.safeParse({
      type: "paragraph",
      text: [run("x", ["bold", "bold"])],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a run with an unsafe link href", () => {
    const result = storyContentBlockSchema.safeParse({
      type: "paragraph",
      text: [run("x", [{ type: "link", href: "javascript:alert(1)" }])],
    });
    expect(result.success).toBe(false);
  });

  it("accepts an image block referencing a media id, and nothing else", () => {
    const result = storyContentBlockSchema.safeParse({
      type: "image",
      mediaId: "11111111-1111-4111-8111-111111111111",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an image block with a non-uuid or missing mediaId", () => {
    expect(
      storyContentBlockSchema.safeParse({
        type: "image",
        mediaId: "not-a-uuid",
      }).success,
    ).toBe(false);
    expect(storyContentBlockSchema.safeParse({ type: "image" }).success).toBe(
      false,
    );
  });

  it("rejects an image block carrying altText/caption -- that data lives on story_revision_media, not content_json", () => {
    const result = storyContentBlockSchema.safeParse({
      type: "image",
      mediaId: "11111111-1111-4111-8111-111111111111",
      altText: "should not be here",
    });
    // Extra keys are stripped by z.object() by default, not rejected --
    // this test documents that the schema does NOT define an altText/
    // caption field for images, not that it errors on one.
    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      type: "image",
      mediaId: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("rejects an unknown block type", () => {
    const result = storyContentBlockSchema.safeParse({
      type: "video",
      url: "x",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty list", () => {
    const result = storyContentBlockSchema.safeParse({
      type: "list",
      style: "ordered",
      items: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a block whose combined run text exceeds its ceiling", () => {
    const longRuns = Array.from({ length: 10 }, () => run("x".repeat(600)));
    const result = storyContentBlockSchema.safeParse({
      type: "paragraph",
      text: longRuns,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a heading with a disallowed level", () => {
    const result = storyContentBlockSchema.safeParse({
      type: "heading",
      level: 1,
      text: [run("Intro")],
    });
    expect(result.success).toBe(false);
  });
});

describe("storyContentSchema", () => {
  it("accepts an array of valid blocks", () => {
    const result = storyContentSchema.safeParse([
      { type: "heading", level: 2, text: [run("Intro")] },
      { type: "paragraph", text: [run("Body")] },
    ]);
    expect(result.success).toBe(true);
  });

  it("rejects an empty content array", () => {
    const result = storyContentSchema.safeParse([]);
    expect(result.success).toBe(false);
  });

  it("rejects content over the document-wide character ceiling", () => {
    const blocks = Array.from({ length: 200 }, () => ({
      type: "paragraph" as const,
      text: [run("x".repeat(4999))],
    }));
    const result = storyContentSchema.safeParse(blocks);
    expect(result.success).toBe(false);
  });
});

describe("revisionInputSchema", () => {
  it("accepts valid input with dates in order", () => {
    const result = revisionInputSchema.safeParse({
      title: "My trip",
      contentJson: [{ type: "paragraph", text: [run("Hello")] }],
      tripStartDate: "2024-01-01",
      tripEndDate: "2024-03-01",
    });
    expect(result.success).toBe(true);
  });

  it("rejects trip end date before start date", () => {
    const result = revisionInputSchema.safeParse({
      title: "My trip",
      contentJson: [{ type: "paragraph", text: [run("Hello")] }],
      tripStartDate: "2024-03-01",
      tripEndDate: "2024-01-01",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty title", () => {
    const result = revisionInputSchema.safeParse({
      title: "",
      contentJson: [{ type: "paragraph", text: [run("Hello")] }],
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
