/**
 * Generates the small, fictional PDF fixtures used by
 * lib/story/pdf-import.test.ts. Kept (not throwaway) so the fixtures can be
 * regenerated if the test matrix changes — CLAUDE.md Engineering Rule 22:
 * every byte of content below is invented placeholder text.
 *
 * Requires the `pdfkit` devDependency and the `qpdf` CLI (used only to
 * produce the password-protected fixture — pdfkit has no encryption
 * support, and no pure-npm PDF-encryption library was already present in
 * this repo's dependency tree). `qpdf` is a build-time-only tool for this
 * script; it is NOT a runtime dependency of the shipped feature.
 *
 * Run: node scripts/generate-pdf-import-fixtures.mjs
 */
import PDFDocument from "pdfkit";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "lib", "story", "__fixtures__");
fs.mkdirSync(OUT_DIR, { recursive: true });

function writePdf(filename, buildFn) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ autoFirstPage: false, margin: 36 });
    const outPath = path.join(OUT_DIR, filename);
    const stream = fs.createWriteStream(outPath);
    doc.pipe(stream);
    stream.on("finish", resolve);
    stream.on("error", reject);
    buildFn(doc);
    doc.end();
  });
}

// Page sizes/margins below are deliberately generous relative to the short
// fixture text -- pdfkit auto-inserts an extra page whenever text overflows
// the writable area, which would silently throw off the exact page counts
// these fixtures exist to test.

// --- valid-two-page.pdf: a small, genuinely valid 2-page PDF -------------
await writePdf("valid-two-page.pdf", (doc) => {
  doc.addPage({ size: [400, 300], margin: 20 });
  doc.fontSize(16).text("Fictional WHV Story", { align: "left" });
  doc.fontSize(10).text("Page one: invented placeholder content only.");
  doc.addPage({ size: [400, 300], margin: 20 });
  doc.fontSize(16).text("Fictional WHV Story");
  doc.fontSize(10).text("Page two: invented placeholder content only.");
});

// --- over-page-ceiling.pdf: more pages than the ceiling allows ------------
// lib/story/pdf-import.ts's MAX_PDF_IMPORT_PAGES is 40 — 41 tiny pages is
// the minimal fixture that exercises the "too many pages" rejection path.
await writePdf("over-page-ceiling.pdf", (doc) => {
  for (let i = 1; i <= 41; i++) {
    doc.addPage({ size: [400, 300], margin: 20 });
    doc.fontSize(10).text(`Fictional filler page ${i}.`);
  }
});

// --- password-protected.pdf: encrypted via qpdf from a plain source ------
const plainForEncryption = path.join(OUT_DIR, "_tmp-plain-for-encryption.pdf");
await writePdf("_tmp-plain-for-encryption.pdf", (doc) => {
  doc.addPage({ size: [400, 300], margin: 20 });
  doc
    .fontSize(12)
    .text("Fictional content behind a password, for a test fixture only.");
});
execFileSync("qpdf", [
  "--encrypt",
  "fixture-user-password",
  "fixture-owner-password",
  "256",
  "--",
  plainForEncryption,
  path.join(OUT_DIR, "password-protected.pdf"),
]);
fs.unlinkSync(plainForEncryption);

// --- corrupt.pdf: has a plausible %PDF- magic-byte prefix but is not a
// parseable PDF beyond that (no valid xref/trailer) --------------------
fs.writeFileSync(
  path.join(OUT_DIR, "corrupt.pdf"),
  Buffer.from(
    "%PDF-1.7\nThis has the right magic bytes but is not a real, parseable PDF document.\n%%EOF",
    "utf8",
  ),
);

// --- empty.pdf: zero bytes --------------------------------------------
fs.writeFileSync(path.join(OUT_DIR, "empty.pdf"), Buffer.alloc(0));

console.log(`Fixtures written to ${OUT_DIR}`);
