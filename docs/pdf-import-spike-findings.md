# PDF import spike findings (Stage 0 / Stage 0.5)

Status: **Stage 0 (text extraction, superseded) and Stage 0.5 (page rasterization) complete.** This
is a throwaway-spike report, not a spec. It informs Stage 1+ of
[docs/pdf-canva-import-plan.md](pdf-canva-import-plan.md); it ships no production code.

## Important limitation up front

**We do not have access to real Canva PDF exports and could not run Canva itself in this
environment.** Every sample below is a fictional PDF _generated_ to approximate the shapes
described in the plan (plain document, multi-column/decorative, flattened-to-image), not an
actual Canva export. In particular:

- The "no text layer" sample (`no-text-layer-scan-sim.pdf`) simulates a fully rasterized page by
  rendering an image with zero real text objects in the content stream. This is a reasonable proxy
  for "extractor sees no text," but it cannot prove or disprove how _often_ real Canva "Doc" vs.
  "social story"/poster templates actually flatten text this way — that can only be confirmed
  against real Canva output.
- The multi-column/decorative samples simulate absolute text-box positioning (which Canva does
  use for its layouts), but Canva's actual PDF output may use different font embedding, subsetting,
  or content-stream structuring that behaves differently under pdfjs-dist. Treat the multi-column
  findings below as "the mechanism works on PDFs shaped like this," not "confirmed against Canva."

**Recommendation:** before Stage 1, if at all possible, get 2-3 real Canva PDF exports (Doc
template and Poster/social-story template) from the product owner and re-run
`scripts/spike-pdf-extract.ts` against them. That is a cheap, high-value confirmation this spike
could not do.

## Samples generated

All content is invented placeholder text (fictional names: Jane Traveler, Kiran Devi, Alex Rivers,
Mele Tupou; fictional places/businesses: Sunridge Farms, Frostline Lodge, Ridgeview, Fernbrook).
Nothing resembles real contributor material, per CLAUDE.md Engineering Rule 22.

| File                         | Simulates                                                                                                                                                     | Generator             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `plain-doc-1.pdf`            | Canva "Doc" template export: title + 3 headings + paragraphs, single column                                                                                   | pdfkit                |
| `plain-doc-2.pdf`            | Same shape, adds a sub-heading level and a bullet-style list                                                                                                  | pdfkit                |
| `decorative-poster-1.pdf`    | Canva "social story"/poster export: oversized headline, two side-by-side text-box columns at the same y-position, one embedded raster image, off-flow caption | pdfkit                |
| `decorative-poster-2.pdf`    | Canva infographic-style export: three narrow columns of varying font sizes, no images                                                                         | pdfkit                |
| `no-text-layer-scan-sim.pdf` | Fully flattened/rasterized export (or scan): a single full-page image, zero text objects                                                                      | pdfkit                |
| `control-browser-print.pdf`  | Non-Canva control: HTML printed to PDF via Chromium (Playwright), simulating a Google-Docs/browser-print-style export                                         | Playwright + Chromium |

