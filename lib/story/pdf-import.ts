import "server-only";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import {
  isPdfMagicBytes,
  MAX_PDF_IMPORT_INPUT_BYTES,
  MAX_PDF_IMPORT_PAGES,
} from "@/lib/story/pdf-validation";

export {
  isPdfMagicBytes,
  MAX_PDF_IMPORT_INPUT_BYTES,
  MAX_PDF_IMPORT_PAGES,
} from "@/lib/story/pdf-validation";

/**
 * PDF-to-page-image import — Stage 1 of docs/pdf-canva-import-plan.md.
 *
 * This module gets a PDF file safely from raw upload bytes to a set of
 * rendered, preview-resolution page images, as a pure/testable server
 * module. It does NOT parse or reconstruct any text from the PDF (that
 * direction was abandoned — see the plan's revision history: pdfjs-dist
 * text extraction silently drops CJK text even though the glyphs render
 * correctly, which is unacceptable given this product's stated primary
 * market of Malaysian WHV travellers). Rasterizing the page sidesteps that
 * problem entirely — a rendered page is just a picture of whatever the PDF
 * actually contains, CJK included, and is handled downstream (Stage 2, not
 * built yet) exactly like any manually-uploaded photo.
 *
 * Server-only, by both `server-only`'s build-time guarantee and by not
 * being imported from anywhere reachable by a Client Component (Engineering
 * Rule 1's "server-only surface" discipline extends to this module even
 * though pdfjs-dist/@napi-rs/canvas are not secrets — a heavy native/WASM
 * PDF renderer has no business running in a browser bundle).
 *
 * Ground Rule 6 (the plan): the source PDF is discarded after rendering —
 * never persisted to any bucket/table/log. This module holds the input
 * `Buffer` only for the duration of the function call: it is read from
 * (pdfjs-dist copies it into its own internal Uint8Array on load), never
 * written anywhere, never captured into a closure that outlives the call,
 * and every pdfjs `Document`/`Page` handle this module creates is
 * `cleanup()`/`destroy()`-ed before returning so nothing lingers in
 * process memory across calls either.
 */

/**
 * Preview-thumbnail target resolution (long edge, px). Per the Stage 0.5
 * timing finding, resolution has only a modest effect on total render time
 * (dominated by vector/font rendering, not raster output size) — this is
 * chosen for picker-UI legibility, not as a performance knob. Computed
 * per-page from each page's own size (real Canva page sizes vary widely),
 * not a fixed DPI/scale.
 */
const PREVIEW_TARGET_LONG_EDGE_PX = 1000;

/**
 * Full-quality (Stage 2) target resolution (long edge, px). Meaningfully
 * higher than the preview resolution above, and comfortably above
 * `MAX_PROCESSED_DIMENSION` (2000px, `lib/story/image-validation.ts`) so the
 * existing image pipeline's own resize step does real, retina-appropriate
 * downsampling instead of passing the render through untouched — per the
 * plan's "roughly 2x the eventual display size for retina, then let the
 * existing sharp pipeline downsize" guidance. Not pushed higher than this:
 * Stage 0.5's spike found rendering *time* is dominated by vector/font
 * rendering, not output pixel count, so there's no throughput reason to
 * over-render, and a much larger raster only makes the pipeline's own
 * decode/resize step (bounded by `MAX_INPUT_PIXELS`) do more unnecessary
 * work for no visible benefit once resized back down.
 */
const FULL_QUALITY_TARGET_LONG_EDGE_PX = 2400;

// --- Result types -----------------------------------------------------

export type PdfImportError =
  | "not_a_pdf"
  | "input_too_large"
  | "corrupt_pdf"
  | "password_protected"
  | "zero_pages"
  | "too_many_pages"
  | "render_failed";

export type PdfPreviewPage = {
  pageNumber: number;
  /** Rendered PNG bytes at preview resolution. */
  bytes: Buffer;
  width: number;
  height: number;
};

export type PdfPreviewResult =
  | { ok: true; pages: PdfPreviewPage[]; pageCount: number }
  | { ok: false; error: PdfImportError };

