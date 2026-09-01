import { describe, expect, it } from "vitest";
import {
  extractMediaIds,
  extractMediaEmbeds,
  mediaEmbedToken,
  clampEmbedWidth,
  removeMediaEmbeds,
  moveMediaEmbed,
  MIN_EMBED_WIDTH,
  MAX_EMBED_WIDTH,
} from "./markdown-media";

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";

describe("extractMediaIds", () => {
  it("extracts every embedded mediaId in document order, lowercased", () => {
    const md = `![[${ID_A.toUpperCase()}]] text ![[${ID_B}|320]]`;
    expect(extractMediaIds(md)).toEqual([ID_A, ID_B]);
  });

  it("returns an empty array when there are no embeds", () => {
    expect(extractMediaIds("No images here.")).toEqual([]);
  });
});

describe("extractMediaEmbeds", () => {
  it("captures an optional stored width alongside the mediaId", () => {
    const md = `![[${ID_A}]] and ![[${ID_B}|480]]`;
    expect(extractMediaEmbeds(md)).toEqual([
      { mediaId: ID_A, width: undefined },
      { mediaId: ID_B, width: 480 },
    ]);
  });
});

describe("clampEmbedWidth", () => {
  it("clamps to the min/max bounds and rounds", () => {
    expect(clampEmbedWidth(10)).toBe(MIN_EMBED_WIDTH);
    expect(clampEmbedWidth(999_999)).toBe(MAX_EMBED_WIDTH);
    expect(clampEmbedWidth(320.6)).toBe(321);
  });
});

describe("mediaEmbedToken", () => {
  it("produces the bare token when no width is given", () => {
    expect(mediaEmbedToken(ID_A)).toBe(`![[${ID_A}]]`);
  });

  it("produces a width-suffixed token, clamped", () => {
    expect(mediaEmbedToken(ID_A, 400)).toBe(`![[${ID_A}|400]]`);
    expect(mediaEmbedToken(ID_A, 5)).toBe(`![[${ID_A}|${MIN_EMBED_WIDTH}]]`);
  });

  it("round-trips through extractMediaEmbeds", () => {
    const token = mediaEmbedToken(ID_A, 640);
    expect(extractMediaEmbeds(token)).toEqual([{ mediaId: ID_A, width: 640 }]);
  });
});

describe("removeMediaEmbeds", () => {
  it("removes every token for the given id, with or without a width", () => {
    const markdown = `Before ![[${ID_A}]] middle ![[${ID_A}|320]] after`;
    expect(removeMediaEmbeds(markdown, ID_A)).toBe("Before  middle  after");
  });

  it("leaves other images' tokens untouched", () => {
    const markdown = `![[${ID_A}|200]]\n\n![[${ID_B}]]`;
    const stripped = removeMediaEmbeds(markdown, ID_A);
    expect(extractMediaIds(stripped)).toEqual([ID_B]);
  });

  it("matches regardless of the id's case", () => {
    const markdown = `![[${ID_A.toUpperCase()}]]`;
    expect(removeMediaEmbeds(markdown, ID_A)).toBe("");
  });

  it("collapses the blank line a removed stand-alone token leaves behind", () => {
    const markdown = `First paragraph.\n\n![[${ID_A}|240]]\n\nSecond paragraph.`;
    expect(removeMediaEmbeds(markdown, ID_A)).toBe(
      "First paragraph.\n\nSecond paragraph.",
    );
  });

  it("returns the document unchanged when the id is not embedded", () => {
    const markdown = `Just text with ![[${ID_B}]]`;
    expect(removeMediaEmbeds(markdown, ID_A)).toBe(markdown);
  });
});