Sample PDFs live in `scratch/pdf-samples/` (gitignored-equivalent scratch location, not committed
as feature code — see Cleanup below). Generators: `scripts/spike-generate-samples.mjs` (pdfkit
path) and `scripts/spike-generate-control.mjs` (Chromium print-to-PDF path, deliberately a
different code path than pdfkit so the control isn't just "the same tool twice").

## Extraction library

Tried `pdfjs-dist` (v6.2.108, `pdfjs-dist/legacy/build/pdf.mjs` entry point — the Node-safe legacy
build with no DOM/Canvas/Worker assumptions) first, per the plan's stated preference. It worked
without needing a fallback to `pdf-parse` or `unpdf`.

Extraction script: `scripts/spike-pdf-extract.ts`, run via `npx tsx scripts/spike-pdf-extract.ts`.
For each PDF it prints, per page: text runs (string, font name, font size in pt derived from the
text-matrix scale, x/y position), and any image-paint operator names found by walking
`page.getOperatorList()`.

## Per-sample results

### `plain-doc-1.pdf` — plain document

- Real text extracted: **yes**, 19 text runs across all headings and paragraphs.
- Reading order: **sane** — runs come out top-to-bottom in document order, matching source order.
- Font-size metadata: **yes**, per run, derived from the text transform's scale component
  (`Math.hypot(transform[2], transform[3])`). Distinct sizes cleanly separate title (24pt) from
  h2-equivalent headings (16pt) from body (11pt).
- Images: none in this sample (n/a).
- Verdict: **pass**.

### `plain-doc-2.pdf` — plain document with sub-heading + list

- Real text extracted: **yes**, 15 runs.
- Reading order: **sane**, top-to-bottom.
- Font sizes: 4 distinct sizes (26/18/13/11pt) cleanly correspond to title / h2 / h3 / body — good
  signal for a font-size-delta heading-level heuristic.
- Bullet-style lines (`"- A second pair..."`) come out as ordinary text runs with a leading `-` —
  Stage 2 will need its own bullet-detection heuristic (leading `-`/`•` at paragraph start), pdfjs
  does not mark list semantics itself (PDF has no native list concept).
- Verdict: **pass**.

### `decorative-poster-1.pdf` — decorative, two-column, with image

- Real text extracted: **yes**, 10 runs.
- Reading order: **NOT top-to-bottom/left-to-right in extraction order in general** — pdfjs returns
  runs in content-stream order, which in this sample happened to already be left-column-then-
  right-column because that's the order they were drawn. In general, content-stream order is
  **not guaranteed to match visual reading order** for absolutely-positioned text boxes; Canva
  could draw the right column before the left column depending on its internal element order. The
  x/y positions are present and reliable, though, so a real reading-order reconstruction (Stage 2)
  must sort/cluster by position rather than trust emission order. This confirms the plan's Stage 2
  note to "explicitly flag/skip anything that looks like a genuine multi-column layout rather than
  guessing wrong."
- Font sizes: 3 distinct sizes (38/10/8pt) — decorative headline vs. body vs. caption, as expected.
- Images: **yes**, 1 image-paint op detected (`img_p0_1`) via `page.getOperatorList()` +
  `OPS.paintImageXObject`. Confirms images are separately extractable from text via a different
  API than text content (see "Image extraction API" below).
- Verdict: **pass, with the caveat that reading-order reconstruction must be position-based, not
  emission-order-based, for this shape** — exactly the risk the plan flagged.

### `decorative-poster-2.pdf` — three-column decorative, no image

- Real text extracted: **yes**, 13 runs.
- Reading order: same caveat as above — this sample's three columns happen to interleave in a
  sane visual order in this run only because of draw order, not because pdfjs reconstructed
  columns. A genuine multi-column detector (compare x-ranges of runs at similar y, per the plan)
  is required before Stage 2 can trust this for real Canva multi-column layouts.
- Font sizes: 3 distinct sizes (20/13/9pt).
- Verdict: **pass, same caveat as above**.

### `no-text-layer-scan-sim.pdf` — flattened/no text layer

- Real text extracted: **no** — 0 text runs, exactly as expected for a page with no text objects.
- Image ops: 1 (the full-page raster).
- Verdict: **this is the case Stage 2 must explicitly reject, not silently produce an empty
  draft for** — pdfjs correctly reports zero text items rather than throwing or hallucinating
  content, which makes a clean "zero extractable text" rejection straightforward to implement.
  It does **not** by itself tell an editor "this page has an image but no text" vs. "this page is
  genuinely blank" — Stage 2 should specifically report page-has-image-but-no-text as its own
  warning category, since that's the actionable signal for "this Canva export flattened its text."

### `control-browser-print.pdf` — non-Canva control (Chromium print-to-PDF)

- Real text extracted: **yes**, 9 runs, cleanly separated headings/paragraphs.
- Reading order: **sane**, top-to-bottom, matching source HTML order (single-column browser-print
  output draws in visual order, unlike absolutely-positioned Canva-style layouts).
- Font sizes: 3 distinct sizes (19.5/13.5/9pt) matching h1/h2/body from the source CSS.
- Verdict: **pass** — confirms pdfjs-dist's behavior isn't idiosyncratic to the pdfkit-generated
  samples; a completely different PDF generator (Chromium's PDF printer) produces equally usable
  output.

## Other findings

- **`standardFontDataUrl` warnings**: pdfjs-dist logs a non-fatal `UnknownErrorException` warning
  on every sample using a standard (non-embedded) font, because the legacy Node build doesn't know
  where to find its bundled standard-font metrics without being told. Extraction still succeeds
  and returns correct text/positions/font sizes despite the warning. For Stage 1, pass
  `standardFontDataUrl` pointing at `pdfjs-dist`'s bundled `standard_fonts/` directory to silence
  this cleanly (cosmetic fix, not a blocker).
- **`doc.destroy()`/`doc.cleanup()`**: not present as a callable method on the document proxy
  returned by this build/version in a plain Node script — worth re-checking against the exact
  pdfjs-dist API surface when writing production code that processes many PDFs in one process
  (long-running server processes should not leak parsed-document memory).
- **Image extraction API**: there is no single "give me all images" call. The working approach was
  `page.getOperatorList()`, scanning `fnArray` for `OPS.paintImageXObject` /
  `OPS.paintInlineImageXObject` / `OPS.paintImageXObjectRepeat`, then resolving the named image via
  `page.objs.get(name)` (not exercised in this spike, but that's the documented next step) to get
  actual pixel/stream data. This is a workable API but is lower-level than the text API — Stage 3
  should budget real implementation time for it, not assume it's a one-liner.

## Summary: go/no-go by PDF shape

| Shape                                                       | Real text extractable?  | Reading order                                                                                                                         | Font-size metadata | Verdict                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plain document (Canva "Doc"-style)                          | Yes, reliably           | Sane, top-to-bottom                                                                                                                   | Yes, per run       | **Go**                                                                                                                                                                                                                                                  |
| Decorative / multi-column (Canva poster/social-story-style) | Yes                     | **Not guaranteed sane from emission order alone — must reconstruct from x/y position, with explicit multi-column detection/flagging** | Yes, per run       | **Go, conditional on Stage 2 building real position-based reading-order reconstruction, not trusting emission order**                                                                                                                                   |
| Flattened-to-image / no text layer                          | No (by design/expected) | n/a                                                                                                                                   | n/a                | **Go on rejection path**: cleanly detectable (zero text items) and should produce an explicit "no extractable text" rejection, never a silent empty draft, per the plan's "full rejection over truncation" rule. OCR remains out of scope per the plan. |

No sample here forced the "OCR is unavoidable" decision point the plan calls out — every generated
shape except the deliberately-no-text sample produced usable text. But per the limitation noted at
the top of this doc, **that finding is bounded by the fact that these are simulated Canva shapes,
not real Canva exports** — confirming against real Canva output before or early in Stage 2 remains
recommended, not optional.

## Library recommendation for Stage 2

**Carry `pdfjs-dist` forward.** It provided everything the plan's Stage 2 heuristics need in one
library: real text with position and derivable font size, and a separate (if lower-level) path to
enumerate embedded images — no need to combine multiple libraries. No fallback to `pdf-parse` or
`unpdf` was necessary.

## Real Canva PDF sample (2026-08-17)

**This section supersedes the "Important limitation up front" caveat above where it conflicts.**
The user supplied one real Canva export to test against: a 30-page PDF (`New Zealand Working
Holiday_1-30.pdf`, ~14.7MB — pages 1-30 of a larger 151-page personal document) authored by a
Malaysian WHV traveller, in a bilingual Chinese/English "story scrapbook" template.

**This PDF was NOT copied into the repo.** It was read directly from its original location in the
user's Downloads folder (`~/Downloads/New Zealand Working Holiday split_pdf/`) using the Read
tool's PDF-page-rendering support (to view it visually) and a Node/`pdfjs-dist` script pointed at
that external path (to extract text/structure programmatically). No page image, extracted text, or
derived content from this real document has been written into any repo-tracked file, `scratch/`, or
`git status`-visible path. The one artifact produced during this analysis besides this findings
section is `scripts/spike-pdf-extract-real-sample.ts` — a _generic, reusable_ extraction script
that contains no content from the source document (it takes a file path as a CLI argument). Its
one-off run output (a text summary containing font sizes, positions, and _short, mostly-English_
excerpts — see the script's own comments) was written to a location outside the repo tree
(the session's private scratchpad), not anywhere under `/Users/user/Desktop/KakiNotes`.

### What the real document actually looks like, structurally

This is unambiguously a Canva **scrapbook/travel-journal template** export, not a plain "Doc"
template — closer to the spike's `decorative-poster-*` simulations than the `plain-doc-*` ones,
but richer:

- **Page 1** is a cover page: a full-bleed background photo (sheep in a paddock) with a large
  script-font title ("New Zealand" / "Working Holiday") overlaid near the top.
- **Pages 2-10** are mostly text-heavy "chapter intro"-style pages: a large heading, then several
  paragraphs of body text, on a plain/lightly-textured background — some are almost entirely
  Chinese prose (personal reflections), one is a step-by-step visa-application walkthrough (mixed
  Chinese/English), two are packing-list infographics with colored rounded-rectangle "chip" labels
  grouping bullet lists into categories (documents, clothing, electronics, etc.) in a 3-column grid.
- **Pages 11 onward** shift to a recurring per-location template: a page-top title (place name, in
  a mix of English/Chinese, sometimes with a small route/map screenshot), then a sequence of
  colored pill-shaped subsection labels (e.g. "Campermate", "Ngaaruawaahia Park", "睡车"), each
  followed by a short bullet or paragraph and one or more **circular-cropped photos** arranged in
  loose, irregular grids (not a strict N-column grid — photo sizes and positions vary per page).
  Many pages mix app-store screenshots, food/product photos, and personal snapshots.
- Several pages (e.g. the two "行李清单/LUGGAGE LIST" pages, several supermarket/food pages) are
  dense **infographic layouts**: multiple independent side-by-side text+bullet blocks under colored
  category-pill headers, laid out in 2-3 columns, interleaved with photo circles — the exact shape
  the plan's "multi-column/decorative" risk category anticipated.
- No page in this 30-page sample was fully flattened-to-image (no page had zero text objects) —
  every page had genuine text objects in its content stream, even the most photo-dense ones.
- Page size/orientation is uniform: all 30 pages are portrait, ~1058×1687pt, rotation 0. No mixed
  orientation observed in this sample.

### Extraction signal findings (pdfjs-dist v6.2.108, legacy build, same technique as before)

Ran the adapted extraction script (`scripts/spike-pdf-extract-real-sample.ts`, a copy of
`scripts/spike-pdf-extract.ts` retargeted at an external file path plus per-document aggregate
stats) against all 30 pages.

- **Text extracted per page: never zero**, but see the critical CJK finding below — "non-zero text
  runs" does **not** mean "the page's actual prose content was captured."
  - 605 non-empty text runs across 30 pages (~20/page average), 308 embedded-image paint ops
    (~10/page average, confirming this is a very photo-dense document format).
- **Font-size metadata: present and usable**, same technique as before
  (`Math.hypot(transform[2], transform[3])`). 30 distinct sizes observed, and they do cleanly
  separate structural roles on inspection — e.g. page/chapter titles render at 98-141pt, pill/
  section-label text around 28-32pt, body/caption text around 20-27pt. The _relative_ ordering
  (title > section label > body) holds, consistent with the synthetic spike's finding, though the
  real spread of sizes is noisier (many near-duplicate sizes like 26.3/26.36/26.64/26.83/26.87/
  26.99/27 rather than the synthetic samples' handful of clean round numbers) — a real heading
  heuristic will need size-bucketing/clustering, not exact-match comparison.
  - Some duplicate-position, duplicate-string runs were observed (e.g. page 1's title text appeared
    twice at the identical transform) — likely a stroke+fill or shadow/outline rendering pass in
    Canva's output. Stage 2 will need basic de-duplication (same string + same/near-identical
    x/y/font) before treating run count as a content-density signal.
- **Reading order: confirmed NOT reliable from emission order**, and now with a concrete real
  example, not just a hypothetical: on a real page (photo-grid/caption page 13, "Auckland Food"),
  the _first_ three items pdfjs emits are three short price/quantity fragments positioned near the
  _bottom_ of the page (y≈250-380 in a ~1687pt-tall page), emitted **before** the page's own title
  text near the top (y≈1563). This is not a subtle column-interleaving issue like the synthetic
  samples showed — it's a flat-out non-monotonic y-order within a single page, consistent with
  Canva drawing decorative/caption elements in an internal layer order unrelated to visual position.
  x/y positions remain present and reliable per run, so the plan's Stage 2 requirement to
  reconstruct order from position (not emission order) is **confirmed necessary, not just
  theoretically prudent** — this real document would produce visibly scrambled output without it.
  (A more conventional page, e.g. page 3's linear visa-steps walkthrough, _did_ emit in clean
  top-to-bottom y-order — so the failure is layout-dependent, exactly as the plan anticipated, and
  a per-page "does this look column/grid-like" check before trusting emission order remains the
  right design.)
- **Embedded images: separately extractable, same API as before** — `page.getOperatorList()` +
  `OPS.paintImageXObject` (plus `paintImageXObjectRepeat`, seen repeatedly on this real document —
  the same resolved image object name reused across a page, e.g. a decorative background image
  reused as a matte for several circular photo frames) found real image objects on every
  photo-bearing page, confirming the technique generalizes past the synthetic samples. Image
  density is high and uneven: 0 images/page on plain-text chapter pages up to ~20 images/page on
  photo-grid pages — Stage 2/3 should not assume a flat "N images per page" budget.

### New failure mode NOT seen in the synthetic samples — CJK/non-Latin text extraction failure

**This is the most important finding of this real-sample test, and changes the risk picture more
than the reading-order question does.** The synthetic spike samples were English-only text, so this
was structurally impossible to surface before.

On this real document (majority Chinese-language body text, per the product's own stated primary
market of Malaysian WHV travellers), **pdfjs-dist's `getTextContent()` extracted zero runs
containing any Chinese/CJK characters, anywhere in the 30-page sample** — while it correctly
extracted English words, numbers, URLs, and punctuation from the very same pages. Verified directly:
across all 30 pages, the content streams contain 4,368 `showText` operator calls (i.e., Canva _is_
drawing the glyphs — they render correctly on screen/print, as seen in the page images captured
during this spike), but `getTextContent()` yields only 605 non-empty text items total, of which
**none** contain a CJK character (checked with a Unicode CJK-range regex against every extracted
run in the document). The Chinese prose is not merely mis-ordered or garbled — it is **entirely
invisible to the text-extraction API**, with no error, warning, or empty-placeholder item marking
where it should be. Punctuation that happens to sit between Chinese words/sentences with a
standard-encoded fallback (commas, periods, slashes) _does_ come through as isolated single-
character runs, which is itself a trap: a page that is 95% Chinese prose can still show a non-zero,
plausible-looking text-run count (a handful of English headers/numbers plus a scatter of lone
punctuation marks), giving false confidence that the page "extracted fine" when the actual story
content is missing entirely.

Root cause (inferred, not proven in this spike): most likely the CJK text in this Canva export uses
an embedded/subsetted font whose glyphs are referenced by glyph index without a usable ToUnicode
CMap, so pdfjs can draw the glyph (it has the outline) but cannot map it back to a Unicode
character for the text layer — a known general class of PDF-generator issue, not specific to
pdfjs. This spike did not attempt a workaround (that's Stage 2+ scope if pursued), only confirmed
the symptom.

**Why this matters more than it might first appear:** CLAUDE.md states the initial market is
Malaysian WHV travellers and that nationality/language must be data, not hard-coded — but it does
not currently say anything about the _language_ of story body text, and the existing plan's Stage 2
heuristics (heading detection, reading-order reconstruction, bullet detection) were designed and
validated only against Latin-script/English samples. If real contributor Canva exports are
routinely bilingual or Chinese-primary (as this one real sample is), a heuristic-only Stage 2 built
without accounting for this could silently drop the majority of a contributor's actual story text
while still reporting "extraction succeeded" (non-zero run count) — the opposite failure mode from
the "flattened image, zero text" case the plan already guards against, and arguably worse because
it is **not cleanly detectable by a zero-text-items check**. Stage 2 needs its own detector for
this: e.g., flagging a page/document where extracted-run character count is implausibly low
relative to `showText` operator count, or (more robustly, if feasible) checking whether the
embedded font's CMap/ToUnicode table is present and covers the glyphs actually used, before trusting
"non-zero text" as "text captured."

### Revised go/no-go conclusion

- **Plain-document / linear-flow shape**: still **Go** — confirmed again on this real document's
  single-column intro/step-by-step pages (e.g. page 3), which extract in clean visual order.
- **Decorative/multi-column/scrapbook shape**: still **Go, conditional on position-based reading-
  order reconstruction** — the prior spike's caveat is now **confirmed on real output**, not just
  simulated. No change to the conclusion, but confidence in it is now higher (it was previously a
  reasonable inference from a hand-built approximation; it is now an observed fact on real Canva
  output).
- **Flattened-to-image / no-text-layer pages**: **unchanged, Go on rejection path** — not
  encountered in this real 30-page sample (every page had a genuine text layer), but the prior
  spike's synthetic test of this case is not contradicted by anything found here.
- **NEW: non-Latin/CJK text extraction — this is a new, unaddressed risk category, not a "Go" or
  "no-go" yet.** It does not block Stage 1 (pdfjs-dist is still the right library — the _drawing_
  operators are present and image extraction is unaffected; this is specifically a text-layer
  Unicode-mapping gap), but **Stage 2's heuristics and Stage 2/3's editor-facing warnings must be
  designed with this failure mode in mind from the start**, not discovered after the fact against
  real bilingual contributor content. Recommend Stage 2 scope explicitly include: (a) a
  low-extraction-relative-to-showText-density detector per page, surfaced as its own warning
  category distinct from "zero text extracted," and (b) testing Stage 2's heuristics against at
  least one further real bilingual/CJK Canva sample before considering the heuristics
  production-ready, since this spike's inferred root cause (missing ToUnicode CMap) was not
  independently confirmed and could vary by which Canva font/template a contributor used.

**Overall**: the library recommendation (carry `pdfjs-dist` forward — see below, unchanged) still
holds. The structural shape findings (font-size-as-heading-signal, position-based reading-order
need, separate image-extraction API) are all **confirmed, not overturned**, by real Canva output.
But this real sample surfaces a genuinely new, higher-priority risk — non-Latin-script text going
missing from extraction while the page still reports plausible non-zero text-run counts — that the
English-only synthetic samples structurally could not have revealed, and that is directly relevant
given this product's stated primary market.

## Cleanup / what's left in the working tree

This is a **Stage 0 spike** — nothing here is committed as shipped feature code, per the plan's
ground rules.

- `scripts/spike-generate-samples.mjs`, `scripts/spike-generate-control.mjs`,
  `scripts/spike-pdf-extract.ts` — left in the repo, **untracked**, for human review. Not deleted
  per this task's instructions, but not staged/committed either.
- `scripts/spike-pdf-extract-real-sample.ts` — added during the real-Canva-PDF-sample follow-up
  above. Takes a PDF path and output directory as CLI args (`npx tsx
scripts/spike-pdf-extract-real-sample.ts <pdf-path> <output-dir>`); contains no content from any
  specific document (generic/reusable), left untracked for human review alongside the other spike
  scripts.
- `scratch/pdf-samples/*.pdf` — the 6 generated fixture PDFs, left for inspection, untracked. The
  real Canva sample PDF used in the follow-up above was **not** copied here or anywhere else in the
  repo — it was read directly from its original location outside the repo, per the task's
  instructions, and no real personal content from it was written into any repo path.
- **`package.json` / `package-lock.json` were NOT modified.** `pdfkit` and `pdfjs-dist` were
  installed with `npm install --no-save`, so they exist in `node_modules/` right now (needed to
  re-run the spike scripts) but are not recorded as dependencies anywhere tracked by git. Running
  a fresh `npm install` (or `npm ci`) will remove them again since nothing references them.
  - **Recommendation for Stage 1**: add `pdfjs-dist` as a real `dependencies` entry (it's needed at
    runtime, not just build time) when `lib/story/pdf-import.ts` is written, with a commit message
    stating why per CLAUDE.md rule 20. `pdfkit` was only needed to _generate_ this spike's fixture
    PDFs and is not needed by the shipped feature — do not carry it into Stage 1 as a runtime
    dependency; if Stage 2's test fixtures need generated PDFs, pdfkit could become a devDependency
    at that point, decided when writing those tests.
- No `npm run verify` was run as a gate for Stage 0 (per the plan, that gate does not apply here).
  `scripts/spike-pdf-extract.ts` was sanity-checked by actually running it against all 6 samples
  without crashing (see output captured during this spike).

---

## Stage 0.5 — Page-rendering spike (2026-08-18)

Follows the pivot documented at the top of `docs/pdf-canva-import-plan.md`: import now rasterizes
PDF pages to images instead of extracting text. This section de-risks _that_, per the plan's Stage
0.5 checklist.

### Library evaluated

Went straight to the plan's first-preference option and it worked cleanly, so no fallback was
needed:

- **`pdfjs-dist`** (already present, v6.2.108, `legacy/build/pdf.mjs` entry point — same Node-safe
  build the Stage 0 text-extraction spike used) **+ `@napi-rs/canvas`** (already present in
  `node_modules`, v1.0.6, prebuilt binary — installed cleanly with no native toolchain, confirming
  the plan's stated preference order).
- A `CanvasFactory` adapter (`create`/`reset`/`destroy`, duck-typed to what pdfjs expects from a
  DOM canvas) is required — pdfjs-dist needs somewhere to allocate scratch canvases internally
  (soft masks, patterns) even when the caller supplies its own top-level canvas per page.
  `@napi-rs/canvas`'s `Canvas`/`Context2D` are compatible with this without any shimming.
- **Poppler (`pdftoppm`/`pdftocairo`) is available on this machine** (`/opt/homebrew/bin/pdftoppm`,
  `/opt/homebrew/bin/pdftocairo`, via Homebrew) but was **not** pursued as the primary path, per the
  plan's own caution: it's a system dependency, and this machine's Homebrew install says nothing
  about whether the actual deployment target (assumed Vercel, per `docs/architecture.md`
  "Deployment assumptions" — still unconfirmed) can install/run a system binary inside its function
  runtime. `@napi-rs/canvas` ships prebuilt native binaries _as an npm package_, which is a
  materially safer bet for a serverless deploy target than assuming a system package manager is
  available at runtime. **Recommendation for whoever confirms the real deploy target: Poppler
  remains a fine fallback if `@napi-rs/canvas`'s prebuilt binary doesn't have a build for the actual
  production architecture, but is not needed given `@napi-rs/canvas` already works here.**
- Did not need to fall back to `skia-canvas`, legacy `canvas`, or a WASM renderer (`mupdf.js`) — the
  first-preference option worked on the first try.

### Rendering correctness

Spike script: `scripts/spike-pdf-render.mjs` (`node scripts/spike-pdf-render.mjs`). Renders every
page of each `scratch/pdf-samples/*.pdf` fixture to a PNG at `PREVIEW_SCALE = 2.0` (roughly 144
DPI), writing output to `scratch/pdf-render-spike-output/` (untracked scratch, not committed).

- All 6 fixture PDFs rendered without error, correct page counts (1 page each), sane non-zero
  output dimensions matching each PDF's page size × scale (e.g. `plain-doc-1.pdf`'s 612×792pt page
  → 1224×1584px PNG), and non-trivial PNG byte sizes (3–176 KB depending on content density).
- Visually inspected `plain-doc-1.pdf` and `decorative-poster-1.pdf`'s rendered PNGs directly: text
  is crisp and correctly positioned, headings/body font-size hierarchy renders as expected, the
  decorative sample's colored rectangle and two-column layout render pixel-accurate to the source.
  No garbling, no missing glyphs, no color/layout corruption.
- **Real Canva PDF, CJK rendering — the actual point of this spike, given Stage 0's finding that
  text _extraction_ silently drops CJK.** Rendered pages 1, 13, and 25 of the real 30-page sample
  (`~/Downloads/New Zealand Working Holiday split_pdf/New Zealand Working Holiday_1-30.pdf` — read
  from its original location only, never copied into the repo, per Ground Rule 6; the one-off
  script used to do this was deleted after use and nothing from its output was written into any
  repo-tracked or `scratch/` path). **Page 13 ("Auckland Food") — a bilingual Chinese/English
  photo-grid page that Stage 0's text-extraction spike specifically flagged as having its Chinese
  prose silently dropped by `getTextContent()` — renders perfectly as an image**: every Chinese
  character crisp and correct, circular photo crops, decorative torn-paper-edge frames, and mixed
  CJK/Latin/numeral text all pixel-accurate to the source. This is exactly the outcome the pivot
  predicted: rasterization sidesteps the CJK text-layer problem entirely, because nothing needs to
  be read as text — confirmed on the real document that originally surfaced the problem, not just
  inferred.

### Resolution control and timing (the real risk this spike targeted)

Timed against the real 30-page sample (a large physical page size, ~1058×1687pt — much bigger than
a normal 612×792pt "Letter" page, which matters for render cost):

| Preview target (long edge)              | Total (30 pages)               | Per-page avg | Notes                                                                                                                                                              |
| --------------------------------------- | ------------------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `scale=2.0` fixed (≈2115×3375px output) | 6.34s (render only, no encode) | 211ms        | The plan's literal "2x eventual display size" guidance, applied naively to this PDF's unusually large page size, produces an oversized preview no picker UI needs. |
| ~1200px long edge                       | 8.65s (render + PNG encode)    | 289ms        |                                                                                                                                                                    |
| ~1000px long edge                       | 8.07s (render + PNG encode)    | 269ms        |                                                                                                                                                                    |
| ~800px long edge                        | 7.54s (render + PNG encode)    | 251ms        |                                                                                                                                                                    |

**Key finding: per-page time is dominated by vector/font rendering (paths, embedded images,
clipping), not by output pixel count** — dropping the target resolution from 2115px to 800px long
edge only cut per-page time by about 20%, not proportionally to the ~7x pixel-count reduction. This
means "render at a smaller size" is a limited lever for controlling total request time; **the page-
count ceiling is the real lever**, not resolution. Given that, resolution should be picked for
picker-UI usefulness, not as a performance knob: **~1000px long edge** is the Stage 1 preview
target — comfortably legible as a thumbnail, and each 1200pt-tall real page still resolves detail
(the circular photo crops, pill-shaped labels) well enough to judge "do I want this page" during
selection.

- Output resolution is fully controllable via pdfjs's `page.getViewport({ scale })` — trivial to
  target either a fixed scale or a computed "fit long edge to N px" scale (used above), confirming
  the plan's "need retina-appropriate control" requirement is met.
- **Full 151-page document extrapolation**: at ~270ms/page (1000px target), a full 151-page render
  would take **~41 seconds** — clearly outside a safe synchronous request/response budget on most
  serverless platforms (Vercel Hobby defaults to a 10s function timeout; even Pro's default is 15s,
  configurable up to 60s/800s on higher tiers, but assuming a high configured ceiling isn't a safe
  default design point). This is the concrete number that drives the page-count ceiling decision
  below.

### Existing async/background-job pattern check

Read `lib/story/image-pipeline.ts` and its one caller,
`app/(contributor)/stories/[id]/edit/upload/route.ts`. Finding: **there is no background-job queue
or async processing pattern in this codebase today.** The upload Route Handler's own doc comment
says it directly: `processStoryMedia` runs "synchronously in this request — there is no background
worker in this phase." The "processing" state the plan mentions
(`story_media.processing_state`/`record_story_media_processing_failed` etc.) is a **state machine
for idempotent retry and moderation-visible status display**, not a queue — nothing currently
enqueues work for a separate worker process to pick up later. A revision can't be submitted while
any attached image is still in a non-terminal processing state, but that state is reached and left
within the same request that created it, not by an async worker.

**Consequence for Stage 1**: `renderPagePreviews()` should be a plain synchronous
(request-scoped) `async function`, matching the existing convention exactly — no queue, no polling,
no new "processing" DB state for the PDF-preview step itself. This is only safe _because_ the
page-count ceiling below keeps worst-case total render time well inside a request budget; if a
future need arose to raise the ceiling significantly, that would be the point to reconsider adding
a real background-job pattern (which doesn't exist yet anywhere in this codebase and would be new
infrastructure, not a small change).

### Decisions (page-count ceiling, size ceiling, resolution) — carried into Stage 1

1. **Library: `pdfjs-dist` + `@napi-rs/canvas`.** Confirmed installable and correct in this
   environment; no native toolchain required; no CJK-rendering problem (rasterization, not text
   extraction). Added as **real dependencies** in Stage 1 (previously `--no-save`).
2. **Preview resolution: ~1000px long edge** (computed per-page from each page's actual size, not a
   fixed DPI/scale — real Canva page sizes vary). Chosen for picker-UI legibility; per the timing
   finding above, resolution has limited effect on total request time, so this is a legibility
   choice, not primarily a performance one.
3. **Page-count ceiling: 40 pages.** At the measured ~270-290ms/page for a real, photo-dense,
   large-page-size document (a worse case than a typical plain "Doc" template), 40 pages is
   **~11-12 seconds worst-case** for the whole synchronous render — inside even a conservative 15s
   request budget with margin, while still comfortably exceeding the existing 12-image-per-revision
   attach limit (an editor picking ≤12 pages from up to 40 candidates has plenty of room to choose a
   good subset without needing every page of a 100+ page personal scrapbook previewed). A PDF over
   40 pages is rejected outright at this stage (Ground Rule 3: full rejection, never partial/
   best-effort) with a clear "only PDFs up to 40 pages are supported" error — not silently
   truncated to the first 40. **This is a conservative starting number bounded by this sandbox's
   measurements, not a confirmed production number** — re-measure against the actual deploy
   target's real function timeout before relaxing it.
4. **Size ceiling: 75 MiB (`MAX_PDF_IMPORT_INPUT_BYTES`, `lib/story/pdf-import.ts`).** The one real
   sample available (151 pages, photo-dense) is 57 MB; 75 MiB gives headroom above that observed
   real-world case while still being a bounded rejection point, not unlimited. **This number has
   NOT been checked against the actual deploy target's platform-level request body limit** (see
   below) — it is a product-level ceiling only.
5. **Transport implication for Stage 4 (not implemented in this stage, but worth recording now
   since it directly affects whether `next.config.ts`'s Server Action body-size limit is even the
   right lever):** the existing image-upload path
   (`app/(contributor)/stories/[id]/edit/upload/route.ts`) deliberately uses a **Route Handler**,
   not a Server Action, and its own doc comment implies this is because a Server Action's body-size
   limit (`next.config.ts`) is a Next.js-level setting that does not by itself guarantee a
   deployment platform will accept an equally large request body — Vercel Serverless Functions in
   particular have historically capped the total request body around 4.5 MB regardless of what
   Next.js's own `bodySizeLimit` says, independent of the framework setting. A 75 MiB (or even a
   much smaller) PDF upload would very likely be rejected before it ever reached a Server Action on
   that platform. **Because of this, Stage 1 does NOT change `next.config.ts`'s
   `experimental.serverActions.bodySizeLimit`** — that value governs the _existing_ text/HTML
   import Server Action only, is already correctly sized for that (2.5 MB) use case, and changing it
   upward would not actually solve the PDF-upload transport problem (and would loosen a limit for
   the unrelated existing feature for no benefit). **Stage 4, when it wires up the real upload UI,
   should use a Route Handler (mirroring the image-upload path), not a Server Action**, for the PDF
   upload step specifically — this is noted here so Stage 4 doesn't have to rediscover it.
6. Nothing rendered during this spike was committed: `scratch/pdf-render-spike-output/` (fixture
   renders) is untracked scratch, and the real-sample renders were written outside the repo entirely
   (this session's private scratchpad) and are not present anywhere under
   `/Users/user/Desktop/KakiNotes`.

**Confirmed with the user before Stage 1 per the plan's requirement**: not applicable in this
session — proceeding directly per the task instructions, which named Stage 0.5 and Stage 1 as both
in scope for this pass. If that's a departure from the plan's literal "confirm with the user before
Stage 1" instruction, flag it back for review.
