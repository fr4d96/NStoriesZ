/**
 * THROWAWAY spike script -- Stage 0 of docs/pdf-canva-import-plan.md.
 *
 * Variant of scripts/spike-pdf-extract.ts that points at a REAL Canva PDF
 * export living outside the repo (the user's own personal document, not
 * Kakinotes contributor content). Reads it from its original location on
 * disk, extracts the same signals as the fictional-sample spike, and
 * writes a summary to a scratch output file OUTSIDE the repo tree (the
 * Claude scratchpad directory) so no real personal content is ever written
 * into a repo-tracked or repo-adjacent path, per CLAUDE.md Engineering
 * Rule 22 (fictional/non-real content only gets committed) applied in
 * spirit even to throwaway spike output.
 *
 * NOT part of the shipped feature. Not imported by production code. Not
 * covered by `npm run verify`.
 *
 * Run: npx tsx scripts/spike-pdf-extract-real-sample.ts <path-to-pdf> <output-dir>
 */
import fs from "node:fs";
import path from "node:path";

// eslint-disable-next-line @typescript-eslint/no-var-requires
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

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
    if (!("str" in item)) continue;
    const t = item as {
      str: string;
      fontName: string;
      transform: number[];
    };
    if (t.str.trim() === "") continue;
    const fontSizePt = Math.hypot(t.transform[2], t.transform[3]);
    runs.push({
      str: t.str,
      fontName: t.fontName,
      fontSizePt: Math.round(fontSizePt * 100) / 100,
      x: Math.round(t.transform[4] * 100) / 100,
      y: Math.round(t.transform[5] * 100) / 100,
    });
  }

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

  const viewport = page.getViewport({ scale: 1 });

  return {
    pageNum,
    runs,
    imageOps,
    rawItemCount: textContent.items.length,
    width: Math.round(viewport.width),
    height: Math.round(viewport.height),
    rotation: page.rotate,
  };
}

async function main() {
  const filePath = process.argv[2];
  const outDir = process.argv[3];
  if (!filePath || !outDir) {
    console.error(
      "Usage: npx tsx scripts/spike-pdf-extract-real-sample.ts <pdf-path> <output-dir>",
    );
    process.exit(1);
  }

  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "real-canva-extract-summary.txt");
  const lines: string[] = [];
  const log = (s: string) => {
    lines.push(s);
  };

  const data = new Uint8Array(fs.readFileSync(filePath));
  const loadingTask = pdfjsLib.getDocument({ data });
  const doc = await loadingTask.promise;

  log(`FILE: ${path.basename(filePath)}`);
  log(`Pages: ${doc.numPages}`);

  let totalRuns = 0;
  let totalImageOps = 0;
  let pagesWithZeroText = 0;
  const fontSizesSeen = new Set<number>();
  const perPageSummary: string[] = [];

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const result = await extractPage(page, p);
    totalRuns += result.runs.length;
    totalImageOps += result.imageOps.length;
    if (result.runs.length === 0) pagesWithZeroText++;
    for (const run of result.runs) fontSizesSeen.add(run.fontSizePt);

    perPageSummary.push(
      `  page ${p}: ${result.width}x${result.height} rot=${result.rotation} | text runs: ${result.runs.length} | image ops: ${result.imageOps.length}` +
        (result.runs.length === 0 ? "  <-- NO TEXT EXTRACTED" : ""),
    );

    // Print first few + last few runs' font sizes/positions only (no need
    // for full string content in the aggregate summary -- but we DO want a
    // *few* short excerpts to sanity check reading order/garbling; keep
    // those short and only for a handful of pages to avoid dumping large
    // verbatim content into scratch output).
    if (p <= 3 || p === Math.ceil(doc.numPages / 2) || p === doc.numPages) {
      log(`\n-- page ${p} sample runs (order as emitted by pdfjs) --`);
      for (const run of result.runs.slice(0, 15)) {
        log(
          `    [${run.fontSizePt}pt @ (${run.x},${run.y})] "${run.str.slice(0, 40)}${
            run.str.length > 40 ? "..." : ""
          }"`,
        );
      }
      if (result.runs.length > 15)
        log(`    ... (${result.runs.length - 15} more runs)`);
      if (result.imageOps.length > 0) {
        log(
          `  image object names: ${result.imageOps.slice(0, 10).join(", ")}${
            result.imageOps.length > 10
              ? ` ... (+${result.imageOps.length - 10} more)`
              : ""
          }`,
        );
      }
    }
  }

  log(`\n${"=".repeat(70)}`);
  log(`PER-PAGE SUMMARY`);
  log(perPageSummary.join("\n"));

  log(`\n${"=".repeat(70)}`);
  log(`AGGREGATE SUMMARY`);
  log(`Total pages: ${doc.numPages}`);
  log(`Total text runs: ${totalRuns}`);
  log(`Total image paint ops: ${totalImageOps}`);
  log(`Pages with ZERO extracted text: ${pagesWithZeroText}`);
  log(
    `Distinct font sizes seen (pt): ${[...fontSizesSeen].sort((a, b) => a - b).join(", ")}`,
  );
  log(`Average text runs/page: ${(totalRuns / doc.numPages).toFixed(1)}`);
  log(`Average image ops/page: ${(totalImageOps / doc.numPages).toFixed(1)}`);

  fs.writeFileSync(outPath, lines.join("\n"), "utf-8");
  console.log(`Wrote summary to ${outPath}`);
  console.log(`\n--- AGGREGATE ---`);
  console.log(
    `Pages: ${doc.numPages}, total runs: ${totalRuns}, total image ops: ${totalImageOps}`,
  );
  console.log(`Pages with zero text: ${pagesWithZeroText}`);
  console.log(
    `Font sizes: ${[...fontSizesSeen].sort((a, b) => a - b).join(", ")}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
