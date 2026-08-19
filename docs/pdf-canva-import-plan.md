# Plan — PDF / Canva-export import as page images

Status: **shipped (2026-08-18)**. All stages (0.5 through 5) are implemented and verified, and the
Turbopack/`pdfjs-dist` gap found during Stage 5's live verification has since been **fixed** — the
feature now works on this repo's default bundler in both `npm run dev` and
`npm run build && npm run start`, with no special flags. See `docs/implementation-status.md`'s
"2026-08-18 — PDF/Canva import: Turbopack fix" entry for the root cause (a bundler-visible
`require.resolve()`), the fix, and the new `e2e/pdf-import.spec.ts` coverage that can catch this
class of bug. No library swap was needed; nothing about how the feature works changed. This is a
staged implementation plan that was executed by Claude Code one stage at a time, each stage
independently mergeable and independently verifiable via `npm run verify`.

## Revision history

- **2026-08-17, pivot.** Original plan (still visible in git history) attempted to extract PDF text
  into structured Markdown (`content_json`) and treat embedded images as a separate asset pool.
  Stage 0's spike against a real Canva export (`docs/pdf-import-spike-findings.md`) found that
  `pdfjs-dist` text extraction **silently drops CJK text** even though the glyphs genuinely render —
  a page can show a plausible non-zero text-run count while its actual content (majority-Chinese, in
  the real sample) is missing. Given Kakinotes' stated primary market is Malaysian WHV travellers,
  this was judged too risky to build heading/paragraph heuristics on top of without a much larger
  R&D spend on CJK-safe extraction.
  **New direction, at the user's request**: stop trying to reconstruct structured text at all.
  Import a PDF by rendering selected pages to images and attaching them to the story as ordered
  image blocks, exactly as if the contributor had photographed/screenshotted each page and uploaded
  it manually. This sidesteps the CJK problem entirely (nothing needs to be read as text) and
  reuses far more of the existing image pipeline than the text-extraction approach did.
- Decisions made with the user before writing this revision (do not relitigate without asking
  again):
  1. **Page-count vs. the 12-image-per-revision cap**: the importer renders lightweight preview
     thumbnails for pages up to a hard ceiling (see Stage 1), the editor **selects a subset** (≤12)
     to actually attach — the existing per-revision image limit is unchanged.
  2. **Accessibility**: the editor must write alt text per selected page image during the mandatory
     review step, before submission is possible — reusing `story_revision_media.alt_text`
     (confirmed already present via `supabase/migrations/20260815110000_fix_create_next_draft_revision.sql`),
     not a generic auto-filled fallback.
  3. **Source PDF retention**: the uploaded PDF is processed transiently and **discarded** — only
     the rendered, selected, processed page images persist. No new "store the original PDF" bucket
     or retention policy.

## Why staged this way

- Each stage produces something real and testable on its own — no stage depends on speculative
  work from a later stage.
- Page-rasterization quality/performance (Stage 0.5) is the new highest-risk unknown — a different
  risk than the old text-extraction one, but still worth de-risking with a spike before production
  code, per the same reasoning as before.
- This reuses existing infrastructure wherever possible instead of building a parallel path:
  `lib/story/image-pipeline.ts` (upload processing, EXIF strip, private→public promotion,
  moderation-visible processing state), `story_revision_media`'s existing `alt_text`/`caption`/
  `sort_order`/`is_cover` columns, and the editorial workflow under `app/(editor)/editorial/`
  (Engineering Rule 5: editorial import stays separate from moderation).
- Per CLAUDE.md Definition of Done: every stage below ends with `npm run verify` passing, tests
  added/updated, and `docs/implementation-status.md` updated before moving to the next stage.

## Ground rules for every stage (do not skip)

1. Read `CLAUDE.md` and `docs/implementation-status.md` in full before starting _any_ stage — the
   codebase may have moved since this plan was written.
2. Never invent a parallel image-upload path. A rendered PDF page, once rasterized, is _just an
   image_ from that point forward — it must go through the exact same
   `lib/story/image-pipeline.ts` processing (magic-byte check, sharp derivatives, EXIF/GPS strip,
   private bucket, moderation-visible processing state) as any manually uploaded photo. If a stage
   seems to require a second path, stop and re-read that module first.
