// @vitest-environment node
//
// server-only's package code throws unconditionally outside Next's own
// bundler — same reasoning/mock as lib/story/image-pipeline.test.ts.
import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  renderPagePreviews,
  renderPagesAtFullQuality,
  isPdfMagicBytes,
  MAX_PDF_IMPORT_INPUT_BYTES,
  MAX_PDF_IMPORT_PAGES,
} from "./pdf-import";

vi.mock("server-only", () => ({}));

const FIXTURES_DIR = path.join(__dirname, "__fixtures__");

async function fixture(name: string): Promise<Buffer> {
  return readFile(path.join(FIXTURES_DIR, name));
}

describe("isPdfMagicBytes", () => {
  it("accepts bytes starting with %PDF-", () => {
    expect(isPdfMagicBytes(Buffer.from("%PDF-1.7\n..."))).toBe(true);
  });

  it("rejects bytes not starting with %PDF-", () => {
    expect(isPdfMagicBytes(Buffer.from("PK\x03\x04 not a pdf"))).toBe(false);
  });

  it("rejects a %PDF- signature that isn't at the very start", () => {
    expect(isPdfMagicBytes(Buffer.from("junk%PDF-1.7"))).toBe(false);
  });

  it("rejects a too-short buffer", () => {
    expect(isPdfMagicBytes(Buffer.from("%PD"))).toBe(false);
  });
});

describe("renderPagePreviews", () => {
  it("renders every page of a valid PDF, in order, with sane dimensions", async () => {
    const bytes = await fixture("valid-two-page.pdf");
    const result = await renderPagePreviews(bytes);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pageCount).toBe(2);
    expect(result.pages).toHaveLength(2);
    expect(result.pages.map((p) => p.pageNumber)).toEqual([1, 2]);
    for (const page of result.pages) {
      expect(page.width).toBeGreaterThan(0);
      expect(page.height).toBeGreaterThan(0);
      expect(page.bytes.byteLength).toBeGreaterThan(0);
      // PNG magic bytes.
      expect(page.bytes.subarray(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );
    }
  });

  it("rejects non-PDF bytes even with a .pdf-like name in the caller's context", async () => {
    const bytes = Buffer.from("this is just plain text, not a pdf at all");
    const result = await renderPagePreviews(bytes);
    expect(result).toEqual({ ok: false, error: "not_a_pdf" });
  });

  it("rejects input over the size ceiling", async () => {
    // Starts with a valid magic-byte prefix -- the size check must fire
    // before any parsing is attempted, not rely on parsing to fail.
    const oversized = Buffer.concat([
      Buffer.from("%PDF-1.7\n"),
      Buffer.alloc(MAX_PDF_IMPORT_INPUT_BYTES, 0x41),
    ]);
    const result = await renderPagePreviews(oversized);
    expect(result).toEqual({ ok: false, error: "input_too_large" });
  });

  it("rejects an empty buffer", async () => {
    const result = await renderPagePreviews(Buffer.alloc(0));
    expect(result).toEqual({ ok: false, error: "corrupt_pdf" });
  });

  it("rejects a corrupt PDF (valid magic bytes, unparseable structure)", async () => {
    const bytes = await fixture("corrupt.pdf");
    const result = await renderPagePreviews(bytes);
    expect(result).toEqual({ ok: false, error: "corrupt_pdf" });
  });

  it("rejects a password-protected PDF", async () => {
    const bytes = await fixture("password-protected.pdf");
    const result = await renderPagePreviews(bytes);
    expect(result).toEqual({ ok: false, error: "password_protected" });
  });

  it("rejects a PDF over the page-count ceiling", async () => {
    const bytes = await fixture("over-page-ceiling.pdf");
    const result = await renderPagePreviews(bytes);
    expect(result).toEqual({ ok: false, error: "too_many_pages" });
  });

  it("MAX_PDF_IMPORT_PAGES is the documented Stage 0.5 ceiling", () => {
    expect(MAX_PDF_IMPORT_PAGES).toBe(40);
  });
});

describe("renderPagesAtFullQuality", () => {
  it("renders exactly the requested pages, in the requested order, at a higher resolution than the preview pass", async () => {
    const bytes = await fixture("valid-two-page.pdf");
    // Page 2 requested before page 1 -- output order must follow the
    // caller's selection order, not ascending page number.
    const result = await renderPagesAtFullQuality(bytes, [2, 1]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pages.map((p) => p.pageNumber)).toEqual([2, 1]);

    const previewResult = await renderPagePreviews(bytes);
    expect(previewResult.ok).toBe(true);
    if (!previewResult.ok) return;
    for (const page of result.pages) {
      const previewPage = previewResult.pages.find(
        (p) => p.pageNumber === page.pageNumber,
      );
      expect(previewPage).toBeDefined();
      // Full-quality output must be meaningfully higher-resolution (long
      // edge) than the preview pass for the same page.
      const fullLongEdge = Math.max(page.width, page.height);
      const previewLongEdge = Math.max(previewPage!.width, previewPage!.height);
      expect(fullLongEdge).toBeGreaterThan(previewLongEdge);
      // PNG magic bytes.
      expect(page.bytes.subarray(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );
    }
  });

  it("renders the same page twice when the selection repeats it (duplicate detection is a downstream concern, not a rejection here)", async () => {
    const bytes = await fixture("valid-two-page.pdf");
    const result = await renderPagesAtFullQuality(bytes, [1, 1]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pages.map((p) => p.pageNumber)).toEqual([1, 1]);
    expect(result.pages[0].bytes.equals(result.pages[1].bytes)).toBe(true);
  });

  it("rejects an empty page-number selection", async () => {
    const bytes = await fixture("valid-two-page.pdf");
    const result = await renderPagesAtFullQuality(bytes, []);
    expect(result).toEqual({ ok: false, error: "invalid_page_numbers" });
  });

  it("rejects a page number the document doesn't have", async () => {
    const bytes = await fixture("valid-two-page.pdf");
    const result = await renderPagesAtFullQuality(bytes, [1, 99]);
    expect(result).toEqual({ ok: false, error: "invalid_page_numbers" });
  });

  it("rejects a zero or negative page number", async () => {
    const bytes = await fixture("valid-two-page.pdf");
    const result = await renderPagesAtFullQuality(bytes, [0]);
    expect(result).toEqual({ ok: false, error: "invalid_page_numbers" });
  });

  it("propagates the same rejection classes as renderPagePreviews (not a parallel validation path)", async () => {
    const corrupt = await fixture("corrupt.pdf");
    expect(await renderPagesAtFullQuality(corrupt, [1])).toEqual({
      ok: false,
      error: "corrupt_pdf",
    });

    const passwordProtected = await fixture("password-protected.pdf");
    expect(await renderPagesAtFullQuality(passwordProtected, [1])).toEqual({
      ok: false,
      error: "password_protected",
    });

    const notAPdf = Buffer.from("not a pdf");
    expect(await renderPagesAtFullQuality(notAPdf, [1])).toEqual({
      ok: false,
      error: "not_a_pdf",
    });
  });
});
