/**
 * THROWAWAY spike script -- Stage 0 of docs/pdf-canva-import-plan.md.
 *
 * De-risks whether pdfjs-dist can extract usable structure (text, reading
 * order, font-size metadata, embedded raster images) from Canva-shaped PDF
 * exports before any production code (Stage 1+) is written.
 *
 * NOT part of the shipped feature. Not imported by production code. Not
 * covered by `npm run verify`. Depends on the temporary devDependency
 * `pdfjs-dist` (installed via `npm install --no-save pdfkit pdfjs-dist`
 * for this spike only -- see docs/pdf-import-spike-findings.md for whether
 * that install should be kept or reverted).
 *
 * Run: npx tsx scripts/spike-pdf-extract.ts
 * (or: npx --yes tsx scripts/spike-pdf-extract.ts if tsx isn't installed)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Legacy build = no DOM/Canvas/Worker assumptions, suitable for plain
// Node.js (this is the same build Node-only server-side consumers of
// pdfjs-dist are documented to use).
// eslint-disable-next-line @typescript-eslint/no-var-requires
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLES_DIR = path.join(__dirname, "..", "scratch", "pdf-samples");

interface TextRunSummary {
  str: string;
  fontName: string;
  fontSizePt: number;
  x: number;
  y: number;
}

async function extractPage(
  page: import("pdfjs-dist").PDFPageProxy,
  pageNum: number,
) {
  const textContent = await page.getTextContent();
  const runs: TextRunSummary[] = [];
  for (const item of textContent.items) {
    if (!("str" in item)) continue; // skip TextMarkedContent entries
    const t = item as {
      str: string;
      fontName: string;
      transform: number[];
    };
    if (t.str.trim() === "") continue;
    // transform = [scaleX, skewX, skewY, scaleY, x, y] -- font size in
    // user-space units is derivable from the transform's vertical scale.
    const fontSizePt = Math.hypot(t.transform[2], t.transform[3]);
    runs.push({
      str: t.str,
      fontName: t.fontName,
      fontSizePt: Math.round(fontSizePt * 100) / 100,
      x: Math.round(t.transform[4] * 100) / 100,
      y: Math.round(t.transform[5] * 100) / 100,
    });
  }

  // Embedded raster image inventory via the page operator list -- pdfjs
  // does not expose "give me all images" directly; you walk the operator
  // list and pick out paintImageXObject-style ops, then resolve each via
  // page.objs / page.commonObjs.
  const opList = await page.getOperatorList();
  const imageOps: string[] = [];
  const OPS = pdfjsLib.OPS;
  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i];
    if (
      fn === OPS.paintImageXObject ||
      fn === OPS.paintInlineImageXObject ||
      fn === OPS.paintImageXObjectRepeat
    ) {
      const args = opList.argsArray[i];
      imageOps.push(String(args?.[0] ?? "<inline>"));
    }
  }

  return { pageNum, runs, imageOps, rawItemCount: textContent.items.length };
}

async function inspectPdf(filePath: string) {
  const data = new Uint8Array(fs.readFileSync(filePath));
  const loadingTask = pdfjsLib.getDocument({ data });
  const doc = await loadingTask.promise;

  console.log(`\n${"=".repeat(70)}`);
  console.log(`FILE: ${path.basename(filePath)}`);
  console.log(`Pages: ${doc.numPages}`);

  let totalRuns = 0;
  let totalImageOps = 0;
  const fontSizesSeen = new Set<number>();

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const result = await extractPage(page, p);
    totalRuns += result.runs.length;
    totalImageOps += result.imageOps.length;

    console.log(`\n  -- page ${p} --`);
    console.log(
      `  text runs: ${result.runs.length}, image ops: ${result.imageOps.length}`,
    );
    if (result.runs.length === 0) {
      console.log("  (NO TEXT EXTRACTED on this page)");
    }
    for (const run of result.runs.slice(0, 12)) {
      fontSizesSeen.add(run.fontSizePt);
      console.log(
        `    [${run.fontSizePt}pt @ (${run.x},${run.y})] "${run.str.slice(0, 60)}${
          run.str.length > 60 ? "..." : ""
        }"`,
      );
    }
    if (result.runs.length > 12) {
      console.log(`    ... (${result.runs.length - 12} more runs)`);
    }
    if (result.imageOps.length > 0) {
      console.log(`  image object names: ${result.imageOps.join(", ")}`);
    }
  }

  console.log(
    `\n  SUMMARY: ${totalRuns} total text runs, ${totalImageOps} image paint ops`,
  );
  console.log(
    `  distinct font sizes seen: ${[...fontSizesSeen].sort((a, b) => a - b).join(", ")}`,
  );

  // Note: doc.destroy() / doc.cleanup() are not present as callable on
  // this legacy-build document proxy in the installed pdfjs-dist version;
  // skipped since this is a short-lived one-shot script, not a long-running
  // process where leaking the parsed document would matter.
}

async function main() {
  const files = fs
    .readdirSync(SAMPLES_DIR)
    .filter((f) => f.endsWith(".pdf"))
    .sort();

  if (files.length === 0) {
    console.error(
      `No sample PDFs found in ${SAMPLES_DIR}. Run scripts/spike-generate-samples.mjs and ` +
        `scripts/spike-generate-control.mjs first.`,
    );
    process.exit(1);
  }

  for (const file of files) {
    try {
      await inspectPdf(path.join(SAMPLES_DIR, file));
    } catch (err) {
      console.log(`\n${"=".repeat(70)}`);
      console.log(`FILE: ${file}`);
      console.log(`  EXTRACTION THREW: ${(err as Error).message}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