3. Full rejection over silent truncation or best-effort guessing: a PDF that can't be safely
   rendered (corrupt, password-protected, over the page/size ceiling) produces a clear, actionable
   error — never a partial or mangled result.
4. PDF parsing/rendering is server-only. Never parse or render an untrusted PDF in a Client
   Component, and never render it via a client-side PDF.js canvas widget either — rendering
   happens server-side, the client only ever sees the resulting image bytes/URLs.
5. Nothing from this feature is ever auto-published. Output always lands as an editorial-import
   draft requiring human review (title, alt text per image, submission), same as every other
   import path in this codebase.
6. The source PDF is discarded after rendering (per the pivot decision above) — do not persist it
   to any bucket, table, or log. Treat it as sensitive/ephemeral input, not an asset.
7. Run `npm run verify` at the end of every stage. Do not start the next stage on a red build.

---

## Stage 0 — _(superseded, kept for history)_ Text-extraction spike

Completed 2026-08-17. Findings live in `docs/pdf-import-spike-findings.md`. Conclusion: text
extraction is viable for Latin-script plain-document PDFs but unreliable for CJK content, which
motivated the pivot above. **No further action needed on this stage** — it's listed here only so
the reasoning trail isn't lost. Do not build on top of its `pdfToBlocks`-shaped output; that
direction is abandoned.

---

## Stage 0.5 — Spike: page rendering quality, performance, and library choice — **COMPLETE (2026-08-18)**

**Goal:** de-risk rasterization before writing production code, the same way old Stage 0 de-risked
text extraction. Produces no shipped feature code.

- [x] Evaluate 2–3 server-side PDF-to-raster-image approaches against both the fictional samples
      from the old spike (`scratch/pdf-samples/`, if still present — regenerate via
      `scripts/spike-generate-samples.mjs` if not) and, if the user provides another real sample,
      a real Canva export. Candidates considered, in preference order: (1) `pdfjs-dist`'s canvas
      rendering path (needs a Node canvas implementation — `@napi-rs/canvas` or `skia-canvas` tend
      to be more reliable to install than legacy `canvas`; confirm which builds cleanly in this
      environment before committing to one); (2) shelling out to `pdftoppm`/`pdftocairo` (Poppler
      utils) if available on the target deployment environment — very mature CJK/font handling, but
      adds a **system dependency**, which needs sign-off (check whether the deployment target —
      e.g. Vercel/whatever hosts this app per `docs/architecture.md` — can install Poppler, since a
      missing system binary in production is a much worse failure mode than a bad npm install);
      (3) `mupdf.js` / other WASM-based renderers as a middle ground (no system dependency,
      generally good font/CJK fidelity) if the first two are unworkable.
      **Result**: `pdfjs-dist` + `@napi-rs/canvas` (option 1, first preference) installed and
      worked cleanly on the first try — no fallback needed. See
      `docs/pdf-import-spike-findings.md`'s "Stage 0.5" section for full detail.
