import { describe, expect, it } from "vitest";
import {
  storyContentBlockSchema,
  storyContentSchema,
  revisionInputSchema,
  submitRevisionSchema,
  createReportSchema,
} from "./story";

describe("storyContentBlockSchema", () => {
  it("accepts a paragraph block", () => {
    const result = storyContentBlockSchema.safeParse({
      type: "paragraph",
      text: "Hello",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a heading, quote, and list block", () => {
    expect(
      storyContentBlockSchema.safeParse({
        type: "heading",
        level: 2,
        text: "Intro",
      }).success,
    ).toBe(true);
    expect(
      storyContentBlockSchema.safeParse({ type: "quote", text: "A quote" })
        .success,
    ).toBe(true);
    expect(
      storyContentBlockSchema.safeParse({
        type: "list",
        style: "unordered",
        items: ["one", "two"],
      }).success,
    ).toBe(true);
  });

  it("rejects an image block — no inline images in content_json", () => {
    const result = storyContentBlockSchema.safeParse({
      type: "image",
      mediaId: "11111111-1111-4111-8111-111111111111",
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

  it("rejects an empty list", () => {
    const result = storyContentBlockSchema.safeParse({
      type: "list",
      style: "ordered",
      items: [],
    });
    expect(result.success).toBe(false);
  });
});

describe("storyContentSchema", () => {
  it("accepts an array of valid blocks", () => {
    const result = storyContentSchema.safeParse([
      { type: "heading", level: 2, text: "Intro" },
      { type: "paragraph", text: "Body" },
    ]);
    expect(result.success).toBe(true);
  });
});

describe("revisionInputSchema", () => {
  it("accepts valid input with dates in order", () => {
    const result = revisionInputSchema.safeParse({
      title: "My trip",
      contentJson: [{ type: "paragraph", text: "Hello" }],
      tripStartDate: "2024-01-01",
      tripEndDate: "2024-03-01",
    });
    expect(result.success).toBe(true);
  });

  it("rejects trip end date before start date", () => {
    const result = revisionInputSchema.safeParse({
      title: "My trip",
      contentJson: [],
      tripStartDate: "2024-03-01",
      tripEndDate: "2024-01-01",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty title", () => {
    const result = revisionInputSchema.safeParse({
      title: "",
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
    });
    expect(result.success).toBe(true);
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