/** Errors specific to rendering a caller-supplied set of page numbers. */
export type PdfPageRenderError = PdfImportError | "invalid_page_numbers";

export type PdfRenderedPage = {
  pageNumber: number;
  /** Rendered PNG bytes at full/publish quality. */
  bytes: Buffer;
  width: number;
  height: number;
};

export type PdfPageRenderResult =
  | { ok: true; pages: PdfRenderedPage[] }
  | { ok: false; error: PdfPageRenderError };

// --- Rendering ----------------------------------------------------------

let standardFontDataUrlCache: string | undefined;

/**
 * Absolute filesystem path (with the trailing slash pdfjs-dist requires) of
 * pdfjs-dist's bundled standard (non-embedded) font metrics directory.
 *
 * DO NOT "simplify" this back to a bare `require.resolve("pdfjs-dist/...")`.
 * That is exactly what this used to be, and it is what broke this feature
 * under Turbopack — this repo's default bundler for both `next dev` and
 * `next build` (see docs/implementation-status.md, 2026-08-18 Turbopack fix).
 * A bare `require.resolve(<literal>)` is a *bundler-visible* call: Turbopack
 * rewrites it to return its own module identifier rather than a real path.
 * With `pdfjs-dist` in next.config.ts's `serverExternalPackages`, dev
 * returned the string
 *   `[externals]/pdfjs-dist/package.json [external] (pdfjs-dist/...)`
 * (which fails pdfjs's own `must include trailing slash` check inside
 * `getDocument()`), and the production build returned a *numeric* module id
 * (`TypeError: 55876.replace is not a function`). `serverExternalPackages`
 * governs how the module is *loaded*; it does not make `require.resolve`
 * of a subpath inside that package fall through to Node.
 *
 * Importing `createRequire` from `node:module` normally is NOT enough
 * either — that was tried and re-broke identically: Turbopack substitutes
 * its own `createRequire` shim, so the resolver still resolves through the
 * bundler's module graph and still returns `[externals]/…`. `process
 * .getBuiltinModule("module")` (Node >= 22.3; this repo pins Node 24 via
 * `engines`) is the documented escape hatch: it reaches the *real* Node
 * builtin at runtime through `process`, which no bundler rewrites, so the
 * resolver below is a genuine Node resolver under Turbopack, webpack, and
 * plain Node/Vitest alike.
 *
 * Lazily resolved so a missing/renamed pdfjs-dist install fails at call
 * time with a clear stack, not at module-import time.
 */
function standardFontDataUrl(): string {
  if (!standardFontDataUrlCache) {
    const nodeModuleApi = process.getBuiltinModule("node:module");
    const pkgPath = nodeModuleApi
      .createRequire(import.meta.url)
      .resolve("pdfjs-dist/package.json");
    // Guard the assumption rather than silently producing a bad URL: if a
    // future bundler ever intercepts this too, fail loudly here (naming the
    // real cause) instead of deep inside pdfjs-dist's argument validation.
    if (!path.isAbsolute(pkgPath) || !pkgPath.endsWith("package.json")) {
      throw new Error(
        `Could not resolve pdfjs-dist's package directory: got ${JSON.stringify(
          pkgPath,
        )}, which is not an absolute path to package.json. This usually means ` +
          `the bundler intercepted module resolution instead of letting Node ` +
          `resolve it — see this function's doc comment.`,
      );
    }
    standardFontDataUrlCache = `${path.join(
      path.dirname(pkgPath),
      "standard_fonts",
    )}${path.sep}`;
  }
  return standardFontDataUrlCache;
}

// Node-safe pdfjs-dist build's shape, minus the parts of its public API this
// module doesn't touch — narrowed just enough to type the shared load
// helper below without importing pdfjs-dist's types eagerly.
type PdfjsLib = Awaited<typeof import("pdfjs-dist/legacy/build/pdf.mjs")>;
type PdfDocument = Awaited<ReturnType<PdfjsLib["getDocument"]>["promise"]>;