- [x] For each candidate, record: rendering correctness (does the page look right, including CJK
      glyphs, embedded fonts, gradients/backgrounds typical of Canva templates?), output resolution
      control (need roughly 2x the eventual display size for retina, then let the existing sharp
      pipeline downsize/generate responsive derivatives — don't over-render), and **timing** for a
      151-page-class document specifically (does rendering all pages' thumbnails fit inside a
      reasonable request/response cycle, or does this need a background/async approach?).
      **Result**: rendering correctness confirmed against fictional fixtures AND the real 30-page
      Canva sample (including a bilingual Chinese/English photo-grid page that Stage 0's text
      extraction had specifically flagged as CJK-lossy — renders perfectly as an image). Timing:
      ~270-290ms/page for the real document at preview resolution; a full 151-page document would
      take ~41s, too long for one synchronous request — this drove the page-count ceiling below.
- [x] Check whether this codebase already has any async/background job pattern to reuse. The image
      pipeline docs mention a moderation-visible "processing" state that prevents a revision with
      unfinished image processing from being submitted (`docs/architecture.md` around image
      pipeline notes) — read `lib/story/image-pipeline.ts` and its callers to confirm the actual
      mechanism, since Stage 1's thumbnail-generation step should reuse that same pattern rather
      than inventing a new one if a large PDF can't render synchronously within one request.
      **Result**: no background-job queue exists anywhere in this codebase today — image
      processing is synchronous-in-request (`processStoryMedia` in
      `app/(contributor)/stories/[id]/edit/upload/route.ts`'s own doc comment: "no background
      worker in this phase"). Stage 1's `renderPagePreviews()` follows the same convention,
      made safe by the page-count ceiling below.
- [x] Decision point, confirm with the user before Stage 1: page-count ceiling for the "generate
      preview thumbnails" step (independent from the 12-image attach limit — this is about how many
      pages the importer will even attempt to show as pickable thumbnails, e.g. capping at 60 pages
      with a clear "only the first N pages are shown, but each PDF page attaches individually"
      message, or whatever the timing findings above suggest is safe).
      **Result: 40 pages.** ~11-12s worst-case synchronous render time at the measured per-page
      cost, comfortably inside a conservative request-timeout budget. See
      `docs/pdf-import-spike-findings.md` for the full reasoning and the explicit note that this
      is a sandbox-measured number needing reconfirmation against the real deploy target.
- [x] Append findings to `docs/pdf-import-spike-findings.md` as a new dated section — don't
      overwrite the existing text-extraction findings, they're still useful history.

No `npm run verify` gate here (throwaway spike code isn't merged), but do not proceed to Stage 1
until findings and the page-count ceiling decision are written down and confirmed.

---

## Stage 1 — Dependency, validation boundary, and page-rendering module (no UI/DB yet) — **COMPLETE (2026-08-18)**

**Goal:** get a PDF file safely from an upload field to a set of rendered page-preview images, as a
pure/testable server module. No editorial workflow wiring yet.

- [x] Add the chosen rendering library/tooling from Stage 0.5 as a dependency (or document the new
      system dependency if Poppler was chosen) — state why in the commit message (CLAUDE.md rule 20).
      **Done:** `pdfjs-dist` and `@napi-rs/canvas` added as real `dependencies` (previously
      `--no-save` spike-only installs). `pdfkit` added as a `devDependency` (test-fixture generation
      only, not a runtime dependency of the shipped feature).
- [x] `lib/story/pdf-import.ts`: magic-byte sniff (`%PDF-`) before any parsing, mirroring
      `lib/story/image-validation.ts`'s posture — never trust the filename or declared MIME type.
      **Done:** implemented in the new `lib/story/pdf-validation.ts` (split out the same way
      `image-validation.ts` is split from `image-pipeline.ts`, so the dependency-free constants/
      magic-byte check stay safe to import from `lib/validation/`), re-exported from
      `lib/story/pdf-import.ts`.
- [x] Size ceiling as its own constant, separate from `MAX_IMPORT_INPUT_BYTES` (the 2MB text-import
      limit is irrelevant here — PDFs, especially photo-heavy Canva exports, are much larger). Wire
      into `next.config.ts`'s Server Action body-size limit the same way the existing constant is
      cross-referenced there.
      **Done, with a deliberate deviation:** `MAX_PDF_IMPORT_INPUT_BYTES` (75 MiB) added, but NOT
      wired into `next.config.ts`'s Server Action body-size limit — see that constant's doc comment
      and `docs/pdf-import-spike-findings.md`'s "Transport implication for Stage 4" note: a file
      this large needs a Route Handler upload path (mirroring the existing image pipeline), not a
      Server Action, so the Server Action body-size limit isn't the right lever here. Flagged for
      Stage 4 to actually wire up.
- [x] Page-count ceiling from Stage 0.5's decision, enforced before attempting to render anything.
      **Done:** `MAX_PDF_IMPORT_PAGES` (40) added, checked after document load (page count isn't
      knowable before parsing) but before any page is rendered.
- [x] `renderPagePreviews(bytes: Buffer): Promise<PdfPreviewResult>` — renders each page (up to the
      ceiling) to a preview-resolution raster image buffer + page number. Explicit rejection cases:
      corrupt/unparseable PDF, password-protected PDF, zero pages, over the page-count ceiling, over
      the size ceiling.
      **Done:** implemented in `lib/story/pdf-import.ts`. Discriminated `PdfPreviewResult` union
      (`{ ok: true, pages, pageCount }` / `{ ok: false, error: PdfImportError }`), mirroring
      `lib/story/content-import.ts`'s `ImportResult` pattern.
- [x] Zod schema for the upload boundary in `lib/validation/` (file present, size ceiling, magic
      bytes) — this is a new trust boundary per the Definition of Done and needs its own validation
      and error states.
      **Done:** `lib/validation/pdf-import.ts`'s `pdfImportFileSchema`, importing from the
      client-safe `lib/story/pdf-validation.ts` (never from the server-only `pdf-import.ts` itself).
- [x] The source PDF buffer must not be retained anywhere after `renderPagePreviews` returns (per
      Ground Rule 6) — confirm nothing holds a reference past the function call (no accidental
      closure capture into a cache, no temp file left on disk without explicit, immediate cleanup).
      **Confirmed:** no module-level cache, no temp files written, every pdfjs `Document`/`Page`
      handle is `cleanup()`/`destroy()`-ed before the function returns.
- [x] Tests: valid PDF renders the expected page count, non-PDF bytes with a `.pdf` filename
      rejected, oversized file rejected, empty/corrupt file rejected, password-protected PDF
      rejected, over-page-ceiling PDF rejected. Use fixture PDFs (small, fictional, checked into
      `lib/story/__fixtures__/` or similar — regenerate via the old spike's generator scripts if
      useful, per Engineering Rule 22).
      **Done:** `lib/story/pdf-import.test.ts` and `lib/validation/pdf-import.test.ts`, 17 tests
      total. Fixtures generated via the new `scripts/generate-pdf-import-fixtures.mjs` (pdfkit for
      valid/oversized-page-count PDFs, `qpdf` CLI — a build-time-only tool, not a runtime
      dependency — for the password-protected fixture, since pdfkit has no encryption support).
- [x] `npm run verify` passes. Update `docs/implementation-status.md`.

---

## Stage 2 — Full-quality render + attach through the existing image pipeline — **COMPLETE (2026-08-18)**

**Goal:** once an editor has picked which page numbers to keep (Stage 4's UI), render _those specific
pages_ at full/publish quality and feed each one through the **existing, unmodified**
`lib/story/image-pipeline.ts` path — exactly as if each were a manually uploaded photo.

- [x] `renderPagesAtFullQuality(bytes: Buffer, pageNumbers: number[]): Promise<Buffer[]>` (or
      stream-per-page, whichever fits the pipeline's existing input shape better — check
      `image-pipeline.ts`'s current entry point signature before deciding) at the resolution Stage
      0.5 determined is right for retina display after the pipeline's own downsizing.
      **Done:** implemented in `lib/story/pdf-import.ts`, returning a discriminated
      `PdfPageRenderResult` (not a bare `Buffer[]`, to keep the same explicit-rejection convention
      as `renderPagePreviews`) at 2400px long edge — meaningfully above Stage 1's 1000px preview and
      comfortably above the pipeline's own 2000px `MAX_PROCESSED_DIMENSION` cap.
- [x] Feed each rendered page buffer through the **existing** pipeline call exactly as a manual
      upload would: magic-byte validation, sharp derivatives, EXIF/GPS strip (a rasterized page
      typically carries none, but run the same path for consistency and because the pipeline may do
      more than EXIF-strip), private bucket landing, moderation-visible processing state.
      **Done:** `lib/story/pdf-page-attachment.ts`'s `attachPdfPagesToRevision()` calls
      `beginStoryMediaUpload` -> raw-bytes upload (regular RLS-scoped client, caller's session
      token) -> `finalizeStoryMediaUpload` -> `processStoryMedia()` — the exact sequence
      `app/(contributor)/stories/[id]/edit/upload/route.ts` already uses for a manual upload, with
      `image-pipeline.ts` itself untouched.
- [x] Respect the existing 12-image-per-revision limit at this step — this is the _real_ enforcement
      point now (Stage 0.5's preview-thumbnail ceiling was a separate, earlier, more permissive
      limit just for browsing/selecting).
      **Done:** enforced by `begin_story_media_upload`'s existing transactional under-lock check
      (unchanged); `attachPdfPagesToRevision()` also does an up-front check (selection size, and
      selection size against the revision's current attachment count) so the common case rejects
      cleanly before any rendering/uploading, and rolls back every reservation/attachment it created
      in-call if the RPC-level check still fails later (e.g. a concurrent-attach race).
- [x] Reuse the existing same-story duplicate-image `sha256` check
      (`image-upload-manager.tsx`'s logic) — relevant if an editor re-imports the same PDF or
      re-selects an already-attached page.
      **Done:** `attachPdfPagesToRevision()` compares `sha256` across every image now on the
      revision (via `get_story_preview()`, the same RPC the client-side check already reads from)
      and returns `isDuplicate` per attached page — a signal, not a rejection, same convention as
      the existing UI.
- [x] Populate `story_revision_media.alt_text`/`caption` as empty/null at this step (Stage 4's
      review UI fills them in before submission is possible — see the accessibility decision above);
      confirm the DB/RPC layer doesn't require these non-null at insert time, only at
      submit-for-review time (check `submit_revision_with_consent()` and the preview-page
      `missingRequirements` gate pattern already used for other required-field enforcement,
      `app/(contributor)/stories/[id]/preview/page.tsx`, and extend that same gate to require alt
      text on every attached image rather than inventing a new enforcement mechanism).
      **Confirmed by reading the SQL, not assumed:** `finalize_story_media_upload` already attaches
      with `decorative = true` (`20260806110100_fix_finalize_upload_alt_text_constraint.sql`) so
      `story_revision_media_alt_text_required`'s check constraint is satisfied with `alt_text` left
      null — this Stage reuses that unmodified, no new insert-time logic needed. The existing
      submit-time `missingRequirements` gate already covers this; not extended in this Stage (no UI
      yet to extend it for).
- [x] Tests: selected pages render and land in the private bucket, over-the-12-limit selection
      rejects cleanly, duplicate-page-selection produces the expected duplicate-warning signal,
      images are correctly ordered by the selected page order (`sort_order`).
      **Done:** `lib/story/pdf-import.test.ts` (+7 tests for `renderPagesAtFullQuality`) and the new
      `lib/story/pdf-page-attachment.test.ts` (7 tests, in-memory fake of every RPC/table touched,
      modeled on the real migrations — no live Docker Supabase stack needed, following the existing
      `lib/story/image-pipeline.test.ts` mocking convention).
- [x] `npm run verify` passes. Update `docs/implementation-status.md`.
      **Done: 350 tests, 0 lint errors, build clean.**

---

## Stage 3 — Assemble the story draft: image blocks in page order, minimal shell text — **COMPLETE (2026-08-18)**

**Goal:** produce a valid `content_json` document referencing the attached page images in the
right order, and a sane default title, without pretending to have extracted any real narrative text.

- [x] Decide the minimal `content_json` shape: most likely one `![[mediaId]]` embed token per
      attached page, in selected-page order, with no surrounding prose (since there's no extracted
      text to write) — confirm this round-trips cleanly through `storyContentSchema`
      (`lib/validation/story.ts`) as-is, since that schema was designed around a Markdown-text
      block with embedded image tokens, not an image-only document; if validation rejects an
      (almost) empty text block, decide whether to add a short instructional placeholder string
      ("Imported from PDF — add your story text here.") that the editor is expected to replace,
      rather than changing the schema itself.
      **Done:** one `markdown` block — the placeholder line
      `"Imported from PDF — add your story text here."` followed by one `![[mediaId]]` token per
      attached page, each on its own line, in input order. The placeholder line turned out to be
      necessary, not optional: the markdown block's `.trim().min(1, ...)` rule rejects an
      embeds-only/no-prose document once trimmed, confirmed by an actual failing test before adding
      the placeholder. The final shape's round-trip through the real
      `storyContentSchema.safeParse()` is asserted `.success === true` in
      `lib/story/pdf-import-content.test.ts`, not just structurally assumed. See
      `docs/implementation-status.md`'s 2026-08-18 Stage 3 entry for the full reasoning.
- [x] Default title: derive from the uploaded filename (sanitized/truncated to the existing 200-char
      title limit) or a fixed "Untitled import" fallback, consistent with the existing
      `createDraftAction`'s "Untitled story" pattern (`app/(contributor)/stories/new/`) — reuse that
      convention rather than inventing new default-title logic.
      **Done:** `titleFromPdfFilename()` in the new `lib/story/pdf-import-content.ts` — strips the
      extension, normalizes control/separator characters and whitespace, truncates to 200 chars
      (mirroring `revisionInputSchema.title`'s limit), falls back to the exact literal
      `"Untitled story"` reused from `start-new-story.tsx` (not a new "Untitled import" string —
      one fallback convention, not two).
- [x] This stage explicitly does **not** attempt heading/paragraph reconstruction, OCR, or any text
      derivation from the PDF — that direction was abandoned in the pivot above. If a future need
      for real narrative text re-emerges, it's a new plan, not an extension of this one.
      **Confirmed:** the new module only ever consumes a `mediaIds: string[]` array and an optional
      filename string — it never touches PDF bytes.
- [x] Tests: a draft assembled from N selected pages produces exactly N embed tokens in the right
      order, referencing the exact `story_revision_media` rows Stage 2 created.
      **Done:** `lib/story/pdf-import-content.test.ts`, 12 tests — embed-token order, schema
      round-trip, placeholder-text presence, zero-pages edge case, and title derivation across
      normal/empty/extension-only/needs-sanitizing/overlong filenames.
- [x] `npm run verify` passes. Update `docs/implementation-status.md`.
      **Done: 362 tests, 0 lint errors, typecheck clean, build clean.**

---

## Stage 4 — Wire into the editorial import workflow (two-phase: preview → select → attach) — **COMPLETE (2026-08-18)**

**Goal:** connect Stages 1–3 into the real, existing editorial-import UI/action as a genuinely new
interaction shape — this is not a single-submit form like the text/HTML importer, because the
editor needs to _see and choose_ pages first.

- [x] Phase A action: accept the PDF upload (title/contributor fields as today), call Stage 1's
      `renderPagePreviews`, return preview thumbnails + page numbers to the client **without**
      creating a draft or touching the image pipeline yet — nothing persists from an abandoned
      import attempt.
      **Done:** `POST /editorial/new/pdf-preview`
      (`app/(editor)/editorial/new/pdf-preview/route.ts`). Returns
      `{ pageCount, pages: [{ pageNumber, width, height, dataUrl }] }`, `dataUrl` a base64
      `data:image/png;base64,...` — the plan's own suggested simplest shape. No draft/revision/media
      row of any kind is created; a rejected or abandoned call leaves nothing behind.
- [x] Phase B action: accept the editor's selected page numbers (≤12, validated server-side against
      the actual rendered page count — never trust a client-supplied selection blindly, Engineering
      Rule 2) plus per-page alt text, call Stage 2 (render-and-attach) and Stage 3 (assemble
      content_json), then create the draft via the same underlying creation path
      `createEditorialImportAction`/`createDraftAction` already use — confirm the exact current
      shape by reading those files rather than assuming.
      **Done, with one scope deviation confirmed against the actual DB/RPC layer:** per-page alt
      text is NOT collected in Phase B — reading
      `supabase/migrations/20260806110100_fix_finalize_upload_alt_text_constraint.sql` confirmed
      `finalize_story_media_upload` attaches every image with `decorative = true`, which alone
      satisfies `story_revision_media_alt_text_required` with `alt_text` left null (Stage 2 already
      relies on and tests this). Real alt-text entry is a picker-UI concern (Stage 5, not built
      here) and is still blocked at submit time by the existing `missingRequirements` gate — this
      stage does not weaken that. `POST /editorial/new/pdf-attach`
      (`app/(editor)/editorial/new/pdf-attach/route.ts`) creates the draft via
      `createEditorialImportDraftShell` (the exact `create_editorial_import_draft` RPC
      `createEditorialImportAction` already uses), then Stage 2's `attachPdfPagesToRevision()`, then
      Stage 3's `buildPdfImportContent()`, then persists the result via `saveRevisionDraft()`.
- [x] The original PDF bytes must survive only across Phase A → Phase B for a single interactive
      session (e.g. kept server-side keyed to a short-lived import-session id, or re-uploaded in
      Phase B) — never written to persistent storage, per Ground Rule 6. Decide the simplest
      mechanism that satisfies this (e.g. the client re-submits the original file alongside its page
      selection in Phase B, avoiding any server-side temp-file/session-cache design entirely) before
      building something more complex.
      **Done, simplest option, as preferred:** the client re-submits the identical PDF file to
      Phase B alongside `pageNumbers`. No server-side cache/session/temp file was built — no PDF
      bytes are ever held between the two requests.
- [x] Server-side re-validation at every step (Engineering Rule 2): re-check magic bytes/size/page
      count in Phase B even though Phase A already validated, since Phase B is a separate request.
      Per Stage 1's findings, Phase A (the PDF upload itself) should use a **Route Handler**, not a
      Server Action, mirroring the existing image-upload path — a platform-level request-body limit
      applies regardless of `next.config.ts`'s Server Action `bodySizeLimit` setting.
      **Done and proven, not just implemented:** Phase B independently re-parses the re-uploaded
      bytes' magic header/size (`pdfImportFileSchema`) and independently re-derives the real page
      count via `renderPagesAtFullQuality()` (inside `attachPdfPagesToRevision()`), rejecting any
      selected page number the actual re-parsed PDF doesn't have. A test selects page 5 of a real
      2-page fixture and asserts rejection, and a separate test sends a non-PDF file with an
      otherwise-fully-valid request and asserts rejection — neither passes by trusting Phase A's
      claim. Both endpoints are Route Handlers (`export const runtime = "nodejs"`), not Server
      Actions, confirmed necessary by reading `next.config.ts`'s still-unwired
      `MAX_PDF_IMPORT_INPUT_BYTES` note.
- [x] Tests: an integration test that goes through both phases end-to-end with a small fixture PDF
      and asserts a draft is created with the expected image count/order, plus the standard
      RLS/ownership assertions the other editorial-import tests already carry; a test asserting
      Phase B rejects a selection referencing a page number the PDF doesn't have.
      **Done:** `app/(editor)/editorial/new/pdf-preview/route.test.ts` (5 tests) and
      `app/(editor)/editorial/new/pdf-attach/route.test.ts` (8 tests) — co-located with in-memory
      RPC fakes (not `tests/integration/**`, which is excluded from `npm run verify`'s default run
      and requires a live linked Supabase project; this follows Stage 1–3's own established
      convention instead). Covers: end-to-end draft creation with correct image count/order and
      content_json embed order, the new-contributor path, auth rejection (signed-out AND
      wrong-role), over-12-page-selection rejection, out-of-range-page-number rejection, and
      non-PDF-file rejection.
- [x] `npm run verify` passes. Update `docs/implementation-status.md`.
      **Done: 375 tests (up from 362), 0 lint errors, typecheck clean, build clean.**

---

## Stage 5 — UI: upload → page picker → alt text → mandatory review step — **COMPLETE (2026-08-18)**

**Goal:** a contributor/editor-facing surface for the two-phase flow above.

- [x] Extend `content-import-panel.tsx` / `new-import-form.tsx` with a "PDF/Canva file" mode
      alongside the existing paste-text/HTML mode.
      **Done, with a scope correction confirmed by reading the actual code first:**
      `content-import-panel.tsx` turned out to be a different, post-draft-creation tool (used
      inside the real editor to replace an already-created draft's body text), not a mode of
      `/editorial/new` — that page only ever had one mode (blank draft). Stage 5 adds the PDF mode
      to `new-import-form.tsx` as a real second `importMode`, alongside the (unchanged) blank-draft
      mode; `content-import-panel.tsx` itself needed no changes. See
      `docs/implementation-status.md`'s Stage 5 entry for the full reasoning.
- [x] Page-picker UI: a grid of the rendered preview thumbnails (Phase A's response), selectable up
      to 12, with a visible running count and a clear disabled state once the limit is hit — mirror
      `image-upload-manager.tsx`'s existing selection/limit-feedback conventions rather than
      inventing new ones.
      **Done:** `app/(editor)/editorial/new/pdf-import-picker.tsx`'s thumbnail grid, "X of 12
      selected" counter, native `disabled` + labeled limit-reached state.
- [x] Per-selected-page alt-text field, required (not optional) before the "create draft" action in
      Phase B can be submitted client-side — this is a UX nicety on top of, never a replacement for,
      Stage 4's server-side enforcement.
      **Done**, plus the server-side enforcement itself was extended in this stage (Stage 4 had
      deferred it) — `pdf-attach/route.ts` now applies submitted alt text via the existing
      `update_story_media_caption` RPC (`updateStoryMediaCaption()`, `lib/story/mutations.ts`) —
      the exact mechanism `image-upload-manager.tsx`'s own caption editing already uses, not a new
      one.
- [x] Client-side pre-checks only (file type/size), matching `image-upload-manager.tsx`'s existing
      "fast client-side pre-checks, server re-validates" pattern.
- [x] **Mandatory review step**: land the result as a normal editorial draft that must go through
      the existing editor UI (`story-edit-form.tsx`) before submission — the placeholder body text
      from Stage 3 makes it obvious the story still needs real narrative text added, not just a
      cosmetic "done" state.
      **Done and live-verified**: `router.push('/editorial/' + storyId + '/edit')` on success, no
      terminal "done" screen.
- [x] Mobile-first check per CLAUDE.md rule 18 — confirm current convention for editorial tools
      (typically desktop-heavy in this codebase) before assuming mobile support is required here,
      same caveat as the original plan.
      **Confirmed:** no prior mobile-specific treatment existed to preserve or break; the new grid
      reuses `image-upload-manager.tsx`'s own `grid-cols-2 sm:grid-cols-3` classes, so it doesn't
      overflow narrow viewports by construction.
- [x] Basic WCAG pass on the new form controls (rule 19): labels, keyboard reachability for the page
      picker grid specifically (a grid-of-clickable-thumbnails pattern needs real keyboard
      navigation, not just mouse click targets), error announcement via the existing `role="alert"`
      pattern already used in `new-import-form.tsx`.
      **Done:** thumbnails are real `<button aria-pressed>` elements (Enter/Space work natively,
      confirmed both by an RTL test and live keyboard interaction), every input has a real
      `<label htmlFor>`, errors render inside `role="alert"`.
- [x] Live-verify in the browser preview per this session's UI-change convention: submit a real
      fixture PDF, confirm the page picker renders thumbnails, select a subset, fill alt text,
      confirm the draft appears with the right images in the right order and moderation-visible
      processing state resolves correctly.
      **Done, against `next dev --webpack`** (classic webpack, not this repo's default Turbopack —
      a genuine, pre-existing Turbopack/`pdfjs-dist` bundling bug was found and characterized
      during this step, unrelated to Stage 5's own code and out of that stage's scope to fix.
      **It has since been fixed** — see `docs/implementation-status.md`'s "Turbopack fix" entry;
      the flow below has been re-confirmed end to end under Turbopack in both dev and a real
      production build, and is now covered by `e2e/pdf-import.spec.ts`). Full flow confirmed end to end
      against the real linked hosted Supabase project, signed in as the `rls-editor` fixture
      account: real non-blank thumbnails, click + keyboard selection, alt text required before
      submit, a real `200 OK` draft creation, landing on the real editor with the placeholder body
      text and both images present with real signed storage URLs, and a live client-side rejection
      of a non-PDF file.
- [x] `npm run verify` passes (and `npm run test:e2e` if a Playwright spec is added for this new
      critical flow, per the Definition of Done). Update `docs/implementation-status.md` and this
      plan's Status line to "shipped."
      **Done: 384 tests (up from 375), 0 lint errors, typecheck clean, build clean.** No new
      Playwright spec added at the time — the live-verification session above exercised the real
      end-to-end flow (real hosted Supabase project, real signed URLs, a real discovered bug) more
      thoroughly than a scripted spec would have added, and a Playwright run in this sandboxed
      environment would hit the same Turbopack/`pdfjs-dist` gap via `next build`.
      **Superseded**: that reasoning is exactly what let the Turbopack bug ship. `e2e/pdf-import.spec.ts`
      now covers both phases against a real built server, and was proven to fail when the fix is
      reverted. Any future server-side module with a native/WASM/self-resolving dependency needs
      Playwright coverage — Vitest cannot prove it loads in the Next runtime.

---

## Explicitly out of scope for this plan

- Any text/OCR extraction from the PDF — the pivot above deliberately abandons this direction.
  Story body text is written by the editor/contributor after import, same as any other draft.
- Auto-generating alt text (e.g. via an image-captioning model) — out of scope for this plan; alt
  text is editor-written, per the accessibility decision above. Could be a future enhancement to a
  _different_ plan, not silently folded into this one.
- Persisting the original uploaded PDF anywhere, in any bucket or table — per the retention
  decision above.
- Any non-PDF Canva export format (e.g. Canva's own "share as link" web export) — file-based PDF
  import only.
- Editing the PDF import pipeline to skip the mandatory human-review step for any reason — this
  plan's importer output is always a draft, never an auto-published revision (Engineering Rule 11
  and this plan's Ground Rule 5).
- Raising the 12-image-per-revision cap — explicitly decided against above; large PDFs are handled
  by editor selection, not a bigger limit.
