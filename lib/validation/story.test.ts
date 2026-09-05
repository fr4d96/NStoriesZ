import { describe, expect, it } from "vitest";
import {
  isSafeHref,
  storyContentBlockSchema,
  storyContentSchema,
  draftContentSchema,
  storyContentText,
  markdownToStoryContent,
  imageBlockMediaIds,
  revisionInputSchema,
  submitRevisionSchema,
  createReportSchema,
  revisionTagsSchema,
  revisionExpenseSchema,
  MAX_TAGS_PER_REVISION,
  TAG_MAX_LENGTH,
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

  // DELIBERATELY REVERSED. This used to assert that empty content was
  // rejected, which is what stopped every OTHER field on the same payload
  // (sub-title, travel style, total expenses, contributor note) from saving
  // on a story whose body had not been written yet -- and step 1 of the
  // timeline is Title, step 2 is Your story, so walking the steps in order
  // was the path straight into it. Content is a SUBMIT-time requirement,
  // enforced by missingStoryRequirements() in the UI and by
  // submit_revision_with_consent() in the database, not a save-time one.
  it("accepts empty content, so a not-yet-written story can still save", () => {
    const result = revisionInputSchema.safeParse({
      title: "My trip",
      contentJson: [],
    });
    expect(result.success).toBe(true);
  });

  it("saves the other fields on a story with no body text yet", () => {
    const result = revisionInputSchema.safeParse({
      title: "My trip",
      excerpt: "A subtitle typed on step 1",
      totalExpenseNzdCents: 1_400_000,
      contentJson: [],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.excerpt).toBe("A subtitle typed on step 1");
    expect(result.data.totalExpenseNzdCents).toBe(1_400_000);
  });

  it("treats a whitespace-only block as no content, not as a broken block", () => {
    // What the editor actually sends after you type and then delete it all.
    const result = revisionInputSchema.safeParse({
      title: "My trip",
      contentJson: markdownToStoryContent("   \n  "),
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.contentJson).toEqual([]);
  });

  // Everything below still fails -- relaxing "there has to be some content"
  // must not relax the rules that apply to content there IS.
  it("still rejects an H1 inside the body", () => {
    const result = revisionInputSchema.safeParse({
      title: "My trip",
      contentJson: markdownToStoryContent("# Not allowed"),
    });
    expect(result.success).toBe(false);
  });

  it("still rejects a pasted markdown image link", () => {
    const result = revisionInputSchema.safeParse({
      title: "My trip",
      contentJson: markdownToStoryContent("![alt](https://example.com/a.png)"),
    });
    expect(result.success).toBe(false);
  });

  it("still rejects an unsafe link href", () => {
    const result = revisionInputSchema.safeParse({
      title: "My trip",
      contentJson: markdownToStoryContent("[x](javascript:alert(1))"),
    });
    expect(result.success).toBe(false);
  });

  it("still rejects more than one content block", () => {
    const result = revisionInputSchema.safeParse({
      title: "My trip",
      contentJson: [
        { type: "markdown", text: "a" },
        { type: "markdown", text: "b" },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe("draftContentSchema vs storyContentSchema", () => {
  // The import/paste paths (PDF, HTML, legacy) keep the strict one: there,
  // "must have content" IS the requirement, not incidental to it.
  it("storyContentSchema still rejects empty content", () => {
    expect(storyContentSchema.safeParse([]).success).toBe(false);
  });

  it("draftContentSchema accepts empty content", () => {
    expect(draftContentSchema.safeParse([]).success).toBe(true);
  });

  it("both accept a real block", () => {
    const blocks = markdownToStoryContent("Real writing.");
    expect(storyContentSchema.safeParse(blocks).success).toBe(true);
    expect(draftContentSchema.safeParse(blocks).success).toBe(true);
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

describe("revisionTagsSchema", () => {
  const ref = { id: "11111111-1111-4111-8111-111111111111" };

  it("accepts a mix of lookup references and contributor-authored labels", () => {
    const result = revisionTagsSchema.safeParse([
      ref,
      { customLabel: "Ferry to Picton" },
    ]);
    expect(result.success).toBe(true);
  });

  it("accepts a full cap's worth of tags", () => {
    const result = revisionTagsSchema.safeParse(
      Array.from({ length: MAX_TAGS_PER_REVISION }, (_, i) => ({
        customLabel: `Tag ${i}`,
      })),
    );
    expect(result.success).toBe(true);
  });

  it("rejects more than the cap (set_revision_tags enforces the same 20)", () => {
    const result = revisionTagsSchema.safeParse(
      Array.from({ length: MAX_TAGS_PER_REVISION + 1 }, (_, i) => ({
        customLabel: `Tag ${i}`,
      })),
    );
    expect(result.success).toBe(false);
  });

  it("rejects a selection that is both a reference and a label, or neither", () => {
    expect(
      revisionTagsSchema.safeParse([{ ...ref, customLabel: "Both" }]).success,
    ).toBe(false);
    expect(revisionTagsSchema.safeParse([{}]).success).toBe(false);
  });

  it("rejects a label longer than the stored column allows", () => {
    const result = revisionTagsSchema.safeParse([
      { customLabel: "x".repeat(TAG_MAX_LENGTH + 1) },
    ]);
    expect(result.success).toBe(false);
  });
});

describe("revisionExpenseSchema", () => {
  const id = "11111111-1111-4111-8111-111111111111";

  it("accepts a curated category reference", () => {
    expect(
      revisionExpenseSchema.safeParse({ categoryId: id, amountNzdCents: 1000 })
        .success,
    ).toBe(true);
  });

  // The case that was broken: a typed row sends categoryId null, and the
  // schema used to require a uuid -- which rejected the WHOLE array, so the
  // server action answered "Invalid expenses." and nothing reached the RPC.
  // The database was fine throughout; only this layer refused.
  it("accepts a contributor-typed label with no category", () => {
    const result = revisionExpenseSchema.safeParse({
      categoryId: null,
      customLabel: "Campervan repairs",
      amountNzdCents: 45000,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a row that is neither a category nor a label", () => {
    expect(
      revisionExpenseSchema.safeParse({
        categoryId: null,
        customLabel: null,
        amountNzdCents: 1000,
      }).success,
    ).toBe(false);
  });

  it("rejects an over-long typed label", () => {
    expect(
      revisionExpenseSchema.safeParse({
        customLabel: "x".repeat(61),
        amountNzdCents: 1000,
      }).success,
    ).toBe(false);
  });

  it("rejects a negative amount", () => {
    expect(
      revisionExpenseSchema.safeParse({ categoryId: id, amountNzdCents: -1 })
        .success,
    ).toBe(false);
  });
});
