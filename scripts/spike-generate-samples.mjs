/**
 * THROWAWAY spike script -- Stage 0 of docs/pdf-canva-import-plan.md.
 *
 * Generates fictional sample PDFs approximating the shapes we expect from
 * Canva PDF exports, so scripts/spike-pdf-extract.ts has something to test
 * against. Not part of the shipped feature -- not imported by any
 * production code, not covered by npm run verify.
 *
 * All content below is invented placeholder text. No real contributor
 * material is used anywhere in this repo (CLAUDE.md Engineering Rule 22).
 *
 * Requires the temporary devDependency `pdfkit` (installed with
 * `npm install --no-save pdfkit pdfjs-dist` for this spike only).
 *
 * Run: node scripts/spike-generate-samples.mjs
 */
import PDFDocument from "pdfkit";
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "scratch", "pdf-samples");
fs.mkdirSync(OUT_DIR, { recursive: true });

function newDoc(file) {
  const doc = new PDFDocument({ autoFirstPage: false });
  doc.pipe(fs.createWriteStream(path.join(OUT_DIR, file)));
  return doc;
}

// ---------------------------------------------------------------------
// Sample 1 -- "plain-doc-1": simple single-column document, simulating a
// Canva "Doc" template export: title, headings, body paragraphs, in
// document order, single font family, no columns.
// ---------------------------------------------------------------------
function buildPlainDoc1() {
  const doc = newDoc("plain-doc-1.pdf");
  doc.addPage({ margin: 72 });
  doc
    .font("Helvetica-Bold")
    .fontSize(24)
    .text("Jane Traveler's WHV Story", { align: "left" });
  doc.moveDown(1.5);
  doc.font("Helvetica-Bold").fontSize(16).text("Arriving in Auckland");
  doc.moveDown(0.5);
  doc
    .font("Helvetica")
    .fontSize(11)
    .text(
      "The plane touched down just after sunrise, and the first thing I noticed was how green " +
        "everything looked from the air. I had spent months preparing paperwork for the Working " +
        "Holiday Visa, and none of it quite prepared me for how quiet the arrivals hall was at " +
        "that hour.",
    );
  doc.moveDown(1);
  doc
    .font("Helvetica")
    .fontSize(11)
    .text(
      "I found a hostel in the city centre for the first few nights while I worked out a longer-term " +
        "plan. The manager, a fictional character we'll call Tama, gave me a list of orchards that " +
        "were hiring seasonal pickers two hours south.",
    );
  doc.moveDown(1.5);
  doc.font("Helvetica-Bold").fontSize(16).text("Finding Work in Hawke's Bay");
  doc.moveDown(0.5);
  doc
    .font("Helvetica")
    .fontSize(11)
    .text(
      "Within a week I had a job picking apples on a fictional orchard called Sunridge Farms. The " +
        "pay was hourly plus a small bin bonus, and most of the other pickers were also on Working " +
        "Holiday Visas from a mix of countries.",
    );
  doc.moveDown(1);
  doc
    .font("Helvetica")
    .fontSize(11)
    .text(
      "It was hard physical work, but the crew became close fast. We shared a rented house near " +
        "the orchard and split the cooking most nights. This is a work of fiction written for " +
        "software testing purposes only.",
    );
  doc.moveDown(1.5);
  doc.font("Helvetica-Bold").fontSize(16).text("Looking Back");
  doc.moveDown(0.5);
  doc
    .font("Helvetica")
    .fontSize(11)
    .text(
      "Six months later I look back at that first quiet morning in the arrivals hall as the start " +
        "of the whole experience. None of the names or places in this account are real; they exist " +
        "only to exercise a PDF-import spike.",
    );
  doc.end();
}

// ---------------------------------------------------------------------
// Sample 2 -- "plain-doc-2": similar shape, different structure --
// includes a bullet-ish list rendered as separate text lines, and a
// sub-heading level to test font-size delta detection.
// ---------------------------------------------------------------------
function buildPlainDoc2() {
  const doc = newDoc("plain-doc-2.pdf");
  doc.addPage({ margin: 72 });
  doc
    .font("Helvetica-Bold")
    .fontSize(26)
    .text("Kiran Devi's Seasonal Work Diary");
  doc.moveDown(1.5);
  doc.font("Helvetica-Bold").fontSize(18).text("Packing List Lessons");
  doc.moveDown(0.5);
  doc
    .font("Helvetica")
    .fontSize(11)
    .text(
      "Before leaving, a fictional friend named Priya told me to pack fewer clothes and more " +
        "waterproof layers. She was right -- Queenstown weather changed four times before lunch " +
        "most days.",
    );
  doc.moveDown(1);
  doc.font("Helvetica-Bold").fontSize(13).text("Things I wish I had packed:");
  doc.moveDown(0.3);
  doc
    .font("Helvetica")
    .fontSize(11)
    .text("- A second pair of waterproof boots");
  doc.font("Helvetica").fontSize(11).text("- A proper thermal base layer");
  doc
    .font("Helvetica")
    .fontSize(11)
    .text("- A dedicated bag for hostel laundry days");
  doc.moveDown(1.5);
  doc
    .font("Helvetica-Bold")
    .fontSize(18)
    .text("Working at a Fictional Ski Lodge");
  doc.moveDown(0.5);
  doc
    .font("Helvetica")
    .fontSize(11)
    .text(
      "I spent the winter season working housekeeping at a made-up lodge called Frostline Lodge, " +
        "part of a fictional scenario written only to test a PDF text-extraction spike, never a " +
        "record of a real business or person.",
    );
  doc.moveDown(1);
  doc
    .font("Helvetica")
    .fontSize(11)
    .text(
      "The shifts were early, but the staff accommodation had a shared lounge with a fireplace, " +
        "which made the six a.m. starts easier to face.",
    );
  doc.end();
}