type LoadPdfResult =
  | {
      ok: true;
      pdfjsLib: PdfjsLib;
      loadingTask: ReturnType<PdfjsLib["getDocument"]>;
      doc: PdfDocument;
    }
  | { ok: false; error: PdfImportError };

/**
 * Shared entry sequence for both preview and full-quality rendering: magic
 * bytes -> size ceiling -> parse. Does not check the page-count ceiling
 * (callers differ on whether/how they enforce it) and does not destroy the
 * loading task on success — the caller owns that once it has `doc` in hand,
 * via a `finally { loadingTask.destroy() }` around its own page loop, same
 * as before this was extracted.
 */
async function loadPdfDocument(bytes: Buffer): Promise<LoadPdfResult> {
  if (bytes.byteLength === 0) {
    return { ok: false, error: "corrupt_pdf" };
  }
  if (bytes.byteLength > MAX_PDF_IMPORT_INPUT_BYTES) {
    return { ok: false, error: "input_too_large" };
  }
  if (!isPdfMagicBytes(bytes)) {
    return { ok: false, error: "not_a_pdf" };
  }

  // Dynamic import: keeps pdfjs-dist's fairly heavy module graph out of any
  // bundle that doesn't actually call this function, and matches the
  // Stage 0.5 spike's confirmed-working entry point (the Node-safe legacy
  // build — no DOM/Worker/Canvas assumptions).
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");

  // No `CanvasFactory` option is passed here: pdfjs-dist v6's own Node-path
  // default (internal `NodeCanvasFactory`) already `require()`s
  // `@napi-rs/canvas` itself when it detects a Node environment — confirmed
  // by reading the installed package's source
  // (node_modules/pdfjs-dist/legacy/build/pdf.mjs). Supplying a duplicate
  // custom factory would be redundant; this module's own `createCanvas`
  // import below is only for the top-level per-page canvas it renders into
  // and encodes to PNG.
  //
  // pdfjs-dist copies `data` into its own internal buffer on load — the
  // Uint8Array view passed here does not extend how long the original
  // `bytes` Buffer is referenced beyond this synchronous call.
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(bytes),
    standardFontDataUrl: standardFontDataUrl(),
    useSystemFonts: true,
  });

  try {
    const doc = await loadingTask.promise;
    return { ok: true, pdfjsLib, loadingTask, doc };
  } catch (err) {
    if (err instanceof pdfjsLib.PasswordException) {
      return { ok: false, error: "password_protected" };
    }
    return { ok: false, error: "corrupt_pdf" };
  }
}

/**
 * Renders one already-loaded page to a PNG at `targetLongEdgePx`, scaled
 * from that page's own base size (real Canva page sizes vary widely, so
 * this is never a fixed DPI/scale).
 */
async function renderPageToPng(
  page: Awaited<ReturnType<PdfDocument["getPage"]>>,
  targetLongEdgePx: number,
): Promise<{ bytes: Buffer; width: number; height: number }> {
  const baseViewport = page.getViewport({ scale: 1.0 });
  const longEdge = Math.max(baseViewport.width, baseViewport.height);
  const scale = longEdge > 0 ? targetLongEdgePx / longEdge : 1.0;
  const viewport = page.getViewport({ scale });
  const width = Math.max(1, Math.ceil(viewport.width));
  const height = Math.max(1, Math.ceil(viewport.height));
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");

  await page.render({
    // pdfjs-dist's TS types assume a DOM HTMLCanvasElement/
    // CanvasRenderingContext2D; @napi-rs/canvas's Canvas/Context2D are
    // runtime-compatible (this is the exact combination pdfjs-dist's own
    // internal NodeCanvasFactory uses, per its source read above) but not
    // structurally identical to those DOM types.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    canvas: canvas as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    canvasContext: context as any,
    viewport,
  }).promise;

  const pngBytes = await canvas.encode("png");
  return { bytes: Buffer.from(pngBytes), width, height };
}