describe("moveMediaEmbed", () => {
  const a = mediaEmbedToken(ID_A, 320);
  const b = mediaEmbedToken(ID_B, 320);

  /** Finds a token's [from, to) the way the editor does, from its position. */
  function rangeOf(doc: string, token: string) {
    const from = doc.indexOf(token);
    return { from, to: from + token.length };
  }

  it("moves a stacked photo below the one after it", () => {
    const doc = `${a}\n${b}\n`;
    const { from, to } = rangeOf(doc, a);
    // Drop at the end of b's line.
    const target = doc.indexOf(b) + b.length;
    // Blank line between them: each stacked photo is its own paragraph, so
    // "stacked" survives to the published page instead of being flowed
    // back onto one row.
    expect(moveMediaEmbed(doc, from, to, target)).toBe(`${b}\n\n${a}\n\n`);
  });

  it("moves a photo above the one before it", () => {
    const doc = `${a}\n${b}\n`;
    const { from, to } = rangeOf(doc, b);
    expect(moveMediaEmbed(doc, from, to, 0)).toBe(`${b}\n\n${a}\n`);
  });

  // The reason the whole line moves rather than just the token: otherwise
  // every move leaves an empty paragraph where the photo used to be, and a
  // few reorders turn the story into a column of gaps.
  it("takes the photo's own line with it, leaving no blank gap", () => {
    const doc = `First paragraph.\n${a}\nSecond paragraph.\n`;
    const { from, to } = rangeOf(doc, a);
    expect(moveMediaEmbed(doc, from, to, doc.length)).toBe(
      `First paragraph.\nSecond paragraph.\n\n${a}`,
    );
  });

  it("keeps the stored width when it moves", () => {
    const wide = mediaEmbedToken(ID_A, 640);
    const doc = `${wide}\n${b}\n`;
    const { from, to } = rangeOf(doc, wide);
    const moved = moveMediaEmbed(doc, from, to, doc.indexOf(b) + b.length);
    expect(moved).toContain(`|640]]`);
  });

  it("puts the photo on its own line when dropped mid-paragraph", () => {
    const doc = `${a}\nSome words here.\n`;
    const { from, to } = rangeOf(doc, a);
    // End of the text line.
    const target = doc.indexOf("Some words here.") + "Some words here.".length;
    expect(moveMediaEmbed(doc, from, to, target)).toBe(
      `Some words here.\n\n${a}\n\n`,
    );
  });

  it("is a no-op when dropped back on itself", () => {
    const doc = `${a}\n${b}\n`;
    const { from, to } = rangeOf(doc, a);
    expect(moveMediaEmbed(doc, from, to, from)).toBe(doc);
    expect(moveMediaEmbed(doc, from, to, to)).toBe(doc);
  });

  it("refuses a range that is not an embed token", () => {
    const doc = `Just some prose.\n${a}\n`;
    expect(moveMediaEmbed(doc, 0, 4, doc.length)).toBe(doc);
  });

  it("clamps a target position outside the document", () => {
    const doc = `${a}\n${b}\n`;
    const { from, to } = rangeOf(doc, a);
    expect(() => moveMediaEmbed(doc, from, to, 10_000)).not.toThrow();
    expect(moveMediaEmbed(doc, from, to, 10_000)).toContain(ID_A);
  });

  it("moves the right photo when the same photo appears twice", () => {
    const doc = `${a}\n${b}\n${a}\n`;
    // The SECOND copy of a -- the one after b.
    const second = doc.indexOf(a, doc.indexOf(b));
    const moved = moveMediaEmbed(doc, second, second + a.length, 0);
    expect(moved).toBe(`${a}\n\n${a}\n${b}\n`);
  });

  describe("inline mode — photos side by side", () => {
    it("places a photo directly beside another, on the same line", () => {
      const doc = `${a}\n${b}\n`;
      const from = doc.indexOf(a);
      // Dropped on the right half of b: insert after b's token.
      const target = doc.indexOf(b) + b.length;
      expect(moveMediaEmbed(doc, from, from + a.length, target, "inline")).toBe(
        `${b} ${a}\n`,
      );
    });

    it("places a photo to the left of another", () => {
      const doc = `${a}\n${b}\n`;
      const from = doc.indexOf(b);
      expect(moveMediaEmbed(doc, from, from + b.length, 0, "inline")).toBe(
        `${b} ${a}\n`,
      );
    });

    // Two tokens jammed together still parse but render with the images
    // touching; a growing run of spaces after several reorders is its own
    // kind of mess. Exactly one space, only where there is not one already.
    it("separates the two tokens with exactly one space", () => {
      const doc = `${a}\n${b}\n`;
      const from = doc.indexOf(a);
      const moved = moveMediaEmbed(
        doc,
        from,
        from + a.length,
        doc.indexOf(b) + b.length,
        "inline",
      );
      expect(moved).not.toMatch(/\]\]!\[\[/);
      expect(moved).not.toMatch(/ {2}/);
    });

    it("does not add a space where whitespace already sits", () => {
      const doc = `${b} \n${a}\n`;
      const from = doc.indexOf(a);
      const moved = moveMediaEmbed(
        doc,
        from,
        from + a.length,
        doc.indexOf(b) + b.length + 1,
        "inline",
      );
      expect(moved).not.toMatch(/ {2}/);
    });

    it("still closes up the line the photo came from", () => {
      const doc = `Opening line.\n${a}\n${b}\n`;
      const from = doc.indexOf(a);
      const moved = moveMediaEmbed(
        doc,
        from,
        from + a.length,
        doc.indexOf(b) + b.length,
        "inline",
      );
      expect(moved).toBe(`Opening line.\n${b} ${a}\n`);
    });

    it("keeps both widths when two photos are paired up", () => {
      const wideA = mediaEmbedToken(ID_A, 400);
      const wideB = mediaEmbedToken(ID_B, 260);
      const doc = `${wideA}\n${wideB}\n`;
      const from = doc.indexOf(wideA);
      const moved = moveMediaEmbed(
        doc,
        from,
        from + wideA.length,
        doc.indexOf(wideB) + wideB.length,
        "inline",
      );
      expect(moved).toBe(`${wideB} ${wideA}\n`);
    });
  });
});
