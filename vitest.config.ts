import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["**/*.test.{ts,tsx}"],
    // tests/integration/** hits a real Supabase project and is intentionally
    // excluded from the default run — see `npm run test:rls`.
    exclude: ["node_modules/**", ".next/**", "e2e/**", "tests/integration/**"],
    // Vitest's default is 5000ms, which was never a deliberate choice here and
    // is too tight for this suite's heaviest tests. Several do REAL work rather
    // than mocked work: the PDF import/attach/export paths rasterise actual
    // fixture PDFs through pdfjs-dist + @napi-rs/canvas (a native module whose
    // render calls block the thread), and the editor/paste tests drive
    // CodeMirror and a full HTML parse.
    //
    // Measured with `vitest run --reporter=json` across full parallel runs on
    // an 8-core machine, worst case per test:
    //
    //   4535ms  pdf-attach/route.test.ts   creates a draft with the selected pages
    //   4241ms  pdf-page-attachment        renders selected pages through the real pipeline
    //   3408ms  story-content-editor       renders a single live-editing surface
    //   3383ms  pdf-import-picker          disables unselected thumbnails at the limit
    //
    // That is 91% of the old budget for the worst one, so ordinary variance
    // under load tipped it over: a full run failed roughly one time in three
    // with "Test timed out in 5000ms" at 5007ms. Isolated, the same file runs
    // in well under a second — which is exactly why this only ever showed up
    // in full runs and looked like a phantom.
    //
    // 20s is ~4.4x the measured worst case, leaving room for slower CI
    // hardware, and still fails a genuinely hung test quickly relative to the
    // ~95s the whole suite takes. Raise the SLOW TESTS, not this number, if it
    // ever starts being hit.
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