/**
 * Renders each page of a PDF (up to MAX_PDF_IMPORT_PAGES) to a
 * preview-resolution PNG. Full rejection over partial/best-effort output
 * (Ground Rule 3): corrupt/unparseable, password-protected, zero-page, and
 * over-the-ceiling PDFs are all explicit typed errors, never a truncated or
 * partially-rendered result.
 *
 * Does not retain any reference to `bytes` beyond this call, and does not
 * write the source PDF anywhere (Ground Rule 6).
 */
export async function renderPagePreviews(
  bytes: Buffer,
): Promise<PdfPreviewResult> {
  const loaded = await loadPdfDocument(bytes);
  if (!loaded.ok) return loaded;
  const { doc, loadingTask } = loaded;

  try {
    const numPages = doc.numPages;
    if (numPages <= 0) {
      return { ok: false, error: "zero_pages" };
    }
    if (numPages > MAX_PDF_IMPORT_PAGES) {
      return { ok: false, error: "too_many_pages" };
    }

    const pages: PdfPreviewPage[] = [];
    for (let pageNumber = 1; pageNumber <= numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      try {
        const rendered = await renderPageToPng(
          page,
          PREVIEW_TARGET_LONG_EDGE_PX,
        );
        pages.push({ pageNumber, ...rendered });
      } catch {
        return { ok: false, error: "render_failed" };
      } finally {
        page.cleanup();
      }
    }

    return { ok: true, pages, pageCount: numPages };
  } finally {
    // PDFDocumentProxy itself has no destroy() in this version's types
    // (confirmed by reading node_modules/pdfjs-dist/types/src/display/api.d.ts
    // -- matches the Stage 0 spike's own finding on this point); the
    // loading task's destroy() is the documented way to release the parsed
    // document and its worker resources.
    await loadingTask.destroy();
  }
}

/**
 * Stage 2: renders a caller-supplied set of specific page numbers (e.g. the
 * pages an editor selected in the Stage 1 preview picker — Stage 4, not
 * built yet) at full/publish quality, in the exact order requested.
 * Duplicate page numbers in `pageNumbers` are allowed and each produce their
 * own independent rendered output (same bytes) — rejecting them here would
 * be the wrong layer; downstream duplicate-image detection (see
 * `lib/story/pdf-page-attachment.ts`) is where that's surfaced as a signal,
 * not a hard error, consistent with the existing same-story duplicate-image
 * warning convention (`components/story/image-upload-manager.tsx`).
 *
 * Full rejection over partial/best-effort output (Ground Rule 3): an empty
 * selection, an out-of-range page number, or any page that fails to render
 * rejects the whole call — never a partial set of pages.
 *
 * Does not retain any reference to `bytes` beyond this call, and does not
 * write the source PDF anywhere (Ground Rule 6).
 */
export async function renderPagesAtFullQuality(
  bytes: Buffer,
  pageNumbers: number[],
): Promise<PdfPageRenderResult> {
  if (
    pageNumbers.length === 0 ||
    pageNumbers.some((n) => !Number.isInteger(n) || n < 1)
  ) {
    return { ok: false, error: "invalid_page_numbers" };
  }

  const loaded = await loadPdfDocument(bytes);
  if (!loaded.ok) return loaded;
  const { doc, loadingTask } = loaded;

  try {
    const numPages = doc.numPages;
    if (numPages <= 0) {
      return { ok: false, error: "zero_pages" };
    }
    if (pageNumbers.some((n) => n > numPages)) {
      return { ok: false, error: "invalid_page_numbers" };
    }

    const pages: PdfRenderedPage[] = [];
    for (const pageNumber of pageNumbers) {
      const page = await doc.getPage(pageNumber);
      try {
        const rendered = await renderPageToPng(
          page,
          FULL_QUALITY_TARGET_LONG_EDGE_PX,
        );
        pages.push({ pageNumber, ...rendered });
      } catch {
        return { ok: false, error: "render_failed" };
      } finally {
        page.cleanup();
      }
    }

    return { ok: true, pages };
  } finally {
    await loadingTask.destroy();
  }
}
