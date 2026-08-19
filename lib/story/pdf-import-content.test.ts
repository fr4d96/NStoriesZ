import { describe, expect, it } from "vitest";
import {
  buildPdfImportContent,
  titleFromPdfFilename,
  DEFAULT_PDF_IMPORT_TITLE,
} from "./pdf-import-content";
import { extractMediaIds } from "@/lib/story/markdown-media";
import { storyContentSchema, storyContentText } from "@/lib/validation/story";

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";
const ID_C = "33333333-3333-4333-8333-333333333333";

describe("buildPdfImportContent", () => {
  it("produces exactly N embed tokens in the same order as the input mediaIds", () => {
    const { contentJson } = buildPdfImportContent([ID_A, ID_B, ID_C]);
    const text = storyContentText(contentJson);
    expect(extractMediaIds(text)).toEqual([ID_A, ID_B, ID_C]);
  });

  it("round-trips through the real storyContentSchema validator", () => {
    const { contentJson } = buildPdfImportContent([ID_A, ID_B, ID_C]);
    const result = storyContentSchema.safeParse(contentJson);
    expect(result.success).toBe(true);
  });

  it("includes the instructional placeholder text", () => {
    const { contentJson } = buildPdfImportContent([ID_A]);
    const text = storyContentText(contentJson);
    expect(text).toContain("Imported from PDF");
  });

  it("still produces valid, round-trippable content_json with zero pages", () => {
    const { contentJson } = buildPdfImportContent([]);
    const text = storyContentText(contentJson);
    expect(extractMediaIds(text)).toEqual([]);
    const result = storyContentSchema.safeParse(contentJson);
    expect(result.success).toBe(true);
  });

  it("derives the title from the filename when provided", () => {
    const { title } = buildPdfImportContent([ID_A], "My Big OE Trip.pdf");
    expect(title).toBe("My Big OE Trip");
  });

  it("falls back to the default title when no filename is given", () => {
    const { title } = buildPdfImportContent([ID_A]);
    expect(title).toBe(DEFAULT_PDF_IMPORT_TITLE);
  });
});

describe("titleFromPdfFilename", () => {
  it("strips the extension and returns the readable name", () => {
    expect(titleFromPdfFilename("my-trip-diary.pdf")).toBe("my-trip-diary");
  });

  it("falls back to the default title for an empty/missing filename", () => {
    expect(titleFromPdfFilename("")).toBe(DEFAULT_PDF_IMPORT_TITLE);
    expect(titleFromPdfFilename(undefined)).toBe(DEFAULT_PDF_IMPORT_TITLE);
    expect(titleFromPdfFilename(null)).toBe(DEFAULT_PDF_IMPORT_TITLE);
  });

  it("falls back to the default title for a filename that's only an extension", () => {
    expect(titleFromPdfFilename(".pdf")).toBe(DEFAULT_PDF_IMPORT_TITLE);
  });

  it("falls back to the default title when nothing usable remains after cleanup", () => {
    expect(titleFromPdfFilename("____.pdf")).toBe(DEFAULT_PDF_IMPORT_TITLE);
    expect(titleFromPdfFilename("\t\n.pdf")).toBe(DEFAULT_PDF_IMPORT_TITLE);
  });

  it("sanitizes control characters and separators, collapsing whitespace", () => {
    expect(titleFromPdfFilename("my\ttrip\n2026.pdf")).toBe("my trip 2026");
    expect(titleFromPdfFilename("nz_working_holiday.pdf")).toBe(
      "nz working holiday",
    );
  });

  it("truncates to 200 characters after the extension is stripped", () => {
    const longName = "a".repeat(250) + ".pdf";
    const title = titleFromPdfFilename(longName);
    expect(title.length).toBe(200);
    expect(title).toBe("a".repeat(200));
  });
});
