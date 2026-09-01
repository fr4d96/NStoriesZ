import { describe, expect, it } from "vitest";
import {
  markdownImageCount,
  markdownToPlainText,
  markdownWordCount,
  readingTimeMinutes,
} from "./markdown-text";

const MEDIA_ID = "11111111-1111-4111-8111-111111111111";

describe("markdownToPlainText", () => {
  it("strips block markers, emphasis and link syntax", () => {
    expect(markdownToPlainText("## A heading")).toBe("A heading");
    expect(markdownToPlainText("- one\n- two")).toBe("one\ntwo");
    expect(markdownToPlainText("**bold** and *italic*")).toBe(
      "bold and italic",
    );
    expect(markdownToPlainText("see [the guide](https://x.test)")).toBe(
      "see the guide",
    );
  });

  it("removes image embed tokens, with or without a stored width", () => {
    expect(markdownToPlainText(`a ![[${MEDIA_ID}]] b`)).toBe("a  b");
    // Regression: content-quality-checks.ts's old private regex predated the
    // `|<width>` suffix, so a resized image leaked its width into the text
    // and "320" was counted as a word.
    expect(markdownToPlainText(`a ![[${MEDIA_ID}|320]] b`)).toBe("a  b");
  });

  it("does not carry regex state between calls", () => {
    const doc = `![[${MEDIA_ID}]]`;
    expect(markdownToPlainText(doc)).toBe("");
    expect(markdownToPlainText(doc)).toBe("");
  });
});

describe("markdownWordCount", () => {
  it("counts nothing for an empty or whitespace-only document", () => {
    expect(markdownWordCount("")).toBe(0);
    expect(markdownWordCount("   \n\n  ")).toBe(0);
  });

  it("counts what a reader would read, not the syntax", () => {
    expect(markdownWordCount("## Two words")).toBe(2);
    expect(markdownWordCount("**one** *two* three")).toBe(3);
    expect(markdownWordCount(`![[${MEDIA_ID}|640]]`)).toBe(0);
  });
});

describe("markdownImageCount", () => {
  it("counts embed tokens, sized or not", () => {
    expect(markdownImageCount("no images here")).toBe(0);
    expect(
      markdownImageCount(`![[${MEDIA_ID}]] text ![[${MEDIA_ID}|200]]`),
    ).toBe(2);
  });
});

describe("readingTimeMinutes", () => {
  it("is zero only for a completely empty story", () => {
    expect(readingTimeMinutes(0, 0)).toBe(0);
  });

  it("never rounds a non-empty story down to zero minutes", () => {
    expect(readingTimeMinutes(5, 0)).toBe(1);
    expect(readingTimeMinutes(0, 1)).toBe(1);
  });

  it("uses 275 words per minute", () => {
    expect(readingTimeMinutes(275, 0)).toBe(1);
    expect(readingTimeMinutes(550, 0)).toBe(2);
  });

  it("adds Ghost's decreasing per-image allowance (12s, 11s, 10s… then 3s)", () => {
    // 550 words = 120s, plus 12 + 11 + 10 = 33s -> 153s -> 3 minutes.
    expect(readingTimeMinutes(550, 3)).toBe(3);
    // The tenth image onwards is a flat 3 seconds.
    const nine = 12 + 11 + 10 + 9 + 8 + 7 + 6 + 5 + 4;
    expect(readingTimeMinutes(0, 10)).toBe(
      Math.max(1, Math.round((nine + 3) / 60)),
    );
  });
});