// ---------------------------------------------------------------------
// Sample 3 -- "decorative-poster-1": simulates a Canva "social story" /
// poster export -- two text columns placed by absolute x/y position, a
// varied set of font sizes for decorative headline vs. caption text, and
// an embedded raster image (a small solid-color PNG generated on the fly).
// ---------------------------------------------------------------------
async function makeTinyPng() {
  // Flat red 40x40 PNG generated with sharp (already a project dependency)
  // so this spike has zero external asset dependencies. Content is a flat
  // color swatch, not a photo.
  return sharp({
    create: {
      width: 40,
      height: 40,
      channels: 3,
      background: { r: 200, g: 60, b: 60 },
    },
  })
    .png()
    .toBuffer();
}

async function buildDecorativePoster1() {
  const doc = newDoc("decorative-poster-1.pdf");
  doc.addPage({ size: [540, 720], margin: 0 });

  // Decorative oversized headline, absolutely positioned, not in normal flow.
  doc
    .font("Helvetica-Bold")
    .fontSize(38)
    .fillColor("#1a3c34")
    .text("MY WHV\nJOURNEY", 40, 40, { width: 460, align: "left" });

  // Embedded raster image (small swatch) placed decoratively.
  doc.image(await makeTinyPng(), 400, 40, { width: 100, height: 100 });

  // Left column of body text at a fixed x/y box.
  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor("#000000")
    .text(
      "A fictional traveller named Alex Rivers spent three months in the South Island picking " +
        "cherries near a made-up town called Ridgeview.",
      40,
      220,
      { width: 220 },
    );

  // Right column, separate text box at same vertical position -- true
  // multi-column layout, the case Stage 2's heuristics need to detect
  // rather than merge left-to-right per line.
  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor("#000000")
    .text(
      "Weekends were spent exploring fictional hiking trails and swapping stories with other " +
        "seasonal workers from a dozen different countries.",
      300,
      220,
      { width: 200 },
    );

  // A caption-sized decorative element far down the page, out of normal
  // top-to-bottom reading order relative to a footer placed above it.
  doc
    .font("Helvetica-Oblique")
    .fontSize(8)
    .fillColor("#666666")
    .text(
      "Fictional sample content -- generated for a PDF-import spike only.",
      40,
      650,
      {
        width: 460,
      },
    );

  doc.end();
}

// ---------------------------------------------------------------------
// Sample 4 -- "decorative-poster-2": three narrow columns, varied font
// sizes throughout (mimicking a Canva infographic-style export), no
// images.
// ---------------------------------------------------------------------
function buildDecorativePoster2() {
  const doc = newDoc("decorative-poster-2.pdf");
  doc.addPage({ size: [600, 400], margin: 0 });

  doc
    .font("Helvetica-Bold")
    .fontSize(20)
    .fillColor("#7a2e2e")
    .text("THREE THINGS I LEARNED", 30, 20, { width: 540, align: "center" });

  const columns = [
    {
      x: 30,
      title: "01. Budgeting",
      body: "A fictional budgeting habit -- tracking weekly spend on a notecard -- kept costs down.",
    },
    {
      x: 220,
      title: "02. Community",
      body: "Fictional hostel meetups turned into a support network across the whole season.",
    },
    {
      x: 410,
      title: "03. Flexibility",
      body: "Plans changed constantly; a fictional itinerary rewrite happened almost every fortnight.",
    },
  ];
  for (const col of columns) {
    doc
      .font("Helvetica-Bold")
      .fontSize(13)
      .fillColor("#7a2e2e")
      .text(col.title, col.x, 90, {
        width: 160,
      });
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor("#222222")
      .text(col.body, col.x, 115, {
        width: 160,
      });
  }
  doc.end();
}

// ---------------------------------------------------------------------
// Sample 5 -- "no-text-layer-scan-sim": approximates the flattened /
// rasterized-text failure mode by rendering the page as a single full-page
// raster image with NO real text objects at all -- the closest a
// non-Canva tool can get to simulating Canva's "flatten to image" export
// path without running Canva itself.
// ---------------------------------------------------------------------
async function buildNoTextLayerScanSim() {
  const doc = newDoc("no-text-layer-scan-sim.pdf");
  doc.addPage({ size: [400, 300], margin: 0 });
  // A single flat-color image covering the whole page and nothing else --
  // no doc.text(...) calls at all, so there are zero text objects in the
  // page's content stream, matching what a flattened/rasterized Canva
  // export or a scanned page would look like from an extractor's point
  // of view.
  doc.image(await makeTinyPng(), 0, 0, { width: 400, height: 300 });
  doc.end();
}

buildPlainDoc1();
buildPlainDoc2();
await buildDecorativePoster1();
buildDecorativePoster2();
await buildNoTextLayerScanSim();

console.log(`Sample PDFs written to ${OUT_DIR}`);
