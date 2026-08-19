#!/usr/bin/env node
/**
 * Stage 0.5 spike: PDF-to-raster-image rendering quality/performance/library
 * choice. Renders every page of each sample PDF in scratch/pdf-samples/ to a
 * preview-resolution PNG using pdfjs-dist + @napi-rs/canvas, and times it.
 *
 * Throwaway spike code, not shipped. Run: node scripts/spike-pdf-render.mjs
 */
import { readFile, mkdir, writeFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas } from "@napi-rs/canvas";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const samplesDir = path.join(repoRoot, "scratch", "pdf-samples");
const outDir = path.join(repoRoot, "scratch", "pdf-render-spike-output");

// legacy build == no DOM/Worker/Canvas assumptions, same entry point the
// prior text-extraction spike used successfully in this Node environment.
const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");

// pdfjs needs a canvas factory to create scratch canvases internally
// (e.g. for soft masks/patterns) — @napi-rs/canvas's Canvas/Context2D are
// duck-type-compatible with what pdfjs expects from a DOM canvas.
class NapiCanvasFactory {
  create(width, height) {
    const canvas = createCanvas(width, height);
    const context = canvas.getContext("2d");
    return { canvas, context };
  }
  reset(canvasAndContext, width, height) {
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  }
  destroy(canvasAndContext) {
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
    canvasAndContext.canvas = null;
    canvasAndContext.context = null;
  }
}

const standardFontDataUrl = path.join(
  path.dirname(
    fileURLToPath(new URL("pdfjs-dist/package.json", import.meta.url)),
  ),
  "standard_fonts/",
);

// Preview resolution: target ~2x a modest on-screen thumbnail. PDF default
// viewport is 72 DPI (scale 1 == 1pt == 1px); scale 2 ~= 144 DPI, roughly
// what the plan's "2x eventual display size for retina, let sharp downsize
// from there" guidance suggests for a preview render.
const PREVIEW_SCALE = 2.0;

async function renderPdf(filePath, label) {
  const bytes = await readFile(filePath);
  const canvasFactory = new NapiCanvasFactory();
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(bytes),
    standardFontDataUrl,
    canvasFactory,
    isEvalSupported: false,
    useSystemFonts: true,
  });

  const perPageMs = [];
  const totalStart = performance.now();
  let doc;
  try {
    doc = await loadingTask.promise;
  } catch (err) {
    return {
      label,
      error: `load failed: ${err instanceof err.constructor ? err.name : "Error"}: ${err.message}`,
    };
  }

  const numPages = doc.numPages;
  const pageDir = path.join(outDir, label);
  await mkdir(pageDir, { recursive: true });

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const pageStart = performance.now();
    const page = await doc.getPage(pageNum);
    const viewport = page.getViewport({ scale: PREVIEW_SCALE });
    const { canvas, context } = canvasFactory.create(
      Math.ceil(viewport.width),
      Math.ceil(viewport.height),
    );
    await page.render({
      canvasContext: context,
      viewport,
      canvasFactory,
    }).promise;
    const pngBuffer = await canvas.encode("png");
    const outPath = path.join(pageDir, `page-${pageNum}.png`);
    await writeFile(outPath, pngBuffer);
    const elapsed = performance.now() - pageStart;
    perPageMs.push({ pageNum, ms: elapsed, bytes: pngBuffer.length });
    canvasFactory.destroy({ canvas, context });
    page.cleanup();
  }

  const totalMs = performance.now() - totalStart;
  if (typeof doc.destroy === "function") {
    await doc.destroy();
  }

  return { label, numPages, totalMs, perPageMs };
}

async function main() {
  await mkdir(outDir, { recursive: true });

  const entries = (await readdir(samplesDir)).filter((f) => f.endsWith(".pdf"));

  console.log(`Found ${entries.length} sample PDFs in ${samplesDir}\n`);

  for (const entry of entries) {
    const filePath = path.join(samplesDir, entry);
    const { size } = await stat(filePath);
    const label = entry.replace(/\.pdf$/, "");
    const result = await renderPdf(filePath, label);
    if (result.error) {
      console.log(`## ${entry} (${(size / 1024).toFixed(0)} KB)`);
      console.log(`   ERROR: ${result.error}\n`);
      continue;
    }
    console.log(
      `## ${entry} (${(size / 1024).toFixed(0)} KB) — ${result.numPages} page(s)`,
    );
    console.log(`   total: ${result.totalMs.toFixed(1)}ms`);
    for (const p of result.perPageMs) {
      console.log(
        `   page ${p.pageNum}: ${p.ms.toFixed(1)}ms, ${(p.bytes / 1024).toFixed(1)} KB PNG`,
      );
    }
    console.log("");
  }

  console.log(`PNG output written to ${outDir} (not committed, scratch only)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
