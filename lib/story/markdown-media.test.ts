import { describe, expect, it } from "vitest";
import {
  extractMediaIds,
  extractMediaEmbeds,
  mediaEmbedToken,
  clampEmbedWidth,
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
