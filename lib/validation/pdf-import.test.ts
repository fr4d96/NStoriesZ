// @vitest-environment node
//
// jsdom's environment runs modules in a separate VM realm, where a
// Uint8Array constructed there is not `instanceof` the same-named global
// class the schema's z.instanceof(Uint8Array) check resolves against --
// forcing the Node environment (no DOM needed here anyway) avoids that
// cross-realm mismatch entirely, same reasoning as
// lib/story/image-pipeline.test.ts's own @vitest-environment directive.
import { describe, expect, it } from "vitest";
import { pdfImportFileSchema } from "./pdf-import";
import { MAX_PDF_IMPORT_INPUT_BYTES } from "@/lib/story/pdf-validation";

function bytesOf(text: string): Uint8Array {
  return Buffer.from(text, "utf8");
}

describe("pdfImportFileSchema", () => {
  it("accepts bytes starting with the PDF magic signature", () => {
    const result = pdfImportFileSchema.safeParse({
      bytes: bytesOf("%PDF-1.7\n...rest of a pdf..."),
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty file", () => {
    const result = pdfImportFileSchema.safeParse({ bytes: new Uint8Array(0) });
    expect(result.success).toBe(false);
  });

  it("rejects bytes without the PDF magic signature, regardless of size", () => {
    const result = pdfImportFileSchema.safeParse({
      bytes: bytesOf("just some plain text"),
    });
    expect(result.success).toBe(false);
  });

  it("rejects a file over the size ceiling", () => {
    const oversized = new Uint8Array(MAX_PDF_IMPORT_INPUT_BYTES + 1);
    oversized.set(bytesOf("%PDF-1.7\n"));
    const result = pdfImportFileSchema.safeParse({ bytes: oversized });
    expect(result.success).toBe(false);
  });

  it("accepts a file right at the size ceiling", () => {
    const atCeiling = new Uint8Array(MAX_PDF_IMPORT_INPUT_BYTES);
    atCeiling.set(bytesOf("%PDF-1.7\n"));
    const result = pdfImportFileSchema.safeParse({ bytes: atCeiling });
    expect(result.success).toBe(true);
  });
});
