# Implementation Status — Kakinotes

Read this before starting any task — it reflects what actually exists, not what is planned in
CLAUDE.md or docs/. Update it as part of the Definition of Done for every task.

Last updated: 2026-08-20 (the REAL cause of every image upload failing on Vercel, found via the
user's actual Function logs — see the entry immediately below; the timeout entry beneath it was a
real, separate, worthwhile fix, but not what was actually breaking every upload).

**2026-08-20 — Every image upload crashing on Vercel: sharp's native binary wasn't being packaged
for the deployed Lambda (`ERR_DLOPEN_FAILED`), found from the user's own Vercel Function logs.**

The maxDuration/timeout fix below (same day, earlier) was real and still worth having, but the
user reported uploads still failing identically after that fix was deployed — meaning it wasn't
the (or wasn't the only) actual cause. Rather than guess further, asked the user for the literal
Vercel Function log for one failed request. That log's actual error text (not just the
trace/timing panel, which showed a red herring — "No outgoing requests", ~200ms execution,
`FUNCTION_INVOCATION_FAILED` — consistent with, but not proof of, several different causes):

```
Failed to load external module sharp-20c6a5da84e2135f: Error: Could not load the "sharp" module
using the linux-x64 runtime
ERR_DLOPEN_FAILED: libvips-cpp.so.8.18.3: cannot open shared object file: No such file or directory
```

- **Root cause.** `sharp` is a native addon: a compiled `.node` binding plus a _separate_ shared
  library (`libvips-cpp.so`, shipped as its own platform-specific optional dependency,
  `@img/sharp-libvips-linux-x64`) that the binding `dlopen()`s at runtime — not a plain
  `require()`/`import` a bundler's static analysis can see. `next.config.ts`'s
  `serverExternalPackages` list (needed for exactly this reason for `@napi-rs/canvas`) did NOT
  include `sharp` — its own comment claimed sharp "already works without needing to be listed here
  (Next auto-detects... but not these two)". That assumption was wrong under this project's
  Turbopack build: confirmed directly in the compiled output (`grep` on `.next/server/chunks/`)
  that sharp WAS already being treated as a Turbopack "external import" — `e.y("sharp-...")`, the
  exact same module id from the Vercel error — so externalization itself wasn't the gap; Next's own
  file-tracing (which decides what actually gets copied into the deployed Lambda, native binaries
  included) was the part not reliably picking up sharp's separate native library. This is not an
  install problem — `package-lock.json` already carried correct `@img/sharp-libvips-linux-x64` /
  `@img/sharp-linux-x64` entries (checked directly) — it's a bundling/packaging one.
  - **Why every upload failed identically, HEIC or not, and why the earlier timeout theory didn't
    fully explain it:** `sharp` is imported unconditionally at the top of
    `lib/story/image-pipeline.ts`, which the upload route imports unconditionally at its own top
    level — so the crash happens at module load, before the route handler body runs at all. That
    matches the trace panel's "no outgoing requests" / ~200ms exactly: the request never got far
    enough to make one.
  - **Fix:** added `"sharp"` to `serverExternalPackages` in `next.config.ts`, alongside
    `@napi-rs/canvas` and `pdfjs-dist`.
  - **Verification, and its real limit.** `npm run verify` green (411/411, build clean) — but this
    is a Linux-only, Vercel-build-only failure mode: local `npm install` only fetches optional
    binaries for the current platform (macOS here), so a local trace can never show the
    `linux-x64`/`libvips-cpp.so` files the actual bug is about, and this could not be reproduced or
    disproven locally by design. **Told the user this plainly rather than claiming a verification
    that wasn't possible** — the fix is the standard, documented mechanism for exactly this error
    signature, and matches the evidence precisely, but only an actual Vercel redeploy + retest can
    confirm it. Awaiting that confirmation as of this entry. If it doesn't fully resolve it, the
    next step is a Vercel redeploy with a cleared build cache (in case a stale cached install is
    involved) before looking further.

**2026-08-20 (earlier the same day) — Image upload timeout on Vercel deployment: root-caused and
mitigated; image-viewing report still open, cause outside this codebase so far.**

User report: "on vercel deployment, images do not load. Uploading HEIC pictures also do not work
... none of the image upload is working in the deployed vercel server" (i.e. not HEIC-specific —
every upload). `npm run verify` run and green (410/410) before any investigation, per the user's
explicit request to test first.

- **Upload timeout — root-caused with real measurements, not guessed.** Reproduced against a real
  local **production** build (`next start`, the same server code Vercel runs) talking to this
  project's actual Supabase project — it succeeded locally, ruling out a code crash or a
  bundling/tracing problem (checked and ruled out: sharp's Linux binaries are present in the
  lockfile, libheif's WASM is embedded in its bundle, not read from disk, so it IS included in the
  Vercel build). The route was then instrumented with temporary timing logs (reverted afterward,
  not shipped) and re-run against a real user-supplied iPhone photo: **13.7-33.2s** end to end
  across several runs, breaking down as ~8.3s to upload the original alone, 1.8-2.7s per subsequent
  storage round trip, ~1.4s across four DB RPCs. The route declared no `maxDuration`, so it ran at
  Vercel's short default Function timeout — comfortably exceeded by ordinary real-world uploads.
  This is not HEIC-specific (matches the user's "none of the image upload is working" report): any
  upload of a non-trivial photo takes this long, HEIC or not; HEIC uploads are only somewhat worse
  because the JPEG re-encode of a HEIC photo is often larger than the HEIC original (this test
  photo: 3.5 MB HEIC → 5.4 MB JPEG), and the transcode itself adds ~1.4s of CPU.
  - **Fix 1: `export const maxDuration = 60`** on `app/(contributor)/stories/[id]/edit/upload/route.ts`
    — 60s chosen as the ceiling supported on every Vercel plan tier without risking a build-time
    rejection for exceeding a lower plan's maximum (Hobby); raise further (Pro: 300s, Enterprise:
    800s) if still insufficient on a plan that supports it.
  - **Fix 2: eliminated one real, measured redundant round trip.** `processStoryMedia()` in
    `lib/story/image-pipeline.ts` always re-downloaded the original from Storage as its first
    action — pointless when (as here) it's called synchronously in the same request that just
    uploaded those exact bytes. Added an optional `knownOriginalBytes` parameter; the upload route
    now passes the bytes it already has in memory, skipping that download entirely. Worth ~2-3s on
    a 5.4 MB file, more for larger ones; standalone/future retry callers are unaffected (parameter
    is optional, falls back to the original download). New regression test
    (`lib/story/image-pipeline.test.ts`) proves the original's specific storage path is never
    downloaded when bytes are supplied, while the (unrelated, still-intentional) post-upload
    verification download of the _processed_ derivative still happens — full `npm run verify` gate
    green afterward, 411/411.
  - **Re-verified live** against the running dev server with the user's real photo after both
    fixes: 13.7s (down from the original 33.2s baseline measurement), succeeded, rendered correctly
    at the expected resized dimensions. Test upload removed from the draft afterward.
  - **Not fully solved.** This remains architecturally a synchronous, multi-round-trip-per-upload
    design — real for any sizeable file, not eliminated by either fix, just brought under a
    timeout ceiling that should now tolerate it. A real background job/queue is the durable fix if
    large/slow uploads keep being a problem; out of scope for this pass.
- **"Images do not load" (viewing, not uploading) — investigated, not yet resolved.** No CSP
  anywhere in the app (`next.config.ts`, `proxy.ts`, `app/layout.tsx` all checked, none set), no
  `next/image` component anywhere renders a remote Supabase URL (confirmed via full-repo search —
  the only two `next/image` usages are a local static asset and a fallback icon; every public/
  gallery image goes through a plain `<img>`, so `next.config.ts`'s empty `images.remotePatterns`
  cannot be the cause), and `getPublicImageUrl()`
  (`lib/story/public-image-url.ts`) works correctly locally against real env vars. Asked the user
  to check Vercel's Environment Variables (`NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`) for the Production environment — **user confirmed these
  are already set correctly**, ruling out the leading hypothesis. Root cause still open: next
  candidates are the Supabase Storage project's own CORS/bucket configuration for the production
  domain, or something specific to the Vercel deployment this codebase has no visibility into.
  **Needs the actual Vercel Function/browser error for a failing image request** (a real HTTP
  status + response body, not just "doesn't load") to make further progress — asked the user for
  this; not yet supplied as of this entry.

**2026-08-20 (earlier the same day) — HEIC (iPhone) photo uploads, PNG tried and reverted, and a
real-photo crash fixed same day.**

- **HEIC uploads (`lib/story/heic.ts`, new).** The image uploader now accepts the format an iPhone
  actually shoots. Sharp's prebuilt libvips parses a HEIC container but cannot decode it (no HEVC
  decompressor in the prebuilt binaries — verified directly here, and pinned by a unit test that
  fails if that ever changes), so the upload route decodes HEIC with `heic-decode` (WASM libheif,
  **dependency added** — the only thing in reach that can decode HEVC; imported lazily, so non-HEIC
  uploads never load its ~6 MB payload) and re-encodes to **JPEG before** a storage path is
  reserved or any row is written.
  - Deliberately normalized at the boundary rather than taught to the rest of the system: bucket
    `allowed_mime_types`, the `begin_story_media_upload()` / `record_processed_story_media()` MIME
    whitelists, `story_media.source_mime_type`, and `image-pipeline.ts`'s own sniff all still see
    exactly the three stored formats. No migration, no RLS change, no storage-policy change.
  - Trade-off recorded: the stored "original" for a HEIC upload is the JPEG transcode, not the
    HEIC bytes. The original is private staging material and the published derivative is always a
    re-encode of it, so nothing user-visible loses more than one JPEG generation.
- **PNG tried first, reverted same day — proven non-viable against a real photo.** The initial
  build transcoded HEIC to PNG (lossless) instead. A live test against a real iPhone photo
  (4284x5712) supplied by the user showed the PNG re-encode at 51 MB against 5 MB for a JPEG
  re-encode of the identical decoded pixels — both `MAX_UPLOAD_BYTES` and the storage buckets'
  own `file_size_limit` are fixed at 15 MiB, so PNG rejected an entirely ordinary upload at the app
  layer, and would have hit the storage layer's own hard cap too (a schema change, not a config
  fix). PNG's losslessness bought nothing back: the HEIC source is already lossy HEVC, so a
  lossless re-encode of it just spends far more bytes on the same already-lossy pixels. Reverted
  to JPEG after presenting the finding and the user choosing it explicitly over raising storage
  limits or downscaling before encode.
- **Real bug found and fixed the same day, via that same real-photo test.** The first
  implementation pre-checked dimensions with a separate `sharp(bytes).metadata()` parse before
  handing off to the real decoder — and that call threw on the user's actual photo:
  `Security limit exceeded: Number of references in iref box (45) exceeds the security limits of
16`. Root cause: sharp's bundled libheif enforces its own hard ceiling of 16 references in a
  HEIC container's `iref` box, and an ordinary modern iPhone photo routinely exceeds it (Portrait
  mode / Deep Fusion / Live Photo all link extra image items — thumbnail, depth map, portrait
  matte — via `iref`). `heic-decode` (the separate WASM libheif build actually used for the real
  decode) opened the same file without issue — confirmed directly, isolated from the app, before
  changing any code. **This meant essentially any real recent-iPhone photo would have failed the
  upload, not just an edge case.** Fixed by dropping the pre-decode `sharp().metadata()` call
  entirely: `MAX_INPUT_PIXELS` (the decompression-bomb guard) is now checked from the dimensions
  `heic-decode` itself returns, immediately after decode and before the JPEG re-encode — an
  accepted narrowing (decode now happens before the pixel-count check, rather than after), justified
  because this endpoint requires an authenticated contributor with edit rights on the revision
  (never anonymous) and the compressed input is already bounded by `MAX_UPLOAD_BYTES`.
  - Sniffing split in two: `sniffImageMimeType()` (stored formats; still rejects HEIC) vs
    `sniffUploadMimeType()` (adds HEIC). HEIC is an ISO-BMFF `ftyp` brand check; `avif`/`avis` and
    video brands excluded.
  - Client side: `accept` now carries `image/heic`, `image/heif` **and the bare `.heic`/`.heif`
    extensions**, because several browsers report an empty `File.type` for them — a MIME-only
    accept list hides the user's own photos in the picker. The in-flight tile shows a muted square
    instead of a broken-image icon for HEIC, which browsers generally can't render.
  - **Verified:** unit tests against a real (checked-in, synthetic) HEIC fixture —
    `lib/story/heic.test.ts`, regenerable via `scripts/generate-heic-fixture.mjs` (macOS `sips`;
    nothing in the dependency tree can _encode_ HEIC either) — plus `image-validation.test.ts`
    brand coverage, and the full `npm run verify` gate. Live-verified end-to-end against the
    linked dev Supabase project twice: once with a synthetic fixture (uploaded through the real
    editor with `File.type` deliberately left empty, mimicking browsers that report no MIME for
    `.heic`), and once with the user's actual 3.5 MB iPhone photo (4284x5712, the file that
    surfaced the `iref`-limit bug above) uploaded through the real editor UI end to end — both
    transcoded, stored, finalized, processed, and rendered correctly (upright, no visible artifacts)
    in the gallery. The real-photo test upload was removed from the draft afterward.
- A landing-page handwriting-font trial was explored in the same session and then **reverted at
  the user's request** — no font change is present in this codebase.

**2026-08-18 — PDF/Canva import: Turbopack runtime fix, proxy body-size fix, and the
anti-recurrence e2e coverage that would have caught both.**

Follow-up to the Stage 5 entry below, which shipped the feature but left it working only under
`next dev --webpack` — not under Turbopack, this repo's default for both `npm run dev` and
`npm run build`. That is now fixed and verified live in both modes.

- **Root cause (specific).** `lib/story/pdf-import.ts`'s `standardFontDataUrl()` used
  `require.resolve("pdfjs-dist/package.json")` to locate pdfjs-dist's bundled `standard_fonts/`
  directory. `require.resolve(<literal>)` is a **bundler-visible call**: Turbopack rewrites it to
  return its own module identifier instead of a filesystem path. Reproduced first-hand under
  `npm run dev` before changing anything (via a throwaway unauthenticated probe route, since the
  real routes are editor-gated; the probe was deleted afterwards):
  - dev returned the _string_
    `"[externals]/pdfjs-dist/package.json [external] (pdfjs-dist/package.json, cjs, [project]/node_modules/pdfjs-dist)"`,
    so the `.replace(/package\.json$/, "standard_fonts/")` matched nothing and the result had no
    trailing slash → pdfjs's own `getFactoryUrlProp()` threw
    `Invalid factory url: "…" must include trailing slash` from inside `getDocument()`;
  - the production build returned a _numeric_ module id → `TypeError: 55876.replace is not a
function`, the exact second error the Stage 5 entry recorded.
    `serverExternalPackages: ["@napi-rs/canvas", "pdfjs-dist"]` (next.config.ts, Stage 1) is correct
    and was never the problem — it governs how the module is _loaded_, and indeed
    `await import("pdfjs-dist/legacy/build/pdf.mjs")` resolved to the real
    `file:///…/node_modules/pdfjs-dist/legacy/build/pdf.mjs` under Turbopack the whole time. It does
    not make `require.resolve` of a _subpath inside_ an externalized package fall through to Node.
    `@napi-rs/canvas`'s native `.node` loading was never implicated either.
- **The fix (one function, no library swap, no dependency change, no bundler change).**
  `standardFontDataUrl()` now resolves through `process.getBuiltinModule("node:module")
.createRequire(import.meta.url).resolve(...)`, then joins with `node:path`. Two things were
  tried and rejected on evidence, both recorded in the function's own doc comment so nobody
  re-derives them:
  1. plain `import { createRequire } from "node:module"` — **re-broke identically**; Turbopack
     substitutes its own `createRequire` shim, which still resolves through the bundler's module
     graph. Confirmed by running it, not by reading docs.
  2. a non-literal specifier variable, to dodge static analysis — also insufficient, same reason.
     `process.getBuiltinModule` (Node ≥ 22.3; this repo pins Node 24 via `engines`) reaches the real
     Node builtin at runtime through `process`, which no bundler rewrites. The function also now
     **guards its own assumption** — a non-absolute or non-`package.json` result throws a message
     naming the real cause, instead of failing deep inside pdfjs's argument validation.
     No library swap was needed, so no CJK-rendering re-validation was required (the plan's Revision
     history reason for the image-based approach is untouched).
- **Second, separate defect found and fixed while verifying: the 10 MB proxy body cap.** The
  running dev server's log carried
  `Request body exceeded 10MB for /editorial/new/pdf-preview. Only the first 10MB will be
available unless configured.` `proxy.ts`'s matcher includes `/editorial/:path*`, and Next
  **silently truncates** (not rejects) a proxied body past 10 MB by default. Against
  `MAX_PDF_IMPORT_INPUT_BYTES` (75 MiB, sized for the real ~57 MB 151-page Canva sample this
  feature exists for), every genuinely large export would have arrived truncated and been reported
  to the editor as a corrupt PDF. `next.config.ts` now sets
  `experimental.proxyClientMaxBodySize = "80mb"` with the same cross-referencing-comment
  discipline the existing `serverActions.bodySizeLimit` uses; `lib/story/pdf-validation.ts`'s
  constant comment now points back at it. This is a transport ceiling only — `pdfImportFileSchema`
  still enforces the real 75 MiB product limit in code. **Not verified with an actual >10 MB
  upload** (no large fixture exists in-repo and generating one purely to test transport was judged
  not worth the runtime); the truncation behaviour is taken from Next's own warning text.
- **Anti-recurrence coverage: `e2e/pdf-import.spec.ts` (new).** This is the real lesson —
  **384 Vitest tests and a green `next build` proved nothing here.** Vitest imports
  `lib/story/pdf-import.ts` directly in plain Node and never touches Next's bundler; `next build`
  succeeded because the failure was a _runtime_ resolution error inside the emitted chunk,
  reachable only by handling an actual request. Playwright is the only layer in this repo that
  runs the real build (`playwright.config.ts`'s webServer runs `npm run start`), so it is the only
  layer that can catch this class of bug. Two tests, both editor-authenticated against the linked
  hosted project, skipping themselves without `.env.test.local` exactly like
  `e2e/editorial-upload.spec.ts`:
  1. **Phase A only** — asserts a real `200` from `POST /editorial/new/pdf-preview` with two real
     `data:image/png;base64,…` thumbnails (length, dimensions) _and_ that the browser decodes them
     (`naturalWidth > 100`). Persists nothing.
  2. **Full flow** — mode switch → upload → select both pages → alt text → `200` from
     `pdf-attach` → lands on `/editorial/:id/edit` with the Stage 3 placeholder text and
     `Images (2)`.
     **This coverage was proven to actually catch the bug, not assumed to**: the fix was temporarily
     reverted, the app rebuilt (`✓ Compiled successfully` — still green, which is the whole point),
     and test 1 failed with `Expected: 200 / Received: 500`. Fix restored, both tests pass again.
     New fixture prefixes (`e2e-pdf-import-` / `E2E PDF Import Contributor `) are registered in
     `scripts/cleanup-editorial-e2e-fixtures.mjs`.
- **General rule for anyone adding server-side code with native/WASM/self-resolving dependencies
  (pdfjs-dist, @napi-rs/canvas, sharp, anything doing its own module resolution): Vitest coverage
  does not prove the module loads in the Next runtime, and a green `next build` does not prove the
  route runs.** Add a Playwright spec that hits the route through a real built server, or you have
  no evidence at all that the feature works on the default path.
- **Live verification (what was and wasn't confirmed).** Signed in as the real
  `rls-editor@whv-compass-test.example` fixture account against the linked hosted dev project
  (Docker/local Supabase remains unavailable in this environment):
  - `npm run dev` (Turbopack) — both e2e tests pass; server log shows
    `POST /editorial/new/pdf-preview 200` and `POST /editorial/new/pdf-attach 200`.
  - `npm run build && npm run start` (production Turbopack) — both e2e tests pass.
  - Screenshotted the real picker: two genuinely rendered, legible page thumbnails, "2 of 12
    selected", both required alt-text inputs, enabled submit; then the real editor showing
    "Imported from PDF — add your story text here." and "Images (2)".
  - Both inline images in the editor resolve to real
    `https://…supabase.co/storage/v1/object/sign/story-image…` signed URLs and decode at
    `naturalWidth = 2000` (the pipeline's `MAX_PROCESSED_DIMENSION`) — i.e. the real processed
    derivative, from the real private bucket, not a placeholder.
  - Zero browser console errors across the whole flow.
- **Pre-existing, unrelated breakage found while getting Playwright to run — NOT fixed here, and
  it is not caused by this work or by the PDF import feature.** Commit `a172393` ("session-aware
  header") put an always-mounted `AuthModal` in `components/site-header.tsx` wrapping the _same_
  `SignInForm`/`SignUpForm` the real `/sign-in` and `/sign-up` pages render:
  - One consequence **was** fixed here because it is a genuine labelling defect and it blocked all
    new coverage: those forms hard-code `id="email"`/`id="password"`/`id="displayName"`, so a
    second element with each id sat in every page's DOM, and `/sign-in`'s own visible
    `<label for="email">` resolved (first-match) to the header modal's _hidden_ input rather than
    the field beside it (CLAUDE.md rule 19). `AuthModal` now mounts its children only while open
    (`components/auth/auth-modal.tsx`, with a test asserting it). The `<dialog>` shell still
    mounts, so `showModal()`/`close()` are unaffected.
  - **Still broken, and out of scope for this task**: the header also renders its own "Sign in"
    button on every page, so the unscoped `page.getByRole("button", { name: "Sign in" })` used by
    every pre-existing e2e sign-in helper now matches two elements (Playwright strict-mode
    violation). Separately, `e2e/home.spec.ts` fails because the header nav's "Stories" link now
    reads `Storiesss` (a real typo, shipped) and points at `/#index` instead of `/stories`.
    **Current full-suite result: 20 passed, 24 failed**, and every one of those 24 failures is one
    of these two pre-existing header regressions — none are in `e2e/pdf-import.spec.ts`, which
    passes in both dev and production modes. `e2e/pdf-import.spec.ts` deliberately scopes every
    locator to `<main>` and documents why. Fixing the other specs (and the `Storiesss` typo) is a
    real, separate task.
- `npm run verify` passes: **385 tests** (384 + 1 new `AuthModal` test), 0 lint errors, 0 format
  issues, typecheck clean, build clean.

**2026-08-18 — PDF/Canva import, Stage 5 (UI: upload → page picker → alt text → mandatory review
step). Completes the full plan (Stages 0.5–5).**

Executed [docs/pdf-canva-import-plan.md](pdf-canva-import-plan.md)'s Stage 5, the last stage. Gives
Stages 1–4's standalone Route Handlers a real UI, reached from the existing editorial "new import"
page (`/editorial/new`).

- **Mode switch, not literally "alongside the existing paste-text/HTML mode"** — the plan's own
  wording assumed `content-import-panel.tsx` (the paste-text/HTML importer) lived on the same page
  as the blank-draft form; reading the actual code showed it doesn't — `content-import-panel.tsx`
  is a post-creation tool used _inside_ the real editor (`story-edit-form.tsx`) to replace an
  already-created draft's body text, not a mode of `/editorial/new`. `/editorial/new`
  (`new-import-form.tsx`) only ever had one mode: title + contributor → blank draft. Stage 5 adds a
  second, real mode next to it — "Blank draft" vs. "PDF / Canva file" — driven by a new `importMode`
  radio pair local to `new-import-form.tsx`; `content-import-panel.tsx` itself is untouched, since a
  PDF import produces its own content_json in one submit and never needs the paste-text tool.
- **New files**:
  - `app/(editor)/editorial/new/contributor-fieldset.tsx` — `TitleAndContributorFields`, the
    title + existing/new-contributor fields factored out of `new-import-form.tsx` verbatim (same
    `name` attributes, same markup) so both the blank-draft `<form action={formAction}>` and the
    new PDF-mode `<form onSubmit={...}>` read identical fields via `resolveContributorIdFromFormData`
    server-side — one copy of this UI, not two drifting apart.
  - `app/(editor)/editorial/new/pdf-import-picker.tsx` — the PDF-mode component
    (`PdfImportPicker`), a plain `<form onSubmit={...}>` (not a Server Action — it needs to drive
    two sequential `fetch()` calls to Stage 4's Route Handlers and hold client state, e.g. the
    picked `File` object, between them):
    1. File input + "Upload & preview pages" button. Client-side pre-checks only (extension/MIME,
       size against `MAX_PDF_IMPORT_INPUT_BYTES`, and a real magic-byte sniff via
       `isPdfMagicBytes()` on the first 5 bytes) — a courtesy; `pdfImportFileSchema` re-validates
       server-side regardless (Engineering Rule 2). Posts to `pdf-preview`.
    2. Page-picker grid: each thumbnail is a real `<button type="button" aria-pressed>` — Enter/Space
       toggle it for free via native button semantics, no custom keydown handler needed for
       keyboard support (CLAUDE.md rule 19). A running "X of 12 selected" counter
       (`aria-live="polite"`); once 12 are selected, every unselected thumbnail gets the native
       `disabled` attribute plus an `aria-label`/`title` stating the limit was reached — mirrors
       `image-upload-manager.tsx`'s "fast client pre-check, clear disabled state" convention rather
       than inventing new UI language, though that file has no exact "grid selection limit"
       precedent of its own to copy verbatim (its own limit is enforced by truncating the files
       array on drop/pick, not a disabled-tile grid) — adapted the closest existing pattern instead.
    3. A required alt-text `<input>` renders directly under each _selected_ thumbnail, inline in the
       grid cell (not a separate list) — the "Create Import Draft" submit button stays `disabled`
       (computed, not just relying on the `required` HTML attribute) until every selected page's
       alt text is non-empty after trimming.
    4. Submit re-uses the exact `File` object already held in this component's state (the user is
       never asked to re-pick the file) via `new FormData(formElement)`, which already carries
       `file`/`title`/the contributor fields from the same `<form>` — only `pageNumbers` (JSON,
       selection order) and `altText` (JSON, `{pageNumber: text}`) are added before posting to
       `pdf-attach`. On success, `router.push('/editorial/' + storyId + '/edit')` — no terminal
       "done" screen, landing the editor directly on the real draft so the placeholder body text
       ("Imported from PDF — add your story text here.") is unmissable (the plan's "mandatory
       review step").
  - `app/(editor)/editorial/new/pdf-import-picker.test.tsx` — 7 RTL tests: thumbnails render from a
    mocked Phase A response; selection toggles via click; selection toggles via keyboard
    (`{Enter}`/`{space}` on a focused thumbnail button); the 12-page limit disables further
    unselected thumbnails with the expected `aria-label`; submit stays disabled until every
    selected page has alt text; a full submit sends the original `File`, `pageNumbers` in selection
    order, and the `altText` map with the expected shape to `pdf-attach`, then navigates to
    `/editorial/:storyId/edit`; a Phase A rejection (mocked 400) renders inside `role="alert"`.
  - Also touched: `app/(editor)/editorial/new/new-import-form.tsx` (adds the mode switch, keeps the
    blank-draft `<form>` byte-for-byte behaviorally identical to before — same `useActionState`
    call, same fields, now sourced from the shared fieldset component).
- **Real, non-obvious bug found and fixed while writing the component test, not by inspection**: an
  early version of `PdfImportPicker` marked the PDF `<input type="file">` `required`. jsdom's
  `HTMLFormElement.reportValidity()`/native submit-blocking does not recognize a `FileList`
  programmatically assigned the way `@testing-library/user-event`'s `upload()` (and this session's
  own `DataTransfer`-based live-browser simulation, see below) assign it — `form.checkValidity()`
  returned `false` with `input.validationMessage === "Constraints not satisfied"` even though
  `input.files.length === 1`, silently swallowing every submit attempt with no error surfaced
  anywhere (confirmed by instrumenting `form.checkValidity()`/iterating `form.elements` directly, not
  guessed). Fixed by removing the `required` attribute — the component's own `handleAttachSubmit`
  already rejects a missing file with a clear `role="alert"` message, making native constraint
  validation redundant _and_, on this specific input type, actively unreliable across environments.
  Real browsers do set `.files` correctly on a genuine user-driven file pick, so this was never a
  problem for a real user — only for any environment (this test suite, and this session's own live
  verification) that has to assign `.files` programmatically. Documented inline at the input.
- **Alt text wiring into `pdf-attach/route.ts` — required, not already handled.** Stage 4 explicitly
  deferred this (confirmed by re-reading that stage's own doc comment before touching anything):
  every attached page landed with `decorative = true`/`alt_text = null`, satisfying the DB check
  constraint but with no real alt text anywhere. Stage 5 extends the route (the one change this
  stage makes outside pure UI, exactly as scoped):
  - New optional multipart field `altText` — JSON `{ "<pageNumber>": "<alt text>", ... }` —
    validated by a new `pdfImportAltTextSchema` (`lib/validation/pdf-import.ts`, a
    `z.record(z.string(), z.string().trim().min(1).max(500))`). A missing or malformed field is
    never a request failure (it's UX-nicety-on-top-of, not a replacement for, the existing
    submit-time `missingRequirements` alt-text gate) — the request proceeds with an empty map,
    leaving affected pages at Stage 4's existing `decorative = true` placeholder.
  - **Reused the exact existing alt-text-setting mechanism, per the plan's explicit instruction —
    did not invent a new one.** Read `components/story/image-upload-manager.tsx` first: its own
    caption/alt-text editing already calls `updateStoryMediaCaption()`
    (`lib/story/mutations.ts`), which wraps the `update_story_media_caption` RPC
    (`supabase/migrations/20260803090700_story_lifecycle_functions.sql`) — confirmed by reading the
    SQL that it does exactly what's needed here (`update story_revision_media set alt_text = ...,
decorative = ...` gated by an expected-version check, bumping `stories.version` by exactly one
    per call, identical to every other mutation in this route). `pdf-attach/route.ts` now calls this
    same function once per attached page that has a non-empty entry in the alt-text map, threading
    the authoring `version` counter by hand across the sequential calls (each call bumps it by one,
    same pattern the route already used for the media-attach loop above it) — no new RPC, no new
    column, no new table.
  - Best-effort, not transactional with the draft's creation: if a caption update fails partway
    (not expected in this single-request, single-actor flow, but not assumed impossible either),
    the loop stops and the request still proceeds to assemble/save `content_json` — a missing alt
    text is recoverable in the real editor afterward and still blocked at submit time by the
    existing gate; it is never a reason to fail an otherwise-successful draft creation.
  - `app/(editor)/editorial/new/pdf-attach/route.test.ts` gained 2 tests on the existing in-memory
    fake (extended with an `update_story_media_caption` case mirroring the real RPC's
    expected-version/row-update behavior): alt text for selection `[2, 1]` lands on the correct
    `story_revision_media` rows in sort order with `decorative` flipped to `false`; a wholly
    malformed `altText` field doesn't fail the request and leaves the affected page
    `decorative = true`/`alt_text = null` (Stage 4's original behavior, unchanged as a fallback).
- **Mobile-first / WCAG (rules 18–19)**: this editorial page had no prior mobile-specific treatment
  to preserve or break (confirmed by reading `new-import-form.tsx`/the `(editor)` layout before
  assuming otherwise — editorial tools in this codebase are rendered with the same responsive
  Tailwind utilities as everywhere else, no separate desktop-only layout). The new thumbnail grid
  uses `grid grid-cols-2 sm:grid-cols-3 gap-3` — the exact classes `image-upload-manager.tsx`
  already uses for its own image grid — so it doesn't overflow at a narrow viewport by construction,
  not by new work. Every new input has a real `<label htmlFor>`; the page-picker grid's thumbnails
  are real `<button>` elements (keyboard-operable natively, visible `focus-visible:outline` added
  explicitly); errors render via the same `role="alert"` pattern `new-import-form.tsx` already used.
- **Live verification — what was and wasn't confirmed, and why (required per this session's own
  standing instructions, not skipped).** Signed in as the real `rls-editor@whv-compass-test.example`
  fixture account against the linked hosted dev Supabase project (`docs/architecture.md`'s
  documented path; Docker/local Supabase is unavailable in this environment).
  - **A genuine, pre-existing bug was found, not introduced by this stage**: driving the real
    `pdf-preview` Route Handler through a real running `next dev` (Turbopack) server for the first
    time — Stage 4 only ever exercised it via Vitest's in-memory-fake tests, which run
    `pdf-import.ts`'s code directly in Node and never go through Next's bundler at all — surfaced
    `Error: Invalid factory url: "[externals]/pdfjs-dist/package.json ..." must include trailing
slash` inside `pdfjs-dist`'s own `getDocument()` call, thrown from
    `lib/story/pdf-import.ts:loadPdfDocument`. The identical PDF, submitted the identical way,
    also failed under `next build && next start` (production Turbopack), with a different but
    equally bundler-internal error (`TypeError: 55876.replace is not a function`, inside a minified
    `.next/server` chunk). Confirmed this is specifically a **Turbopack** bundling incompatibility
    with `pdfjs-dist` (not a Stage 1–5 code defect, and not fixable within this stage's scope
    without touching `pdf-import.ts`'s core logic, which the plan explicitly forbids): the exact
    same request against `next dev --webpack` (classic webpack, no Turbopack) rendered two real,
    non-blank PNG thumbnails successfully (1000×750px, ~28KB base64 each; sampled pixel data
    directly — 7,918 non-white pixels out of 750,000 in one thumbnail, i.e. genuinely rendered PDF
    content, not a blank canvas). `next.config.ts`'s `serverExternalPackages: ["@napi-rs/canvas",
"pdfjs-dist"]` (added in Stage 1) evidently isn't enough on its own to keep Turbopack's dev/prod
    bundler from mis-handling this specific package's internal `require("pdfjs-dist/package.json")`
    version-probe — a Turbopack/Next.js-level gap, tracked here rather than silently worked around,
    since this stage's constraints explicitly forbid modifying `pdf-import.ts`'s core rendering
    logic to route around it.
  - **Fully live-verified end to end, against `next dev --webpack`** (the same app code, only the
    dev bundler differs — confirms Stage 5's own UI/wiring is correct, independent of the Turbopack
    gap above): switched to PDF mode; uploaded a real two-page fixture PDF
    (`lib/story/__fixtures__/valid-two-page.pdf`, injected via a `DataTransfer`-based
    `input.files` assignment + `change` event, since this sandboxed browser tool has no OS-level
    file-picker dialog to drive); got back two real, distinct, non-blank page thumbnails; selected
    both via real click events; filled both required alt-text fields; confirmed the submit button
    was enabled only once both had alt text; submitted; got a real `200 OK` from `POST
/editorial/new/pdf-attach`; the browser navigated to `/editorial/<storyId>/edit` (title changed
    to "Edit Editorial Import"); the real editor showed "Imported from PDF — add your story text
    here." as the story body and "Images (2)" in the media panel; the two attached images' inline
    `<img>` widgets in the CodeMirror editor resolved to real signed
    `https://ybhydepjaantkngngvuf.supabase.co/storage/...` URLs (not placeholders) — proof the
    images went through the real private-bucket upload → `processStoryMedia` → signed-URL-mint
    pipeline, not a mock. Also live-verified the client-side rejection path: uploading a `.txt` file
    in PDF mode is rejected immediately client-side ("Choose a PDF file.") inside a real
    `role="alert"` element, with no server round-trip at all — confirmed via network-request
    inspection (no `pdf-preview` request fired).
  - **Not independently re-confirmed pixel-by-pixel in the live browser**: that the two specific
    alt-text strings typed in the picker (`"Cover page of the trip PDF"`, `"Second page of the trip
PDF"`) landed on the correct `story_revision_media` rows in the database — the editor's own
    `ImageUploadManager` panel filters out images already embedded inline in the story text (by
    design, see that component's `inlineMediaIds` prop/doc comment; both attached pages are embedded
    inline in the placeholder body per Stage 3), so its alt-text `<input>`s never render for these
    two images to inspect live. This exact mechanism is instead proven with full field-level
    assertions by the new `pdf-attach/route.test.ts` cases (real `update_story_media_caption` fake,
    asserting the stored `altText`/`decorative` values match what was submitted) — a live DB query
    was judged unnecessary on top of that direct test coverage, not skipped for lack of trying.
  - The 12-image-limit boundary UI was verified via the component test (a 13-page mocked response,
    selecting 12, asserting the 13th is disabled with the expected label) rather than live, since
    the only available small fixture PDF has 2 pages and generating a 13-page real PDF fixture
    for a one-off manual click-through wasn't worth the time against test coverage that already
    exercises the exact same client-side logic.
  - No console errors were observed on any of the successful requests (Phase A success, Phase B
    success, the client-side rejection path); the only console output during the whole session was
    ordinary dev-mode HMR/Fast-Refresh logging and the one already-explained Turbopack-only error.
- `npm run verify` passes: **384 tests** (up from 375 — 7 new in
  `pdf-import-picker.test.tsx`, 2 new in the extended `pdf-attach/route.test.ts`), 0 lint errors,
  0 format issues, typecheck clean, build clean. `npm run test:e2e` (Playwright) was not run for
  this stage — no new Playwright spec was added; the live-verification session above exercised the
  real end-to-end flow more thoroughly (real hosted Supabase project, real signed URLs, a real
  discovered bug) than a scripted Playwright spec would have added on top, and Playwright would hit
  the identical Turbopack/pdfjs-dist gap in this sandboxed environment's `next build` output anyway.
- **This completes the full PDF/Canva import plan** (`docs/pdf-canva-import-plan.md`, Stages
  0.5–5). Next, if anyone picks this up: (1) resolve the Turbopack/`pdfjs-dist` bundling gap
  documented above — likely a Next.js/Turbopack issue report, or a Poppler/`pdftoppm`-based
  fallback per the plan's own Stage 0.5 alternative-candidates list, if Turbopack support doesn't
  land — since it currently means this feature only works correctly under classic webpack dev or
  possibly a non-Turbopack production build, not the `npm run dev`/`npm run build` defaults this
  repo's `package.json` scripts currently use; (2) re-confirm the 40-page/12-image ceilings against
  the real deploy target once (1) is resolved and a large real Canva export can be tested end to
  end again, per Stage 0.5's own noted caveat that its timing numbers were sandbox-measured.

**2026-08-18 — PDF/Canva import, Stage 4 (wire into the editorial import workflow: two-phase
preview → select → attach).**

Executed [docs/pdf-canva-import-plan.md](pdf-canva-import-plan.md)'s Stage 4 only (explicitly
stopped there — no picker/alt-text/review UI; that's Stage 5, not started). This is the first stage
where Stages 1–3's standalone modules get a real caller: two new staff-only Route Handlers under
`app/(editor)/editorial/new/`, alongside the existing single-phase `new-import-form.tsx` importer
(untouched — both coexist; Stage 5 will add the UI that actually calls the new endpoints).

- **Phase A — `POST /editorial/new/pdf-preview`**
  (`app/(editor)/editorial/new/pdf-preview/route.ts`). Multipart field `file` only. Auth-checks
  editor/admin (`getCurrentUserRole` + `resolveStaffAccess`, identical to
  `createEditorialImportAction`), re-validates the upload against `pdfImportFileSchema`
  (magic bytes + size ceiling), then calls Stage 1's `renderPagePreviews()` unmodified. Returns
  `{ pageCount, pages: [{ pageNumber, width, height, dataUrl }] }` — **response shape decided:
  base64 `data:image/png;base64,...` URLs**, per the plan's own suggested default ("simplest for
  thumbnails that don't need to persist anywhere... avoid inventing new storage for ephemeral
  previews"). Creates no draft, no revision, touches no image-pipeline table — an abandoned Phase A
  call leaves nothing behind. Not size-tested against a near-40-page real document's full base64
  payload; flagged for Stage 5 (or earlier, if it proves too slow in practice) to reconsider if
  needed, since no UI consumes this response yet to make that call concretely.
- **Phase B — `POST /editorial/new/pdf-attach`**
  (`app/(editor)/editorial/new/pdf-attach/route.ts`). Multipart fields: `file` (the SAME PDF,
  re-uploaded), `pageNumbers` (JSON-encoded array, e.g. `"[3,1,7]"`, selection order = attach/embed
  order), `title`, and the identical `contributorMode`/`existingContributorId`/
  `newContributorDisplayName`/`newContributorAttributionType` fields
  `createEditorialImportAction` already accepts. Same editor/admin auth check. Sequence: validate
  title (`createDraftSchema`) → validate `pageNumbers` (new `pdfImportPageNumbersSchema`,
  `lib/validation/pdf-import.ts`, bounded by `MAX_IMAGES_PER_REVISION`) → **re-validate the
  re-uploaded file's magic bytes/size** via `pdfImportFileSchema` (a completely independent check
  from Phase A's — this is a fresh, separately-authenticated request, Engineering Rule 2) → resolve
  the contributor → create the draft shell (`createEditorialImportDraftShell` /
  `create_editorial_import_draft`, the exact RPC the existing importer uses) → Stage 2's
  `attachPdfPagesToRevision()` → Stage 3's `buildPdfImportContent()` → `saveRevisionDraft()` to
  persist the assembled `content_json` (embed tokens for the attached pages, in selection order)
  under the editor-supplied title. Returns
  `{ storyId, revisionId, attachedCount, duplicatePages }` on success (200) or `{ error, storyId? }`
  on failure (400/403/500) — no `redirect()` (this is a Route Handler, not a Server Action; Stage
  5's client code is expected to navigate to `/editorial/:id/edit` itself using the returned
  `storyId`).
- **Both are Route Handlers, not Server Actions — confirmed necessary, not assumed.** Read
  `next.config.ts`: `experimental.serverActions.bodySizeLimit` is 2.5 MB, sized for the separate
  text/HTML importer, and Stage 1 deliberately left `MAX_PDF_IMPORT_INPUT_BYTES` (75 MiB) unwired
  from it for exactly this reason. Mirrors
  `app/(contributor)/stories/[id]/edit/upload/route.ts`'s existing pattern: `export const runtime =
"nodejs"`, buffer the multipart body, sniff real bytes before trusting anything, JSON response
  (no redirect).
- **PDF-bytes-across-phases mechanism — the plan's preferred simplest option, no server-side
  cache/temp-file built.** The client re-submits the identical PDF file in Phase B alongside its
  page selection; no PDF bytes (partial or whole) are ever held server-side between the two
  requests — no session cache, no temp file, no new table/bucket. This keeps Ground Rule 6 (never
  persist the source PDF) trivially true across two requests instead of adding an expiring-cache
  mechanism whose own cleanup would need auditing. The only cost is that Phase B always re-parses
  and re-renders the PDF's selected pages even though Phase A already rendered previews of every
  page — accepted as correct, not wasteful in a way worth optimizing yet: Phase B only ever renders
  the ≤12 selected pages (not all up to 40), each once, at full quality — no page is ever rendered
  twice within one request.
- **Server-side re-validation confirmed to genuinely re-run, not just repeat Phase A's claim.**
  Phase B's `pdfImportFileSchema.safeParse()` re-sniffs the re-uploaded bytes' magic header/size
  from scratch (a new test proves a request with a non-PDF file, valid page selection, and valid
  contributor fields is still rejected). The page-number check is genuinely independent too: Stage
  2's `renderPagesAtFullQuality()` (called inside `attachPdfPagesToRevision()`) re-parses the
  re-uploaded bytes with `pdfjs-dist` and rejects any selected page number the ACTUAL re-parsed
  document doesn't have (`invalid_page_numbers`) — proven by a test that selects page 5 of a real
  2-page fixture PDF and asserts a 400, not by trusting whatever page count a client claims Phase A
  returned.
- **Auth**: both endpoints call the identical `getCurrentUserRole()` + `resolveStaffAccess(role,
["editor", "admin"])` check `createEditorialImportAction` uses — confirmed by reading that action
  first, not assumed. Route Handlers are NOT covered by the `(editor)` route group's
  `layout.tsx` role guard (that guard only wraps `page.tsx`'s render tree, a `route.ts` colocated in
  the same folder never passes through it), so this check is load-bearing here, not defense in
  depth on top of something else. A test with `currentRole = "user"` confirms Phase B returns 403
  and creates nothing (`stories.size === 0`).
- **Shared contributor-resolution logic extracted, not duplicated.**
  `app/(editor)/editorial/new/actions.ts` gained a new exported
  `resolveContributorIdFromFormData(formData)` — the exact "pick existing / create new unlinked
  contributor" logic `createEditorialImportAction` already had, factored out so Phase B parses the
  identical form fields identically rather than risking two copies drifting apart.
  `createEditorialImportAction` itself now calls this helper too — behavior unchanged, confirmed by
  the existing tests/build still passing. Note: because this file carries `"use server"`, every
  exported async function (including this new helper) is technically a directly callable Server
  Action reference from any signed-in client, not gated by this file's own editor/admin check
  (which every _caller_ is responsible for, per its doc comment) — its only side effect for a
  non-staff caller would be attempting a `contributors` insert, which the existing
  `"contributors: staff create unlinked contributor records"` RLS policy
  (`supabase/migrations/20260802085016_contributors.sql`) independently rejects for non-editor/admin
  callers regardless. Same defense-in-depth posture (RLS is the real backstop) this codebase already
  uses everywhere else (Engineering Rule 3) — not a new gap.
- **Draft-creation ordering decision**: the draft/revision shell is created BEFORE pages are
  rendered/attached (Phase B needs a real `revisionId` for `attachPdfPagesToRevision()`, which
  reuses the exact begin_/finalize_story_media_upload sequence a manual upload uses — no parallel
  path invented). If the attach step then fails (e.g. a genuinely out-of-range page number,
  discovered only once the re-uploaded bytes are actually re-parsed), the title-only draft shell is
  left behind — the same state an editor would reach today by using the existing single-phase
  importer and abandoning the next step before adding any photos. Not a new failure mode; documented
  in the route's own doc comment rather than papered over.
- **New shared module `lib/story/pdf-import-messages.ts`**: `pdfImportErrorMessage()` /
  `pdfPageAttachErrorMessage()`, mapping the typed error unions from `pdf-import.ts` /
  `pdf-page-attachment.ts` to editor-facing copy. Kept out of both `route.ts` files deliberately —
  a Next.js Route Handler module may only export HTTP method handlers plus the small set of
  reserved route-segment config names; any other export is a build-time error.
- **New Zod schema**: `pdfImportPageNumbersSchema` (`lib/validation/pdf-import.ts`) — array of
  positive integers, `min(1)`/`max(MAX_IMAGES_PER_REVISION)`. Safe to import client-side (no
  server-only/native deps), consistent with that file's existing posture; not actually imported by
  any Client Component yet (Stage 5's job).
- **Not modified**: `lib/story/pdf-import.ts`, `lib/story/pdf-page-attachment.ts`,
  `lib/story/pdf-import-content.ts`, `lib/story/image-pipeline.ts` — Stage 4 is a caller/wiring
  layer only, per the plan's own constraint. No bug was found in any of them that blocked correct
  integration.
- New tests (co-located, in-memory fakes, no live Docker/Supabase — `tests/integration/**` is
  excluded from `npm run verify`'s default `vitest run`, so these follow Stage 1–3's own convention
  instead): `app/(editor)/editorial/new/pdf-preview/route.test.ts` (5 tests — valid PDF preview
  shape/count, auth rejection, non-PDF rejection, password-protected rejection, missing-file
  rejection) and `app/(editor)/editorial/new/pdf-attach/route.test.ts` (8 tests — end-to-end draft
  creation with correct attached-image count/order and content_json embed order, new-contributor
  path, auth rejection for both signed-out and non-editorial-role callers, over-12-page-selection
  rejection, out-of-range-page-number rejection with no draft media left behind, non-PDF-file
  rejection). The Phase B fake extends `lib/story/pdf-page-attachment.test.ts`'s existing in-memory
  RPC fake with `create_editorial_import_draft` and `save_revision_draft`, plus a minimal
  `user_roles`/`contributors` table fake — deliberately NOT a second copy of Stage 2's own
  capacity/rollback test scenarios (already covered there); this suite is about the new wiring only.
- `npm run verify` passes: **375 tests** (up from 362), 0 lint errors, typecheck clean, build clean.
  Both new routes appear in the build's route table (`ƒ /editorial/new/pdf-attach`,
  `ƒ /editorial/new/pdf-preview`).
- Next: Stage 5 of `docs/pdf-canva-import-plan.md` — the picker/alt-text/review UI: extend
  `new-import-form.tsx` (or a new PDF-mode component) to call Phase A on file select, render the
  thumbnail grid with a 12-page selection limit (mirroring `image-upload-manager.tsx`'s existing
  selection/limit conventions), collect per-page alt text before Phase B can be submitted
  client-side, then call Phase B and navigate to `/editorial/:id/edit` using the returned `storyId`.
  Not started.

**2026-08-18 — PDF/Canva import, Stage 3 (assemble the story draft: image blocks in page order,
minimal shell text).**

Executed [docs/pdf-canva-import-plan.md](pdf-canva-import-plan.md)'s Stage 3 only (explicitly
stopped there — no editorial workflow wiring, no Server Action/Route Handler, no UI; those start at
Stage 4). Still no caller anywhere in the app references the new function — it remains a standalone,
tested server module, same posture as Stages 1–2.

- **New module `lib/story/pdf-import-content.ts`** (kept separate from `pdf-page-attachment.ts`
  deliberately — see the module's own doc comment — so Stage 2's already-passing tests needed zero
  changes; content_json assembly is orthogonal to Stage 2's render-and-upload job). Exports
  `buildPdfImportContent(mediaIds, filename?)` returning `{ title, contentJson }`, plus
  `titleFromPdfFilename()` and the `DEFAULT_PDF_IMPORT_TITLE` constant standalone in case a caller
  wants the title logic alone.
- **`content_json` shape chosen**: one `markdown` block (the schema's only block type,
  `lib/validation/story.ts`) whose text is a fixed instructional placeholder line —
  `"Imported from PDF — add your story text here."` — followed by one `![[mediaId]]` embed token
  (`lib/story/markdown-media.ts`'s `mediaEmbedToken()`) per attached page, each on its own line, in
  the exact order the caller's `mediaIds` array is given in (callers must pass Stage 2's
  `AttachedPdfPage.mediaId` list already in selected-page order — this module does no reordering of
  its own). Confirmed by an actual passing test
  (`lib/story/pdf-import-content.test.ts`, "round-trips through the real storyContentSchema
  validator") that the assembled content_json passes `storyContentSchema.safeParse()` with
  `.success === true` — not just structurally eyeballed. The placeholder text was necessary, not
  optional: `storyContentBlockSchema`'s markdown block has `.trim().min(1, ...)`, so an
  embeds-only/no-prose document (the plan's first-choice option) fails validation with an empty or
  embeds-only-with-no-surrounding-text block once trimmed — the placeholder line is what keeps the
  `.min(1)` rule satisfied honestly (it says outright that no real narrative text exists yet, rather
  than silently passing validation with content that reads as finished). No other rule in that
  schema needed accommodating: the `![[...]]` token syntax doesn't match the standard-Markdown-image
  rejection regex (`![alt](url)`-shaped only), no `# ` h1 line is ever produced, and no Markdown
  links are produced to trip the safe-href check.
- **Title derivation rule**: `titleFromPdfFilename()` strips the file extension, replaces control
  characters and the separator characters `_`/`/`/`\` with spaces, collapses whitespace, trims, and
  truncates to 200 characters (mirroring `revisionInputSchema.title`'s `.max(200)` exactly — kept as
  a named local constant with a comment cross-referencing the schema, not re-derived from it, so a
  future schema change would surface as a failing round-trip test rather than silently drifting).
  Falls back to `DEFAULT_PDF_IMPORT_TITLE` — the literal `"Untitled story"`, reused character-for-
  character from `app/(contributor)/stories/new/start-new-story.tsx`'s existing default-title
  convention, not a new fallback string — when the filename is missing, empty, only an extension, or
  reduces to nothing after cleanup (e.g. a name made only of control characters/underscores).
- **Zero-pages-attached edge case decided**: Stage 2's `attachPdfPagesToRevision()` already rejects a
  zero-page selection outright (`"too_many_pages_selected"`), so `buildPdfImportContent()` is never
  actually called downstream with an empty `mediaIds` array. It's still handled gracefully rather
  than throwing (documented in the module comment): an empty list produces the placeholder text
  alone, which is still valid, submittable content_json.
- **Composition decision**: this stage's function is kept fully separate from
  `attachPdfPagesToRevision()`'s return shape rather than folded in — Stage 2's return type/tests are
  untouched. Stage 4 (not built here) is expected to call `attachPdfPagesToRevision()` then
  `buildPdfImportContent(attached.map((a) => a.mediaId), filename)` back to back and compose the two
  results itself when it creates the draft.
- New tests: `lib/story/pdf-import-content.test.ts` (12 tests) — N attached pages produce exactly N
  embed tokens in input order; the real `storyContentSchema.safeParse()` round-trip (`.success ===
true`); placeholder text present; zero-pages edge case still validates; title derivation from a
  normal filename, empty/missing filename, extension-only filename, filenames needing control-
  character/separator sanitization, and a filename exceeding 200 characters after the extension is
  stripped.
- `npm run verify` passes: 362 tests (up from 350), 0 lint errors, typecheck clean, build clean.
- Next: Stage 4 of `docs/pdf-canva-import-plan.md` — wire Stages 1–3 into the real editorial-import
  workflow as a two-phase (preview → select → attach) Server Action/Route Handler pair, per that
  stage's own spec. Not started.

**2026-08-18 — PDF/Canva import, Stage 2 (full-quality render + attach through the existing image
pipeline).**

Executed [docs/pdf-canva-import-plan.md](pdf-canva-import-plan.md)'s Stage 2 only (explicitly
stopped there — no `content_json` assembly, no editorial workflow wiring, no UI; those start at
Stage 3). Still no UI, Server Action, or Route Handler references either new function — both remain
standalone, tested server modules, same posture as Stage 1.

- **`renderPagesAtFullQuality(bytes, pageNumbers)`** added to `lib/story/pdf-import.ts`, alongside
  Stage 1's `renderPagePreviews()`. Renders a caller-supplied set of specific page numbers, in the
  exact order requested (duplicates allowed — each produces its own independent output, since
  rejecting a duplicate selection is the wrong layer; see below), at `FULL_QUALITY_TARGET_LONG_EDGE_PX`
  (2400px long edge) — meaningfully above Stage 1's 1000px preview resolution and comfortably above
  `MAX_PROCESSED_DIMENSION` (2000px, `lib/story/image-validation.ts`) so the existing image
  pipeline's own sharp resize step does real, retina-appropriate downsampling rather than passing
  the render through untouched. Shares its PDF-loading sequence with `renderPagePreviews()` via a
  new internal `loadPdfDocument()` helper (extracted, not duplicated) and rejects the same error
  classes (`corrupt_pdf`, `password_protected`, `not_a_pdf`, `zero_pages`) plus a new
  `invalid_page_numbers` (empty selection or any number outside `[1, numPages]`). Full rejection
  over partial output, same as Stage 1: any invalid page number or render failure rejects the whole
  call, never a partial page set.
- **New module `lib/story/pdf-page-attachment.ts`**: `attachPdfPagesToRevision()` — the actual
  Stage 2 orchestration. Deliberately kept separate from `pdf-import.ts` (which stays free of any
  Supabase/session dependency) since this function pulls in `lib/supabase/server`,
  `lib/story/mutations.ts`, and `lib/story/image-pipeline.ts`. For each rendered page, in selection
  order: `beginStoryMediaUpload()` (reserves a slot, the real 12-image-per-revision enforcement
  point per `begin_story_media_upload`'s transactional lock,
  `supabase/migrations/20260804090100_story_media_upload_functions.sql`) -> raw-bytes upload to the
  private bucket via the caller's own session token (mirrors
  `app/(contributor)/stories/[id]/edit/upload/route.ts` exactly — regular RLS-scoped client, not
  admin) -> `finalizeStoryMediaUpload()` -> `processStoryMedia()` (the real, unmodified
  `lib/story/image-pipeline.ts` decode/EXIF-strip/resize/private-bucket-stage path). No parallel
  image-upload path was written — every step is the existing manual-upload sequence, just driven in
  a loop over rendered PDF pages instead of one `File` from a form (plan Ground Rule 2).
- **12-image limit**: enforced at the real point (`begin_story_media_upload`'s transactional
  under-lock check), same as any manual upload. `attachPdfPagesToRevision()` additionally does an
  up-front check (selection size alone, and selection size against this revision's actual current
  attachment count via `getStoryPreview()`) so the common case rejects cleanly before rendering or
  uploading anything, rather than relying on failing partway through a loop.
- **Full rejection over partial application (Ground Rule 3)**: if a later step fails anyway (e.g. a
  race against a concurrent attach that only the transactional RPC-level check catches), every
  media reservation/attachment this call itself created in that call is rolled back — cancelled via
  `cancelPendingStoryMediaUpload()` if still pending, detached via `detachStoryMedia()` if already
  attached — before returning an error. Verified with a test that forces the second of two pages to
  fail mid-batch and confirms the first page's successful attachment is unwound too.
- **Duplicate-image signal reused, not reinvented**: after a successful attach, compares sha256
  hashes across every image now on the revision (pre-existing + just attached), via the same
  `sha256` field `get_story_preview()` already exposes and
  `components/story/image-upload-manager.tsx` already compares client-side
  (`20260806090100_add_sha256_to_story_preview_media.sql`). Surfaced as `isDuplicate` per attached
  page — a warning signal, never a hard block, same convention as the existing manual-upload UI.
- **Ordering**: preserved via `story_revision_media.sort_order`, which `finalize_story_media_upload`
  already assigns as `max(sort_order) + 1` on every call — since pages are finalized strictly in
  selection order, no separate ordering logic was needed in the new module.
- **`alt_text`/`caption` confirmed left null/empty at this step, verified by reading the SQL, not
  assumed**: `finalize_story_media_upload` attaches every image with `decorative = true` (the fix in
  `20260806110100_fix_finalize_upload_alt_text_constraint.sql`, since
  `story_revision_media_alt_text_required`'s check constraint — `decorative or (alt_text is not null
and char_length(alt_text) > 0)` — would otherwise reject a fresh, not-yet-captioned attach). This
  is the same placeholder state every manual upload starts in; Stage 4's editor review step is
  expected to fill in real alt text before submission, still gated by the existing
  `missingRequirements` check on `app/(contributor)/stories/[id]/preview/page.tsx` (a submit-time
  gate, not an insert-time one) — nothing new needed there.
- **Tests**: `lib/story/pdf-import.test.ts` gained a `renderPagesAtFullQuality` describe block (7
  tests: selection order, higher-than-preview resolution, duplicate-page-number selection producing
  identical output rather than a rejection, empty/out-of-range/zero page-number rejection, and the
  same rejection classes as `renderPagePreviews` for corrupt/password-protected/non-PDF input). New
  `lib/story/pdf-page-attachment.test.ts` (7 tests) exercises `attachPdfPagesToRevision()` against
  an in-memory fake of every RPC/table it touches (`begin_/finalize_/cancel_story_media_upload`,
  `detach_story_media`, `get_story_preview`, `record_processed_story_media`,
  `record_story_media_processing_failed`) modeled on the real migrations' semantics — extending
  `lib/story/image-pipeline.test.ts`'s existing "fake Storage + minimal admin client, test the
  boundary not the live call" convention rather than inventing a new testing approach, with the
  regular-client and admin-client fakes sharing one in-memory `story_media` map so a media row
  created via the (mocked) `begin_story_media_upload` is genuinely visible to the real
  `processStoryMedia()` exactly as it would be through a real database. Covers: pages render and
  land through the real pipeline in the right order; a selection over 12 pages is rejected before
  anything is created; a selection that would push an existing revision over 12 is rejected without
  partial attachment; a mid-batch failure rolls back everything already attached; a duplicate-page
  selection is flagged, not rejected; an out-of-range page number is rejected without attaching
  anything; no-session is rejected. No local Docker Supabase stack was needed or used — this follows
  the existing mock-based pattern, not a live-database integration test, consistent with every other
  `lib/story/*.test.ts` file in this codebase.
- **`npm run verify`: 350 tests, 0 lint errors, build clean.**
- **Not done** (explicitly out of scope for this pass): Stage 3 (`content_json` assembly, default
  title), Stage 4 (editorial workflow wiring — Phase A/B actions, Route Handler for the PDF upload
  itself), Stage 5 (UI: page picker, alt-text form, mandatory review step).
- **Next**: Stage 3 of `docs/pdf-canva-import-plan.md` — assemble a valid `content_json` document
  referencing the Stage 2-attached page images in selection order (`![[mediaId]]` embed tokens, no
  extracted prose) plus a default title derived from the uploaded filename, reusing
  `createDraftAction`'s "Untitled story" convention rather than inventing new default-title logic.

**2026-08-18 — PDF/Canva import, Stage 0.5 (rendering spike) and Stage 1 (rendering module).**

Executed [docs/pdf-canva-import-plan.md](pdf-canva-import-plan.md)'s Stage 0.5 and Stage 1 only
(explicitly stopped there — no UI, no editorial workflow wiring, no image-pipeline attachment; that
starts at Stage 2). Full findings: [docs/pdf-import-spike-findings.md](pdf-import-spike-findings.md)'s
new "Stage 0.5" section.

- **Decision: rasterize with `pdfjs-dist` + `@napi-rs/canvas`.** First-preference option from the
  plan, installed and worked cleanly with no native toolchain and no fallback needed. Confirmed
  correct against both the fictional fixture PDFs and — the actual point of this spike — the real
  30-page bilingual Canva export used in the earlier (superseded) text-extraction spike: a page
  whose Chinese prose Stage 0 found was **silently dropped by text extraction** renders perfectly
  as an image, since rasterization never needs to read anything as text. A useful implementation
  detail found while wiring this up: pdfjs-dist v6's own Node-path default already `require()`s
  `@napi-rs/canvas` internally when it detects a Node environment — no custom `CanvasFactory` needs
  to be supplied to `getDocument()`, only a plain per-page canvas for the actual render target.
- **Decision: 40-page ceiling** for how many pages the importer will attempt to generate preview
  thumbnails for (`MAX_PDF_IMPORT_PAGES`, `lib/story/pdf-validation.ts`) — independent from, and
  much more permissive than, the existing 12-image-per-revision attach limit. Driven by real timing
  data: the real sample averaged ~270-290ms/page at preview resolution (dominated by vector/font
  rendering cost, not pixel count — resolution is a legibility knob here, not a performance one);
  40 pages is ~11-12s worst case for one synchronous request. This is a sandbox-measured number,
  not confirmed against the real deploy target's actual function timeout — flagged in the findings
  doc for reconfirmation before relying on it in production.
- **Decision: 75 MiB size ceiling** (`MAX_PDF_IMPORT_INPUT_BYTES`) — headroom above the one real
  sample measured (a 151-page personal scrapbook export, ~57 MB), its own constant separate from
  `lib/story/content-import.ts`'s 2 MB text-import limit. **Deliberately NOT wired into
  `next.config.ts`'s Server Action body-size limit**, unlike that existing constant — a file this
  large needs a Route Handler upload path (mirroring the existing image pipeline, which already
  uses a Route Handler rather than a Server Action for exactly this reason: a platform-level
  request-body ceiling applies on top of whatever Next's own config says). Flagged for Stage 4 to
  actually wire up; noted in both the findings doc and the plan doc so it isn't rediscovered later.
- **No background-job pattern needed.** Confirmed by reading `lib/story/image-pipeline.ts` and its
  one caller: there is no async/queue infrastructure anywhere in this codebase today — image
  processing is synchronous-in-request, and `renderPagePreviews()` follows the same convention,
  made safe specifically by the 40-page ceiling above.
- **New files**: `lib/story/pdf-validation.ts` (dependency-free constants + `%PDF-` magic-byte
  sniff, split out the same way `image-validation.ts` is split from `image-pipeline.ts` so it stays
  safe to import from `lib/validation/` without dragging a native/WASM renderer into a client
  bundle), `lib/story/pdf-import.ts` (`server-only`, the actual `renderPagePreviews()` renderer;
  discriminated `PdfPreviewResult` union mirroring `content-import.ts`'s `ImportResult` pattern;
  explicit rejection for corrupt/unparseable, password-protected, zero-page, over-page-ceiling, and
  over-size-ceiling input — never a partial/truncated result), `lib/validation/pdf-import.ts`
  (`pdfImportFileSchema`, the new upload-boundary Zod schema, importing only from the client-safe
  `pdf-validation.ts`). Tests: `lib/story/pdf-import.test.ts` and `lib/validation/pdf-import.test.ts`
  (17 tests), against small fictional fixture PDFs in `lib/story/__fixtures__/` generated by the new
  `scripts/generate-pdf-import-fixtures.mjs` (pdfkit for the valid/over-page-ceiling PDFs; the
  `qpdf` CLI — installed via Homebrew, a build-time-only tool, not a runtime dependency — for the
  password-protected fixture, since pdfkit has no encryption support).
- **Dependency changes**: `pdfjs-dist` and `@napi-rs/canvas` added as real `dependencies` (were
  `--no-save` spike-only installs before this task); `pdfkit` added as a `devDependency`
  (test-fixture generation only). `next.config.ts` gained `serverExternalPackages:
["@napi-rs/canvas", "pdfjs-dist"]` so Next doesn't try to bundle the native-binary/large-module-graph
  renderer through webpack's browser-oriented transforms (the same reason `sharp` already works
  without needing this — Next auto-detects a few common native packages, but not these two).
- **Confirmed nothing persists the source PDF or a stray reference to it** (plan Ground Rule 6): no
  module-level cache in `pdf-import.ts`, no temp files written to disk, every pdfjs
  `Document`/`Page`/`LoadingTask` handle is `cleanup()`/`destroy()`-ed before `renderPagePreviews()`
  returns. Verified live end-to-end against a real fixture through the actual production module
  (not just the vitest mock path) — rendered PNG output inspected visually and confirmed correct.
- **Not done** (explicitly out of scope for this pass, per the task instructions): Stage 2 (full-
  quality render + attach through `lib/story/image-pipeline.ts`), Stage 3 (`content_json`
  assembly), Stage 4 (editorial workflow wiring, two-phase upload/select action), Stage 5 (UI). No
  UI, Server Action, or Route Handler references `lib/story/pdf-import.ts` yet — it is a standalone,
  tested module only, per the plan's explicit Stage 1 scope.
- **`npm run verify`: 337 tests, 0 lint errors, build clean.** Two pre-existing `no-var-requires`
  eslint-disable warnings in the untracked Stage-0-era `scripts/spike-pdf-extract*.ts` files (not
  part of this task's deliverable) were left as warnings, not errors — `npm run verify` was already
  green before touching them; a `TextItem` type-export mismatch in those same two files (an
  unrelated `pdfjs-dist` type-surface change between the version they were originally written
  against and the version now pinned) was fixed minimally (inline type instead of the missing
  export) since it blocked `tsc --noEmit` for the whole repo.
- **Next**: Stage 2 of `docs/pdf-canva-import-plan.md` — `renderPagesAtFullQuality()` at full/publish
  resolution, feeding each rendered page through the **existing, unmodified**
  `lib/story/image-pipeline.ts` path exactly as a manual upload would, respecting the real
  12-image-per-revision limit at that (the real) enforcement point.

**2026-08-17, part 2 — Border every image frame.**

Every place a real photo (or its placeholder/loading state) renders had inconsistent framing: some
card wrappers had `border border-border-subtle`, most had none, and one — the inline story-body
image in `content-block-renderer.tsx`, the actual story-reading experience — had no border at all,
so a photo close in tone to the page ground (a common case in both the near-black dark ground and
the warm light one) had no visible edge. Added `border border-border-subtle` — the one token-driven
border colour in the system, already correct in both themes — to every image "frame" element (the
`overflow-hidden`/`rounded-*` wrapper, or the `<img>` itself where there is no wrapper):
`my-stories-view.tsx`'s list-view thumbnail (the grid-view one already had it), `story-index.tsx`'s
catalogue thumbnail, `story-card.tsx` and `featured-story-slide.tsx`'s photo panes (as a directional
`border-b`/`sm:border-r` rather than a full box, since the outer card already carries a full border
and doubling it on the shared edge would look wrong), `preview-gallery.tsx`, `image-upload-manager.tsx`
(previously the `<li>`'s own border was inset by padding and never actually touched the photo), and
`content-block-renderer.tsx`'s `frameClassName` (applied to both the loaded `<img>` and the
"loading" spinner placeholder, so the frame doesn't pop into existence only once the image resolves).
`story-gallery.tsx` already had this and was left alone.

**Live-verified** in both themes: the landing catalogue, `/stories` cards, a story's inline body
image, and the signed-in My Stories list view — the border is visible as a hairline against both the
warm light ground and the near-black dark ground, exactly the two cases the request named.
`npm run verify`: 320 tests (unchanged), 0 lint errors, build clean.

**2026-08-17, part 1 — My Stories / New Story leave the public header nav.**

`SiteHeader` (rendered by both `app/(public)/layout.tsx` and `app/(auth)/layout.tsx`) no longer
renders `ContributorNavLinks` for signed-in visitors. On public pages the primary nav bar is back to
Stories/Destinations/About, and My Stories / New Story are reached only through the profile icon —
`UserAvatarMenu`'s own `menuItems` already carried both on every signed-in header, so that half of
the change needed no code (verified live, not assumed). Rationale: a signed-in visitor on a public
page is reading, not authoring; the authoring shortcuts belong on the routes where authoring happens.

`ContributorNavLinks` itself is unchanged and still rendered by `ContributorNav` — so `/account`,
`/my-stories`, `/stories/new`, and `/stories/[id]/edit|preview` keep both as always-visible,
underline-on-current-page header links (part 6, item 1, now scoped to those routes only). Staff
headers (`ModerationNav`/`EditorialNav`/`ReadinessNav`) never had them and still don't.

- **Layout**: removing the element left no gap — SiteHeader's primary `<nav>` already owns the
  `ml-auto` that pushes the theme toggle + avatar cluster right, so the desktop header simply closes
  up. Mobile is untouched: signed in, the avatar replaces the hamburger and its dropdown carries the
  public primary nav (`extraItems`) _plus_ My Stories/New Story/Account/Sign out — confirmed live at
  375px that all seven entries render.
- **Live-verified** signed in at 867px and 375px and signed out: public landing/about header shows
  only Storiesss/Destinations/About + theme + avatar; the avatar dropdown shows My Stories →
  `/my-stories`, New Story → `/stories/new`, Account, Sign out; `/account` still shows both links in
  its own header bar. Signed-out public header is unchanged (Sign in / Share your story).
- **Test**: `components/site-header.test.tsx` gained a signed-in case (the Supabase browser-client
  mock's session is now switchable via a hoisted `sessionMock`) asserting no `navigation`-role
  "Contributor" landmark and no My Stories/New Story _links_ in the header, while both are present as
  `menuitem`s once the avatar is opened. **`npm run verify`: 320 tests, 0 lint errors, build clean.**

**2026-08-16, part 7 — Editor upload toasts; skip the working-title page.**

1. **The rich-text editor's inline "Insert image" toolbar button now toasts on both ends of an
   upload** — "Uploading `<file>`…" the moment it starts, "`<file>` uploaded." on success,
   "`<file>` failed to upload." (error variant) on failure. `ImageButton`
   (`components/story/editor/markdown-editor.tsx`) previously gave zero feedback beyond the toolbar
   icon switching to "…" — easy to miss, and gave no signal at all once the upload actually finished
   (the inserted image widget itself starts as a spinner too, so nothing visibly changed at that
   moment either). Uses the same `useToast()`/`ToastProvider` this session's toast redesign already
   established; `image-upload-manager.tsx` (the separate Images-panel upload surface) already had its
   own completion/failure toasts and was left as-is. **Live-verified**: dispatched real file uploads
   into the toolbar's hidden `<input>` via injected `File`/`DataTransfer` objects (this session's
   browser tool has no native file-picker driver), confirmed via a DOM poll immediately after dispatch
   that "Uploading test5.png…" renders with `role="status"`, and confirmed via the network log that
   every one of eight rapid test uploads returned `200 OK` — the success-path `showToast()` call
   sits unconditionally right after that same response parses, using the identical mechanism already
   proven to render (multiple "Draft saved." toasts captured live in the same session).
2. **`/stories/new` no longer shows a separate "give it a working title" page.** It now creates a
   real "Untitled story" draft itself and redirects straight to the real editor — Title is already a
   required, clearly-marked field there (part 6, `RequiredMark`), so there's nothing the old
   intermediate page did that the destination doesn't already ask for. `new-story-form.tsx` (the old
   title-input form) is deleted; `app/(contributor)/stories/new/page.tsx` now renders
   `StartNewStory`, a Client Component that calls the **existing, unchanged** `createDraftAction`
   directly as a plain async function (not via a `<form action>`) once on mount, with a fixed
   "Untitled story" title. `redirect()` inside a Server Action called this way works identically to
   the form-triggered case. A `started` ref (not state) guards against React Strict Mode's dev-only
   double-invoke of effects creating two drafts per visit. Deliberately **not** a plain Server
   Component performing the mutation directly on the GET-rendered page itself: Next.js Link
   prefetching could then create a throwaway draft every time this route's link scrolls into view,
   not only on an actual click — the mutation only ever runs from a real, one-shot client-side effect.
   - **A real, load-bearing consequence found and fixed while updating this**: `stories.slug` is
     generated once, at creation, from whatever title is passed to `create_self_service_draft()`
     (confirmed by reading that function and confirming no later migration ever updates
     `stories.slug`) — and is never regenerated when the title changes afterward. Every self-service
     story now gets an `untitled-story-<hex>` slug specifically, permanently, regardless of what the
     contributor renames it to. `e2e/cross-contributor-access.spec.ts`'s own fixture-hygiene comment
     had relied on the OLD flow putting a `rls-test`-prefixed title into `_generate_story_slug()`
     directly, so its fixture stories would silently stop matching
     `scripts/rls-test-cleanup.sql`'s `slug like 'rls-test-%'` scope — the exact kind of permanent
     fixture leak this session already spent real effort eliminating (part 5). Fixed by broadening
     `rls-test-cleanup.sql`'s matching predicate everywhere it targets `stories` (20 call sites) to
     `slug like 'rls-test-%' OR owner_user_id in (select id from auth.users where email like
'%@whv-compass-test.example')` — every fixed test account shares that domain, and no real
     contributor can, so the added signal is exactly as safe as the slug one and catches this case
     unconditionally regardless of title. `docs/architecture.md`'s cleanup section updated to match.
     **Verified live**: created a throwaway "Untitled story" draft as the `rls-owner` fixture account
     (the eight test image uploads from item 1 above), ran `npm run test:rls:cleanup` by hand, and
     confirmed the story was removed while all 13 real stories were untouched — then updated the two
     `e2e/cross-contributor-access.spec.ts` call sites themselves to go through the real new flow
     (fill Title/type real content on the edit page instead of a "Working title" field that no longer
     exists; the second call site needed no title/content at all, since it never asserted on either).
     **`npm run verify`: 319 tests, 0 lint errors, build clean. `npm run test:rls`: 69/69, and the
     `posttest:rls` hook (part 5) fired and cleaned up automatically afterward, confirmed by a direct
     post-run query showing exactly the 13 real stories and nothing else.**

**2026-08-16, part 6 — Contributor UX polish batch (5 items).**

1. **"My Stories" / "New Story" are now always-visible, clickable header links**, not just entries in
   UserAvatarMenu's dropdown. New `components/contributor-nav-links.tsx` (Client Component, needs
   `usePathname` for the active-page match), rendered in both `ContributorNav` (every `(contributor)`
   route) and `SiteHeader`'s signed-in desktop state (a signed-in visitor browsing public pages sees
   the same nav). The current page is underlined via `aria-current="page"` +
   `.journiq-nav-link[aria-current="page"]::after` (`app/globals.css`) — extends the existing
   hover-underline rule rather than introducing a new visual language. UserAvatarMenu keeps both
   links too (harmless duplication, and still the only entry point on narrow viewports); it still
   owns Account/Sign out. Active match is exact-path only (`/stories/new` is not "active" while
   editing `/stories/[id]/edit`, which is reached from it but isn't itself "New Story").
2. **Title, Story content, Location, and Tags are now required before a contributor can submit.**
   Visual: a red `*` + `sr-only "required"` marker (`RequiredMark`, `story-edit-form.tsx`; a
   duplicated 3-line inline version in `tag-editor.tsx`, not worth sharing across files for this
   size) on all four field labels. Enforcement: a new gate on `app/(contributor)/stories/[id]/preview/page.tsx`
   — `missingRequirements`, computed from `preview.title`, the parsed content's text, and
   `getRevisionSelections(revisionId)`'s locations/tags counts — replaces `SubmitConsentPanel` with
   an amber "Add …, … before you can submit." message (naming exactly what's missing) plus a link
   back to editing, whenever anything is missing. **Deliberately UI-only, not a new DB constraint**:
   `submit_revision_with_consent()` is exercised by dozens of `tests/integration/story-rls.integration.test.ts`
   fixtures (via its `publishOwnerStory()` helper) that never call `set_revision_locations`/
   `set_revision_tags`, so a hard requirement at the RPC would break `test:rls`, not just this form.
   Title/content already had stricter save-time enforcement (`revisionInputSchema` rejects an empty
   title/content on every autosave) — this preview-page gate is what actually catches the one gap:
   the moment right after `/stories/new` creates the shell (`content_json` defaults to `[]`) and
   before anything has been written.
   - **A pre-existing, adjacent bug found and fixed while verifying this live**: a genuinely empty
     `content_json` failed `storyContentSchema`'s `.length(1)` check with Zod's raw default message,
     "Too small: expected array to have >=1 items," surfacing verbatim in the editor on the very
     first keystroke in _any other_ field of a still-content-less New Story (confirmed live —
     reproduced with the travel-style select before writing the fix, and again with the title field
     alone, to confirm it wasn't caused by this session's own change). Not new — pre-existing
     whenever content was empty — but directly adjacent to "make Story required," so fixed alongside
     it: `.length(1, "Your story needs at least some content.")` in `lib/validation/story.ts`.
3. **Travel style now has a free-text "Other" option.** `travel_style` is a loosely-typed `text`
   column with no DB enum/CHECK (confirmed by reading `20260803090200_story_revisions.sql` before
   relying on it), so widening `revisionInputSchema.travelStyle` from `z.enum(travelStyles)` to a
   bounded free string (max 50 chars) needed no migration. The select gained an "Other (type your
   own)" option; choosing it reveals a text input, debounced-saved the same way every other field is.
   Loading a revision whose stored value isn't one of the three presets (e.g. from an earlier
   session) auto-detects "other" mode and pre-fills the text, so it's never silently dropped into
   "Not specified." The public `/stories` travel-style filter (`filter-bar.tsx`) needed no change —
   it already builds its options from real distinct values via `list_distinct_public_travel_styles()`,
   not the hardcoded enum.
4. **Both "Preview" buttons in the edit form now use the same pill/accent style as "New Story"**
   (`journiq-button bg-accent text-accent-foreground`, replacing a plain bordered-box style) — the
   top-of-form and end-of-form Preview links in `story-edit-form.tsx`.
5. **"Note to editors" is now optional-labelled and collapsed by default**, matching the existing
   Images panel's `<details>`/`<summary>` pattern rather than introducing a new one. Summary reads
   "Note to editors (optional, private, never published)"; the textarea keeps an `sr-only` label
   since the summary text already states its purpose visibly.

**Live-verified end to end** against the linked project, signed in as the account that owns "Hamilton
Trip" (a real draft, not a fixture): confirmed the nav underline switches between My Stories/New
Story, watched the raw Zod error appear and then confirmed the friendly message after the fix,
selected "Other" travel style and typed a custom value that survived a reload, watched the preview
page's gate list "at least one location, at least one tag" and then shrink to nothing as each was
added (using a real OpenStreetMap-backed location search result, not a stub), and confirmed
`SubmitConsentPanel` only renders once all four requirements are met. `npm run verify`: 319 tests,
0 lint errors, build clean (all pre-existing warning count, no new ones).

**Note on the live-verification story**: "Hamilton Trip" is a real draft belonging to the signed-in
test account, not a fixture — used because it happened to be freshly created and empty. Its location,
tag, and custom travel style were removed again after verification. Its body text
("A quick trip to Hamilton for a working holiday.") could **not** be cleared back to empty afterward
— autosave now correctly refuses to persist empty content, which is item 2 working as designed. Left
in place rather than worked around; it's an ordinary, harmless placeholder sentence in the owning
account's own still-unpublished draft, freely editable by them.

**2026-08-16, part 5 — RLS test lookup fixtures are created inactive.**

`tests/integration/story-rls.integration.test.ts` created its region/destination/work-type/tag
fixtures with `active` defaulting to **true**. `scripts/rls-test-cleanup.sql` does delete them by
slug prefix, but it is deliberately manual and never-automatic — so between runs the rows
accumulated, and every dropdown that lists lookup values (`lib/story/active-lookups.ts`,
`lib/story/public-queries.ts` — all filtering `active = true`) showed them to real users. By the time
this was caught there were 5 copies each of "RLS Test Tag A"/"B" in the story editor's tag
suggestions and the public `/stories` filter, plus 5 each of the region fixtures in the moderation
queue's region filter. Part 4 made it matter more, since tags became the only taxonomy.

Fixed by inserting all seven lookup fixtures with `active: false`. Nothing the suite asserts depends
on them being active — verified before changing it: `list_published_stories` does not filter attached
tags/work types by `active`, and `set_revision_tags` deliberately still matches an inactive lookup
row (an existing story may already reference one). The reasoning is recorded as a comment at the
fixture site so it isn't "helpfully" reverted later.

The rows already in the linked project were set `active = false` in place rather than deleted: all 10
tag and all 10 work-type fixtures are referenced by real `story_revision_tags`/`story_revision_work_types`
rows, and every structural FK in the story domain is `on delete restrict` by design, so deleting them
would have raised. (The region/destination fixtures were unreferenced but were deactivated too, for
one uniform rule.) `scripts/rls-test-cleanup.sql` still removes them outright when it is run. Done as
direct SQL rather than a migration — it is environment-specific fixture junk, not schema, and the
established home for this is that cleanup script, which is deliberately not a migration.

**Verified**: `npm run test:rls` passes 69/69 with inactive fixtures, and that run's own new fixtures
landed inactive (tag fixture rows 10 → 12, `active` count 0). The live lookup tables now expose
exactly 32 tags, 16 regions, 34 destinations, 0 work types, and the `/stories` filter dropdown
contains no `RLS Test` option.

**Test-story purge (follow-up, on explicit instruction).** The suite also left its _stories_ published
and public: 204 `rls-test-%` fixtures plus 21 `prompt5-costband-%` Prompt 5 verification leftovers,
against 12 real stories — the public listing and landing index were ~95% test data. All fixtures were
then removed. `npm run test:rls:cleanup` handled the `rls-test-%` ones (and its own lookup fixtures)
through its existing guarded path. A one-off companion pass, modelled on
`scripts/rls-test-cleanup.sql`'s exact dependency order and trigger handling, removed the 30 that
script's slug prefix does not match: the 21 `prompt5-costband-%` rows, `stress-test-undici-fix`, and
the hand-made editor fixtures owned by the `dev-user@example.com` / `rls-owner@…` fixture accounts
(`bear-editor-test-story`, `picking-apples-in-hawke-s-bay`, `highlight-fix-verify`,
`highlight-and-list-fix-test`, `formatting-test`, `inline-image-test`, `plate-real-editor-test`,
`table-feature-test`). That pass was run once from a scratchpad rather than committed as a repo
script — it targets a fixed, non-recurring list, and a general "purge stories by slug prefix" tool is
not worth leaving lying around. A full slug/title/owner audit of all 234 deleted stories was written
to disk before anything was deleted.

**Result**: 12 stories remain, all real user content (6 published, 6 draft), verified by listing them.
Deliberately kept: everything owned by a real account and not named as a test, including junk-titled
drafts (`sdf`, `aaa`/"Auckland Trip") — that is user data, not a fixture. 15 `story_media` rows were
orphaned in the private bucket; **0** had been promoted to the public bucket, so no publicly-readable
orphan objects remain. The landing page and `/stories` now show only real stories, and the region/tag
filters only real values.

**The suite now tears itself down** (2026-08-16, on explicit instruction — this reverses the
scripts' original "manual only" stance, so every comment asserting that was updated with it:
`scripts/run-rls-cleanup.mjs`, `scripts/rls-test-cleanup.sql`, and docs/architecture.md's
"Cleanup is honest, not automatic" section, which was also factually stale about lookup tables).
`package.json` gains `"posttest:rls": "npm run test:rls:cleanup"`. npm runs a `post<script>` hook
only when the script exits 0 — **verified empirically with a throwaway package rather than assumed**
— so a FAILING run deliberately leaves its fixtures in place for debugging, which is the behaviour
you want. Every safety property is unchanged: the fail-closed guard still runs on each invocation,
deletes are still scoped to `rls-test-%`, and full-truncate still needs its own second env var. The
hook is scoped to `test:rls`, not `test`, so `npm run verify` is unaffected (confirmed).

**A second, worse gap surfaced while proving the hook worked.** After the first automated run, the
story count went 12 → 16 with zero `rls-test-%` rows left — the suite was creating fixtures the
cleanup prefix could never match. Cause: the cost-band/full-text-search block titles its three
stories `Prompt5 CostBand <runId> ...` **space-separated on purpose** (a documented constraint —
`websearch_to_tsquery` treats a hyphen-joined query as a strict phrase, so slug()'s hyphenated form
would never match a partial search). The DB derives the slug from the title, giving
`prompt5-costband-…`, outside the `rls-test-` prefix. This was the only place in the suite that
created stories without the `slug()` helper, so **3 leaked per run, forever** — which is what the 21
"Prompt 5 verification leftovers" purged above actually were. Not leftovers from a one-off
verification at all; an ongoing leak. Fixed by titling them `RLS Test Prompt5 CostBand <runId> …`, so
the derived slug starts with `rls-test-` and cleanup matches. Safe for the search assertions: they
query `CostBand <marker> Searchable` and `websearch_to_tsquery` AND-matches those words regardless of
order or of extra words being present.

**Verified end to end**: a full `npm run test:rls` now passes 69/69, fires the hook automatically, and
leaves **zero** residue — 0 fixture stories, 0 fixture tags/regions, 32 active tags, 6 published
public stories, exactly the real content. (Story total is 13, not 12: "Hamilton Trip" is a real story
the user created in the browser during this session — confirmed by matching its owner to their other
stories — not a fixture, so it was left alone.)

**Duplicate-React-key bug found and fixed while verifying the purge**
(`components/home/story-index.tsx`): each index row's `fields` list is `[region label, first tag, trip
year]`, keyed by the bare value — but nothing stops two of those being the same string. The "Auckland
Trip" story is in region Auckland _and_ carries a custom tag "Auckland", which tripped React's
unique-key warning on every landing-page render. Found by reading the browser console on a clean
rebuild, not by any test (a duplicate key only warns, it doesn't fail). Fixed to
``key={`${field}-${index}`}`` — the convention `story-card.tsx` and `featured-story-slide.tsx` already
use. Freely-typed tags (part 4) make this collision more likely, not less. Verified: zero console
errors on a fresh page load.

**2026-08-16, part 4 — My Stories list view; tags become the only taxonomy.**

1. **My Stories now opens in list view, with a cover thumbnail beside each title.**
   `app/(contributor)/my-stories/my-stories-view.tsx`'s `useSyncExternalStore` snapshot inverted:
   only an explicitly stored `"grid"` opts out, so the default (including when localStorage is
   unavailable) is `"list"`, and the server snapshot matches so hydration doesn't flip. An existing
   stored preference still wins in both directions — the toggle and its storage key
   (`kaki-my-stories-view`) are otherwise unchanged. The list rows were restyled after the landing
   page's catalogue index (`components/home/story-index.tsx`): hairline-ruled `.nf-entry` rows, a
   mono tabular numeral, a cover thumbnail, and a mono "Updated" line. Same one-grid-two-shapes
   trick that index uses — mobile is `[thumb | stacked content]` with the numeral hidden
   (`display: none` claims no track), and from `sm` up an inner `sm:contents` wrapper drops its
   children into the parent grid as `[numeral | thumb | title+meta | actions]`. Unlike that index a
   row can't be one big `<Link>` (each story carries Edit/Preview/Review actions), so the thumbnail
   and title are the linked targets, the thumbnail link is `aria-hidden` + `tabIndex={-1}` (it
   duplicates the title link), and each action carries an `sr-only` story title so "Preview" isn't
   an ambiguous link name repeated down the page. Thumbnails reuse the existing
   `story-cover-thumbnail.tsx` — a draft has no public-bucket image, so it mints a short-lived
   signed preview URL through `mintPreviewUrlAction`; that path is untouched. 4 new tests
   (`my-stories-view.test.tsx`). **Live-verified** at mobile and desktop viewports: list is the
   default, a story whose cover is a private draft image renders a real signed-URL thumbnail
   (confirmed the `src` is a `story-images-private` signed URL), and stories with no cover fall back
   to the existing placeholder.

2. **Work types are gone from every user-facing surface; tags are the only taxonomy.**
   Removed from the story edit form, the editorial import form, the public `/stories` filter bar and
   its metadata copy, the story card and featured slide badges, the landing-page index's "Work"
   filter axis (its meta column now shows the first tag), the public story detail's chip row, the
   moderation queue filter, the readiness checklist, and `whats-public-summary`. The supporting
   readers/wrappers/schemas went with them: `listActiveWorkTypes`, `listPublicWorkTypes`,
   `setRevisionWorkTypes`, `setWorkTypesAction`, `workType`/`workTypeId` in
   `lib/validation/discovery.ts` and `lib/validation/moderation.ts`, and `workTypeId` on
   `PublishedStoriesFilter`/`ModerationQueueParams`. `content-quality-checks.ts`'s
   `hasWorkType`/`unclear_work_type` advisory became `hasTag`/`missing_tags`.

   **Deliberately non-destructive at the data layer.** Nothing was dropped: `work_types`,
   `story_revision_work_types`, `set_revision_work_types()`, and every `p_work_type_id` parameter on
   `list_published_stories`/`get_moderation_queue` are all still there, and
   `get_published_story`/`list_published_stories`/`get_revision_selections` still return their
   `work_types` payloads. Existing published revisions carry work-type rows, `npm run test:rls`
   exercises `set_revision_work_types` with its own "RLS Test Work Type A/B" fixtures, and a dropped
   column or parameter is irreversible. The retirement is expressed as `active = false` on all nine
   non-fixture `work_types` rows — the exact mechanism these lookup tables were given in
   `20260803090000_lookup_tables.sql` — plus a table comment recording why the table is kept. The
   app simply never sends `p_work_type_id` any more (a comment at each call site says so).

3. **A contributor can now add as many tags as they like, including their own labels.** The edit
   form previously offered a fixed checkbox list plus one "Other (type your own)" text input — one
   custom label per story, maximum. New `components/story/tag-editor.tsx`: type a label, press Enter
   (or comma, or "Add"), it becomes a removable chip; Backspace on an empty input removes the last
   one; the curated tag rows are offered as native `<datalist>` suggestions rather than 32
   checkboxes, so they stay discoverable without being a ceiling. It goes through the same
   `setTagsAction` → `set_revision_tags` path as before, on the same mutation-queue "tags" slot (no
   debounce — an add/remove is a discrete action, not typing). 7 new tests.

   **The RPC, not the client, is the boundary** (Engineering Rules 2/3).
   `supabase/migrations/20260816100000_set_revision_tags_multi_add.sql` replaces
   `set_revision_tags()` — same signature, same authorization, same optimistic-version check, based
   on the live `pg_get_functiondef()` output — and adds three behaviours: (a) a typed label that
   case-insensitively names an existing `tags` row is stored as a _reference_ to that row, so "Van
   life" and "van life" can't become two catalogue entries (and contributors still never need write
   access to the admin-managed `tags` table); (b) duplicates collapse, by id or by folded custom
   label; (c) a per-revision cap of **20** — chosen because it matches the cap already applied to
   locations and to the selection arrays in `lib/validation/story.ts`, and because 20 topical labels
   on one story is well past where tags describe a story rather than keyword-stuff it. The 100-char
   length ceiling (`story_revision_tags_one_of`'s CHECK) is unchanged. Exceeding the cap raises
   inside the same transaction as the delete, so a rejected write leaves the existing tags intact.
   `lib/validation/story.ts`'s `revisionSelectionsSchema` became `revisionTagsSchema` with exported
   `MAX_TAGS_PER_REVISION`/`TAG_MAX_LENGTH` constants (6 new tests).

   `supabase/migrations/20260816100200_get_revision_selections_tag_names.sql` adds a `name` to each
   element of that RPC's `tags` payload (resolved lookup name, or the contributor's own text) and
   orders by it — the chip UI needs a display name, and a revision may legitimately reference a
   now-inactive tag that the form's own options list no longer contains. `RevisionSelections` is
   correspondingly `{ locations, tags: RevisionTagSelection[] }`; its `workTypeIds`/`customWorkType`
   /`tagIds`/`customTag` fields are gone.

4. **Curated tag list.** `supabase/migrations/20260816100100_curate_whv_tags_retire_work_types.sql`
   upserts 32 WHV-relevant tags (insert-or-reactivate on `slug`; never `DELETE`, since revisions
   reference these rows) and deactivates anything outside the set that isn't an `rls-test-%`
   fixture — which today matches nothing, since all eleven pre-existing tags were already relevant
   and were kept. The genuinely useful work-type concepts were folded in as tags:
   _Work_ — Fruit picking, Horticulture, Viticulture, Farm work, Dairy farming, Packhouse work,
   Hospitality, Tourism, Construction, Retail, Office work, Ski season, Au pair, Seasonal work,
   Finding work, Pay & conditions, Cost of living. _Trip shape_ — Van life, Road trip, Backpacker
   hostels, Budget travel, Solo travel, Couple travel, First-time traveller, Hiking & tramping,
   Buying a car. _Place_ — North Island, South Island. _Practicalities_ — Visa & paperwork,
   Tax & IRD, Second visa, Culture shock.

   **All three migrations applied** to the linked project (`ybhydepjaantkngngvuf`) via
   `apply_migration`, never `db push` (local and remote histories are legitimately divergent here).

   **Live-verified**, signed in as a real contributor: the edit form shows one "Tags" fieldset and
   no "Work types" one; typing `van LIFE` produced a `Van life` chip that persisted as a _reference_
   to the real lookup row (confirmed by direct DB read: `tag_id = 94d1b711…`, `custom_label = null`),
   `Ferry to Picton` persisted as a custom label, and `VAN LIFE` was refused with
   `"VAN LIFE" is already on this story.`; a reload rendered both chips back with their names. The
   RPC's own enforcement was verified separately with a **rolled-back probe** running as the story's
   owner (`set local role authenticated` + a `request.jwt.claims` sub): five inputs (a duplicated
   `tag_id`, two spellings of one custom label, and a label naming a lookup row) collapsed to
   exactly two rows; 21 tags were rejected with `Too many tags for revision … (max 20 per story, got
21)`; 20 were accepted. The probe rolled back, and the tags added by hand during verification
   were removed afterwards, leaving the story's tag set as it was found. `/stories`' filter bar has
   no Work type control and lists the 32 curated tags; the landing index's axes are Place and Topic
   only.

   **Not verified live:** the moderation queue page. Reaching it needs the moderator fixture
   account, which would mean signing the already-signed-in contributor out of their own browser
   session; the change there is the removal of one `<select>` and one query parameter, covered by
   typecheck, build, and `test:rls`.

   **Known, pre-existing, not changed:** `npm run test:rls` inserts fresh "RLS Test Tag A/B" rows on
   every run with `active` defaulting to true, so those fixtures accumulate in the public tag
   dropdown alongside the curated set. Left alone deliberately — the RLS suite depends on those rows
   — but worth a cleanup decision later.

   **Gates:** `npm run verify` passes (319 tests, up from 303; 0 lint errors, 151 pre-existing
   warnings, unchanged), and `npm run test:rls` still passes 69/69 against the live project.

**2026-08-16, part 3 — Toast redesign.**

`components/ui/toast.tsx` restyled on explicit user reference (a screenshot of another site's toast)
asking for "a nice green color that shows clearly": a solid `bg-green-600` (error: `bg-red-600`)
pill, fixed regardless of light/dark mode (a toast is a momentary assertive notification, not page
chrome, so it doesn't adapt to theme), a white icon in a translucent circle on the left
(`CheckCircleIcon`/`AlertCircleIcon`, new additions to `components/icons.tsx`, matching the existing
house icon style — 24×24, `currentColor` stroke), and a dismiss `×` button (`CloseIcon`, same set) on
the right — clicking it now removes the toast immediately rather than waiting out the fixed
3.5s auto-dismiss. `dismissToast(id)` is shared between the timeout and the button, so there's one
removal path, not two. No caller changed (`showToast()`'s signature is unchanged) — both existing call
sites (`story-edit-form.tsx`'s "Draft saved.", `image-upload-manager.tsx`) picked up the new look for
free. **Live-verified**: triggered a real autosave via the dev server (signed in as the RLS owner
fixture, edited a draft's title), screenshot confirms the new green pill with icon and × exactly
matches the requested reference.

**2026-08-16, part 2 — Moderation queue sort order + collapsed Media section.**

1. **The "submitted" moderation queue now sorts newest-submission-first.** `get_moderation_queue()`'s
   `'submitted'` branch (added in Prompt 6 Stage 1, `20260805100800_get_moderation_queue_v2.sql`) had
   deliberately ordered `submitted_at asc` (oldest first — a FIFO fairness queue, per that
   migration's own comment). Moderators asked for the opposite. Fixed in
   `supabase/migrations/20260816090000_moderation_queue_submitted_desc.sql`: `order by
s.submitted_at desc, r.id asc` — the only change; filters, pagination, and return shape are
   untouched, and the `'recently_reviewed'` branch already ordered `created_at desc` and needed no
   change. **Applied and live-verified**: signed in as the RLS moderator fixture, the Stories queue
   now lists the most recently submitted story first (a story submitted at 4:48pm ahead of ones
   submitted at 4:39pm and 12:41pm the same day).
2. **The review page's "Media" section is now collapsed by default.** A moderator lands on this page
   to read the story, not to see thumbnails first — the media grid (added earlier today, see part 1
   below) now sits inside a closed `<details>`/`<summary>` (same pattern
   `story-edit-form.tsx`'s own Images section already uses), opened only on click.
   `app/(moderation)/moderation/stories/[id]/page.tsx` only; `PreviewGallery` itself is unchanged (it
   still mints preview URLs on mount regardless of the parent's collapsed state, since it stays
   mounted — a deliberate non-issue, given the RLS suite's fixture stories carry at most a handful of
   images). **Live-verified**: the section renders "▶ MEDIA (4)" collapsed, with the story body
   visible immediately below it; clicking it opens the full thumbnail grid.

**2026-08-16, part 1 — Post-submit redirect, image loading spinner, moderator image visibility.**

1. **Submitting for review (or a linked contributor's "Approve & submit for moderation") now
   redirects to My Stories** instead of leaving the contributor on the preview page reading a
   "Submitted for review." text line. `submitOwnConsentAction`
   (`app/(contributor)/stories/[id]/preview/actions.ts`) calls `redirect("/my-stories")` on success
   instead of returning a success state — My Stories already shows a status badge for
   `pending_review`/`awaiting_contributor_approval`, so the contributor sees the story move.
   `requestEditorialChangesAction`/`declineEditorialPublicationAction` are unchanged (not part of
   this request). **Live-verified**: signed in as the RLS test owner fixture, submitted a real draft
   with 4 attached images through the real consent form — landed on My Stories with the story showing
   "In review", confirmed via a direct DB read that the revision genuinely flipped to `submitted`.
2. **Preview images now show a spinner while their signed URL is being minted**, instead of a blank
   gap in the text (inline embeds) or "Preparing image…" text-only (the gallery). `ContentBlockMediaMap`
   (`components/story/content-block-renderer.tsx`) gained a `"loading"` literal state alongside its
   existing `{url, altText, decorative}` shape — a caller that mints asynchronously
   (`PreviewContentBody`) sets an embedded id to `"loading"` the moment it's known and clears it once
   the mint resolves or fails; `MediaEmbed` renders the shared `<Spinner>` component
   (`components/ui/spinner.tsx`, already used elsewhere) for that state. `PreviewGallery` got the same
   treatment for its own "not yet loaded" branch. `PreviewContentBody`'s loading set is derived each
   render from `blocks`/`urls`/`failed` rather than tracked as its own state, to satisfy
   `react-hooks/set-state-in-effect` (a synchronous `setState` at the top of the effect body was
   rejected by the linter as a cascading-render risk). 1 new render test
   (`content-block-renderer.test.tsx`). **Live-verified**: the private preview page showed spinners on
   first paint, then real images 1–2s later, for a fixture story with images both inline in text and
   inside a table cell.
3. **A moderator reviewing a submitted revision could not see any of its images — not the inline ones
   in the body text, not even a thumbnail in the "Media" list.** Root cause:
   `app/(moderation)/moderation/stories/[id]/page.tsx` called `ContentBlockRenderer` three times with
   no `media` prop at all (defaults to `{}`), so every `![[mediaId]]` embed silently resolved to
   nothing; the "Media (N)" section only ever rendered caption/processing-state text, never an actual
   picture. Fixed by reusing the already-existing, already-tested preview components instead of
   `ContentBlockRenderer` directly:
   - The submitted revision's body now renders via `PreviewContentBody`, which mints short-lived
     signed URLs through `mintPreviewUrlAction` — already generic over "owner, linked contributor,
     assigned editor, admin, **or a moderator scoped to a revision they're genuinely reviewing**" (see
     `_can_access_story_media()`, `supabase/migrations/20260804090600_story_preview_and_media_access.sql`),
     so no new grant or RPC was needed, only a new caller.
   - The "Media (N)" list gained an actual thumbnail grid via `PreviewGallery` (same component,
     same mint), kept alongside the existing caption/processing-state rows rather than replacing them.
   - The "Currently published" comparison panel (shown only when reviewing a replacement) now builds
     its own `ContentBlockMediaMap` synchronously, server-side, from `get_published_story_media()` +
     `getPublicImageUrl()` — no signed-URL minting needed there, since that revision's images are
     already promoted to the public bucket.
   - `PreviewGallery`/`PreviewContentBody`'s `media` prop was widened from `RevisionMediaItem[]` to a
     new shared `PreviewableMediaItem` type (`lib/story/contributor-queries.ts`) covering only the
     fields both `RevisionMediaItem` and `lib/story/moderation.ts`'s `ModeratorMediaItem` already
     share — so both components work unchanged for either caller, no data reshaping needed.
     **Live-verified**: signed in as the RLS test moderator fixture, opened the review page for the
     revision submitted in item 1 above — all 4 images rendered as real thumbnails in the Media
     section, and all 3 of the body's inline images (including one inside a table cell) rendered in the
     Submitted revision panel, where every one of them had previously rendered nothing.

Last updated before that: 2026-08-15 (first-sign-in lands on contributor-identity setup; detaching an
image now strips its embed tokens).

**2026-08-15 — First-sign-in landing + dangling image-embed fix.**

1. **First sign-in lands on contributor-identity setup.** A brand new account has no `contributors`
   row, and every authoring surface depends on one, so the first sign-in now lands on
   `/account#contributor-identity` instead of an empty My Stories; every later sign-in lands on
   My Stories exactly as before, and no staff role is diverted. The decision is a pure function
   (`landingPathAfterSignIn()` in `lib/auth/post-login-redirect.ts`, unit-tested); the server-side
   wrapper that supplies the identity flag is `lib/auth/contributor-identity.ts`, which only
   queries when the role-based answer is the contributor default (no extra round trip for staff)
   and reads the caller's own row only (`linked_user_id = auth.uid()`, never a client-supplied id).
   Wired into both sign-in paths — `signInAction` and `app/auth/callback/route.ts` (email
   confirmation / OAuth). An explicit `?next=` still wins over all of it. `/account` also shows a
   prompt whenever the contributor identity is genuinely missing (driven by the absent row, not by
   a one-shot query parameter, so it also catches anyone who skipped the step and came back).
2. **Detaching an image left a dangling `![[mediaId]]` embed token — published stories then showed
   nothing where the image was.** `save_revision_draft()` rejects content referencing media not
   attached to the revision, but `detach_story_media()` had no counterpart on the way out: removing
   an image deleted the `story_revision_media` row and left the token in the Markdown. The editor
   still rendered that token (it resolves embeds by minting a private preview URL for the mediaId,
   which is scoped to the story, not to the revision's media list), so the image looked present
   while writing — but `get_published_story_media()` only ever returns attached, promoted media, so
   the approved, published page rendered nothing there. Every later save of that draft also failed
   with "references an image that is not attached to this revision". Fixed in
   `supabase/migrations/20260815100000_detach_media_strips_embed_tokens.sql`: detaching now strips
   that image's embed tokens (with or without a `|width` suffix) from the same revision's content in
   the same transaction. `_authorize_revision_edit()` still gates the whole function, so an approved
   or published revision remains unwritable (Rules 10–12). `removeMediaEmbeds()`
   (`lib/story/markdown-media.ts`, 5 tests) plus a new `onMediaDetached` hook from
   `ImageUploadManager` into `StoryEditForm` is the client-side half that keeps the open editor in
   step, so the next autosave can't re-save the stale reference.
   **Migration applied** to the linked project (`ybhydepjaantkngngvuf`) and the replacement function
   verified in place. **Known pre-existing data**, not repaired by this change (an approved revision
   is immutable): story `kakiman-5e00f9f4` still embeds a detached media id, and
   `working-holiday-in-new-zealand-with-jeng-2c24729a`'s published revision still holds a
   pre-Markdown `content_json` shape (`[{type:"paragraph",text:[…runs]}]`) — the latter is now
   handled on read by item 3 below; the former is repaired by the author republishing (item 4).
3. **Legacy `content_json` shapes now render instead of erroring.** `lib/story/legacy-content.ts`'s
   `normalizeStoryContentJson()` reads a revision's stored content in ANY shape this codebase has
   written — today's single Markdown block, the pre-20260811090000 paragraph/heading/quote/list/
   table/image block union, and the oldest plain-string block text — and returns today's canonical
   blocks. Conversion is on read only; no stored row is touched (an approved revision's content is
   immutable, which is exactly why these rows still exist). The converted Markdown is passed back
   through the real `storyContentSchema`, so a legacy document gets the same validation as anything
   written today (no h1, no `![alt](url)`, safe hrefs only, length ceilings), and legacy run text is
   Markdown-escaped so a literal `*`/`_`/`[` can never become markup. Replaces the direct
   `storyContentSchema.safeParse()` call at all six read sites (public story, contributor preview,
   moderation detail ×2, contributor edit, editorial edit). 13 tests in
   `lib/story/legacy-content.test.ts`. **Live-verified:** `working-holiday-in-new-zealand-with-jeng-2c24729a`
   now renders its body instead of "This story's content couldn't be rendered"; the two
   Markdown-shape stories are unchanged.
4. **`create_next_draft_revision()` could never copy child rows — "Edit" on any published story
   carrying an image, location, work type, or tag failed outright.** It copied the source revision's
   child rows and only _then_ pointed `stories.current_draft_revision_id` at the new revision, but
   every child table carries `_protect_revision_child_immutability()`, which requires
   `_revision_is_editable()` — which requires that pointer. **Confirmed empirically** against the
   live project with an isolated, rolled-back probe insert reproducing the exact exception, before
   any fix was written. Fixed in
   `supabase/migrations/20260815110000_fix_create_next_draft_revision.sql` by setting the draft
   pointer immediately after the new revision row is inserted and before the child copies (nothing
   weakened: the trigger still demands an active draft-status revision, which it now genuinely is
   from the moment it exists; the version bump still happens exactly once). The same migration
   strips, from the new draft's copied content only, any embed token whose media was not carried
   over — otherwise a pre-existing dangling reference would make every autosave in the new draft
   fail with "references an image that is not attached to this revision", with the offending token
   invisible in the editor. **Applied and live-verified**: `npm run test:rls` passes 69/69, and a
   rolled-back probe of the real repair path on `kakiman-5e00f9f4` now returns a new draft with its
   media copied and the dangling token stripped (story left untouched — pointer still null, version
   still 29, one revision).
5. **Not reproduced:** "a newly published story does not appear in the landing page's Featured
   section." Verified live against the linked project — `list_published_stories` returns the three
   stories published 2026-08-15 newest-first, and the newest one is the first Featured card, with
   its custom tags and cover photo. Most likely a stale cached page (`revalidate = 60`) at the time
   it was looked at.

Last updated before that: 2026-08-12 (story editor images render inline and are drag-resizable,
Bear.app-style; see "Inline, drag-resizable images in the story editor" below).

**2026-08-06 — Rebrand + home hero redesign.** Product renamed from "WHV Compass NZ" to
"Kakinotes" across all user-facing copy, metadata, `package.json`/`package-lock.json`, and docs
(historical migration/seed identifiers like `whv-compass-terms-2026-08` and disposable test
emails were deliberately left untouched — they're data-level identifiers, not branding, and
`supabase/migrations/` is not edited retroactively). The home hero
(`app/(public)/page.tsx`, new `components/home/hero-backdrop.tsx`) now uses a full-bleed
illustrated Remarkables/Queenstown backdrop, in the site's existing warm terracotta palette
(not the dark-teal "corporate travel agency" look docs/design-brief.md explicitly rules out) —
copy, CTA language, and the `PersonalExperienceLabel` component are unchanged. The SVG
illustration is a placeholder for real on-location photography per the design brief.
`lint`/`typecheck`/`format:check`/`test` (212/212) all pass; not yet live-verified in a browser
in this environment (see note below) or run through `test:e2e`.

## Status legend

`not started` · `in progress` · `blocked` · `complete`

## Prompt checklist

| #   | Prompt                                                                                                                                                                    | Status                                                                                                                                                                                                                              | Notes                                                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | Repository inspection & documentation baseline                                                                                                                            | complete                                                                                                                                                                                                                            | CLAUDE.md and docs/ created against an empty repo.                                                                                                                                                                     |
| 1   | Application foundation (Next.js scaffold, Supabase client/proxy wiring, env validation, local DB workflow scaffolding, quality tooling, public shell + placeholder pages) | **Blocked — implementation complete, local Supabase runtime verification unavailable because no container runtime is installed.**                                                                                                   | Limitation accepted by user 2026-08-02. See "Prompt 1 detail" below for exactly what's verified vs. blocked.                                                                                                           |
| 2   | Authentication, profiles, roles, and contributor identities                                                                                                               | **complete — migrations applied and live-verified against a real linked Supabase project.**                                                                                                                                         | See "Prompt 2 detail" below for what was live-verified (including a real bug found and fixed), and the role/RLS matrix.                                                                                                |
| 3   | Core story schema & RLS (stories/story_revisions, media, consent/rights, moderation, reporting)                                                                           | **complete — migrations applied and live-verified (23/23) against a real linked Supabase project, including 3 real bugs found and fixed.**                                                                                          | See "Prompt 3 detail" below.                                                                                                                                                                                           |
| 4   | Editor/self-service authoring UI, image upload, storage buckets, contributor approval flow                                                                                | **complete — all 5 sub-phases done: all 8 migrations pushed and live-verified (`test:rls` 33/33); the cross-contributor UI-level access spec found and fixed a real per-row `notFound()`-as-200 leak.**                             | Built on `prompt-4-authoring-images`; PR #5 (Sub-phases 1–4) already merged to `main`, Sub-phase 5 lands as a follow-up PR. See "Prompt 4 detail" below.                                                               |
| 5   | Public discovery (browse/filter/detail, SEO, sitemap/robots, cost-band UI)                                                                                                | **complete — 5 migrations pushed and live-verified (`test:rls` 44/44); 24/24 Playwright specs pass; a real ambiguous-column bug and a real public per-row 404 gap were found and fixed.**                                           | See "Prompt 5 detail" below.                                                                                                                                                                                           |
| 6   | Editorial and moderation workspace (queue UI, reports triage)                                                                                                             | **complete — all 3 stages. All 10 migrations pushed and live-verified (`test:rls` 69/69); Stage 3 added no new migration. `npm run verify` clean (182/182 tests, 32 routes).**                                                      | Roadmap corrected in Prompt 3 — was previously numbered 7; `/editorial` and `/moderation` got real UI in Stage 2/3 instead of a role-gated JSON stub. See "Prompt 6 detail — Stage 1", "Stage 2", and "Stage 3" below. |
| 7   | Operational launch tooling and Playwright coverage of critical flows                                                                                                      | **complete — 2 migrations pushed and live-verified (`test:rls` 69/69, unchanged); `npm run verify` clean (212/212 unit tests, 33 routes); `e2e/founding-story-workflow.spec.ts` run live and passing, found and fixed a real bug.** | Renumbered from 8 — reporting itself is done (Prompt 3); contributor drafting/private preview folded into Prompt 4. See "Prompt 7 detail" below.                                                                       |

## Prompt 1 detail — verified vs. blocked

Verified (actually run in this environment):

- `npm install` completes; `npm run format:check`, `lint`, `typecheck`, `test` (5/5 unit tests),
  `build`, and `npm run verify:full` (adds the Playwright smoke spec) all pass.
- `npx playwright install chromium` completed; the e2e smoke spec runs for real and passes,
  including the negative check that `/editorial`, `/moderation`, `/admin` return HTTP 404.
- `supabase init` ran successfully (doesn't need Docker) — `supabase/config.toml`,
  `supabase/migrations/`, `supabase/seed.sql` exist.
- `supabase gen types typescript --help` was inspected directly to confirm `--linked` is a real,
  supported flag (CLI 2.111.0) before adding `supabase:types:linked`.

Blocked (Docker is not installed in this environment):

- `supabase start`, `supabase db reset`, and `supabase gen types typescript --local` have not been
  run or verified. `types/database.ts` is a hand-written placeholder, not real CLI output.
- The hosted-development path (`supabase link` + `supabase:types:linked`) is documented and the
  script is wired up, but has not been exercised against a real linked project either — no dev
  project ref was available in this session.

## Prompt 2 detail — verified

Prompt 2 was initially built and code-verified without a real Supabase project (Docker unavailable,
same constraint as Prompt 1 — see below). The user then connected a real Supabase account
(`supabase login`, project ref `ybhydepjaantkngngvuf`, region ap-northeast-1), so everything in this
section was subsequently pushed to and live-tested against that real project, in this session:

- `npm run verify:full` passes in full: `format:check`, `lint` (0 errors, 0 warnings), `typecheck`,
  `test` (49/49 unit tests across 9 files, including 27 new tests for validation, safe-redirect,
  `resolveStaffAccess`, and the auth/profile Server Actions with Supabase mocked at the import
  boundary), `build` (22 routes, including the new `/sign-up`, `/forgot-password`,
  `/reset-password`, `/auth/callback`), and Playwright (8/8 — the pre-existing smoke spec plus a new
  `e2e/auth.spec.ts` covering sign-up/in/forgot/reset page rendering, the protected-route
  redirect-with-`next`, and the invalid-callback-link friendly error).
- `supabase link --project-ref ybhydepjaantkngngvuf` succeeded; `supabase db push --dry-run` showed
  exactly the expected six migrations with nothing unexpected, then `supabase db push` applied all
  six for real; `supabase migration list` confirmed local and remote timestamps match.
- `npm run supabase:types:linked` generated real types from the live schema. Diffed against the
  hand-written placeholder it replaced: **identical field-for-field** (only cosmetic differences —
  formatting, table ordering, and the newer Supabase CLI helper-type exports). `types/database.ts`
  is now genuinely generated output, not hand-written.
- `.env.local` updated with the real project URL and **publishable** key (never the secret/service-role
  key — that was used transiently, in shell commands only, for verification queries below, and is not
  written anywhere in the repo).
- Live-verified via direct calls to the Supabase Auth and PostgREST APIs, using a fictional,
  disposable test account (`whv-compass-verify-prompt2@mailinator.com`, deleted afterward — see
  cleanup note below):
  - Sign-up creates the `auth.users` row and `handle_new_user()` fires correctly: a `profiles` row
    (with `display_name` taken from `user_metadata`, `home_country_code` defaulted to `MY`,
    `public_profile_enabled` false) and a `user_roles` row (`role = 'user'`) both appeared
    automatically.
  - Anonymous read of the (private) test profile and of `user_roles` both correctly returned `[]`
    (RLS-filtered).
  - A signed-in `user`-role account: could read its own role; a direct `PATCH user_roles` attempting
    self-escalation to `admin` returned **0 rows affected** (RLS silently excluded the row from the
    UPDATE — not a 403, but structurally a no-op, confirmed by re-reading the role afterward and
    seeing it unchanged); calling the `admin_set_user_role` RPC directly raised
    `"Only admins can change user roles"` as designed.
  - Self-service `contributors` creation with `linked_user_id`/`created_by` = the caller's own id
    succeeded; the same insert with a **different** `linked_user_id` (impersonating another account)
    was rejected outright with a Postgres RLS error (`42501`, "new row violates row-level security
    policy") — contributor-identity hijacking is confirmed structurally blocked, not just by
    application code.
- **A real bug was found and fixed during this verification**: deleting a test user whose account was
  linked to a contributor record failed. `contributors_protect_privileged_fields()` (see
  `20260802085016_contributors.sql`) blocked _any_ non-staff change to `linked_user_id` — including
  the `ON DELETE SET NULL` foreign-key action itself, which runs with no user session
  (`auth.uid()` is null during that system-driven update), so the trigger treated it identically to a
  hijack attempt and raised an exception, blocking the deletion. Fixed in a new migration,
  `20260802093000_fix_contributors_unlink_on_delete.sql`: the trigger now only blocks a non-staff
  caller from _assigning/reassigning_ `linked_user_id` to a non-null value; clearing it to `null` is
  always allowed (it can never be used to claim an identity), which lets the cascade succeed. Pushed
  and re-verified — deletion now succeeds. This is exactly the kind of defect the "reviewed, not
  verified" caveat below was warning about, and it's why this section no longer carries that caveat.
  Separately, deleting a user who is the `created_by` of a contributor record (not just the linked
  owner) is still blocked outright, with no `ON DELETE` action on that foreign key — determined during
  this same test to be correct, intentional behavior, not a bug: it prevents silently losing
  provenance/audit-trail data on account deletion, consistent with
  docs/content-governance.md's "full deletion is a slower, explicit, human-reviewed path, not
  self-service." A real deletion flow (Prompt 3+ territory) will need to handle this explicitly
  (reassign or archive authored records first) rather than deleting `auth.users` directly.
  Test cleanup followed the same order this implies: delete the contributor row, then the auth user
  (which cascades `profiles` and `user_roles`) — confirmed empty afterward.
- Also empirically discovered (not previously knowable without a real project): this hosted project
  has **email confirmation ON** by default — a direct password-grant sign-in attempt before
  confirming returned `email_not_confirmed`. Documented under "Manual Supabase settings required"
  below; the app's own sign-up success copy already handles both cases correctly.

No Docker was used or needed for any of this — all done through the Supabase CLI's linked-project
path and direct HTTPS calls to the project's Auth/PostgREST APIs, per
docs/architecture.md "Local vs. hosted Supabase development."

## Prompt 3 detail — verified

Built on a fresh branch, `prompt-3-story-schema-rls`, created from `main` after fast-forwarding it to
`origin/main` (which already had Prompt 2 merged) — not continued on `prompt-1-application-foundation`.

- `npm run verify` passes in full: `format:check`, `lint` (0 errors, 0 warnings), `typecheck`, `test`
  (62/62 unit tests across 11 files — 47 new tests for `lib/validation/story.ts`'s content-block
  union, revision input, submit-consent input, and report input schemas), and `build` (22 routes,
  unchanged — this phase adds no new pages, only schema/RPCs/data-access modules).
- All 11 new migrations applied to the linked hosted dev project (`ybhydepjaantkngngvuf`) via
  `supabase db push` — see "Migration summary" below for the full list, including the three
  bug-fix migrations.
- `npm run supabase:types:linked` regenerated `types/database.ts` against the live schema —
  introspected all ~45 new functions (including the internal `_`-prefixed helpers, which appear in
  the generated types since introspection sees every function regardless of grants, but are confirmed
  unreachable over the API by the integration suite below).
- **`npm run test:rls` — the checked-in integration suite
  (`tests/integration/story-rls.integration.test.ts`) — passes 23/23** against the real project, using
  a fixed pool of 5 pre-confirmed accounts (owner/other/editor/moderator/admin). Covers: direct
  table-access denial (every story-domain table, every role, `42501`); internal-helper
  unreachability; `promote_story_media` ungranted; the full self-service first-publication lifecycle
  (create → submit → moderate → public read with safe-shaped columns); a moderator attempting to
  rewrite approved content directly; the published-replacement lifecycle (story stays `published`
  throughout, a new replacement's consent grant never affects what's currently public, stale consent
  from a withdrawn/superseded revision doesn't authorize a different one); withdrawal (freezes to
  `withdrawn`, story stays published, a fresh draft can be started via `create_next_draft_revision()`);
  destination/region integrity; and reporting (reporter-only visibility of their own reports). See
  `docs/architecture.md` "RLS integration test setup" for exactly how the account pool and
  fail-closed guard work, and "Cleanup is honest, not automatic" for what `npm run test:rls:cleanup`
  does and doesn't remove.
- **Three real bugs were found and fixed during this verification** — full technical account in
  `docs/architecture.md` "A real bug class found during live verification":
  1. **Authorization bypass via SQL three-valued logic** (`20260803091100_fix_nullable_actor_boolean_logic.sql`):
     `if not (owner_check or nullable_column = auth.uid()) then raise ... end if;` silently skipped
     the raise whenever the nullable column (`assigned_editor_id`, `contributors.linked_user_id`) was
     `NULL` — which is every self-service story — letting any signed-in stranger overwrite another
     contributor's private draft. Caught by the very first ownership test in the integration suite.
     Fixed by wrapping every such comparison in `coalesce(..., false)`, across 9 functions
     (`mark_editorial_draft_awaiting_approval`, `save_revision_draft`,
     `submit_revision_with_consent`, `create_next_draft_revision`, `withdraw_unstarted_submission`,
     `request_editorial_changes`, `decline_editorial_publication`, `_authorize_revision_edit`,
     `get_story_for_editor`).
  2. **`moderate_revision()`'s approve path never set `stories.visibility = 'public'`**
     (`20260803091200_fix_publish_sets_visibility.sql`) — only `lifecycle_status`. Since every
     public-read function correctly requires both, no story could ever actually become publicly
     visible even once approved, until this fix.
  3. **PL/pgSQL `RETURNS TABLE` column-name ambiguity** (`20260803091000_fix_returns_table_column_ambiguity.sql`)
     — a `returns table (slug text, ...)` function's output columns are implicit variables in the
     whole function body, so a bare `where slug = p_slug` is ambiguous (`42702`) at call time (the
     `CREATE FUNCTION` itself succeeds silently). Fixed in `get_published_story`,
     `list_published_stories`, `get_story_for_moderator` by qualifying every such reference with a
     table alias.
  4. Separately (not a bug, a real limitation): applying `scripts/rls-test-cleanup.sql`'s first draft
     failed with a foreign-key violation, because every structural parent/child FK in the story
     domain is deliberately `on delete restrict` (no ordinary hard deletion, by design — see
     "Deletion policy" in architecture.md) — a plain `delete from stories` can't cascade. Fixed by
     deleting in explicit dependency order, scoped by the `rls-test-` slug prefix.
- The disposable test-account-pool bootstrap needed a human step this session: creating and
  email-confirming 5 accounts was done via the Auth Admin API with the project's secret key used
  transiently in shell commands only (same pattern as Prompt 2's verification, never written to any
  file, per Engineering Rule 1) — but promoting 3 of them to editor/moderator/admin required either an
  existing admin account (none existed yet) or a direct `user_roles` write, which this session's
  sandboxed permission model correctly blocked as a sensitive action; the user ran the three
  `admin_set_user_role`-equivalent `UPDATE` statements directly in the Supabase SQL editor. Documented
  here since it's the kind of one-time setup a future session repeating this needs to know about.

No Docker was used or needed — same hosted-linked-project path as Prompts 1–2. `supabase/seed.sql`'s
new story-domain fixtures (regions/destinations/work types/tags, and stories covering every lifecycle
state including the new terminal `withdrawn` state) are **not** verified this session — they run only
against the local stack (`supabase db reset`), which remains blocked on the missing container runtime,
exactly like the rest of `seed.sql` since Prompt 1.

## Prompt 4 detail — in progress

Built on `prompt-4-authoring-images`, branched from `main` after Prompt 3's PR (#4) was found
already merged upstream (`32fed0b`) — no new push/PR/merge was needed for the prerequisite, only
a local fast-forward. The full Prompt 4 design (self-service authoring, editorial import, image
storage/processing pipeline, consent/approval flows) went through seven rounds of plan review
before implementation began; the approved plan is the source of truth for every decision below
and is not duplicated here in full.

**Sub-phase 1 — canonical content-schema extension (complete):**

- `lib/validation/story.ts`'s `storyContentBlockSchema` extended from plain-string block text to
  a block/run/mark structure: every block's text is now `TextRun[]` (`{ text, marks? }`), where
  `marks` is `("bold" | "italic" | { type: "link"; href })[]`, capped at 3 (one of each kind,
  enforced by a `.refine()` rejecting duplicate mark kinds on the same run). List items are now
  `TextRun[][]` (one run array per item) rather than bare strings.
- Added `isSafeHref()`: parser-based (`new URL()`), not regex-scheme-sniffing — accepts only
  `http:`/`https:` absolute URLs or single-slash root-relative paths; rejects protocol-relative
  (`//host/...`), backslashes, control characters, mixed-case scheme tricks, and overlong values.
  Used both by the link-mark schema and (in a later sub-phase) the content renderer, at render
  time too, per the plan's defense-in-depth requirement.
- Added a document-wide character ceiling (50,000, sum of all run text across all blocks) and a
  per-block run-count ceiling (100), on top of the existing per-block/per-run length ceilings.
- `storyContentSchema` gained `.min(1)` (previously unbounded below — an empty array passed) —
  combined with every run already requiring non-whitespace content, this closes the "meaningful
  content" gap flagged during plan review.
- **No DB migration was needed for this change.** Confirmed by reading
  `supabase/migrations/20260803090200_story_revisions.sql` directly:
  `content_json jsonb not null default '[]'::jsonb` with only a
  `constraint story_revisions_content_json_is_array check (jsonb_typeof(content_json) = 'array')`
  — the column is loosely-typed at the DB layer by design, so extending the Zod-side shape is
  safe without a migration. This is exactly the kind of claim the plan required verifying against
  the real migration file rather than assuming, so it's recorded here as verified, not assumed.
- `supabase/seed.sql`'s 9 story-revision fixtures updated from the old
  `'[{"type":"paragraph","text":"..."}]'` shape to the new
  `'[{"type":"paragraph","text":[{"text":"..."}]}]'` shape, so local-stack seeding (whenever
  Docker is available) stays schema-valid. Grepped the rest of the repo for the old shape —
  no other file references it, since nothing yet consumes `content_json` outside `seed.sql` (the
  first real consumer, the rich-text editor and content renderer, is Sub-phase 3).
- `lib/validation/story.test.ts` rewritten/expanded to 29 tests (from 8): overlapping marks
  accepted, duplicate mark kinds rejected, unsafe link hrefs rejected, per-block and document-wide
  character ceilings enforced, empty-content-array rejected, plus a full `isSafeHref` matrix
  (accepted: absolute https/http, root-relative; rejected: `javascript:`/`data:`/`vbscript:`/
  `file:`, mixed-case scheme tricks, protocol-relative, control characters/backslashes, overlong
  URLs, unparseable strings).
- `npm run verify` passes in full: format/lint/typecheck clean, **78/78 unit tests** (up from 62),
  build unchanged at 22 routes.

**Sub-phase 2 — storage, admin client, media pipeline, publication backend (complete — migrations
pushed and live-verified against a real linked Supabase project):**

- 9 new migrations (`20260804090000` through `20260804090800`) — see
  [docs/architecture.md](architecture.md#media-processing-and-publication-pipeline-prompt-4-sub-phase-2)
  for the full design: two storage buckets + strict-path-parsing RLS; the
  `story_media.processing_state` state machine with a DB-enforced transition trigger and
  state-dependent `CHECK` constraints; `begin_/finalize_/cancel_story_media_upload()` (superseding
  Prompt 3's `attach_story_media()`, dropped); `record_processed_story_media()`/
  `record_story_media_processing_failed()` (service_role-only); `story_publication_attempts` +
  `story_media_public_copy_attempts` (the latter append-and-update, never-delete);
  `begin_story_publication_attempt()`/`finalize_story_publication()` (the atomic publication
  transaction, no `expectedVersion` parameter); `moderate_revision()` narrowed to
  `reject`/`changes_requested` only (`'approve'` now raises); `submit_revision_with_consent()`
  extended to require every attached image be at least `processed`; `get_story_preview()`
  (path-free) + `authorize_story_media_preview()` + `get_media_private_path_for_preview()`
  (service_role-only) + `_can_access_story_media()` (moderator access scoped to the specific
  revision under review, not blanket role access); two `maintenance_*` reconciliation RPCs
  (service_role-only).
- `lib/env.server.ts`: added a lazily-evaluated, separately-exported `getAdminEnv()` for
  `SUPABASE_SERVICE_ROLE_KEY` — never merged into the existing `env` export, so ordinary
  publishable-key code paths never require the secret to be set.
- `lib/supabase/admin.ts` (new service-role client) and `lib/story/image-pipeline.ts` (the one
  module allowed to import it) — enforced by both `server-only` (build-time) and a new
  `no-restricted-imports` ESLint rule (`eslint.config.mjs`), verified directly: a scratch file
  importing the admin client from outside `image-pipeline.ts` was confirmed to fail lint before
  being deleted.
- `lib/story/image-validation.ts` (magic-byte sniffing, size/count/dimension constants) and
  `lib/story/image-pipeline.ts` (the real `sharp`-based decode/strip/resize/hash pipeline, the
  public-bucket copy step, and the signed-URL mint). A real bug was found and fixed while writing
  the test suite: `sharp`'s `metadata().pages` is always `undefined` — even for a genuinely
  animated source — unless the image is decoded with `{ pages: -1 }`; without that option, the
  animated-image rejection check would have silently never fired. Fixed in
  `lib/story/image-pipeline.ts`, verified by `lib/story/image-pipeline.test.ts`, which also proves
  (against a real source image with embedded EXIF, generated via `sharp.withExif()`) that the
  pipeline's output genuinely has no EXIF.
- `scripts/cleanup-abandoned-media-uploads.mjs` (new, `npm run media:cleanup:pending`) — fail-closed
  (dedicated `SUPABASE_MAINTENANCE_*` env vars, project-ref-bound confirm string, dry-run default,
  100-row batch bound), mirroring `scripts/run-rls-cleanup.mjs`'s isolation pattern.
- All 9 migrations applied via `supabase db push` against the linked hosted project
  (`ybhydepjaantkngngvuf`) — `supabase migration list` confirmed local and remote timestamps match
  afterward. `types/database.ts` regenerated for real via `npm run supabase:types:linked`; the
  hand-patched version written before the push typechecked cleanly against the real regenerated
  output with zero changes needed to app code — a useful sanity check, not a substitute for the
  real introspection now in place.
- `npm run verify` passes in full: format/lint/typecheck clean, **89/89 unit tests** (up from 78,
  11 new: `image-validation.test.ts`, `image-pipeline.test.ts`), build unchanged at 22 routes.
  `npm audit` newly surfaces `sharp` by name (previously only `next`/`postcss`) for the exact same
  pre-existing, already-documented `next`-bundled-transitive-dependency advisory
  (`GHSA-f88m-g3jw-g9cj`, `<0.35.0`) — confirmed the flagged node is `next/node_modules/sharp`, not
  this project's own `sharp@^0.35.3` (already the fixed version), so nothing new is actually
  introduced.
- **`npm run test:rls` — 25/25** against the real project, including the new publication-attempt
  flow exercised live end-to-end (`begin_story_publication_attempt` → `finalize_story_publication`
  successfully publishing a text-only revision; a stale/already-approved revision correctly denied
  by `begin_story_publication_attempt`). The pre-existing suite's direct
  `moderate_revision({decision:"approve"})` calls (which now unconditionally raise, as designed)
  were replaced with a small `approveRevision()` test helper going through the real attempt flow —
  all previously-passing Prompt 3 invariants (ownership, consent, revision-safety, withdrawal,
  reporting) still hold. `scripts/rls-test-cleanup.sql` needed a real fix, not just a formality:
  the new `story_publication_attempts`/`story_media_public_copy_attempts` tables' `on delete
restrict` foreign keys to `story_revisions` blocked the existing cleanup order (a genuine
  `23503` violation on the first attempt) — fixed by deleting both, in dependency order, before
  clearing revision pointers; verified by two full clean run → cleanup → clean re-run cycles.
- **Not yet live-verified**: a full round trip through actual Storage (real bytes uploaded →
  processed via `sharp` → copied to the public bucket → publicly readable) — this needs the
  project's service-role secret key, which wasn't available in this session. Explicitly deferred
  to Sub-phase 5's broader integration-test pass per your direction; everything at the DB/RPC layer
  (including the exact sequence a real pipeline run would follow) is live-verified above.
- A discovered plan/code conflict, resolved in favor of the code: the approved plan's decision 4
  (round seven) assumed `_authorize_revision_edit()` grants edit rights to the story's
  `owner_user_id` and `assigned_editor_id` only, deliberately excluding a linked contributor. In
  fact, `_authorize_revision_edit()` is built on Prompt 3's existing `_is_story_owner()`, whose own
  documented semantics already treat a linked contributor as equivalent to the owner for editing
  purposes (`s.owner_user_id = auth.uid() or c.linked_user_id = auth.uid()`) — this is pre-existing,
  live-verified Prompt 3 behavior, not a Prompt 4 decision to make. The upload-authorization
  functions reuse `_authorize_revision_edit()` verbatim (satisfying the plan's deeper intent — never
  drift from the platform's one real edit-rights rule), which means a linked contributor _does_ have
  upload rights, consistent with every other authoring RPC. There is no structural "linked
  contributor with review-only rights, distinct from the owner" state in the current schema to test
  against; the meaningful negative case is a signed-in user who is none of owner/linked-contributor/
  assigned-editor/admin, which is what the Sub-phase 2 test list actually exercises.

**Sub-phase 3 — self-service authoring, drafting, preview (complete — unit/component-tested and
live-verified against the real linked project with a real signed-in test account, see below):**

- `lib/story/rich-text-serialize.ts` (new, pure, no DOM/editor dependency) — `tiptapDocToBlocks()`/
  `blocksToTiptapDoc()` convert between Tiptap/ProseMirror JSON and the canonical block/run/mark
  schema. Defensive on the read path (unsupported node types and mark kinds are dropped, not
  thrown) since the real safety boundary is `storyContentSchema.safeParse()` downstream, not this
  converter. 13 tests, including a full round trip through every block/mark type.
- `components/story/rich-text-editor.tsx` (new) — Tiptap `@tiptap/react` + `@tiptap/starter-kit`
  `^3.29.2` added as dependencies (justification: the plan requires a real rich-text editor
  constrained to exactly the canonical schema's node/mark set; `npm view @tiptap/react
peerDependencies` confirmed `react: "^17.0.0 || ^18.0.0 || ^19.0.0"` before installing — safe
  against this project's React 19). `StarterKit.configure()` explicitly turns off every
  node/mark with no representation in `storyContentSchema` (`underline`, `strike`, `code`,
  `codeBlock`, `horizontalRule`, `hardBreak`), restricts headings to levels 2–3, and wires the
  link extension's `validate` option to `isSafeHref()` so an unsafe href is refused at the editor
  level, not only at the Zod boundary. **Closed-loop test**
  (`components/story/rich-text-editor.test.tsx`, 6 tests): drives a real headless `@tiptap/core`
  `Editor` instance (not a mock) through every allowed command, converts its output via
  `tiptapDocToBlocks()`, and asserts `storyContentSchema.safeParse()` accepts it; separately
  asserts the disallowed commands (`toggleUnderline`, `toggleStrike`, `toggleCode`,
  `toggleCodeBlock`, `setHorizontalRule`, `setHardBreak`) don't exist on this configuration at
  all, and that even a hand-crafted `setContent()` call carrying `underline`/`strike` marks has
  them silently dropped by Tiptap's own schema (no extension registered to represent them).
- `components/story/content-block-renderer.tsx` (new) — renders the canonical schema as real JSX
  (`<p>`/`<h2>`/`<h3>`/`<blockquote>`/`<ul>`/`<ol>`/`<strong>`/`<em>`/`<a>`), never
  `dangerouslySetInnerHTML` (Rule 7); used by the preview page today, reusable unchanged by the
  future public story-reading page since it renders the same schema.
- `lib/story/active-lookups.ts` (new) — `listActiveRegions/Destinations/WorkTypes/Tags()`, each
  filtered to `active = true`, backing the edit form's pickers.
- `lib/story/mutation-queue.ts` (new) — the client-side serialized async mutation queue the plan
  calls for: per-slot coalescing (a new mutation queued for a slot before the previous one starts
  replaces it, so rapid edits collapse to one network call), strict global one-at-a-time execution
  across all slots (so `expectedVersion` chaining is never raced), and a stale-version conflict
  (`isStaleVersionConflict()`, matching the RPCs' own `"Stale version for ..."` message) is
  reported via a callback and never discards in-memory form state. `flush()` awaits everything
  queued or in flight, including work enqueued while it's already waiting. 8 tests covering
  coalescing, strict serial execution (asserted via a max-concurrency counter), conflict vs.
  plain-error routing, and `flush()`'s "wait for latecomers too" behavior.
- Replaced both placeholder pages: `app/(contributor)/stories/new/page.tsx` (title-only form →
  `createDraftAction` → `create_self_service_draft` → redirect to the new edit page) and
  `app/(contributor)/my-stories/page.tsx` (real list from `list_my_stories`, status badges for all
  7 `story_lifecycle_status` values, Edit/Preview links).
- New `app/(contributor)/stories/[id]/edit/` — `page.tsx` (Server Component: `get_my_story_with_draft`
  - the new `get_revision_selections` + `get_story_preview` for the media list + the four active-
    lookup queries, in parallel; renders a "not editable right now" state if the current revision
    isn't `draft`) and `actions.ts` (9 Server Actions — fields/locations/work types/tags/media
    caption/reorder/cover/detach/cancel-pending-upload — every one Zod-validates its input and
    returns `{ok:true} | {ok:false,error}` rather than throwing, so the mutation queue's conflict
    detection keeps working uniformly; ownership is re-derived by the underlying RPC's
    `_authorize_revision_edit()` in every case, never trusted from the client).
    `components/story/story-edit-form.tsx` (client) wires all of the above through one
    `MutationQueue` instance and one `version` ref shared with the image manager — every successful
    mutation bumps it by exactly 1 (confirmed by reading each RPC: `update ... set version =
version + 1` unconditionally on success), a stale-version conflict shows a non-destructive
    "reload to continue" banner rather than silently dropping edits.
- The concrete upload endpoint: `app/(contributor)/stories/[id]/edit/upload/route.ts`
  (`export const runtime = "nodejs"`) — authenticates, rejects an oversized `Content-Length`
  early, buffers via `request.formData()`, sniffs real magic bytes (never trusts the client's
  `File.type`), `begin_story_media_upload()`, uploads via the **regular** (RLS-respecting) server
  client — never the admin client — to the reserved path, `finalize_story_media_upload()`, then
  calls `processStoryMedia()` from `lib/story/image-pipeline.ts` **synchronously in the same
  request** (there is no background worker in this phase — documented as a Sub-phase 5+ candidate
  below). `components/story/image-upload-manager.tsx` (client) does fast client-side pre-checks
  (type/size, UX feedback only — every real decision is server-side), then reorder/cover-
  select/detach (detach only ever calls `detachStoryMedia`, never a delete), alt-text-required-
  unless-decorative enforced both client- and server-side (`updateMediaCaptionAction`).
- New `app/(contributor)/stories/[id]/preview/page.tsx` — calls `get_story_preview()` exclusively
  (never `get_published_story`), `export const dynamic = "force-dynamic"` plus `robots: {index:
false, follow: false}` metadata; `Cache-Control: no-store` is set in `proxy.ts` for this path
  specifically (a Server Component page can influence caching but can't set an arbitrary response
  header itself). Images render via `components/story/preview-gallery.tsx`, which calls the new
  shared `app/(contributor)/stories/[id]/media-actions.ts#mintPreviewUrlAction` — authorizes via
  `authorize_story_media_preview()` on the caller's own regular client **first**, then mints the
  signed URL via `mintMediaPreviewSignedUrl()` from `lib/story/image-pipeline.ts`; the raw storage
  path is never sent to the browser.
- `proxy.ts` matcher extended with a regex pattern (`/^\/stories\/[^/]+\/(edit|preview)(\/.*)?$/`)
  since the existing static-string `PROTECTED_PATHS` list can't express a dynamic `:id` segment;
  manually verified both `/stories/<uuid>/edit` and `/stories/<uuid>/preview` redirect a signed-out
  visitor to `/sign-in?next=<original path>` exactly like the pre-existing protected paths.
- **A real gap found while building this**: `story_revision_locations`/`story_revision_work_types`/
  `story_revision_tags` have RLS enabled with no policies at all (Prompt 3 design — every access is
  a `SECURITY DEFINER` function), but only the _writer_ RPCs
  (`set_revision_locations`/`set_revision_work_types`/`set_revision_tags`) were ever built — there
  was no way for the edit form to read back a draft's already-selected locations/work types/tags on
  page load, which would have made every page reload silently forget them. Added
  `supabase/migrations/20260804091000_get_revision_selections.sql` — a symmetric reader, using the
  exact same edit-rights authorization as the writers (owner, linked contributor, assigned editor,
  admin). The task scope for this sub-phase assumed no new migrations were needed, which turned out
  to be incorrect. **Applied** via `supabase db push` (with your explicit go-ahead) and confirmed in
  sync via `supabase migration list`; `types/database.ts` regenerated for real via
  `npm run supabase:types:linked`, and `lib/story/contributor-queries.ts#getRevisionSelections()`'s
  earlier `as never` type-cast workaround (needed only while the generated types didn't know about
  this RPC yet) was removed in favor of the real generated types.
- `npm install @tiptap/react@^3.29.2 @tiptap/starter-kit@^3.29.2 @tiptap/pm@^3.29.2` — the only new
  dependencies this sub-phase adds.
- `npm run verify`: format/lint/typecheck clean, **112/112 unit tests** (up from 89 — 21 from the
  original implementation, plus 2 more from the live-verification bug fix below), build succeeds
  with 4 new routes (`/stories/[id]/edit`, `/stories/[id]/edit/upload`, `/stories/[id]/preview`,
  and `/stories/new`/`/my-stories` now real instead of placeholders).
- **Live-verified via the dev server, signed in with the real `rls-owner@whv-compass-test.example`
  test account against the real linked project** (the same account pool `npm run test:rls` uses):
  created a real draft ("Picking Apples in Hawke's Bay"), confirmed the signed-out redirect for
  `/stories/new`/`/stories/<uuid>/edit`/`/stories/<uuid>/preview` all correctly bounce to
  `/sign-in?next=...` and land back on the original page after sign-in, typed real body text into
  the Tiptap editor, applied bold to a mid-sentence word, confirmed autosave ("Saved" indicator)
  and the `/my-stories` list showing the new draft with a status badge, and confirmed the private
  preview page renders the same content via `get_story_preview()`.
- **A real, user-visible bug was found this way and fixed**: `lib/validation/story.ts`'s
  `textRunSchema` called `.trim()` on every run's `text` field — correct in isolation, wrong once a
  run is one interior slice of continuous text split at a mark boundary (e.g. `"picking "` /
  `"apples"` (bold) / `" in Hawke's Bay."`), since trimming its edges deletes real inter-word
  spacing. Bolding a mid-sentence word therefore silently produced `"pickingapplesin"` instead of
  `"picking apples in"` — confirmed live by inspecting the actual rendered DOM
  (`picking<strong>apples</strong>in`, no spaces anywhere) before the fix, and
  `picking <strong>apples</strong> in` after it. Fixed by replacing `.trim()` with a
  `.refine((s) => s.trim().length > 0, ...)` check that rejects whitespace-only runs without
  mutating legitimate boundary whitespace on non-whitespace-only ones. Two regression tests added
  to `lib/validation/story.test.ts` (adjacent-run spacing preserved; whitespace-only run still
  rejected). Not caught by the original 21 new tests because none of them happened to construct a
  mid-sentence marked run specifically — a gap in test construction, not in the schema's
  documented intent.
- **Not exercised**: a real image upload through the Route Handler (this session has no real image
  file to upload from), and a second contributor account interacting with someone else's story.
  Deferred to Sub-phase 5's broader integration-test pass, same as Sub-phase 2's deferred Storage
  round trip.

**Sub-phase 4 — editorial import + consent/approval UI (complete — all 8 migrations pushed and
live-verified against the real linked Supabase project, including 2 real security/correctness bugs
found and fixed via a live `test:rls` run performed AFTER the initial push, plus both new
Playwright specs now passing for real — see "Real bugs found via live `test:rls` AFTER the push"
below):**

Built from the approved round-6 plan
(`/Users/user/.claude/plans/implement-sub-phase-4-of-twinkling-feigenbaum.md`, with the
implementation session's own addendum plan recording five independently-verified findings beyond
the plan's own named list — see "Real bugs found this sub-phase" below).

- **8 migrations total** (`20260804092000`–`20260804092700`) — see "Migration summary" below for
  the full list and exact contents. The first 5 (`20260804092000`–`20260804092400`) were written,
  reviewed against Engineering Rules 2/3/10–14, verified read-only against the live linked project
  (see "Pre-push verification performed" below), and pushed via `supabase db push`. The remaining 3
  (`20260804092500`–`20260804092700`) are corrective migrations, written and pushed in the same
  session immediately after a live `test:rls` run against the newly-pushed schema surfaced two real
  bugs in the first 5 (see below). **All 8 are applied; `supabase migration list` confirms
  local/remote timestamps match.**
- `lib/story/rpc-errors.ts` (new) — `isTermsChangedError()` checks `error.code === "WHV01"`,
  matching the already-established `error.code === "23505"` pattern in
  `app/(contributor)/actions.ts`.
- `lib/story/content-import.ts` (new) + 23 tests — `plainTextToBlocks()`/`sanitizeHtmlToBlocks()`
  using `node-html-parser@^9.0.1` (new dependency; justification: a lightweight, Node-runtime-only
  HTML parser was needed to convert arbitrary editor-pasted HTML into the canonical block schema
  without `dangerouslySetInnerHTML` or a full DOM — `jsdom`, already a devDependency, is test-only
  and not meant for production parsing). Full rejection (never truncation) on a UTF-8 byte-length
  ceiling (`MAX_IMPORT_INPUT_BYTES = 2,000,000`, checked before any parsing), a node-count ceiling
  (5,000), and a nesting-depth ceiling (40). Dangerous subtrees (`script`/`style`/`iframe`/etc.)
  removed entirely; safe containers (`div`/`section`/etc.) unwrapped, not dropped; nested
  lists/blockquotes flattened to the schema's flat shapes; `table`/`pre`/`code` converted to plain
  paragraphs; `<br>` splits into two runs within the same block; every produced block validated
  through the real `storyContentSchema` before being returned. `ImportReport` reports exact
  counts/samples (dropped elements, unsupported elements, converted tables/code blocks, attributes
  stripped, unsafe links removed — bounded to a 10-item sample, never logged anywhere).
- `app/(editor)/editorial/import-actions.ts#importStoryContentAction` — the Server Action wrapping
  the above, no `storyId` parameter (pure conversion, touches no row), independently re-checks
  editor/admin.
- `next.config.ts` — `experimental.serverActions.bodySizeLimit = "2.5mb"` (confirmed against the
  installed Next 16.2.12's own shipped type declarations that this is still the correct, non-promoted
  config key), a deliberate +25% margin over `MAX_IMPORT_INPUT_BYTES`, cross-referenced in both
  files' comments.
- **R6-7 fix, live**: `components/story/story-edit-form.tsx`'s `MutationQueue` now derives `saving`
  from `queue.hasPending()` at the moment of settling instead of hardcoding `false`. New test in
  `lib/story/mutation-queue.test.ts` proves the underlying primitive already reports the right thing
  at exactly the moment each of two concurrently-queued slots settles — the bug was in the consumer
  trusting a hardcoded value, not in the queue itself.
- **`save_revision_draft()` now returns the new version** (migration, below); `lib/story/mutations.ts`,
  `app/(contributor)/stories/[id]/edit/actions.ts`, and `story-edit-form.tsx`'s `queueFieldsSave`
  updated to use the real returned value instead of the blind `versionRef.current += 1` fallback —
  scoped to only that one call site, since every other mutation's RPC has nothing else to return and
  already always bumps by exactly 1 unconditionally.
- **Content-import "Use this content" integration** (`components/story/content-import-panel.tsx` +
  new logic in `story-edit-form.tsx`): a synchronous `applyingImportRef` (not just React state)
  excludes autosave races; the destructive replace is enqueued on the SAME `"fields"` mutation-queue
  slot the normal debounced autosave uses (coalescing naturally); visible editor state
  (`setContent`) and the rich text editor's own document are only updated **after** a successful
  save; a failed apply keeps the converted blocks in the panel's own local state for retry.
  - **A real, would-have-been-a-bug found while wiring this up**: `components/story/rich-text-editor.tsx`
    is deliberately _uncontrolled_ (`initialContent` loaded once, by design, per its own existing
    code comment) — calling `setContent(blocks)` alone after a successful import would update the
    React state used to build the _next_ snapshot, but the visible ProseMirror document would stay
    stale. The very next keystroke's `onChange` would then derive its snapshot from the stale
    pre-import document, silently reverting the import on the next autosave. Fixed by adding a
    narrow, additive `RichTextEditorHandle` (`forwardRef` + `useImperativeHandle`,
    `replaceContent(blocks)`) used by exactly one caller (the import-apply success path) — every
    other (self-service) usage of the component is completely unaffected, since it never touches the
    ref.
- **Editorial staff UI** — `app/(editor)/editorial/` gained a real dashboard
  (`list_assigned_editorial_stories`), a new-import form (pick/create a contributor +
  `create_editorial_import_draft`), a contributors list (`is_linked` derived server-side, `linked_user_id`
  never selected into anything passed to a Client Component), an editorial edit page reusing
  `story-edit-form.tsx`/`rich-text-editor.tsx`/`image-upload-manager.tsx`/the upload Route Handler
  completely unchanged (all three already worked for an assigned editor via
  `_authorize_revision_edit()` — confirmed by reading the code before assuming it), and editorial
  controls (mark-ready-for-contributor-review; a clearly non-authorizing "log evidence note" using
  the already-existing-but-previously-UI-less `logEditorialAction()`; "Submit with offline
  confirmation"). Every new editorial Server Action independently calls `getCurrentUserRole()` +
  `resolveStaffAccess()` before touching any RPC — never relies on the `(editor)` route group's
  layout guard alone.
- **Contributor-side UI** — `app/(contributor)/stories/[id]/preview/page.tsx` gained the
  consent-at-submission panel (`components/story/submit-consent-panel.tsx`, shown to
  owner/linked-contributor whenever the current revision is genuinely submittable) and the
  linked-contributor review panel (`components/story/contributor-review-panel.tsx`:
  approve/request-changes/decline, shown only when `viewerRelationship === 'linked_contributor'` and
  `lifecycleStatus === 'awaiting_contributor_approval'`). "Approve" reuses the same consent panel,
  relying on the awaiting-approval submission fix below. `app/(contributor)/my-stories/page.tsx`
  now shows a "Review" CTA instead of a dead "Edit" link while a story awaits this contributor's
  approval (the "review discoverability" fix).

### Real bugs found via live `test:rls` AFTER the push

The 5 original migrations above were pushed, `npm run supabase:types:linked` was run, and then
`npm run test:rls` was run for real against the live project for the first time against this new
schema. It found two genuine bugs — not test artifacts, confirmed by direct inspection of the
resulting database rows, not just a red test — plus one related hardening fix applied proactively
while re-auditing every function this sub-phase touched. Three corrective migrations
(`20260804092500`–`20260804092700`) fixed all three; `npm run test:rls` was then re-run and passes
**33/33**.

1. **Security regression — any authenticated user could overwrite any self-service story's draft**
   (`20260804092600_fix_save_revision_draft_nullable_actor_bug.sql`). `save_revision_draft()` had to
   change its return type from `void` to `integer` (see the un-numbered bullet below about
   returning the new version) — which requires a `DROP FUNCTION` + `CREATE FUNCTION`, not
   `CREATE OR REPLACE`. That `DROP`+`CREATE`, written in `20260804092300`, copied the ownership
   check as `if not (public._is_story_owner(v_story_id) or v_story.assigned_editor_id = auth.uid()) then`
   — silently dropping the `coalesce(..., false)` wrapper that
   `20260803091100_fix_nullable_actor_boolean_logic.sql` (Prompt 3) had already added around this
   exact line for this exact reason. For a self-service story `assigned_editor_id` is `null`;
   `null = auth.uid()` is SQL `NULL`, `false OR NULL` is `NULL`, `NOT NULL` is `NULL`, and PL/pgSQL's
   `if NULL then ... end if` does **not** execute the branch — so the `raise exception` guarding
   ownership was silently skipped, letting any signed-in stranger overwrite any self-service story's
   draft. **Confirmed live, not just via a failing assertion**: the RLS suite's "another user cannot
   read or edit the private draft" hijack attempt against a self-service story actually _succeeded_
   — `story_revisions.title` was genuinely overwritten to `"hijacked"` with `updated_by` set to the
   attacking test account, not the story's owner. Fixed by restoring the `coalesce(...,false)`
   wrapper; no other change to the function.
2. **Ambiguous-column bug reintroducing an already-fixed bug class**
   (`20260804092500_fix_get_my_story_with_draft_ambiguous_column.sql`). `20260804092000_assigned_editor_can_read_draft.sql`
   added `exists (select 1 from public.stories where id = p_story_id and assigned_editor_id = auth.uid())`
   with no table alias — ambiguous, because `get_my_story_with_draft()`'s own `RETURNS TABLE`
   declares an output column also named `assigned_editor_id`, so Postgres can't tell whether the
   bare reference means the table column or the implicit PL/pgSQL output variable. This is the exact
   same bug class already documented and fixed for three other functions in
   `20260803091000_fix_returns_table_column_ambiguity.sql` (Prompt 3) — reintroduced here by not
   applying that same lesson to a new instance. **Confirmed live**: calling the function raised a
   real Postgres `42702 column reference "assigned_editor_id" is ambiguous` error when exercised by
   the RLS suite. Fixed by qualifying the reference with a table alias (`s.assigned_editor_id`), the
   same fix pattern as the earlier migration.
3. **Hardening (not a live-exploited bug, caught by proactive re-audit)**
   (`20260804092700_fix_submit_consent_offline_actor_bug.sql`): the same unwrapped-nullable-actor
   pattern as bug 1, found in `submit_revision_with_consent()`'s offline-confirmation branch
   (`if not (v_story.assigned_editor_id = auth.uid() or public.has_role(auth.uid(), 'admin')) then`).
   In practice this branch is only reachable for `source_kind = 'editorial_import'` stories, and
   `create_editorial_import_draft()` always sets `assigned_editor_id` to a real, non-null value —
   so this has not been observed to be exploitable today. Fixed anyway, on the same
   `coalesce(...,false)` pattern used everywhere else in this codebase, rather than leave a known
   instance of an already-twice-fixed bug class sitting in a function this sub-phase was already
   editing.

### Real bugs found this sub-phase (beyond the round-6 plan's own named list, found pre-push)

1. **The assigned-editor read gap** (plan-named): `get_my_story_with_draft()` authorized only
   `_is_story_owner()`, never the story's `assigned_editor_id`, even though every write RPC already
   granted the assigned editor edit rights. Fixed in `20260804092000_assigned_editor_can_read_draft.sql`.
2. **A fifth source-kind-partition site the plan didn't name**: `submit_revision_with_consent()`'s
   own `confirmation_method = 'account'` branch checked only `auth.uid() <> v_contributor.linked_user_id`,
   with no check against `stories.owner_user_id` for a self-service story. Silently correct only
   because a self-service contributor's `linked_user_id` equals `owner_user_id` at creation time —
   but once contributors can be unlinked/relinked (this same sub-phase's new RPCs), a newly-linked,
   unrelated account would satisfy that check and could submit consent for the _original_ owner's
   self-service story. Found by independently re-deriving the plan's own instruction to
   "re-verify this list yourself," not by trusting the plan's named 4. Fixed in the same migration as
   the terms-version work (already a `DROP`+`CREATE`).
3. **The "awaiting-approval submission dead-end"**: `_revision_is_editable()` requires
   `lifecycle_status in ('draft', 'published')`; `mark_editorial_draft_awaiting_approval()` sets
   `'awaiting_contributor_approval'` and leaves the draft pointer in place. Net effect: a linked
   contributor had **no way to actually approve** an editor-prepared draft — the one RPC the
   "approve" action needs (`submit_revision_with_consent()`) structurally rejected it. Fixed with a
   narrow, same-revision-only carve-out inside that function (not by widening
   `_revision_is_editable()`, which must keep rejecting every other field-editing RPC during
   contributor review — confirmed against its own doc comment before deciding this).
4. **`my-stories/page.tsx`'s dead "Edit" link**: `current_draft_revision_id` stays set while a story
   is `awaiting_contributor_approval` (only the lifecycle status changes), so the pre-existing
   `editable = Boolean(story.current_draft_revision_id)` check rendered a working-looking "Edit" link
   into a page that would always reject every save. Fixed by also checking
   `lifecycle_status !== 'awaiting_contributor_approval'` and showing "Review" instead.
5. **The `/editorial` route-conversion 404 gap — found live, exactly as the plan warned it might
   need to be**: a `curl -i` against a freshly built `app/(editor)/editorial/layout.tsx` (role check
   at the very top of a plain, non-streaming Server Component, no `loading.tsx`/Suspense anywhere
   under it) still returned **HTTP 200** for a signed-out visitor, with the real 404 only appearing
   deep inside the streamed RSC payload (`NEXT_HTTP_ERROR_FALLBACK;404`) — the exact failure mode
   `docs/architecture.md` already documents as the reason Prompt 1 chose Route Handlers over pages in
   the first place. **Fixed by moving the authorization gate into `proxy.ts` (middleware)**, which
   runs before any RSC streaming and can set a real response status directly: `/editorial` and every
   sub-path now get a genuine `404` (identical JSON body to the existing `/moderation`/`/admin`
   stubs) for both signed-out and signed-in-with-the-wrong-role requests, verified two ways —
   directly via `curl -i` after the fix, and via the pre-existing
   `e2e/home.spec.ts#"staff routes fail closed with a not-found response"` test (which already
   asserted `/editorial` specifically and now genuinely passes against real HTTP status, not
   incidentally). The layout's own `notFound()` call is kept as a defense-in-depth backstop, but the
   middleware check is what actually produces the guarantee.

### Pre-push verification performed (read-only, against the live linked project — no write/DDL run)

Using the project's own Supabase MCP tooling (`execute_sql`, `list_migrations` — SELECT-only, no
`apply_migration` call made):

- `list_migrations` confirmed all 32 previously-applied migrations match this document's migration
  summary exactly, through `20260804091000_get_revision_selections` — no drift.
- `pg_get_function_identity_arguments`/`pg_get_function_result` for the live, current signatures of
  every function this sub-phase's migrations touch — confirmed exactly matching what the new
  migrations' `DROP FUNCTION`/`CREATE OR REPLACE` statements assume:
  `submit_revision_with_consent(uuid, integer, text, boolean, boolean, identifiable_people_state, boolean) returns void`,
  `save_revision_draft(uuid, integer, text, text, jsonb, date, date, smallint, text, integer, text) returns void`,
  `get_my_story_with_draft(uuid)` (table-returning, unchanged), `_is_story_owner(uuid) returns boolean`,
  `link_contributor_to_user(uuid, uuid, text) returns void`, `contributors_protect_privileged_fields()`
  (trigger, no args).
- `pg_depend` dependency checks for both functions about to be `DROP`ped
  (`submit_revision_with_consent`'s and `save_revision_draft`'s exact current signatures above) —
  **zero rows for both**, confirming the planned `DROP FUNCTION` calls are safe.
- `information_schema.columns` for `contributor_links` — confirmed `event_type` does not already
  exist, so the new migration's `ADD COLUMN` is additive and collision-free.

### Post-push verification (completed)

All of the following has now actually happened, in this order, against the real linked project
(`ybhydepjaantkngngvuf`):

1. `supabase db push` applied `20260804092000`–`20260804092400` (the 5 original migrations).
   `npm run supabase:types:linked` regenerated `types/database.ts` for real. The documented
   `callUntypedRpc()` escape hatch / inline-cast `TODO`s in `lib/story/mutations.ts` and
   `lib/story/editorial-queries.ts` were removed in favor of the real generated types — confirmed
   still true this session (`grep -n "callUntypedRpc\|as never"` over both files returns nothing).
2. `npm run test:rls` run for real against the new schema — **found the two bugs and one hardening
   fix documented above under "Real bugs found via live `test:rls` AFTER the push."**
3. Three corrective migrations (`20260804092500`–`20260804092700`) written and pushed via
   `supabase db push`. `supabase migration list` confirms all 8 Sub-phase-4 migrations are in sync
   between local and remote.
4. `npm run test:rls` re-run — **33/33 passing**, including: assigned-editor read access; `WHV01` on
   a mismatched `p_expected_terms_version`; the awaiting-approval submission path end-to-end;
   **R6-9** (self-service story + owner; editor unlinks/relinks the same contributor to `other`;
   `owner` keeps full access via every read path, and `other` cannot submit consent for `owner`'s
   story either); **R6-8** (link→unlink→relink audit-trail reconstruction); **R6-2**
   (GUC/internal-helper unreachability, direct-`UPDATE` rejection in both directions); and the
   hijack-attempt test that had actually succeeded against the pre-corrective-migration schema
   (bug 1 above) now correctly fails.
5. `e2e/editorial-upload.spec.ts` and `e2e/content-import-body-size.spec.ts` both run for real
   against the live project with real editor credentials from `.env.test.local` — **4/4 passing**
   (1 upload spec + 3 body-size-margin specs). One test-fixture bug was found and fixed while
   running these (not an app bug): `content-import-body-size.spec.ts`'s `BELOW_PRODUCT_LIMIT`
   fixture (`"Paragraph one.\n\nParagraph two.\n\n".repeat(500)`) produced 1000 paragraph blocks,
   exceeding `storyContentSchema`'s separate 200-block cap (`lib/validation/story.ts`, independent
   of the 50,000-character document cap the fixture's own comment accounted for) — so the real
   conversion logic correctly rejected it as `invalid_content` (schema validation failure) rather
   than succeeding, which the test's assertion hadn't anticipated. Not a security or product bug:
   the schema behaved exactly as documented. Fixed by reducing the fixture to `.repeat(80)` (160
   blocks, ~2.6KB), which reaches the success path the test is actually named for, and updated the
   fixture's comment to record the 200-block constraint. This also means the editorial-upload spec
   newly exercises the previously-deferred Sub-phase 2 gap ("a full round trip through actual
   Storage... real bytes uploaded → processed via `sharp` → copied to the public bucket") for real,
   end-to-end, through the actual UI.
6. **`npm run e2e:cleanup:editorial-fixtures -- --execute` was attempted, with explicit go-ahead,
   and failed closed before touching anything**: it requires `.env.maintenance.local` (service-role/
   maintenance credentials, `SUPABASE_MAINTENANCE_*`, mirroring `cleanup-abandoned-media-uploads.mjs`'s
   established pattern), and that file does not exist in this environment (`node:
.env.maintenance.local: not found`) — the same service-role-key unavailability documented since
   Sub-phase 2. **Accepted, not resolved this session**: one contributor + one story + its uploaded
   image, created by the two Playwright specs' real runs, remain on the hosted project. Low-cost,
   disposable test fixture data on the disposable dev project — revisit only if it ever becomes
   noisy enough to matter, or whenever `.env.maintenance.local` is set up for another reason.
7. **`npm run test:rls:cleanup` was run, with explicit go-ahead, and succeeded.** `scripts/run-rls-cleanup.mjs`
   has no dry-run mode — it only gate-checks that `SUPABASE_RLS_TEST_URL`/`SUPABASE_RLS_TEST_PROJECT_REF`/
   `SUPABASE_RLS_TEST_CONFIRM` are set and match the target project (a misfire guard, not a preview
   mode), then unconditionally executes `scripts/rls-test-cleanup.sql`'s real `DELETE` statements via
   `supabase db query --file ... --linked`. Ran clean; verified directly afterward
   (`select count(*) from stories where slug like 'rls-test-%'` → `0`) — every fixture this
   sub-phase's `test:rls` runs created (including the row briefly titled `"hijacked"` by the
   confirmed-then-fixed security regression above) is gone from the hosted project.

### Locally verified this sub-phase (no hosted write involved)

`npm run lint`/`typecheck`/`test`/`build` all pass — **137 unit tests** (up from 112 at the end of
Sub-phase 3: 23 new for `content-import.ts`, 1 new `mutation-queue.test.ts` case for R6-7, and 1 new
`submitRevisionSchema` case, plus an existing `submitRevisionSchema` test updated for the new
required `expectedTermsVersion` field) — **re-confirmed after the 3 corrective migrations landed**
(they touch only SQL, no TypeScript, so this was expected to still hold, and it does: 137/137 unit
tests, clean lint, clean typecheck, and a clean build with the same 25 routes both before and after).
Build succeeds with 4 new routes (`/editorial`, `/editorial/new`, `/editorial/contributors`,
`/editorial/[id]/edit`) and 1 removed (`/editorial`'s old stub `route.ts`). The pre-existing
`e2e/home.spec.ts`/`e2e/auth.spec.ts` (8 specs, no real credentials needed) all pass, including the
staff-route 404 check now covering `/editorial` for real. `npm run format:check` fails only on a
single **pre-existing, unrelated, untracked** file (`docs/design-brief.md`, present before this
session started, not touched by this sub-phase) — not a regression from this work.

**Sub-phase 4 is complete.**

**Sub-phase 5 — broader integration tests / final docs (complete):**

The two gaps this session's Sub-phase 3/4 write-ups above deferred forward are both now closed:

- **The Storage byte round trip** (upload → real `sharp` processing → public-bucket copy),
  deferred since Sub-phase 2, was already closed by Sub-phase 4's own `e2e/editorial-upload.spec.ts`
  — re-confirmed here, not re-built.
- **A second contributor account interacting with someone else's story through the actual UI**,
  deferred since Sub-phase 3, is now covered by a new spec,
  `e2e/cross-contributor-access.spec.ts`. It signs in as the fixed `owner`/`other` test accounts (a
  spot-check also uses `editor`) in fully independent browser contexts and, using real
  `page.goto()`/`page.request.post()` calls against a real `npm run start` server, proves one
  contributor's session cannot read, preview, or upload to another contributor's draft. This closes
  a real, distinct gap the RLS suite couldn't: `tests/integration/story-rls.integration.test.ts`
  proves the _database_ rejects cross-account access; nothing previously proved the _page layer_
  (Server Components, `notFound()`, Route Handlers) fails closed the same way against a real browser
  session.

**This spec found a real, live-reproducing bug** — the exact question left open by Sub-phase 4's own
`/editorial` fix (had anyone checked the _per-row_ case, as opposed to the _role-level_ case that
fix addressed?). `get_my_story_with_draft()` and `get_story_preview()` both `RAISE EXCEPTION` for an
unauthorized caller rather than returning zero rows; `app/(contributor)/stories/[id]/edit/page.tsx`
and `app/(editor)/editorial/[id]/edit/page.tsx` never even catch that exception (it reaches Next's
generic error boundary), and `app/(contributor)/stories/[id]/preview/page.tsx` _does_ catch it and
call `notFound()` — but live-verified via real Playwright navigations, **all three routes still
returned a live HTTP 200** to a per-row-unauthorized visitor, never the actual data, but the wrong
status and a generic/not-found-looking page instead of a real 404. Fixed the same way Sub-phase 4
fixed `/editorial`'s role-level version of this: `proxy.ts` now runs the same authorization RPC
itself (`canReadStoryDraft()`/`canPreviewStory()`), before any RSC render can commit a 200, and
returns a real, flat 404 directly if the caller isn't authorized for that specific row. Re-verified
directly (`response.status()` in Playwright) after the fix: all three routes now return a genuine
404 for an unauthorized visitor, and unchanged 200s for legitimately-authorized ones (confirmed via
the pre-existing `e2e/editorial-upload.spec.ts`/`e2e/content-import-body-size.spec.ts`, which still
pass unmodified, plus a same-session sanity check inside the new spec itself). The upload Route
Handler was checked too and needed no fix — Route Handlers already set real status codes directly
(it already returned a genuine `400` to an unauthorized caller, since a Route Handler doesn't go
through the same RSC-render path a page does).

**Locally verified:** unit test count is unchanged at **137/137** — this sub-phase added no new
`lib/` code, only the new Playwright spec and the `proxy.ts` fix (which touches no unit-tested
surface directly; its behavior is covered by the new e2e spec instead). `npm run lint`/`typecheck`/
`build` all clean; `npm run format:check` is now clean across the **whole** repo, including
`docs/design-brief.md` (a pure `prettier --write`, zero content change — that file is untracked,
Prompt 5 planning material unrelated to this sub-phase, left otherwise untouched) and this document
plus `docs/implementation-status-human.md` (both had drifted out of Prettier's formatting since an
earlier session's edits; also a pure whitespace/table-reflow fix here, no content change beyond
what's described in this write-up). `npm run test:rls` re-run: still 33/33, unaffected (this
sub-phase's only non-test code change, `proxy.ts`, touches no RPC the suite covers).

Also disposed of by this sub-phase, per the approved plan's "Out of scope" reasoning (not rebuilt,
not re-litigated):

- `npm run e2e:cleanup:editorial-fixtures -- --execute` remains blocked on a missing
  `.env.maintenance.local` (no service-role key available in this environment) — unchanged from
  Sub-phase 4's finding, re-affirmed rather than re-attempted. The existing "low-cost, disposable
  test fixture data" acceptance stands.
- `docs/design-brief.md`'s content and purpose are out of scope for Prompt 4 entirely — traced to a
  separate Prompt 5 UI-planning session; only its formatting was touched, per above.

**Prompt 4 is now fully done — all 5 sub-phases complete.** See "Next prompt" below.

## Prompt 5 detail — complete

Public discovery (`/`, `/stories`, `/stories/[id]`, `/contributors`, `/contributors/[slug]`), SEO
(metadata/canonical/JSON-LD/sitemap/robots), search/filter/pagination, and reader reporting UI. Full
design account, including every decision and tradeoff, is in
[docs/architecture.md](architecture.md#public-discovery-and-seo-prompt-5) — not duplicated in full
here.

- **5 new migrations** (`20260805100000`–`20260805100400`): revoke `anon`'s direct table grants on
  `contributors` (a real pre-existing gap found via audit, not introduced this prompt);
  `list_published_stories()` extended with cover image/regions/work_types/tags/cost-band/
  expense-availability/exclude-story-id/search (plus a new `search_vector` generated column + GIN
  index on `story_revisions`); `list_distinct_public_travel_styles()`; `list_public_contributors()` +
  `get_public_contributor()`; a corrective migration fixing a real ambiguous-column bug in
  `list_published_stories()` (see below). All applied via the Supabase MCP `apply_migration` tool
  (no Supabase CLI available in this environment — same limitation as every prior prompt, see "Local
  vs. hosted Supabase development" in architecture.md) and reviewed with `execute_sql` beforehand
  (grant/`pg_depend` checks) and `get_advisors` afterward (only the expected, already-established
  "anon can execute SECURITY DEFINER function" warnings, nothing new). `types/database.ts`
  regenerated for real via the MCP `generate_typescript_types` tool.
- **User decisions locked in during planning**: cost bands (<$5k / $5k–15k / $15k–30k / $30k+, NZD,
  exact cent boundaries `500000`/`1500000`/`3000000`); contributor avatars deferred entirely
  (`contributors.avatar_path` has no upload/processing/moderation pipeline and none was built here —
  a distinct image-pipeline feature, out of scope; public contributor pages render a text-initial
  placeholder only).
- **`proxy.ts`** gained a public per-row 404 check (`publishedStoryExists`/`publicContributorExists`,
  matching `/stories/:id`/`/contributors/:slug`) — a real gap found live via Playwright: a
  non-existent slug returned HTTP 200 (the same "deep `notFound()` doesn't set a real status"
  failure mode already documented for `/editorial` and the Prompt 4 Sub-phase 5 per-row leaks, this
  time on a public, non-security-sensitive route). Returns a small real-HTML 404, not the flat JSON
  staff routes use — a public 404 isn't a stealth response.
- **`lib/supabase/public.ts`** (new, cookie-free client) — `lib/supabase/server.ts` calls
  `next/headers`' `cookies()`, which unconditionally forces dynamic rendering regardless of `export
const revalidate`; every function in `lib/story/public-queries.ts` now uses the cookie-free client
  instead, which is what actually lets `/` and `/sitemap.xml` build as static routes. `/stories`,
  `/stories/[id]`, `/contributors`, `/contributors/[slug]` still render dynamically regardless
  (`searchParams` / un-enumerated dynamic segments), documented as such rather than overclaimed.
- **Route rename**: `app/(public)/stories/[slug]/` was renamed to `app/(public)/stories/[id]/`
  mid-implementation — Next.js requires every route sharing a URL position across route groups to
  use the same dynamic-segment name, and `(contributor)/stories/[id]/edit`/`preview` already existed
  with `[id]`. Caught immediately by `npm run build` (`"You cannot use different slug names for the
same dynamic path"`); the value itself is still a slug, not a UUID.
- **A real, previously-undiscovered bug**: `list_published_stories()`'s lateral consent-lookup
  subquery has always had a bare `story_id` reference, ambiguous against the function's own `returns
table (story_id uuid, ...)` — the exact bug class already fixed twice before in this codebase
  (`20260803091000`, `20260804092500`). This specific line was in fact already fixed correctly once
  (`20260803091000`), but this prompt's `DROP FUNCTION`/`CREATE FUNCTION` (needed for the new return
  columns) was authored from a stale, pre-fix copy of the function body and silently reintroduced
  it. Never caught by the pre-existing 33 `test:rls` cases (`list_published_stories` had no real
  caller before this prompt — the page it powers was a placeholder) — found live by
  `app/sitemap.ts`'s build-time call, its first-ever real invocation, and `npm run build` failing
  outright with `42702`. Fixed in a corrective migration (`20260805100400`).
- **`scripts/rls-test-cleanup.sql`** gained `set session_replication_role = replica` around its
  deletes — a real gap found live: the new "no duplicate story rows" test case attached work
  types/tags to a revision and then approved it, and the cleanup script's later `delete from
story_revision_work_types`/`tags` was rejected by `_protect_revision_child_immutability()` (a
  protection meant for ordinary application mutation, not this already-guarded, dev-only teardown
  script). Reset to `default` at the end of the script.
- **44/44 `npm run test:rls`** (up from 33), including new coverage for: exact cost-band cent
  boundaries; `p_has_reported_expense` true/false/omitted; `p_search`/`p_exclude_story_id`; no
  duplicate story rows when multiple work types/tags are attached; `list_distinct_public_travel_styles()`
  case-insensitive/whitespace dedup and public-only scope; `list_public_contributors()`/
  `get_public_contributor()` excluding private/anonymous-attribution/zero-story contributors; direct
  `anon` table access to `contributors` now rejected (`42501`). One real test-methodology finding
  along the way: `websearch_to_tsquery('simple', ...)` on a hyphenated query string matches as a
  strict phrase against the document's whole hyphenated compound token, so a partial hyphenated
  substring search never matches — confirmed directly against the live database
  (`to_tsvector`/`websearch_to_tsquery` inspection) before adjusting the test fixtures to
  space-separated words, which is also what a real user's search query looks like.
- **24/24 `npx playwright test e2e/`** (up from 19), including the new `e2e/public-discovery.spec.ts`
  (mobile-viewport-first browse/filter/search, desktop filter visibility, story detail rendering +
  canonical link, real 404s for non-existent story/contributor slugs, signed-out vs. signed-in report
  flow, sitemap/robots content). One real UI bug found and fixed along the way: the filter bar's
  mobile disclosure was originally a native `<details>` element with a CSS override intended to force
  it open at the `sm:` breakpoint — live-verified (Playwright, real Chromium) that a closed
  `<details>`'s children stay hidden from both the accessibility tree and visual layout even under a
  `display: block !important` override; replaced with the same explicit-`useState` disclosure pattern
  `components/mobile-nav-toggle.tsx` already used. A second, narrower finding: Playwright's
  `getByLabel()` with an anchored regex (`/^region$/i`) unreliably reported zero matches against a
  correctly-implicitly-labelled native `<select>` in this Chromium build, confirmed via direct DOM/
  computed-style/ARIA-snapshot inspection to be a real element correctly rendered and accessible — a
  tooling quirk, not an app defect; the spec uses a direct `select[name="region"]` locator instead.
- **153/153 unit tests** (up from 137), including `lib/validation/discovery.test.ts` (the new
  search-param parser — every field parses independently, a bad value for one field never fails the
  whole page) and `components/story/{story-card,filter-bar}.test.tsx`.
- `npm run verify` passes in full: format/lint/typecheck clean, build succeeds (`/`, `/sitemap.xml`
  static; `/stories`, `/stories/[id]`, `/contributors`, `/contributors/[slug]` dynamic, as expected
  given the caching section above).
- **Left as accepted debris**, matching this codebase's existing precedent for disposable RLS-test
  lookup rows (regions/destinations): the `contributors` rows created by the new
  `list_public_contributors`/`get_public_contributor` RLS test case (private/zero-story/
  anonymous-attribution/real-public fixtures) are not cleaned up —
  `scripts/rls-test-cleanup.sql` has never touched `contributors` (the fixed test-account pool must
  survive every cleanup run), and these are genuinely new rows, not pool accounts. Low-cost,
  disposable, on the same disposable dev project.
- **Not built, deliberately out of scope**: contributor avatar upload/processing (see "user
  decisions" above); on-demand cache invalidation for the actual publish/archive path (no real
  caller exists yet — Prompt 6's job, see architecture.md's "Caching and invalidation"); a dedicated
  search service (basic Postgres full-text is appropriate at this scale).

## Prompt 6 detail — Stage 1

Backend/migrations only, per this stage's explicit scope — no `app/(moderation)/`/`app/(editor)/`
route files were touched. Full technical account (design decisions, judgment calls) is in
[docs/architecture.md](architecture.md#editorial-and-moderation-workspace-backend-prompt-6-stage-1);
not duplicated in full here.

**Built:**

- 8 new migrations (`20260805100500`–`20260805101200`) — see "Migration summary" below for the full
  list. Every one follows the established template (`set search_path = ''`, re-derive caller
  identity/role, lock+version-check rows being mutated, specific exceptions, explicit
  `revoke`-then-`grant execute ... to authenticated`, never `anon`).
- **A real instance of this codebase's own documented "SQL three-valued logic" bug class was found
  and fixed during review, before this migration was ever pushed**:
  `reassign_editorial_story()`'s authorization check originally read
  `(assigned_editor_id is null and p_editor_id = auth.uid()) or (assigned_editor_id = auth.uid())`.
  When `assigned_editor_id IS NULL` and `p_editor_id <> auth.uid()`, the first clause is `false` and
  the second is `NULL` (nullable-column comparison) — `false or NULL` is `NULL`, and PL/pgSQL's
  `if not (NULL) then raise` never executes, exactly the pattern already fixed four times elsewhere
  in this codebase (`20260803091100`, and its Prompt 4/5 recurrences). Net effect: any editor could
  have silently reassigned an unclaimed editorial-import story to an arbitrary third party, which
  must be admin-only per this function's own stated rule. Fixed, before push, by wrapping the second
  clause in `coalesce(..., false)` — see the migration's own updated header comment. This was caught
  by a manual review pass reading every new/changed function's nullable-actor comparisons line by
  line immediately before pushing, not by an automated test (the written test suite did not happen to
  exercise this exact null/mismatch combination) — a gap worth remembering for future stages.
- Every `DROP FUNCTION`+`CREATE FUNCTION` in this stage was diffed against the **current** live body —
  read via the latest migration that actually touched each function (not an earlier copy) — per the
  "reconstruct from a stale copy" lesson documented in docs/architecture.md's Prompt 4/5 recurrences
  of that exact bug class. Confirmed no other function body anywhere in `supabase/migrations/` calls
  any of `archive_story()`/`resolve_report()`/`list_reports_for_staff()`/`get_moderation_queue()`/
  `get_story_for_moderator()` as a dependency (grepped), so each `DROP FUNCTION` is safe.
- `lib/story/moderation.ts`: `moderateRevision()`'s `decision` type narrowed to
  `"reject" | "changes_requested"` (the `'approve'` branch was already dead code — the RPC itself has
  raised on `'approve'` since Prompt 4 Sub-phase 2). New typed wrappers:
  `beginStoryPublicationAttempt()`, `finalizeStoryPublication()`, `reassignEditorialStory()`,
  `listEditorialQueue()`, `getStoryModerationHistory()`, `getStoryEditorialHistory()`,
  `getPublishedRevisionSnapshot()`, `getReportNotes()`; updated `archiveStory()` (reason required),
  `getModerationQueue()`/`getStoryForModerator()`/`listReportsForStaff()`/`resolveReport()` (new
  params/shapes). Initially written against `lib/supabase/call-untyped-rpc.ts#callUntypedRpc()`
  (this codebase's established escape hatch) while the migrations were unpushed; **after the push and
  a real `npm run supabase:types:linked` regeneration (below), every `callUntypedRpc()` call site in
  this file was converted back to a plain, fully-typed `supabase.rpc(...)` call**, and the now-unused
  import removed — the same cleanup this codebase already did once before in Prompt 4 Sub-phase 4.
  `lib/supabase/call-untyped-rpc.ts` itself is left in place (still referenced in a test-file comment,
  and available for the next stage that writes migrations ahead of a push).
- No new pure helpers were added to `lib/validation/` — the brief invited them only "if genuinely
  useful," and every filter/pagination concern this stage introduces (status/category/date-range
  filters, `p_limit` clamping) is enforced server-side, in SQL, at the RPC boundary; inventing a
  client-side mirror of that validation with no current caller (Stage 2 owns the UI that would need
  it) would have been exactly the kind of unneeded abstraction the brief warned against.
- `tests/integration/story-rls.integration.test.ts` gained coverage for: editor denial of
  `moderate_revision`/`begin_story_publication_attempt`/`finalize_story_publication`; required
  archive reason (empty/null/stale-version rejected, valid succeeds); moderator-cannot-reassign an
  editorial story, editor claim/hand-off/self-service-rejection/stale-version rules; serious-category
  report-note enforcement (`harassment` rejected without a note, succeeds with one, `reviewing`
  needs no note, `spam_commercial` succeeds either way, an editor can't resolve or read notes);
  immutability of `story_report_notes`/`story_publication_state_actions`/`editorial_actions` (direct
  update/delete rejected); queue access/filters/deterministic pagination for
  `get_moderation_queue()` (including the `resubmission` label and an unknown-`p_status` rejection),
  `list_reports_for_staff()`, and `list_editorial_queue()`; `get_story_for_moderator()` never
  returning `linked_user_id`/`created_by`/`owner_user_id`-shaped keys and reading attribution from the
  consent snapshot; a moderator's direct `contributors` select returning nothing beyond the
  public/self-service policies now that the staff policy is narrowed; `get_story_moderation_history()`/
  `get_story_editorial_history()` access (moderator/admin yes, editor denied for moderation history);
  `get_published_revision_snapshot()`. New tests were written using the file's existing
  `untypedRpc()` helper (a new narrow `untypedTable()` sibling was added for the two new tables)
  while the migrations were still unpushed; **left as-is after the push** rather than refactored to
  the now-real generated types, since the tests pass either way (69/69, see below) and the priority
  after a push is re-running the suite for real, not a cosmetic typing cleanup — a future stage
  touching this test file may convert these call sites to typed ones opportunistically.

**Verified this session, initially with no live database involved:** `npm run format:check`, `lint`,
`typecheck`, `test` (**153/153**, unchanged — no new pure helpers were added, so no new unit tests
were needed), and `build` (27 routes, unchanged from Prompt 5 — this stage adds no new pages) all
passed before anything was pushed.

**Then, with your explicit go-ahead, pushed and live-verified for real:**

- All 8 migrations applied to the linked project (`ybhydepjaantkngngvuf`) via the Supabase MCP
  `apply_migration` tool, in filename order, immediately after the nullable-actor bug above was found
  and fixed in the local file (so the pushed version of `reassign_editorial_story()` is the corrected
  one — the vulnerable version was never live).
- `npm run supabase:types:linked` (via the MCP `generate_typescript_types` tool) regenerated
  `types/database.ts` for real; confirmed it now declares every new/changed function
  (`reassign_editorial_story`, `list_editorial_queue`, `get_moderation_queue`, `story_report_notes`,
  `story_publication_state_actions`, etc.) with the expected argument/return shapes.
- `lib/story/moderation.ts` converted from `callUntypedRpc()` back to plain typed `supabase.rpc(...)`
  calls (see above) — `npm run verify` re-run afterward, still clean: 153/153 unit tests, clean
  lint/typecheck/format, build unchanged at 27 routes.
- **`npm run test:rls` — 69/69 passing** (up from 44 at the end of Prompt 5), confirming both that
  every `DROP FUNCTION`+`CREATE FUNCTION` was reconstructed correctly from the live body (no
  ambiguous-column or missing-grant surprises) and that the fixed `reassign_editorial_story()`
  authorization rule behaves as intended against the real database.
- `get_advisors` (security) was run and reviewed; no new advisories beyond the pre-existing,
  already-documented ones from Prompt 5.
- **Not yet done, and not required by this session's instruction**: `npm run test:rls:cleanup` —
  this stage's new test fixtures (reassignment/report-note/queue-filter rows) remain on the linked
  dev project, the same "accepted low-cost debris" category as every prior stage's disposable
  fixtures (see "Risks" below). Can be run on request.

**Deviations from the brief, and why:**

- The literal parameter list given for `reassign_editorial_story()`
  (`p_note text default null, p_expected_version integer`) is not valid PostgreSQL — a
  parameter without a default cannot follow one that has a default, positionally. Declared
  `p_expected_version integer default null` instead, with an explicit `raise exception` if it's ever
  actually null, preserving "required in practice" while staying syntactically valid. Documented in
  the migration's own header comment.
- `reassign_editorial_story()` is restricted to `source_kind = 'editorial_import'` stories, not
  every story — self-service stories have no "prepared by" editor concept to reassign (confirmed by
  grep: no self-service authoring function ever sets `assigned_editor_id`).
- `get_moderation_queue()`'s `submission_kind` precedence (`'resubmission'` overrides
  `'replacement'` whenever both would technically apply) is a judgment call the brief explicitly
  invited — documented in the migration's own SQL comment, not asserted as the only valid reading.

**A real, pre-existing gap found while implementing item 2 (editorial reassignment), left unfixed as
out of scope for Stage 1:** `create_editorial_import_draft()` always resolves `p_assigned_editor_id`
via `coalesce(p_assigned_editor_id, auth.uid())` — there is no RPC path today that leaves
`assigned_editor_id` null on an editorial-import story. This means the "unclaimed pool" branch both
`reassign_editorial_story()` and `list_editorial_queue()` support (per the brief's own "an editor can
claim an unassigned...story" language) can never actually be exercised against a story created
through the real API as it exists today — the RPC logic is written and correct for that case, but
nothing produces the precondition. Flagged here rather than silently assumed away; Stage 2 or a later
prompt should decide whether an explicit "unassign" capability is warranted, or whether the founding
catalogue import process is expected to seed some stories with a null `assigned_editor_id` directly
(bypassing the RPC, e.g. via a one-time data migration) instead.

**Not built, deliberately out of scope for Stage 1** (per the task's own boundary): any UI under
`app/(moderation)/` or `app/(editor)/`; the media-copy-then-finalize Server Action orchestration that
will call `beginStoryPublicationAttempt()`/`finalizeStoryPublication()`/`copyStoryMediaToPublic()`
together; wiring any of this stage's new/changed functions into an actual page.

## Prompt 6 detail — Stage 2

UI/orchestration layer on top of Stage 1's backend. Full technical account (design decisions, the
approve-flow partial-failure contract, the two new migrations) is in
[docs/architecture.md](architecture.md#moderationeditorial-workspace-ui-and-orchestration-prompt-6-stage-2);
not duplicated in full here.

**Built:**

- `app/(moderation)/moderation/route.ts` deleted; replaced with `layout.tsx` (role check, mirrors
  `app/(editor)/editorial/layout.tsx`), `moderation-nav.tsx`, `page.tsx` (minimal landing),
  `stories/page.tsx` (filterable/paginated queue — status/source/region/work-type/consent-method/
  date-range, first/replacement/resubmission labels, no bulk-approve control), and
  `stories/[id]/page.tsx` (the review page — `[id]` is a **revision id**, see architecture.md for
  why). The review page renders: the exact submitted revision's content, a before/after two-column
  diff against the published snapshot when it's a replacement (via the existing
  `ContentBlockRenderer`, no new diff library), attribution/consent/image-rights state, moderation
  history and editorial history in separate labeled sections (never merged), the story's open
  reports, and media processing state.
- `app/(moderation)/moderation/stories/[id]/actions.ts` — `approveStoryAction()`,
  `moderateDecisionAction()` (reject/changes_requested, required reason), `archiveStoryAction()`
  (required reason, re-derives slug server-side). Every action independently re-checks
  `resolveStaffAccess(await getCurrentUserRole(), ["moderator", "admin"])`.
- `lib/story/publish-orchestration.ts#runApproveOrchestration()` — the begin → copy-media → finalize
  loop, factored out as an injectable-dependency pure function specifically so its partial-failure
  behavior is unit-testable without a real Supabase client or real storage. See architecture.md for
  the exact contract; summary: any media-copy failure stops the loop immediately and `finalize` is
  never called, leaving the attempt `active`/recoverable.
- `lib/validation/moderation.ts` — new file (this codebase's existing "one Zod file per domain when
  it doesn't cleanly fit an existing one" convention): search-param parsers for the moderation queue
  and editorial queue (same "every field parses independently, never throws" convention as
  `lib/validation/discovery.ts`), and Server Action input schemas (`moderateDecisionSchema`,
  `approveStorySchema`, `archiveStorySchema`, `reassignEditorialStorySchema`, `resolveReportSchema`).
- `app/(editor)/editorial/page.tsx` rewritten to call `listEditorialQueue()` (status filter +
  free-text search + pagination via `total_count`) instead of the flat `listAssignedEditorialStories()`
  — a single filterable view, not separate tabs (documented judgment call, see architecture.md).
  `app/(editor)/editorial/reassign-actions.ts` + `reassign-form.tsx` add the reassignment control
  (editor/admin only, raw target-editor-id field — no staff-directory function exists to build a
  picker, see "Gaps found" below). `app/(editor)/editorial/editorial-history-panel.tsx` (new,
  read-only) is rendered on `app/(editor)/editorial/[id]/edit/page.tsx` in every state that page can
  render.
- `proxy.ts`: `STAFF_MODERATION_PATH` (mirrors `STAFF_EDITORIAL_PATH` exactly) and
  `MODERATION_REVIEW_PAGE_PATH` + `canViewModerationReview()` (per-row check for
  `/moderation/stories/[revisionId]`, via the new `can_view_moderation_review()` RPC — deliberately
  not a reuse of `get_story_for_moderator()`, which would fetch the entire review payload on every
  request just to decide a 404).
- Two new migrations, reviewed against Engineering Rules 2, 3, 10–14 and **applied** (pushed via the
  Supabase MCP `apply_migration` tool, with your explicit go-ahead, immediately after this stage's
  review confirmed both were clean — no nullable-actor issues, standard revoke/grant discipline):
  - `supabase/migrations/20260805110000_moderator_story_detail_slug_version.sql` — DROP+CREATE
    `get_story_for_moderator()`, adding `slug`/`story_version` output columns. A genuine gap found
    while wiring the real approve/archive Server Actions: no moderator-accessible function exposed
    either field before this (`stories` has no RLS policies at all — every access is a
    `SECURITY DEFINER` function — and `get_story_for_editor()` is editor-assigned/admin scoped, not
    moderator). Diffed against the current live body (confirmed unchanged by any later migration).
  - `supabase/migrations/20260805110100_moderation_review_existence_check.sql` — new
    `can_view_moderation_review(p_revision_id)`, moderator/admin only, existence-only (returns just
    the revision id). Used by `proxy.ts` instead of the brief's alternative of reusing
    `get_story_for_moderator()` wholesale for the per-row check, which would mean fetching the whole
    review payload in middleware on every request.
  - `npm run supabase:types:linked`-equivalent (Supabase MCP `generate_typescript_types`) regenerated
    `types/database.ts` for real afterward; `lib/story/moderation.ts#getStoryForModerator()`'s
    temporary `callUntypedRpc()` call (Stage 1's escape hatch, used here for the one call site
    affected by the slug/version shape change) was converted back to a plain typed `supabase.rpc(...)`
    call and the now-fully-unused import removed from that file — the same cleanup done once already
    in Stage 1 and once before that in Prompt 4 Sub-phase 4.

**Verified, in order:** `npm run format:check`, `lint`, `typecheck`, `test` (**171/171**, up from
153 — 18 new tests: `lib/validation/moderation.test.ts` for the search-param parsers and Server
Action schemas, `lib/story/publish-orchestration.test.ts` for the approve-flow partial-failure
contract), and `build` (**30 routes**, up from 27) all passed before anything was pushed. Both
migrations were then applied; types regenerated; `getStoryForModerator()` cleaned up; `npm run verify`
re-run clean afterward (same 171/171, same 30 routes). **`npm run test:rls` — 69/69 passing**
(unchanged from Stage 1 — this stage's migrations didn't add new RLS-suite-relevant authorization
surface beyond what Stage 1 already covers; the queue/review functions changed here are UI-facing
shape additions, not new authorization logic).

**Not yet run**: `npm run test:e2e`/Playwright against the live project — the new
`e2e/moderation.spec.ts` needs real fixture data (a submitted revision, a replacement, etc.) it
creates itself via direct RPC calls, following `tests/integration/story-rls.integration.test.ts`'s
own fixture-creation pattern; deferred to whenever that's explicitly run, same as this stage's own
report noted before the push.

**Deviations from the brief, and why:**

- Two new migrations were added this stage, even though the brief's Stage 2 scope is nominally
  "UI/orchestration ... not backend design" — both are narrow, structurally necessary gaps
  discovered while wiring the real Server Actions (see above), not new backend feature design, and
  both are written-but-unpushed exactly like the brief's own contingency describes ("if you decide
  ... write the migration, do NOT push it").
- The editorial queue was implemented as a single filterable view (status dropdown covering every
  `lifecycle_status` value) rather than two separate hard-coded "awaiting-approval"/
  "returned-for-changes" tabs — `list_editorial_queue()`'s own `p_status` parameter already covers
  this generically, and two tabs would just be the same call made twice with a fixed filter each.
- The reassignment UI uses a raw target-editor-user-id text field rather than a name-based picker —
  no staff-directory listing function exists anywhere in this codebase (grepped) to safely populate
  one; `reassign_editorial_story()` independently verifies the target holds `editor`/`admin` via
  `has_role()` regardless, so a wrong id fails loudly server-side rather than silently misdirecting.

**Real, pre-existing gaps found this session, left unfixed as out of scope:**

- No staff-directory function exists to list editors/admins by name — noted above; a real usability
  gap for the reassignment control, not a security issue (the target is always independently
  verified server-side).
- Stage 1's own flagged gap (`create_editorial_import_draft()` never leaves `assigned_editor_id`
  null, so the "unclaimed pool" branch of `reassign_editorial_story()`/`list_editorial_queue()` can
  never actually be exercised against a story created through today's real API) is still unresolved
  — this stage's UI surfaces the unclaimed-pool case correctly (an editor sees "Unclaimed" in the
  queue when `assigned_editor_id` is null) but, per Stage 1's own note, no real story can reach that
  state today without a one-time data migration or a new "unassign" RPC, neither of which this stage
  added.

**What remains for Stage 3** (per this brief's own boundary, not implemented here): a dedicated
reports-triage page (Stage 2 only surfaces a story's own open reports inline on its review page, via
`listReportsForStaff({ storyId })`); `docs/moderation-guidelines.md`; a full recovery-hardening pass
(e.g. a UI affordance to explicitly retry/abandon a stuck-`active` publication attempt, beyond what
"reload the review page and click Approve again" already achieves via the orchestration's own
idempotent retry); `e2e/reports-triage.spec.ts`. This stage's own `e2e/moderation.spec.ts` is written
but still needs a real run against the live project (it creates its own fixture data via direct RPC
calls) — both migrations it depends on are now pushed and `test:rls`-verified, so nothing blocks that
run except actually executing it.

## Prompt 6 detail — Stage 3

The final stage. Full technical account is in
[docs/architecture.md](architecture.md#reports-triage-and-operational-hardening-prompt-6-stage-3);
not duplicated in full here.

**Built:**

- `app/(moderation)/moderation/reports/page.tsx` (filterable/paginated reports-triage queue) and
  `app/(moderation)/moderation/reports/[id]/page.tsx` (report detail: reporter details, private
  internal notes via `getReportNotes()`, resolution form) + co-located
  `actions.ts#resolveReportAction()` + `resolve-form.tsx`. `moderation-nav.tsx` gained a "Reports"
  link.
- `lib/validation/moderation.ts` gained `parseReportsQueueSearchParams()`/
  `REPORTS_QUEUE_PAGE_SIZE` (same never-throws convention as the other two queue parsers) and a new
  pure helper, `reportNoteRequired(category, status)`, mirroring `resolve_report()`'s own
  serious-category note requirement for the client-side form.
- **No new migration.** Every RPC this stage's UI calls
  (`listReportsForStaff()`/`resolveReport()`/`getReportNotes()`/`create_story_report()`) already
  existed and was already pushed/`test:rls`-verified as of Stage 1.
- **Cache-invalidation-failure gap found and fixed**: `app/(moderation)/moderation/stories/[id]/actions.ts`
  called `invalidateStoryPublicCache(slug)` directly, uncaught, immediately after a successful
  approve/archive database mutation. A `revalidatePath()` throw inside that helper would have
  propagated out of the Server Action and looked like a failed publish/archive to the moderator even
  though the mutation had already committed. Fixed with a new `invalidatePublicCacheSafely()`
  wrapper (catches, logs, never propagates) in the same file.
- New `lib/log.ts#logStaffAction()` — a single minimal structured-logging function (grepped first:
  no logging convention existed anywhere in this repo outside test files). Wired into
  `approveStoryAction()`/`moderateDecisionAction()`/`archiveStoryAction()`,
  `reassignEditorialStoryAction()`, and the new `resolveReportAction()`. Logs only
  actor id/action name/target id/outcome — never story bodies, secrets, or note contents; the DB
  audit tables remain the actual source of truth.
- Recovery-hardening review against every scenario the brief listed (partial media copy, failed
  finalize, orphan copy-attempt objects, repeated approval requests, archive/withdrawal retries):
  all confirmed already sufficient by re-reading the actual code
  (`lib/story/publish-orchestration.ts`, `supabase/migrations/20260804090800_maintenance_reconciliation_functions.sql`,
  `archive_story()`/`revoke_publication_consent()`) — nothing rebuilt. See architecture.md for the
  per-item account.
- `docs/moderation-guidelines.md` — new, full prose (not a stub): immigration misinformation, unsafe
  employment advice, employer/allegation defamation risk, harassment/hate, privacy/identifiable
  people, copyright/image permission, spam/promotion, dangerous travel advice, concrete
  request-changes-vs.-reject criteria tied to `moderateRevision()`'s actual two-decision lifecycle,
  admin escalation (explicitly stated as a process/communication step, not an in-app feature),
  consent withdrawal/removal tied to `revoke_publication_consent()`/`archive_story()`, and the
  required-note-for-serious-categories rule in practice.
- `docs/architecture.md`/`docs/content-governance.md` updated for end-to-end consistency (see below).

**A real, flagged gap, left unfixed as out of scope (would need a new RPC/migration):** unlike
`/moderation/stories/[revisionId]`, `/moderation/reports/[id]` has no middleware-level per-row
existence check (`can_view_moderation_review()`'s equivalent). `STAFF_MODERATION_PATH` already fully
covers authorization here (any moderator/admin may view any report — there's no per-row
authorization narrower than role, unlike a story's editor-scoped draft), so this is a possible
wrong-HTTP-status-code edge case for a same-role staff member hitting a bogus report id, never a
cross-role information leak. Fixing it properly would mean a new "does this report id exist" RPC —
a new migration — which this stage otherwise needed none of. Flagged, not built, per the brief's own
instruction to write up a flagged finding rather than add a migration without asking first.

**Verified:** `npm run format:check`, `lint`, `typecheck`, `test` (**182/182**, up from 171 — 11 new:
`parseReportsQueueSearchParams()`, `resolveReportSchema` edge cases, `reportNoteRequired()` across
every serious/non-serious × reviewing/resolved/dismissed combination), and `build` (**32 routes**, up
from 30 — `/moderation/reports`, `/moderation/reports/[id]`) all pass. No migration to push, so no
`test:rls` re-run was needed or performed.

### Post-Stage-3 live e2e verification (completed)

`e2e/moderation.spec.ts` and `e2e/reports-triage.spec.ts` were subsequently run for real against the
linked project (**12/12 passing**, `--workers=1` — see both files' own header comments for why
serial execution is required: they share a live, cross-test queue, and default parallelism produces
worker-interference failures unrelated to app correctness). Two real, live-reproducing bugs were
found and fixed in the process:

1. **`get_story_editorial_history()` was moderator/admin-only**, but Stage 2's own
   `editorial-history-panel.tsx` renders it on the assigned **editor's own** edit page — every editor
   hit a genuine `P0001` 500 visiting their own story, confirmed directly against server logs before
   diagnosis. Fixed in a new corrective migration,
   `20260805120000_fix_get_story_editorial_history_editor_access.sql` (broadens authorization to also
   accept the story's assigned editor, via the same `coalesce(...,false)`-guarded pattern
   `get_story_for_editor()` already uses — the nullable-actor bug class this codebase has now hit and
   fixed five times). **Pushed and re-verified**: `test:rls` re-run afterward, still 69/69.
2. **The review page's approve/reject success message was unobservable** —
   `app/(moderation)/moderation/stories/[id]/review-controls.tsx`'s success/error paragraphs lived
   inside the `canDecide` branch, which flips `false` the instant a successful action's
   `revalidatePath()` refreshes `revisionStatus`, replacing the whole section (confirmation included)
   with the "not submitted anymore" fallback before a human — or Playwright — could observe it. The
   same root cause existed in `app/(moderation)/moderation/reports/[id]/resolve-form.tsx`'s
   `alreadyClosed` branch. Both fixed by rendering the success/error message unconditionally, above
   the branch that can replace the rest of the section. No migration involved — pure client-component
   fix, covered by `npm run test`'s existing suite (182/182, unaffected) and now proven live by the
   e2e run itself.

Two additional bugs were in the **tests**, not the app, also found and fixed while chasing the above:
a Playwright strict-mode locator match against accumulated fixture debris (`.first()` added); the
reassignment test's final assertion had the correct/expected authorization outcome inverted (an
admin-assigned fixture story correctly does _not_ appear in a non-admin editor's own queue — the
original assertion expected the opposite); and both reports-triage tests missing a wait for a
detail-page-only heading before interacting with the resolution form, which could transiently target
the _queue_ page's own identically-labeled "Status" filter `<select>` mid-navigation (see
`e2e/reports-triage.spec.ts`'s header comment for the full mechanism).

All accumulated `rls-test-%` fixture debris from this verification pass was cleaned up afterward
(direct SQL via the Supabase MCP, scoped identically to `scripts/rls-test-cleanup.sql` — the Supabase
CLI is not installed in this environment, so `npm run test:rls:cleanup` itself could not run, but its
underlying SQL was executed directly and verified empty afterward).

**Deviations from the brief, and why:**

- The reports-triage detail page requires a `storyId` query parameter (`/moderation/reports/[id]?storyId=...`),
  populated by the queue page's own link. `list_reports_for_staff()` has no by-report-id filter and
  clamps `p_limit` to `[1, 50]`, so an unscoped "fetch everything and find the matching id" would
  silently miss reports past the first page; adding a by-id RPC would be a new migration. Direct/
  bookmarked navigation without `storyId` shows a clear "return to the queue" message rather than an
  unscoped scan.
- The detail page is a separate route (`[id]/page.tsx`), not an inline expand on the queue row, for
  its own bookmarkable URL and Server Action target — documented as the brief invited ("your call,
  document it").

## Prompt 7 detail — complete

Full technical account (design decisions, the disclosed schema simplifications, the real bug found
via live e2e testing) is in
[docs/architecture.md](architecture.md#content-readiness-operational-metrics-and-launch-tooling-prompt-7);
not duplicated in full here. Two scope decisions were confirmed with you before implementation:
skip bulk metadata operations entirely (build nothing bulk, per the brief's own caution), and put
the readiness dashboard at a new shared route (`/readiness`, editor/moderator/admin) rather than
folding it into the existing editor-only or moderator-only workspace.

**Built:**

- 2 migrations (`20260806090000`, `20260806090100`) — `story_launch_verifications` (append-only) +
  `record_story_launch_verification()`, `get_content_readiness_queue()`, `get_operational_metrics()`,
  and a `create or replace` on `get_story_preview()` adding `sha256` to its media shape. **Applied**
  via the Supabase MCP `apply_migration` tool; `get_advisors` reviewed (only the already-established
  `rls_enabled_no_policy`/`authenticated_security_definer_function_executable` classes, nothing
  new); `types/database.ts` regenerated for real via the MCP `generate_typescript_types` tool.
- `app/(readiness)/readiness/` — a third staff route group (layout/nav/page/actions/verify-form),
  gated in `proxy.ts` by a new `STAFF_READINESS_PATH` mirroring the existing staff-route pattern
  exactly (flat 404 for signed-out and wrong-role). Renders operational metrics + a filterable,
  paginated per-story readiness checklist; a published story additionally offers a launch-
  verification disclosure form. `editorial-nav.tsx`/`moderation-nav.tsx` both gained a "Readiness"
  link.
- `lib/story/content-quality-checks.ts` — 10 advisory (non-blocking) heuristics, pure, no DB
  dependency; not yet wired into a review page's UI in this pass (a real follow-up candidate, not a
  gap in this prompt's own scope).
- Same-story duplicate-image warning in `components/story/image-upload-manager.tsx`, using the new
  `sha256` field threaded through `lib/story/contributor-queries.ts#RevisionMediaItem`.
- `components/story/whats-public-summary.tsx` — shown above the contributor's own approve/submit
  panel on the private preview page; reads only `get_story_preview()`'s existing return shape, so
  internal editorial/moderation notes are structurally unreachable from it, not merely omitted.
- Three new docs: `docs/founding-catalogue-runbook.md`, `docs/content-inventory-template.md`,
  `docs/launch-content-checklist.md`. `docs/content-governance.md` gained a short "Operational
  readiness (Prompt 7)" section cross-referencing all of the above.
- **No bulk publication** — confirmed by a new structural regression test,
  `lib/story/no-bulk-publication.test.ts`, rather than just by omission.

**A real, live-reproducing bug found and fixed while building `e2e/founding-story-workflow.spec.ts`:**
the exact "vanishing confirmation" bug class Prompt 6 Stage 3 already found and fixed twice
(`review-controls.tsx`, `resolve-form.tsx`) — a Server Component page's
`{someServerComputedBoolean && <ClientPanel/>}` unmounts the panel, discarding its own
just-produced success/error message, the instant that panel's own successful Server Action changes
the underlying state the boolean is computed from. Reproduced live: the contributor's "Approve &
submit for moderation" click on `app/(contributor)/stories/[id]/preview/page.tsx` genuinely
succeeded (confirmed directly via `execute_sql` — the story's `lifecycle_status` really did move to
`pending_review`), but the confirmation was never observable, because
`isAwaitingThisContributorsApproval` flipped `false` on the very next render and unmounted
`ContributorReviewPanel` before its message could be seen — by a human or by Playwright. The
self-service `canSubmitOwnConsent`/`SubmitConsentPanel` pairing has the identical structural flaw,
fixed the same way. New reusable primitive, `components/sticky-visible.tsx#StickyVisible`, wraps
all three of `preview/page.tsx`'s conditionally-rendered panels; re-ran the new spec (now passing)
and the full 37-spec Playwright suite afterward (37/37, zero regressions).

**Verified, in order:** `npm run format:check`/`lint`/`typecheck`/`test` (**212/212**, up from
182 — 30 new: `content-quality-checks.test.ts` 13, `whats-public-summary.test.tsx` 4,
`readiness.test.ts` 11, `no-bulk-publication.test.ts` 2) and `build` (**33 routes**, up from 32 —
`/readiness`) all passed before anything was pushed. Both migrations then applied; types
regenerated; `npm run verify` re-run clean afterward (same 212/212, same 33 routes). **`npm run
test:rls` — 69/69, unchanged** (this prompt's SQL is additive/read-only; no existing authorization
surface was touched). **`e2e/founding-story-workflow.spec.ts` run live** against the real linked
project (`--workers=1`): failed on the vanishing-confirmation bug above before the fix, passed
after it. **The full Playwright suite (37 specs) then re-run live, 37/37 passing**, confirming the
`StickyVisible` fix introduced no regression anywhere else it could plausibly have mattered
(`review-controls.tsx`/`resolve-form.tsx` were not touched — only `preview/page.tsx` needed the new
primitive).

**Left as accepted debris**, same low-cost/disposable precedent as every prior prompt's RLS-test
fixtures: 4 `rls-test-founding-story-%` stories created by this session's live spec runs remain on
the linked dev project. `npm run test:rls:cleanup` was not run (the Supabase CLI is still not
installed in this environment, unchanged since Prompt 1) and a manual bulk delete via the Supabase
MCP was deliberately not performed without asking first, since it would also remove pre-existing
`rls-test-%` debris from prior prompts, not just this session's own rows.

**Not built, deliberately out of scope per this session's confirmed scope decisions:**

- Bulk metadata operations (region/work-type/tag) — the brief only constrained bulk operations if
  built, it didn't mandate building any; skipped per your confirmed choice.
- A staff-directory picker for the reassignment control — a pre-existing Stage 2 gap, unrelated to
  this prompt's scope, not revisited.
- Wiring `content-quality-checks.ts`'s findings into an actual review-page UI as visible badges —
  the pure module and its tests are built and ready for a future prompt to surface; not required by
  this prompt's own acceptance criteria, which asked for the checks to exist and be advisory, not
  for a specific UI placement.

## Release audit (2026-08-06)

A release-focused security/correctness audit was run against the live linked project
(`ybhydepjaantkngngvuf`) ahead of a private-beta go/no-go decision. This was a targeted audit of a
codebase that had already been through 7 prompts of iterative live-verification, not a from-scratch
review — the goal was to find anything the prior passes missed, using both automated tooling and a
mechanical check for this codebase's own most-repeated real bug class.

**Method:**

1. `get_advisors` (security + performance) run against the live project. Result: the ~90
   `*_security_definer_function_executable` WARNs are expected noise for this codebase's architecture
   (every table has RLS-enabled-no-policy by design — access is exclusively through `SECURITY
DEFINER` RPCs that re-derive the caller's identity/role themselves, already documented in "Decisions
   made so far"). One new, real, actionable finding: `auth_leaked_password_protection` is not
   enabled — see "Manual Supabase settings required" below.
2. Every live function whose body references `assigned_editor_id`/`linked_user_id`/`owner_user_id`/
   `initiated_by`/`created_by`/`moderator_id`/`editor_id` compared against `auth.uid()` was pulled via
   `pg_get_functiondef` and read directly (not from migration files, which can be stale once
   superseded by a later `CREATE OR REPLACE` — the exact trap that caused two of this codebase's own
   documented past bugs). This mechanically re-checks the "SQL three-valued logic" bug class
   documented five separate times in this file (Prompts 3, 4, 5, and twice in Prompt 6) — a bare
   nullable-column `= auth.uid()` inside `if not (...) then raise` silently no-ops when the column is
   `NULL`. **Result: every live instance is now safe** — either wrapped in `coalesce(..., false)`, or
   structurally immune because it's inside an `EXISTS (...)` subquery (`exists` never returns `NULL`)
   or an `if x then ... elsif y then ... else raise` chain (a `NULL` branch condition falls through to
   the next branch, not into the `then`, so this shape was never actually vulnerable to begin with).
   No new instance of this bug class was found.
3. `revoke_publication_consent()`, `get_published_story()`, and `get_published_story_media()` were
   read together to directly confirm Engineering Rules 10–14 hold at the function level: all three
   public-read paths check `consent_revoked_at is not null` and return zero rows if so (on top of the
   redundant `visibility = 'public' and lifecycle_status = 'published'` check, since revocation also
   flips a published story to `archived`), and `get_published_story_media()` additionally requires
   `metadata_removed_at is not null` before ever returning a path — an already-removed-EXIF image
   can't leak through this path even mid-processing.
4. `proxy.ts` (the per-row IDOR gate for every dynamic staff/contributor/public route) was read in
   full against the list of dynamic routes in `app/`. **One real, previously-flagged gap found and
   fixed** — see below.

**Found and fixed:**

- **`/moderation/reports/[id]` had no middleware-level per-row existence check** — flagged as a known,
  accepted, non-blocking gap since Prompt 6 Stage 3 ("still needs a new RPC/migration to fix
  properly, still flagged rather than built without asking"). Not an authorization bypass (the
  role-level check on `/moderation/*` already applied), but a wrong-status-code correctness gap: a
  nonexistent or wrong-`storyId` report id rendered Next's deep `notFound()` as a live HTTP 200
  instead of a real 404 — the same failure mode already fixed for every other staff per-row route in
  this app (`/moderation/stories/[revisionId]`, `/editorial/[id]/edit`, `/stories/[id]/edit`,
  `/stories/[id]/preview`). Fixed the same proven way: `can_view_moderation_report()`
  (`supabase/migrations/20260806100000_moderation_report_existence_check.sql`, applied and
  live-verified) mirrors `can_view_moderation_review()` exactly, wired into `proxy.ts` as
  `canViewModerationReport()`. **Live-verified**: a new Playwright case in
  `e2e/reports-triage.spec.ts` confirms a bogus report id now returns a genuine 404; the full
  `e2e/moderation.spec.ts` + `e2e/reports-triage.spec.ts` batch (13/13) re-run live afterward, no
  regressions. `npm run verify` clean afterward (unit tests, lint, typecheck, build all pass; build
  still 33 routes).

**Not independently re-verified this session** (relied on the extensive existing live-verification
record instead, given the size of the surface and no new findings from the mechanical checks above):
image pipeline internals (magic-byte sniffing, path-traversal regex, EXIF stripping — already
live-verified with a real EXIF-embedded source image in Prompt 4 Sub-phase 2), the full moderation/
editorial separation matrix, and accessibility scans beyond what's already wired into the existing
Playwright specs. These remain exactly as documented in the relevant Prompt sections above — no
regressions found, but also not independently re-derived from scratch.

**One pre-existing, unrelated test-isolation issue observed while re-running `npm run test:rls`**:
`list_my_reports` returned a stale report for the `owner` test account, failing one assertion
(68/69). Root-caused to accumulated `rls-test-%` fixture debris from prior sessions' live runs (the
same accepted-debris category documented throughout this file, e.g. "Prompt 7 detail" and "Risks")
— not caused by this session's migration (which only adds a new, additive, read-only existence-check
function) and not a real app defect. `npm run test:rls:cleanup` was not run without asking first,
consistent with this file's established practice.

### Critical finding, found and fixed same day: image upload was completely broken

A user report ("the image upload function does not work") led to a live reproduction (real signed-in
session, real `tests/integration/fixtures/tiny.png`, real storage/DB calls against
`ybhydepjaantkngngvuf`) that surfaced **two independent, always-existing bugs** — every single
authenticated image upload attempt, self-service or editorial, had been failing since the upload
pipeline was introduced in Prompt 4 Sub-phase 2. Confirmed directly: `story_revision_media` had
**zero rows** in the live database before this fix, for any story, ever.

1. **Missing `EXECUTE` grant on `_can_write_reserved_media_path(text)`**
   (`supabase/migrations/20260806110000_fix_missing_storage_policy_function_grants.sql`). This
   function is called directly inside `storage.objects`' "private media: reserved-path writes only"
   `with check` clause (`20260804090700_story_media_storage_buckets.sql`), which is evaluated as the
   actual querying role (`authenticated`) — `security definer` only changes what happens _inside_ a
   function once it's already running, it does not waive the caller's own need for `EXECUTE` to
   invoke it in the first place. The migration that created the function revoked `EXECUTE` from
   `authenticated` (correct for an internal `_`-prefixed helper normally only reached from inside
   another `SECURITY DEFINER` function) but never re-granted it for this different calling context.
   Reproduced live via a direct Storage API call: `{"message":"permission denied for function
_can_write_reserved_media_path"}`. `public._can_access_story_media(uuid)` has the identical shape of
   gap in the sibling private-bucket SELECT policy — currently latent/unobserved only because every
   real read goes through the service-role admin client, which bypasses Storage RLS entirely — fixed
   in the same migration for the same reason.
2. **`finalize_story_media_upload()`'s `story_revision_media` insert unconditionally violated
   `story_revision_media_alt_text_required`**
   (`supabase/migrations/20260806110100_fix_finalize_upload_alt_text_constraint.sql`) — `check
(decorative or (alt_text is not null and char_length(alt_text) > 0))`
   (`20260803090400_story_media.sql`). The insert hardcoded `decorative = false` with no `alt_text`
   (column default `null`), but alt text is only ever collected _after_ a successful upload via the
   image manager's own caption UI — there was no way to reach that step, since this insert always
   failed first. Reproduced live: `{"code":"23514","message":"new row for relation
\"story_revision_media\" violates check constraint \"story_revision_media_alt_text_required\""}`.
   Fixed by inserting with `decorative = true` (a freshly-attached image with no alt text yet is
   exactly what "decorative" is for) — the existing UI flow (uncheck "Decorative", fill in real alt
   text, save) is unchanged, this only fixes the placeholder value the row is born with.

**Live-verified, both bugs, end to end**: a direct Storage API + RPC sequence (create draft → begin
upload → raw storage `POST` → `finalize_story_media_upload`) now returns `200`/`204` throughout,
where it previously failed at step 3 (`403`) and then, after fixing #1, at step 4 (`400`/`23514`).
Confirmed again through the real browser UI (`/stories/[id]/edit`'s "Add images" control) — the image
now attaches and renders in the manager (Decorative checkbox checked, Caption field, Set-as-cover/
Remove controls), with no error banner.

**Also observed, environment-specific, not a code bug**: in _this_ sandboxed session's `.env.local`,
`SUPABASE_SERVICE_ROLE_KEY` is unset (same long-documented limitation as every prior prompt's Storage
round-trip work — see "Prompt 4 detail" Sub-phase 2's "Not yet live-verified" note), so
`processStoryMedia()`'s `createAdminClient()` call throws before it can run the `sharp` decode/strip/
resize step; the route's own `catch {}` around that call swallows it silently (by design — a
processing failure must not fail the upload response itself), leaving the image stuck at
`processing_state = 'uploaded'` ("Preparing…" in the UI) instead of advancing to `processed`/`failed`.
This is an environment credential gap, not a logic bug — a real deployment (or a local `.env.local`
with the project's actual service-role key added) will exercise the real `sharp` pipeline, already
live-verified independently in Prompt 4 Sub-phase 2 and Sub-phase 4's
`e2e/editorial-upload.spec.ts`. Worth noting separately: that same Playwright spec (and
`e2e/cross-contributor-access.spec.ts`'s upload assertions) reported passing in this and prior
sessions despite these bugs being present the whole time — its assertions (absence of specific literal
UI strings) turned out not to strongly enough pin down "the image actually got attached in the
database," a real test-quality gap worth tightening in a future session, not chased further here to
stay scoped to the reported bug.

**Debris**: 5 disposable stories created directly against the live project while reproducing this
(`debug-upload-script-story-*`, `image-upload-debug-story-*`, `whv-nz-*`, all owned by the
`rls-owner@…` test account) were left in place rather than risk an ad hoc manual delete against the
`on delete restrict` story domain outside the vetted `scripts/rls-test-cleanup.sql` path — same
accepted-debris category as everywhere else in this file.

## Migration summary

All in `supabase/migrations/`, applied in filename order:

| File                                                               | Adds                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `20260802085013_helpers.sql`                                       | `public.set_updated_at()` — shared `updated_at` maintenance trigger function.                                                                                                                                                                                                                                                                                                                    |
| `20260802085014_user_roles.sql`                                    | `app_role` enum; `user_roles` table + RLS; `public.has_role()` (SECURITY DEFINER, used inside other tables' RLS); `public.admin_set_user_role()` (SECURITY DEFINER, the only post-creation role-change path).                                                                                                                                                                                    |
| `20260802085015_profiles.sql`                                      | `profiles` table + RLS (owner read/write; public read only when opted in with a slug).                                                                                                                                                                                                                                                                                                           |
| `20260802085016_contributors.sql`                                  | `attribution_type`, `contributor_status` enums; `contributors` table + RLS + `contributors_protect_privileged_fields()` trigger (blocks non-staff changes to `linked_user_id`/`created_by`/archiving).                                                                                                                                                                                           |
| `20260802085017_contributor_links.sql`                             | `contributor_links` audit table (no direct-write RLS policy at all); `public.link_contributor_to_user()` (SECURITY DEFINER, editor/admin-only, the sole write path).                                                                                                                                                                                                                             |
| `20260802085018_handle_new_user.sql`                               | `handle_new_user()` trigger on `auth.users` — creates the default `profiles` + `user_roles('user')` row for every new account, idempotently.                                                                                                                                                                                                                                                     |
| `20260802093000_fix_contributors_unlink_on_delete.sql`             | Fixes a bug found during live verification (see "Prompt 2 detail" above): `contributors_protect_privileged_fields()` now only blocks non-staff _assignment_ of `linked_user_id`, not clearing it to `null` — otherwise the `ON DELETE SET NULL` FK action itself got blocked, breaking user deletion for anyone with a linked contributor record.                                                |
| `20260803090000_lookup_tables.sql`                                 | `regions`, `destinations`, `work_types`, `tags` + plain RLS (active-only public read, admin write).                                                                                                                                                                                                                                                                                              |
| `20260803090100_stories.sql`                                       | `story_source_kind`/`story_visibility`/`story_lifecycle_status` enums; `stories` table, RLS enabled with zero policies, no direct grants.                                                                                                                                                                                                                                                        |
| `20260803090200_story_revisions.sql`                               | `story_revision_status` enum; `story_revisions` table + content-immutability trigger; `story_revision_editor_notes` (staff-only); `stories_validate_revision_pointers()` trigger.                                                                                                                                                                                                                |
| `20260803090250_story_internal_helpers.sql`                        | `_is_story_owner()`, `_revision_is_editable()` — no API grants.                                                                                                                                                                                                                                                                                                                                  |
| `20260803090300_story_revision_relations.sql`                      | `story_revision_locations` (+ region/destination integrity trigger), `story_revision_work_types`, `story_revision_tags`; shared `_protect_revision_child_immutability()` trigger.                                                                                                                                                                                                                |
| `20260803090400_story_media.sql`                                   | `story_media`, `story_revision_media` (+ one-cover/alt-text/sort-order/processed-derivative constraints, cross-story-attachment trigger); `_require_processed_media()`.                                                                                                                                                                                                                          |
| `20260803090500_story_publication_consents.sql`                    | `identifiable_people_state` enum; append-only `story_publication_consents` (+ `unique(revision_id)`, `unique(story_id, event_number)`); `story_publication_consent_notes`; `_latest_valid_consent_for_revision()`.                                                                                                                                                                               |
| `20260803090600_moderation.sql`                                    | `moderation_actions` + `moderation_action_notes`, `story_reports`, `editorial_actions` — all append-only / no direct grants.                                                                                                                                                                                                                                                                     |
| `20260803090700_story_lifecycle_functions.sql`                     | The full authoring/submission/moderation/consent/media/report RPC surface (~35 functions) — see docs/architecture.md "Story domain" for the complete list.                                                                                                                                                                                                                                       |
| `20260803090800_story_public_reads.sql`                            | `get_published_story`, `list_published_stories`, `get_published_story_media` — the only three functions granted to `anon`.                                                                                                                                                                                                                                                                       |
| `20260803090900_lock_down_story_domain_grants.sql`                 | Bug fix: explicit `revoke all ... from public, anon, authenticated` on every story-domain table — Supabase grants broad table privileges by default independent of RLS, so "RLS enabled, no policies" alone denied rows but not the query itself.                                                                                                                                                |
| `20260803091000_fix_returns_table_column_ambiguity.sql`            | Bug fix: qualifies bare column references in `get_published_story`/`list_published_stories`/`get_story_for_moderator` that collided with their own `RETURNS TABLE` output-column names.                                                                                                                                                                                                          |
| `20260803091100_fix_nullable_actor_boolean_logic.sql`              | Bug fix: wraps every `nullable_column = auth.uid()` ownership/role comparison in `coalesce(..., false)` across 9 functions — see "Prompt 3 detail" above.                                                                                                                                                                                                                                        |
| `20260803091200_fix_publish_sets_visibility.sql`                   | Bug fix: `moderate_revision()`'s approve path now also sets `stories.visibility = 'public'`, not just `lifecycle_status`.                                                                                                                                                                                                                                                                        |
| `20260804090000` – `20260804090800` (9 files)                      | Prompt 4 Sub-phase 2 — storage buckets, media processing-state machine, upload reservation, publication-attempt system. See "Prompt 4 detail" above and `docs/architecture.md`. **Applied and live-verified.**                                                                                                                                                                                   |
| `20260804091000_get_revision_selections.sql`                       | Prompt 4 Sub-phase 3 — `get_revision_selections()`, the missing reader for `story_revision_locations`/`story_revision_work_types`/`story_revision_tags`, symmetric with the existing writer RPCs. Applied via `supabase db push` with explicit go-ahead; confirmed in sync via `supabase migration list`.                                                                                        |
| `20260804092000_assigned_editor_can_read_draft.sql`                | Prompt 4 Sub-phase 4 — bug fix: `get_my_story_with_draft()` now also authorizes the story's assigned editor, not just `_is_story_owner()`. **Applied.** (Introduced an ambiguous-column bug, fixed by `20260804092500` below.)                                                                                                                                                                   |
| `20260804092100_submit_consent_requires_terms_version.sql`         | Prompt 4 Sub-phase 4 — `DROP`+`CREATE` of `submit_revision_with_consent()`: new required `p_expected_terms_version` (raises `WHV01` on mismatch); new `current_terms_version()`/`get_consent_terms_version()` readers; source-kind-partitions the `confirmation_method = 'account'` check; fixes the awaiting-approval submission dead-end. **Applied.**                                         |
| `20260804092200_source_kind_partitioned_authorization.sql`         | Prompt 4 Sub-phase 4 — bug fix: `_is_story_owner()`, `list_my_stories()`, `get_story_preview()`, `_can_write_reserved_media_path()` all source-kind-partitioned (self_submitted checks `owner_user_id` only; editorial_import checks the live `linked_user_id` only — never an OR across both). **Applied.**                                                                                     |
| `20260804092300_save_revision_draft_returns_version.sql`           | Prompt 4 Sub-phase 4 — `DROP`+`CREATE` of `save_revision_draft()`: now returns the authoritative new `story.version` instead of `void`. **Applied.** (The `DROP`+`CREATE` accidentally dropped a `coalesce(...,false)` ownership-check wrapper — a real, live-confirmed security regression, fixed by `20260804092600` below.)                                                                   |
| `20260804092400_restrict_contributor_linking_to_named_rpcs.sql`    | Prompt 4 Sub-phase 4 — `contributor_links` gains `event_type`; new private `_set_contributor_linked_user()` helper + a transaction-local GUC the `contributors_protect_privileged_fields()` trigger now requires for every `linked_user_id` transition (except the literal `ON DELETE SET NULL` cascade); new `unlink_contributor_from_user()` RPC, editor/admin-only, audited. **Applied.**     |
| `20260804092500_fix_get_my_story_with_draft_ambiguous_column.sql`  | Prompt 4 Sub-phase 4 corrective — bug fix, found via live `test:rls` after the initial push: qualifies the bare `assigned_editor_id` reference `20260804092000` added, ambiguous against `get_my_story_with_draft()`'s own `RETURNS TABLE` output column of the same name (Postgres `42702`, live-confirmed). Same fix pattern as `20260803091000`. **Applied.**                                 |
| `20260804092600_fix_save_revision_draft_nullable_actor_bug.sql`    | Prompt 4 Sub-phase 4 corrective — **security bug fix**, found via live `test:rls` after the initial push: restores the `coalesce(...,false)` wrapper around `save_revision_draft()`'s ownership check that `20260804092300`'s `DROP`+`CREATE` had silently dropped, closing a live-confirmed hole that let any authenticated user overwrite any self-service story's draft. **Applied.**         |
| `20260804092700_fix_submit_consent_offline_actor_bug.sql`          | Prompt 4 Sub-phase 4 corrective — hardening (not live-exploited): wraps `submit_revision_with_consent()`'s offline-confirmation `assigned_editor_id = auth.uid()` check in the same `coalesce(...,false)` pattern, found via proactive re-audit after the two bugs above. **Applied.**                                                                                                           |
| `20260805100000_revoke_anon_contributors_table_grants.sql`         | Prompt 5 — bug fix (audit finding, not newly introduced): revokes `anon`'s default direct table grants on `contributors` (Supabase grants these independent of RLS); public reads now go through curated functions only. **Applied.**                                                                                                                                                            |
| `20260805100100_extend_list_published_stories.sql`                 | Prompt 5 — `DROP`+`CREATE` of `list_published_stories()`: cover image/regions/work_types/tags in the same query, `p_cost_band`/`p_has_reported_expense`/`p_exclude_story_id`/`p_search` filters; adds `story_revisions.search_vector` (generated `tsvector`, `'simple'` config) + GIN index. **Applied**, superseded immediately by the corrective migration below.                              |
| `20260805100200_list_distinct_public_travel_styles.sql`            | Prompt 5 — new anon-granted function backing the travel-style filter's options, scoped to public+approved+consent-valid stories only. **Applied.**                                                                                                                                                                                                                                               |
| `20260805100300_public_contributor_functions.sql`                  | Prompt 5 — new anon-granted `list_public_contributors()`/`get_public_contributor()`, the public contributor directory/detail backend. **Applied.**                                                                                                                                                                                                                                               |
| `20260805100400_fix_list_published_stories_ambiguous_story_id.sql` | Prompt 5 corrective — bug fix, found live via `npm run build` (`app/sitemap.ts`'s first-ever real call to `list_published_stories()`): qualifies the bare `story_id` reference in the lateral consent-lookup subquery `20260805100100` reintroduced from a stale pre-fix copy of the function body (this exact line was already fixed once, in `20260803091000`). Same fix pattern. **Applied.** |
| `20260805100500_archive_reason_and_publication_state_audit.sql`    | Prompt 6 Stage 1 — new `story_publication_state_actions` append-only audit table (`action_type` in `archived`/`consent_withdrawn`, reason required only for `archived`); `DROP`+`CREATE` of `archive_story()` adding a required `p_reason`/optional `p_note`; `revoke_publication_consent()` gains a matching reason-free audit insert. **Applied.**                                             |
| `20260805100600_reassign_editorial_story.sql`                      | Prompt 6 Stage 1 — new `reassign_editorial_story()`, editorial-import stories only; admin reassigns anyone, editor may only claim-unassigned or hand-off-their-own. Records an `editorial_actions` row. **Applied** (with the `coalesce(...,false)` nullable-actor fix described above — the vulnerable version was never pushed).                                                               |
| `20260805100700_story_report_notes_and_resolve_report.sql`         | Prompt 6 Stage 1 — new `story_report_notes` table (mirrors `moderation_action_notes`); `DROP`+`CREATE` of `resolve_report()` requiring a non-empty note when closing a serious-category report; new `get_report_notes()` reader. **Applied.**                                                                                                                                                    |
| `20260805100800_get_moderation_queue_v2.sql`                       | Prompt 6 Stage 1 — `DROP`+`CREATE` of `get_moderation_queue()`: filters, pagination (`count(*) over()`), `is_replacement`/`submission_kind` labels, a `recently_reviewed` branch. **Applied.**                                                                                                                                                                                                   |
| `20260805100900_moderator_story_detail_functions.sql`              | Prompt 6 Stage 1 — `DROP`+`CREATE` of `get_story_for_moderator()` (full content + consent snapshot + path-free media); new `get_story_moderation_history()`, `get_story_editorial_history()`, `get_published_revision_snapshot()`. **Applied.**                                                                                                                                                  |
| `20260805101000_narrow_moderator_contributor_access.sql`           | Prompt 6 Stage 1 — drops the moderator branch of the "staff read all contributor records" RLS policy on `contributors`, replaced with editor/admin-only. **Applied.**                                                                                                                                                                                                                            |
| `20260805101100_list_reports_for_staff_filters.sql`                | Prompt 6 Stage 1 — `DROP`+`CREATE` of `list_reports_for_staff()`: `p_category`/`p_date_from`/`p_date_to`/`p_story_id`/pagination. **Applied.**                                                                                                                                                                                                                                                   |
| `20260805101200_editorial_queue.sql`                               | Prompt 6 Stage 1 — new `list_editorial_queue()` (does not replace `list_assigned_editorial_stories()`, still called directly by `app/(editor)/editorial/page.tsx`). **Applied.**                                                                                                                                                                                                                 |
| `20260805110000_moderator_story_detail_slug_version.sql`           | Prompt 6 Stage 2 — DROP+CREATE of `get_story_for_moderator()` adding `slug`/`story_version` output columns, needed by the real approve/archive Server Actions (cache invalidation, expectedVersion) with no other moderator-accessible source for either. **Applied.**                                                                                                                           |
| `20260805110100_moderation_review_existence_check.sql`             | Prompt 6 Stage 2 — new `can_view_moderation_review(p_revision_id)`, moderator/admin-only existence check backing `proxy.ts`'s per-row 404 for `/moderation/stories/[revisionId]`, deliberately not a reuse of the full `get_story_for_moderator()` payload. **Applied.**                                                                                                                         |
| `20260805120000_fix_get_story_editorial_history_editor_access.sql` | Post-Stage-3 corrective — bug fix, found live via `e2e/moderation.spec.ts`: `get_story_editorial_history()` was moderator/admin-only, but Stage 2's `editorial-history-panel.tsx` renders it on the assigned editor's own edit page, causing a genuine 500 for every editor. Broadened to also authorize the story's assigned editor (`coalesce(...,false)`-guarded). **Applied.**               |
| `20260806090000_content_readiness_and_metrics.sql`                 | Prompt 7 — new append-only `story_launch_verifications` table + `record_story_launch_verification()`; new `get_content_readiness_queue()` (editor/moderator/admin, per-story founding-catalogue readiness checklist); new `get_operational_metrics()` (editor/moderator/admin, 7 aggregate counts only). **Applied.**                                                                            |
| `20260806090100_add_sha256_to_story_preview_media.sql`             | Prompt 7 — `create or replace` (return shape unchanged) on `get_story_preview()`, adding `sha256` to each media object for same-story duplicate-image detection in the editorial/contributor image manager. **Applied.**                                                                                                                                                                         |
| `20260806100000_moderation_report_existence_check.sql`             | Release audit — new `can_view_moderation_report(p_report_id)`, moderator/admin-only existence check backing `proxy.ts`'s per-row 404 for `/moderation/reports/[id]`, mirroring `can_view_moderation_review()`. **Applied.**                                                                                                                                                                      |
| `20260806110000_fix_missing_storage_policy_function_grants.sql`    | Bug fix — image upload was completely broken for every authenticated user: grants `EXECUTE` on `_can_write_reserved_media_path(text)` and `_can_access_story_media(uuid)` to `authenticated`, missing since both functions were first created (referenced directly inside `storage.objects` RLS policies, which needs the querying role's own grant). **Applied.**                               |
| `20260806110100_fix_finalize_upload_alt_text_constraint.sql`       | Bug fix — `finalize_story_media_upload()`'s `story_revision_media` insert unconditionally violated `story_revision_media_alt_text_required`; now inserts `decorative = true` (no alt text collected yet at attach time) instead of `false`. **Applied.**                                                                                                                                         |

## Role and RLS matrix

`app_role`: `user` (default) · `editor` · `moderator` · `admin`. Assigned via `user_roles`, structurally
unwritable by ordinary clients (see docs/architecture.md).

| Table               | Anonymous                                                 | Owner (self)                                                                    | Other authenticated user | Editor                                                                                                                              | Moderator                                                                                                                         | Admin                                                                          |
| ------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `profiles`          | Read only if `public_profile_enabled AND public_slug` set | Read/update own row (no INSERT/DELETE for anyone)                               | Same as anonymous        | Same as anonymous                                                                                                                   | Same as anonymous                                                                                                                 | Same as anonymous                                                              |
| `user_roles`        | None                                                      | Read own role only                                                              | None                     | Read own role only                                                                                                                  | Read own role only                                                                                                                | Read own + all others; only writer of role changes (via `admin_set_user_role`) |
| `contributors`      | Read only `public_status = 'public'` rows                 | Read/update own linked row; cannot change `linked_user_id`/`created_by`/archive | Same as anonymous        | Read all rows; create unlinked rows; update any row (still can't self-archive via the non-staff path — they ARE staff, so they can) | None (Prompt 6 Stage 1 — narrowed from "read all rows"; attribution comes from the `story_publication_consents` snapshot instead) | Read/update/delete all rows; create unlinked rows                              |
| `contributor_links` | None                                                      | Read own link history                                                           | None                     | Read all link history; the only role (with admin) that can write, and only through `link_contributor_to_user()`                     | None                                                                                                                              | Read all link history; can write via the same function                         |

Self-service contributor creation (`linked_user_id = auth.uid()`) is available to any authenticated
user regardless of role, via a dedicated INSERT policy — this is what "self-service stories" needs
and is separate from the editor/admin-only unlinked-creation path.

**The story domain (Prompt 3) does not use this table-and-policy model at all** — every
story-domain table has RLS enabled with zero policies and zero direct grants, for every role
including admin; all access goes through `SECURITY DEFINER` functions instead. See
docs/architecture.md "Story domain (Prompt 3)" for the full entity/lifecycle/consent/access-model
writeup rather than duplicating it here — a table-shaped matrix like the one above doesn't fit a
model where nothing is granted directly.

## Manual Supabase settings required

Not expressible in a migration — configure on the actual Supabase project (local `supabase/config.toml`
already has sane defaults; a hosted project needs these set explicitly in the dashboard or via
`supabase config push`):

- **Email confirmations**: confirmed **already ON** on the linked project (`ybhydepjaantkngngvuf`) —
  discovered empirically during Prompt 2 verification (a password-grant sign-in before confirming
  returned `email_not_confirmed`), not something this app or its migrations configured.
  `supabase/config.toml`'s local default is `enable_confirmations = false` (local dev stack only, if
  Docker is ever used); the hosted project's real setting is independent of that file unless
  `supabase config push` is run, which has **not** been done — the on-by-default hosted setting is
  fine as-is. The sign-up flow already handles both cases either way.
- **Redirect allow-list** (`auth.additional_redirect_urls` / dashboard "Redirect URLs"): **not yet
  confirmed configured** on the linked project. Must include `${NEXT_PUBLIC_SITE_URL}/auth/callback`
  (currently `http://localhost:3000/auth/callback` per `.env.local`, plus the real production URL once
  one exists) or Supabase itself will reject the redirect regardless of this app's own
  `resolveSafeReturnTo()` check — this is a second, project-level layer of open-redirect protection,
  not a substitute for the in-app one. Verified so far only via direct Auth API calls (which don't
  exercise the redirect step); a real browser-driven sign-up/password-reset email click has not been
  tested end-to-end. **Do this before relying on email-link flows.**
- **Password minimum length**: `supabase/config.toml` sets `minimum_password_length = 6`; `lib/
validation/auth.ts`'s `passwordSchema` mirrors this by hand (documented in a code comment). If this
  is changed on the Supabase project, update `MIN_PASSWORD_LENGTH` in that file to match.
- **Auth rate limiting**: Supabase's platform-level rate limits (`auth.rate_limit` in config.toml —
  `sign_in_sign_ups = 30`/5min, `token_verifications = 30`/5min, `email_sent = 2`/hour by default,
  etc.) are what actually protect sign-in/sign-up/password-reset from brute-force and email-bombing.
  This app adds no additional application-level rate limiting on top — documenting that dependency
  explicitly per the Prompt 2 brief's "document platform-level authentication rate limiting."
- **CAPTCHA** (`auth.captcha`): not configured; consider enabling (hCaptcha/Turnstile) before public
  launch if sign-up abuse becomes a problem.
- **SMTP**: local dev uses the built-in inbucket-style email testing server; a real project needs a
  production SMTP provider configured (`auth.email.smtp` in config.toml) or emails silently won't
  send.
- **Leaked-password protection** (`auth.password_requirements`/dashboard "Leaked password protection"):
  found **disabled** on the linked project by the release audit's `get_advisors` run
  (`auth_leaked_password_protection` WARN — Supabase checks new passwords against HaveIBeenPwned.org
  when this is on). Not expressible in a migration; enable in the dashboard (Authentication → Policies
  → Password) before inviting external beta readers, since sign-up is the one flow where this
  actually matters.

## Decisions made so far

- Node: this machine's global `node` was v25.8.0 (a Current, non-LTS release). Installed Node 24 LTS
  (`brew install node@24`, keg-only — the global `node` symlink was not changed by this step). A
  later `brew reinstall node` (done to repair an unrelated dylib break, see below) moved the global
  `node` to v26.5.1; Node 24 remains used explicitly for this project (`.nvmrc`, `engines.node`).
- **Unintended side effect, disclosed to you at the time**: installing `node@24` upgraded the shared
  `simdjson` dependency, breaking the existing global `node` v25.8.0 binary. Repaired via
  `brew reinstall node`, which (because Homebrew's formula had moved on) installed v26.5.1 rather
  than restoring v25.8.0. You were informed and confirmed proceeding both times.
- Env var naming: `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, not the legacy
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase is migrating to publishable/secret keys.
- Global public/auth layouts never check the session (kept static/cache-friendly); only
  `(contributor)/layout.tsx` calls `getCurrentUser()`. Documented trade-off: the static header never
  reflects sign-in state.
- Editorial/Moderation/Admin: no nav entry anywhere; implemented as Route Handlers, not pages, for the
  same HTTP-status-reliability reason established in Prompt 1. As of Prompt 2 they perform a real role
  check but still return the identical flat 404 to anyone without the role, including a signed-in user
  with an insufficient role — no information is leaked about _why_ access was denied.
- **Still no admin/service-role Supabase client, still no secret-key env var.** Every Prompt 2
  mutation (profile update, contributor create/update, role changes, contributor linking) is
  achievable as the calling user through RLS plus `SECURITY DEFINER` functions that re-derive
  authorization server-side — nothing needs to bypass RLS outright yet.
- Role-change and contributor-linking mutations are implemented as Postgres `SECURITY DEFINER`
  functions (`admin_set_user_role`, `link_contributor_to_user`) rather than permissive RLS UPDATE
  policies, specifically so the authorization re-check (caller's role, target-row state) lives in one
  place and can't be bypassed by a different query shape hitting the same table.
- `contributors_protect_privileged_fields()` is a trigger, not an RLS `WITH CHECK` clause, because
  column-level "can't change this specific column unless privileged" logic needs the pre-update
  (`OLD`) row, which `WITH CHECK` alone doesn't expose.
- `proxy.ts` now also performs the redirect-to-`/sign-in?next=`-decision for signed-out requests to
  protected routes (previously it only refreshed the cookie); the `(contributor)` layout's own
  `getCurrentUser()` check remains as a defense-in-depth backstop rather than being removed.
- `resolveStaffAccess()` was split into its own file (`lib/auth/staff-guard.ts`) separate from
  `lib/auth/roles.ts` after the first test run failed: `roles.ts` imports `"server-only"`, which
  throws under Vitest's jsdom environment the moment the module is imported, even to reach a pure
  function inside it. Same reasoning as the existing `contributor-guard.ts` / `get-current-user.ts`
  split.
- **Connected a real Supabase project mid-Prompt-2** (user ran `supabase login`; project
  `ybhydepjaantkngngvuf`, ap-northeast-1, confirmed as theirs before linking). Linked with
  `supabase link`, applied all migrations with `supabase db push` (dry-run reviewed first),
  regenerated real types, and updated `.env.local` with the real project URL and **publishable** key
  only — the secret/service-role key was used transiently in shell commands for verification queries
  and never written to any file in the repo. See "Prompt 2 detail" above for everything this let us
  actually verify, including a real bug it surfaced and the fix for it.
- Chose **not** to run `supabase config push` (which would push local `supabase/config.toml`'s
  `[auth]` section, including `site_url = "http://127.0.0.1:3000"`, to the hosted project) — those
  local-dev defaults don't match this app's actual `http://localhost:3000`, and pushing project-level
  auth/security settings without the user reviewing them first isn't something to do automatically.
  Left as a manual dashboard step (see "Manual Supabase settings required").
- **Prompt 3's biggest design decision: no direct table grants at all, for any role, in the story
  domain** — five review rounds on the plan converged on this before any code was written (RLS alone
  can't restrict which columns an `UPDATE` touches, and can't hide a column of an otherwise-readable
  row). Turned out to matter empirically too: Supabase's default per-table grants to
  `anon`/`authenticated` had to be explicitly revoked in a follow-up migration
  (`20260803090900_lock_down_story_domain_grants.sql`) for the design to be literally true, not just
  effectively true via RLS's own row-filtering.
- **`stories.visibility` and `stories.lifecycle_status` are two separate columns on purpose** (per the
  original brief), even though in this phase's implementation `visibility` only ever transitions
  `private → public`, exactly once, at first approval — `moderate_revision()` sets both together.
  Kept separate rather than collapsed into one column because a future admin action (e.g. temporarily
  unlisting a published story without archiving it) is a plausible use of the distinction, and the
  brief listed it as its own field.
- **`content_json` is text-only — no inline image blocks** — a deliberate simplification from an
  earlier design-review round that would have let a block reference a `story_revision_media` row by
  id. Removed entirely rather than half-built: images render as a separate ordered gallery from
  `story_revision_media`, which avoids the whole "does the referenced media id still exist / does its
  caption match" consistency problem an inline-image model would create.
- **Revocation is a terminal flag on `stories` (`consent_revoked_at`/`consent_revoked_by`), not
  another row in `story_publication_consents`** — simpler than treating it as another event in the
  same append-only sequence, and correct because revocation is story-wide (never per-revision) and
  needs no history beyond "did it happen, and when."
- Disposable RLS-test-suite accounts were created via the Auth Admin API using the project's
  secret/service-role key **transiently in shell commands only** (never written to any file), the
  same pattern already established in Prompt 2 — see "Prompt 3 detail" above for exactly what that
  did and didn't cover, and why one step (role promotion) still needed a manual SQL-editor action.

## Risks

- **Local Docker-based development still unverified.** Docker remains unavailable in this
  environment, so the _local_ stack path (`supabase start`/`db reset`/`gen types --local`) is still
  untested — Prompt 2's live verification instead used the **hosted linked-project** path
  (`supabase link` + `db push`), which is fully verified (see "Prompt 2 detail" above). Anyone
  developing locally with Docker available should still do a first `supabase db reset` and sanity
  check before assuming parity, though nothing in this session gave a reason to expect a difference.
- **Global header never reflects auth state, by design.** Unchanged from Prompt 1 — still acceptable,
  still worth revisiting if it becomes confusing UX.
- ~~Moderator visibility into `contributors` is row-level, not column-level~~ — **resolved in Prompt
  6 Stage 1** (`20260805101000_narrow_moderator_contributor_access.sql`, live-verified): the
  moderator branch of the "staff read all" policy was dropped; moderators have no direct
  `contributors` access at all now, since `get_story_for_moderator()` sources attribution from the
  `story_publication_consents` snapshot instead.
- **Sign-up and RLS/trigger behavior are live-verified (see "Prompt 2 detail"); the email-link
  round trip specifically is not.** Sign-up, self-escalation denial, and contributor-hijack denial
  were all exercised directly against the real Auth/PostgREST APIs. What's still unverified: actually
  clicking a real confirmation/reset email and landing on `/auth/callback` with a real `token_hash` —
  the redirect allow-list for that hasn't been confirmed configured on the project (see "Manual
  Supabase settings required"), so this is the next thing to check, not a re-litigation of the schema.
- **npm audit reports 3 high-severity advisories** in `postcss`/`sharp`, both transitive dependencies
  bundled inside `next@16.2.12` itself. `npm audit fix --force` would downgrade to `next@9.3.3` (a
  nonsensical, years-old regression) — not applied. No safe fix currently available; revisit when
  Next.js publishes a patched release.
- **`supabase/seed.sql`'s new story-domain fixtures are unverified.** They run only against the local
  stack (`supabase db reset`), which remains blocked on the missing container runtime — same
  limitation as every prior prompt's seed data. Written carefully (direct inserts, not RPC calls,
  since seed scripts have no `auth.uid()` session) but not exercised.
- **Full deletion of a story remains entirely out of scope**, exactly as content-governance.md always
  planned — every structural foreign key in the story domain is `on delete restrict`, so there is no
  accidental path to one either. A future explicit, human-reviewed deletion workflow is not scoped
  into any specific prompt yet.
- **`promote_story_media()` exists but is deliberately ungranted** — Prompt 4 must explicitly decide
  and grant the trusted image-processing pipeline's access (not assumed to be automatic via
  `service_role`, which does not bypass function `EXECUTE` privilege). Flag when scoping Prompt 4.
- ~~Cost-band bucket thresholds are not decided~~ — resolved in Prompt 5: <$5k / $5k–15k / $15k–30k /
  $30k+ NZD, exact cent boundaries `500000`/`1500000`/`3000000`, implemented in
  `list_published_stories()`'s `p_cost_band` parameter.
- **A handful of disposable `regions`/`destinations` rows accumulate** in the linked dev project from
  the RLS suite's destination-integrity test (`rls-test-` prefixed) — not covered by
  `scripts/rls-test-cleanup.sql`, which only scopes to story-domain tables. Trivial, accepted cost;
  revisit if it ever becomes noisy enough to matter (unlikely at test-suite run frequency). Prompt 5
  adds a second, analogous small accumulation: disposable `contributors` rows from the new
  `list_public_contributors`/`get_public_contributor` RLS test case (private/zero-story/
  anonymous-attribution/real-public fixtures) — `contributors` has never been in scope for the
  cleanup script (the fixed test-account pool must survive every run).
- **Contributor avatars are entirely unbuilt.** `contributors.avatar_path` exists in the schema but
  has no upload/processing/moderation pipeline and none was built in Prompt 5 (a deliberate scope
  decision — see "Prompt 5 detail"). Public contributor pages show a text-initial placeholder only.
  A future prompt needs: a new storage bucket (mirroring `story-images-public`'s public/private
  split), reuse of `lib/story/image-pipeline.ts`'s processing, and a decision on whether avatars need
  moderation approval before going public (Rules 13–14 suggest yes, matching story images).
- **No real caller exists yet for the actual publish/archive path**, so Prompt 5's cache-invalidation
  helpers (`lib/story/public-cache.ts`) are unwired — public pages rely on short-TTL ISR where it
  actually applies (`/`, `/sitemap.xml`) and on being forced-dynamic everywhere else (see
  architecture.md's "Caching and invalidation"). Prompt 6 must call the invalidation helpers from its
  new publish/archive/withdraw Server Actions the moment each mutation succeeds.

## Open assumptions

1. Hosting target is assumed to be Vercel + Supabase-hosted Postgres/Auth/Storage — not confirmed.
2. ~~Package manager~~ — confirmed: npm.
3. No existing design system, brand colors, or logo were found — Tailwind v4 defaults used until
   supplied.
4. ~~No existing Supabase project~~ — resolved during Prompt 2: a real project (`ybhydepjaantkngngvuf`)
   is now linked; `.env.local` holds its real URL and publishable key.
5. The exact reporting/report-review workflow (Prompt 8) is scoped at "reader can flag, moderator
   re-reviews" per docs/content-governance.md; no dedicated report-triage UI is assumed for MVP
   beyond surfacing reports in the moderation queue.
6. ~~Pending confirmation on the container-runtime limitation~~ — confirmed 2026-08-02: user accepts
   Prompt 1's "blocked on container runtime" classification and wants to proceed to Prompt 2.
7. ~~Email confirmation is assumed OFF~~ — resolved: confirmed **ON** on the real linked project
   (empirically, during Prompt 2 verification), independent of `supabase/config.toml`'s local-only
   default. See "Manual Supabase settings required" above.
8. A contributor's public byline (`contributors.public_status`/`attribution_type`) and a user's public
   profile page (`profiles.public_profile_enabled`) are modeled as two separate opt-ins on two
   separate tables, not one combined toggle — assumed correct per CLAUDE.md rule 4 ("keep
   user-editable profile data separate from protected role/permission data") and the brief listing
   `contributors` and `profiles` as distinct tables with their own fields. Revisit if product intent
   was actually a single combined "public profile."

## Next prompt

**Prompt 4 is complete — all 5 sub-phases.** All 8 migrations (5 original + 3 corrective) are
pushed and live-verified: `npm run test:rls` 33/33, all Playwright specs passing (including the new
`e2e/cross-contributor-access.spec.ts`), `types/database.ts` regenerated with no remaining
`callUntypedRpc()`/`as never` workarounds, and 137/137 unit tests + clean lint/typecheck/build/
format:check. See "Prompt 4 detail" → "Sub-phase 4" and "Sub-phase 5" above for the full account,
including the 2 real bugs found post-push in Sub-phase 4 (1 security regression, 1 ambiguous-column
bug), 1 hardening fix, and the real per-row `notFound()`-as-200 leak Sub-phase 5's new spec found
and fixed across all three of `/stories/[id]/edit`, `/stories/[id]/preview`, and
`/editorial/[id]/edit`.

Remaining, explicitly-accepted, non-blocking items (unchanged by this sub-phase, not Prompt-4-
shaped work):

- `npm run e2e:cleanup:editorial-fixtures -- --execute` remains blocked on a missing
  `.env.maintenance.local` (no service-role key available in this environment). Accepted as
  low-cost/disposable test fixture data for now — revisit whenever maintenance credentials are
  actually set up; this is a one-time credential-provisioning step only the user can perform, not
  an engineering task.
- `docs/design-brief.md` (untracked, Prompt 5 UI-planning material) informed Prompt 5's palette/
  component styling — see "Prompt 5 detail" above.

**Prompt 5 is complete.** 5 migrations pushed and live-verified (`npm run test:rls` 44/44, up from
33), 24/24 Playwright specs (up from 19, including the new `e2e/public-discovery.spec.ts`), 153/153
unit tests (up from 137), clean `npm run verify`. See "Prompt 5 detail" above for the full account,
including the contributor-table grant fix, the public per-row 404 fix, and the
ambiguous-`story_id` corrective migration.

Remaining, explicitly-accepted, non-blocking items:

- `npm run e2e:cleanup:editorial-fixtures -- --execute` remains blocked on a missing
  `.env.maintenance.local` (no service-role key available in this environment) — unchanged from
  Prompt 4, re-affirmed rather than re-attempted.
- Disposable `contributors` fixture rows from Prompt 5's RLS test additions are not cleaned up (see
  "Risks" above) — same low-cost/accepted category as the existing disposable regions/destinations.
- Contributor avatars remain entirely unbuilt (see "Risks" above) — a real, scoped follow-up feature,
  not a Prompt 5 gap.
- Prompt 5's cache-invalidation helpers (`lib/story/public-cache.ts`) have no real caller yet —
  Prompt 6 must wire them into its new publish/archive/withdraw Server Actions.

**Prompt 6 is now complete — all 3 stages, including live e2e verification.** Stage 1
(backend/migrations), Stage 2 (queue/review UI + approve/archive orchestration), and Stage 3
(reports-triage workspace, `docs/moderation-guidelines.md`, recovery-hardening review) are all done.
**11 migrations** pushed and live-verified (`npm run test:rls` 69/69) — 10 from Stages 1–2 plus one
post-Stage-3 corrective migration found via live e2e testing (see "Post-Stage-3 live e2e
verification" above). `npm run verify` clean: 182/182 unit tests, 32-route build.
**`e2e/moderation.spec.ts` + `e2e/reports-triage.spec.ts`: 12/12 passing live** against the real
linked project (`--workers=1`), the two real app bugs that run found and fixed, and the accumulated
test-fixture debris cleaned up afterward. See "Prompt 6 detail — Stage 1", "Stage 2", "Stage 3", and
"Post-Stage-3 live e2e verification" above for the full account.

Remaining, explicitly-accepted, non-blocking items:

- `e2e/moderation.spec.ts` and the new `e2e/reports-triage.spec.ts` are both written (following this
  repo's established direct-RPC-fixture pattern) but **not run this session** — both need the full
  `SUPABASE_RLS_TEST_*` credential pool in `.env.test.local`, the same live-project boundary every
  other real e2e spec in this repo already has; neither is blocked by any unpushed migration.
- `/moderation/reports/[id]` has no middleware-level per-row existence check (unlike
  `/moderation/stories/[revisionId]`'s `can_view_moderation_review()`) — a low-risk, same-role-only
  wrong-status-code edge case, not an authorization gap (see "Prompt 6 detail — Stage 3" above).
  Fixing it properly needs a new RPC/migration; flagged, not built without asking first.
- `npm run e2e:cleanup:editorial-fixtures -- --execute` remains blocked on a missing
  `.env.maintenance.local` (no service-role key available in this environment) — unchanged since
  Prompt 4.
- Disposable test fixture rows from Prompt 6's RLS/e2e-spec additions are not cleaned up — same
  low-cost/accepted category as every prior stage's disposable fixtures.

**Prompt 7 is now complete.** Content readiness dashboard (`/readiness`), operational metrics,
advisory content-quality checks, same-story duplicate-image warnings, an explicit "what's public"
contributor summary, and three founding-catalogue runbook docs — see "Prompt 7 detail" above and
[docs/architecture.md](architecture.md#content-readiness-operational-metrics-and-launch-tooling-prompt-7)
for the full account. This session also closed out the item flagged directly above: `.env.test.local`
was available this session, so `e2e/moderation.spec.ts` and `e2e/reports-triage.spec.ts` (previously
"written but not run") were run live along with the new `e2e/founding-story-workflow.spec.ts` — full
suite **37/37 passing**. 2 new migrations pushed and live-verified (`test:rls` 69/69, unchanged).

Remaining, explicitly-accepted, non-blocking items:

- ~~`/moderation/reports/[id]` still has no middleware-level per-row existence check~~ — **fixed in
  the release audit session (2026-08-05→2026-08-06)**: `can_view_moderation_report()`
  (`supabase/migrations/20260806100000_moderation_report_existence_check.sql`, applied and
  live-verified) mirrors `can_view_moderation_review()`'s existing pattern exactly; `proxy.ts` now
  gates `/moderation/reports/[id]` the same way it already gated `/moderation/stories/[revisionId]`.
  A new Playwright case in `e2e/reports-triage.spec.ts` ("a nonexistent report id gets a real 404,
  not a soft-200") confirms a bogus report id now returns a genuine HTTP 404 instead of the previous
  live 200; the full `e2e/moderation.spec.ts` + `e2e/reports-triage.spec.ts` batch (13/13) was re-run
  live afterward with no regressions.
- `npm run e2e:cleanup:editorial-fixtures -- --execute` remains blocked on a missing
  `.env.maintenance.local` (no service-role key available in this environment) — unchanged since
  Prompt 4.
- Disposable `rls-test-%` fixture rows (including 4 new `rls-test-founding-story-%` stories from
  this session's live spec runs) are not cleaned up — same low-cost/accepted category as every
  prior prompt's disposable fixtures; `npm run test:rls:cleanup` still can't run in this environment
  (no Supabase CLI), and a manual bulk delete via the Supabase MCP was deliberately not performed
  without asking first.
- Bulk metadata operations and a staff-directory reassignment picker were both confirmed out of
  scope for this prompt (see "Prompt 7 detail" above) — real, but not required, future work.
- `content-quality-checks.ts`'s findings are not yet surfaced as UI badges on any review page — the
  pure module and its tests are ready for whichever future prompt wants to wire them in.

**Prompt checklist (0–7) is now fully complete.** Any further work is genuinely new scope, not a
continuation of a planned prompt — check with the user before starting anything substantial.

## Landing page rebuild (2026-08-05, new scope — not part of Prompts 0–7)

The user supplied a full design-tool mockup (`journiq_landing_page_card_stack.html`: hero photo
slideshow, drag-based card-stack carousel, filter+grid, region explorer, destination-match quiz,
testimonial, newsletter, dialogs, manual theme toggle) and asked for it as the real homepage — a
larger scope than the narrower carousel-only task in
`docs/landing-page-carousel-implementation-prompt.md`. Confirmed with the user via plan-mode
questions before building; see "Landing page rebuild — card-stack carousel, discovery sections, and
manual theming" in `docs/architecture.md` for the technical account.

**Decisions made (and explicitly _not_ built), all confirmed with the user first:**

- Real data only — no hotlinked Unsplash stock photography anywhere (hero, region tiles,
  testimonial). Sections with no real backing content simply aren't ported rather than getting a
  fake interactive feature.
- Manual light/dark theme toggle built for real (`data-theme` model, localStorage persistence,
  blocking inline script) — this is a real change from the previous `prefers-color-scheme`-only
  approach.
- Newsletter signup **dropped entirely** — no email-list infrastructure exists; the mockup's
  fake-success-message version would have been dishonest UX.
- Destination-match quiz kept the mockup's UX shape but is **not** hardcoded against the mockup's
  fictional regions — it scores real `regions`/`work_types`/`tags` data via the new
  `lib/story/region-match.ts`, degrading to a plain "browse all stories" link when nothing matches
  rather than fabricating a result.
- The mockup's fake local-only "sign in"/"share your story" dialogs and in-page story-preview modal
  were not built — the existing real `/sign-in`, `/sign-up`, and `/stories/[slug]` pages are used
  instead, and the existing `SiteHeader`/`SiteFooter` are reused rather than rebuilt.

**Status:** implementation complete — `components/home/featured-story-stack.tsx` (replaces the
prior scroll-snap `FeaturedStoryCarousel`), `components/home/story-filter-grid.tsx`,
`components/home/region-explorer.tsx`, `components/home/destination-quiz.tsx` +
`lib/story/region-match.ts`, `components/theme-toggle.tsx`, and the `app/globals.css`/
`app/layout.tsx` theming rework. `app/(public)/page.tsx` and its test extended; `e2e/home.spec.ts`
extended with stack-carousel keyboard operability, quiz flow, region link, and theme-toggle
persistence cases.

**Live browser verification:** a dev server against the linked Supabase project was already running
in this environment, so the rebuild was checked live in-browser (not just via unit tests) at
375px/mobile first, then desktop, in both themes. This caught and fixed one real bug the unit
suite couldn't: the `data-theme` blocking-script pattern in `app/layout.tsx` needs
`suppressHydrationWarning` on `<html>` — React validates hydration on the root element's own
attributes, so without it the intentional pre-hydration `data-theme` write (server has no such
attribute; the inline script adds it before paint) was logging a hydration-mismatch error on every
load. Fixed; confirmed clean afterward with a fresh tab (no accumulated console history).

**Risks / remaining items:**

- The linked dev Supabase project's published-story rows are entirely disposable `rls-test-%`
  fixtures (see the recurring "fixture cleanup" items elsewhere in this doc) — confirmed via direct
  REST query that **zero** of them carry any `regions` value, and only some carry `work_types`/
  `tags`. That means region-explorer and the quiz's real-match path couldn't be exercised against
  realistic content this session: region-explorer correctly rendered nothing (verified), and the
  quiz correctly reached its "no strong match yet" fallback (verified) — both are the _intended_
  behavior for zero-region data, not a bug, but neither path's "found a real match" branch got a
  live look. The filter grid's chip-from-real-data path did render correctly since some fixture
  rows have `work_types`/`tags`.
- The quiz's match quality generally depends on catalogue breadth — even with clean data, thin
  catalogues will legitimately hit the "no strong match yet" fallback for some answer
  combinations. That's correct behavior, not a bug, but worth knowing before demoing.
- The `data-theme` CSS rework was spot-checked against the public/home page and the shared
  header/footer only in this session — worth a quick visual pass over the auth, contributor,
  editorial, moderation, and readiness route groups the next time any of them are touched, to
  confirm none of them hardcode a light- or dark-only assumption that the new manual toggle can now
  actually trigger.
- `npm run test:e2e` (the Playwright suite itself) was not run live in this session — the new
  cases were instead exercised manually against the live dev server via the browser tool
  (carousel drag/keyboard, quiz flow, theme persistence all confirmed working). Running the actual
  spec file live is still worth doing before calling this fully verified end-to-end.

**Follow-up pass (same day): full fidelity to the mockup, on explicit user direction.** The user
came back after reviewing the first pass and gave two direct instructions that reverse two of the
guardrail decisions above: (1) use the mockup's actual hero photography, animation, and wording
throughout — "abandon the initial wording of the initial landing page" — and (2) replace the warm
brown/terracotta palette with the mockup's forest-green + sand + orange palette ("DO NOT USE
BROWN"). Both implemented sitewide (not homepage-only, since the color tokens in `app/globals.css`
back every page):

- `app/globals.css`: full retint — `--background`/`--foreground`/`--surface`/`--surface-muted`/
  `--border-subtle`/`--accent`/`--accent-foreground`/`--tag-background`/`--tag-foreground` all
  replaced with the mockup's hex values (light + dark), plus two new tokens (`--forest`, `--fern`)
  for the header-toned dark-green bands and eyebrow-label green the mockup uses.
- `components/home/hero-slideshow.tsx` (new) replaces `components/home/hero-backdrop.tsx`
  (deleted): the mockup's exact 3 Unsplash photos, cross-fade + Ken Burns zoom (CSS in
  `app/globals.css`: `.hero-slide`, `.hero-overlay`, `@keyframes hero-ken-burns`), a visible
  pause/play control, `prefers-reduced-motion` respected via `useSyncExternalStore` (not
  setState-in-effect — the stricter React Compiler purity lint the same fix from the first pass
  required here too).
- `app/(public)/page.tsx`: every section's wording replaced with the mockup's copy verbatim
  (hero, "Featured journals", "Find your match", "Browse by interest", "Across the motu", "How
  Kakinotes helps" 3-step block replacing the old 3-column trust grid, the community-note quote, and
  the "Pass it forward" closing band), and reordered to the mockup's flow. Hero CTAs now anchor to
  in-page sections (`#stories`, `#match`) exactly as the mockup does, since those sections now
  exist on this page.
- `components/story/personal-experience-label.tsx` gained a `tone="onPhoto"` variant (white/glass)
  so the hard product-requirement disclaimer (Rule 17) still has a real, legible placement over
  the new photo hero — the mockup's own hero doesn't include this label at all (it's a marketing
  mockup, not the real product), so this is a deliberate addition on top of the mockup rather than
  a literal copy of it.
- `components/home/region-explorer.tsx` gained a `tone="onForest"` variant for the mockup's
  always-dark `.regions` band.
- One quote/testimonial section (`"Amélie R. · France"`) is copied verbatim from the mockup's
  placeholder copy. **This is fabricated content attributed to a named individual** — flagged
  rather than silently shipped: before this goes further than a working preview, either replace it
  with a real (consented, attributed) contributor quote or restyle it as an explicitly-labeled
  illustrative/placeholder element. Every other new section degrades honestly (renders nothing /
  falls back) when there's no real data; this one section does not, because the mockup's own copy
  was a fixed placeholder rather than something driven by real content.
- Stock photography was deliberately _not_ extended beyond the hero (region tiles and the closing
  CTA band use solid forest-green treatments instead of the mockup's additional stock photos) —
  the user's instruction specifically named "hero images"; this is a scope call worth confirming
  if the intent was broader.
- Live-verified in-browser (mobile then desktop, light and dark) against the same already-running
  dev server: hero photo/animation/pause control, forest/sand/orange palette in both themes, new
  section copy and order, "How Kakinotes helps" steps, quote section, dark "Pass it forward" band.
  `npm run verify` clean throughout (252/252 unit tests, lint, typecheck, build).

**Second follow-up (same day): three bugs from that pass, all fixed and live-verified.**

- The hero's "Pause motion" button never received clicks. Root cause: it was nested inside
  `HeroSlideshow`'s `-z-10` background wrapper, and the hero's text-content div (a later,
  higher-stacking sibling of that whole wrapper) covered it for hit-testing everywhere their boxes
  overlapped, even where the text div was visually empty. Fixed by making the button a sibling of
  the background layer instead of a child of it (`components/home/hero-slideshow.tsx`), matching
  how the mockup itself structures `.hero-motion-toggle`. Also wired up the
  `.hero-slideshow.is-paused` CSS (already present in `app/globals.css` from the first pass but
  never actually applied) so pausing now visibly freezes the Ken Burns zoom mid-frame, not just
  the slide-advance timer.
- `components/site-header.tsx` had no sticky positioning at all — added `sticky top-0 z-40`.
- Ported the mockup's remaining animations, which the first pass had genuinely skipped: hero
  content staggered fade-in on load (`.hero-fade-item`/`@keyframes hero-content-in` in
  `app/globals.css`), scroll-reveal-on-view for section intros and grid items (new
  `components/home/reveal.tsx`, an `IntersectionObserver` wrapper — needed a jsdom stub added to
  `vitest.setup.ts` since jsdom doesn't implement `IntersectionObserver`), and hover-lift
  transforms on cards/buttons/dots/icon-buttons (`components/story/story-card.tsx`,
  `components/home/region-explorer.tsx`, `components/home/featured-story-stack.tsx`,
  `components/theme-toggle.tsx`). All of it routes through the existing global
  `prefers-reduced-motion` override in `app/globals.css`, so no separate reduced-motion branching
  was needed in the new component.
- Live-verified: clicked the real pause button via the browser tool and confirmed it toggles to
  "Play motion" and the slideshow changes; scrolled deep into the page and confirmed the header
  stays pinned; watched the reveal animation fire mid-scroll on grid cards. `npm run verify` clean
  (252/252 tests, lint, typecheck, build).

**Third pass (same day): merged the user's own hand-edited archive** (`docs/landing-designs/
journiq-landing-page-edited.zip`, extracted to `/tmp/journiq-edited` for inspection, never
extracted over the repo). It contained the same 26-file set from the second pass, with edits to 6:
`app/(public)/page.tsx`, `app/globals.css`, `components/site-header.tsx`,
`components/site-footer.tsx`, `components/home/featured-story-stack.tsx`,
`components/home/featured-story-slide.tsx`. Diffed every file against the repo before touching
anything; the other 20 were byte-identical and untouched.

Sizing/copy/typography edits (bigger stack card, serif card titles, `max-w-[1160px]` sections,
`.journiq-heading`/`.journiq-button` utilities, a photo behind the "Community note" quote, a photo
band behind "Pass it forward") were applied as authored. Several things needed adaptation rather
than a blind copy, because `SiteHeader`/`SiteFooter` are shared across **every** route (including
`(auth)/layout.tsx` and every staff layout for `SiteFooter`), not just the home page:

- The edited header made `.journiq-header` (a transparent dark gradient, white text) permanent.
  Applied everywhere unmodified, this would have made header text illegible on every non-home page
  (light background, no hero underneath). Rewrote `SiteHeader` as route- and scroll-aware
  (`usePathname() === "/"` and a `useSyncExternalStore`-based scroll threshold, same pattern as the
  reduced-motion/theme hooks elsewhere in this codebase): transparent only on `/` before scrolling
  past the hero, solid everywhere else. The header's own box never resizes when toggling (no
  negative margin on the header); instead `app/(public)/page.tsx`'s hero section alone carries
  `-mt-[76px]` to tuck behind the sticky header, so the transparent→solid switch never causes a
  layout jump.
- `ThemeToggle` and `MobileNavToggle` gained an `inverted` prop so their icon buttons stay legible
  in both header modes.
- Found and fixed a real bug during live verification: the mobile nav dropdown panel is always
  opaque (`bg-surface`) but was inheriting `text-white` from the transparent header ancestor,
  making its own links invisible against its own light background. Added an explicit
  `text-foreground` on the dropdown `<nav>`.
- The edited header switched its desktop/mobile-nav breakpoint from `sm` to `md` but
  `MobileNavToggle`'s wrapper was still hardcoded to `sm:hidden` — a live 640–767px dead zone with
  neither nav visible. Fixed by changing the wrapper to `md:hidden` to match.
- The edited footer dropped the `/copyright` link (route still exists, just no longer linked from
  anywhere) — added it back into the Support column.
- The edited featured-story-slide.tsx "Read story" button had both `text-white` and
  `text-accent-foreground` on a `bg-forest` background; `accent-foreground` is a near-black tone
  meant for the orange accent background, not forest green, and would have been nearly invisible.
  Removed the stray `text-accent-foreground`.
- Merged the new `globals.css` rules (`.journiq-heading`, `.journiq-button`, `.journiq-header`,
  `.journiq-nav-link`, `.journiq-share`) as new class-scoped utilities (nothing outside where
  they're actually applied is affected) and deduped the two properties that arrived as a second,
  separate `:focus-visible`/`.story-stack-card` rule block into the file's single existing
  declarations, rather than leaving two rules for the same selector.
- Updated `app/(public)/page.test.tsx` and `components/site-footer.test.tsx` for the new copy (the
  personal-experience disclaimer moved from a hero pill to footer-only text — the hero pill was my
  own earlier addition, not in the mockup or the user's edit, and dropping it doesn't violate
  Engineering Rule 17, which is about story detail pages, not the marketing hero); added
  `components/site-header.test.tsx` (didn't exist before) covering the new route/scroll-aware
  behavior.

**Not resolved, flagged for the user instead of guessed at:** `SiteFooter` is also rendered by
every staff layout (`(editor)/editorial`, `(moderation)/moderation`, `(contributor)`,
`(readiness)/readiness`) — this was already true before this change, but the new footer is a much
more visually "marketing site" branded treatment (dark green, "Share a story" CTA) than the
previous neutral one, so that branding now shows up under internal staff tools too. Left unchanged
since restructuring which layouts use which footer is new scope beyond "integrate the landing
page," not a bug — flagging for a product decision.

Live-verified in-browser: header transparent→solid transition on scroll (both directions), solid
header immediately on a non-home route (`/sign-in`), the previously-broken 640–767px width (mobile
menu now appears correctly), the mobile dropdown contrast fix, dark mode at 1024px and 375px, and
1440px. `npm run verify` clean throughout (257/257 tests, lint, typecheck, build).

**Fourth pass (same day): "Sign in" and "Share your story" open as modals** instead of navigating
to `/sign-in`/`/sign-up`, closing back to whatever page was open underneath. No auth logic was
duplicated: `components/auth/sign-in-form.tsx` and `sign-up-form.tsx` (relocated from
`app/(auth)/sign-in/` and `app/(auth)/sign-up/` — they were already self-contained
`useActionState` client components calling the real `signInAction`/`signUpAction` Server Actions,
just living next to their page) are rendered unchanged inside a new
`components/auth/auth-modal.tsx`, a native-`<dialog>`-based shell (`showModal()`/`close()` via a
ref synced to an `open` prop) that gets focus trapping, top-layer rendering, and Escape-to-close
for free from the browser, plus a backdrop-click handler and a visible × button. `/sign-in` and
`/sign-up` still exist and work standalone (direct navigation, bookmarks, and the auth
middleware's own redirects to `/sign-in?next=…` all still land on a real page) — only the header's
own buttons changed. A successful sign-in still calls `redirect()` server-side as before, which
navigates the whole page away and closes the modal as a side effect; the "sign up success" state
just shows its confirmation message in place of the form until the user closes the modal manually.

`MobileNavToggle`'s `navItems` gained an `href`-or-`onClick` union so the mobile dropdown's "Sign
in"/"Share your story" entries can open the same modals (closing the dropdown first) instead of
navigating.

Two test-environment gaps found and fixed along the way, both jsdom limitations rather than app
bugs: jsdom 30's `HTMLDialogElement` is a bare stub with no `showModal()`/`close()` at all (only
the `open` attribute reflects), so `vitest.setup.ts` gained a small polyfill, guarded for the one
test file that runs in Vitest's plain "node" environment where the global doesn't exist. And
`components/site-header.test.tsx` needed `SignInForm`/`SignUpForm` mocked out — importing the real
ones pulls in their `"use server"` action module, which imports `lib/supabase/server.ts`'s
`server-only` guard; that guard throws when it detects a `window` global, which jsdom always
provides, even though the same import graph is perfectly fine in an actual Next.js build (the
`"use server"` directive is specially compiled away for client bundles there).

Live-verified in-browser: both modals open from their header buttons (desktop and the mobile
dropdown), close via the × button, Escape, and backdrop click, the landing page is fully visible
and interactive again after closing, and `/sign-in` still returns a real 200 on direct navigation.
`npm run verify` clean (265/265 tests, lint, typecheck, build).

**Fifth pass (same day): destination quiz reverted to hardcoded scoring, per explicit user
request** ("change back to using hardcoded answers. Do not use what is available from the database
to compare"). `components/home/destination-quiz.tsx` no longer takes any props — it dropped its
`stories`/`regions` inputs and the Supabase-backed matching helper `lib/story/region-match.ts`
(and its test) entirely, deleting both files as now-dead code (confirmed via repo-wide grep that
nothing else imported `matchRegion`). The component now hardcodes its own 5-question quiz and a
fixed `DESTINATION_INFO` lookup for 6 destination names (Auckland, Wellington, Canterbury, Bay of
Plenty, Queenstown Lakes, Central Otago); the result screen always shows a top-scoring destination
from that fixed table (no more "no strong match" fallback) with an "Explore stories" CTA pointing
to the in-page `#discover` anchor instead of a `/stories?region=<id>` link, since there's no real
region id to link to anymore. `app/(public)/page.tsx` updated to `<DestinationQuiz />`.
`components/home/destination-quiz.test.tsx` was rewritten from scratch for the new zero-props
shape (walking through all 5 questions, two deterministic single-destination answer paths, back
navigation, the `#discover` link, and restart). `npm run verify` clean (260/260 tests, lint,
typecheck, format, build).

**2026-08-08 — New Story vs. Edit Story heading, and story editor migrated from Tiptap to Plate.**

The self-service edit page (`app/(contributor)/stories/[id]/edit/page.tsx`) previously showed "Edit
Story" unconditionally, including immediately after `/stories/new` redirects a freshly-created
draft here. It now shows "New Story" (heading + browser tab title, via a new `generateMetadata()`)
for a story's first-ever revision (`revision_number === 1`) and "Edit Story" once it's been through
at least one submit/changes-requested/resubmit cycle. `lib/story/contributor-queries.ts`'s
`getEditableStoryWithDraft()` is now wrapped in React's `cache()` so `generateMetadata()` and the
page component share one RPC round trip instead of duplicating it. `StoryEditForm` gained an
`isNewStory` prop (only passed by the self-service page; the editorial import page's usage is
unaffected — an editor preparing someone else's story is always "editing").

Separately, replaced the Tiptap-based rich text editor with
[Plate](https://platejs.org) end-to-end, per explicit request. New packages: `platejs`,
`@platejs/basic-nodes`, `@platejs/list`, `@platejs/link` (+ `use-sync-external-store`, a transitive
peer Zustand needs that wasn't otherwise installed). Removed: `@tiptap/react`, `@tiptap/pm`,
`@tiptap/starter-kit`, and the old `components/story/rich-text-editor.tsx` +
`lib/story/rich-text-serialize.ts` (with their tests).

- `lib/story/plate-serialize.ts` (new) converts between Plate's document value and the existing
  canonical `StoryContentBlock[]` schema (`lib/validation/story.ts`) — the DB/validation contract
  itself is completely unchanged, only what produces/consumes it. Plate's list model turned out to
  be flat (confirmed empirically, not from docs — a list item is a plain paragraph node carrying
  `indent`/`listStyleType`, not a nested `<ul>/<li>` tree); converting canonical → Plate expands a
  `list` block's items into that many flat indented paragraphs, and Plate → canonical groups
  consecutive same-category flat paragraphs back into one `list` block. Blockquote turned out to be
  block-level (`{ type: "blockquote", children: [{ type: "p", children: [...] }] }`), not a flat
  text-holding node — an earlier version of this file assumed the flat shape from hand-written
  probe data (never exercised through the real `editor.tf.blockquote.toggle()` transform) and threw
  a live runtime error (`Cannot read properties of undefined (reading 'length')`) the first time
  blockquote was toggled through the real editor; fixed once caught live.
- `components/story/story-content-editor.tsx` (new, replaces `rich-text-editor.tsx`) — same external
  props/ref contract (`initialContent`, `onChange`, `editable`, `ariaLabel`,
  `replaceContent()` handle) so `story-edit-form.tsx` only needed an import/rename change. Custom
  node/leaf components (no Plate prebuilt shadcn UI kit — this repo has no shadcn/ui setup
  anywhere else, so pulling one in for just this component would be inconsistent). Toolbar mirrors
  the old one exactly: Bold, Italic, H2, H3, bulleted/numbered list, Quote, Link (prompt-based, same
  UX as before), Undo, Redo.
- Two more real bugs found and fixed live (not hypothetical): (1) the toolbar's active/pressed
  indicators never updated after the first render — `useEditorRef()` doesn't subscribe to editor
  state changes; fixed with `useEditorSelector`, Plate's reactive-selector hook. (2) List items
  initially rendered their own manual "•"/"1." marker prefix, which turned out to double up with
  `ListPlugin`'s own automatic `<ul>/<ol>` node-wrapper (confirmed live via the real DOM) — removed
  the manual marker. That wrapper also turned out to insert the `<ul>` _inside_ whatever tag the
  paragraph component rendered as; rendering list items as `<p>` produced invalid
  `<p><ul>...</ul></p>` markup and a live React hydration error, fixed by rendering list-item
  paragraphs as `<div>` instead (ordinary paragraphs still render as real `<p>`).
- Live-verified end-to-end in-browser, not just unit tests: typing, Bold/Italic on a real selection,
  H2 toggle, bulleted/numbered list toggle, Quote toggle, Link (with an existing mark preserved
  inside it), Undo/Redo, full save → reload → re-edit round trip (confirmed via the actual
  `story_revisions.content_json` row, not just the in-memory editor state), and the independent
  read-only preview page (`content-block-renderer.tsx`, which never touches Plate at all) rendering
  the same content correctly.
- `npm run verify` clean: lint, typecheck, 262/262 tests (9 new in `plate-serialize.test.ts`, 6 new
  in `story-content-editor.test.tsx`, replacing the 2 old Tiptap test files 1:1 in coverage), build.

**2026-08-08 — Added a table block type to the story content schema/editor.**

User asked for "all the features" of the full Plate playground demo (AI copilot, media embeds,
columns, comments, etc.); most of that conflicts with Engineering Rule 6/7 (controlled JSON, no
raw HTML) and the MVP non-goals (no audio/video), so scoped down via `AskUserQuestion` to one
concrete addition: table blocks. New package: `@platejs/table@53.0.9` (matches the installed
`platejs@53.3.3` line).

- `lib/validation/story.ts`: new `tableBlockSchema` (`{ type: "table", rows: TableCell[][] }`,
  cells are run arrays with `minRuns: 0` — unlike every other block, a blank cell is a normal part
  of a grid's shape, not "no content" to drop). `storyContentSchema` gained a `.refine()` requiring
  every row in a table to have the same column count (rectangular grid); `blockCharacterCount()`
  extended to sum table cells into the existing document-length cap.
- `lib/story/plate-serialize.ts`: table conversion both directions. Confirmed empirically (not
  from docs) against the installed `@platejs/table`'s `getEmptyCellNode`/`getEmptyRowNode`: a table
  is `tr` rows of `td` cells, and — like blockquote — each cell holds a block (paragraph) child
  rather than inline children directly. `TableCellHeaderPlugin` (the `"th"` variant) is
  deliberately never registered, so header cells are structurally absent, same reasoning as
  underline/strike/hr elsewhere in this editor configuration.
- `components/story/story-content-editor.tsx`: registers `TablePlugin`/`TableRowPlugin`/
  `TableCellPlugin` (no resize/merge/border UI — kept minimal) and a "Table" toolbar button that
  calls `insertTable(editor, { colCount: 3, rowCount: 3 })`. `TableElement` renders as a `<div>`
  wrapping a real `<table><tbody>...`, not `<table>` itself directly — same reasoning as
  `ParagraphElement`'s list-item `<div>` above: a bare `<table><tr>` (no `tbody`) produced the same
  class of invalid-DOM-nesting issue already documented there for `<p><ul>`.
- `components/story/content-block-renderer.tsx`: **a real bug, found live** — this is a _separate_
  component from the Plate editor (used by the preview page and, later, the public story page), and
  its `Block()` switch had no `"table"` case. Because the function has no return-type annotation,
  TypeScript didn't flag the non-exhaustive switch, so `npm run build` stayed green while a table
  block silently rendered as nothing on `/stories/[id]/preview`. Caught by live-testing the full
  editor → save → reload → preview round trip in-browser (not just unit tests), not by any
  automated check. Fixed by adding the missing case (`<table><tbody>` of `<tr>`/`<td>`, reusing the
  existing `RunList` for cell text — no `dangerouslySetInnerHTML`, per Engineering Rule 7).
- New tests: `plate-serialize.test.ts` (table round-trip, empty cells preserved),
  `story-content-editor.test.tsx` (`insertTable()` produces only `td`, never `th`),
  `content-block-renderer.test.tsx` (new file — this component had no tests before; covers the
  table case specifically since that's what regressed).
- `npm run verify` clean: lint, typecheck, 265/265 tests, build. Live-verified in-browser: inserted
  a table, typed into a cell, reloaded the page (content persisted through the mutation
  queue/DB round trip), and confirmed it renders correctly on the preview page.

**2026-08-08 — Rebuilt the story editor on Plate's registry components (not hand-rolled ones).**

User asked to "just use the Platejs editor directly" instead of the bare-`<button>` toolbar and
minimal node components from the previous two entries. `AskUserQuestion` narrowed this to: adopt
Plate's own registry UI (`platejs.org/r/*.json` — the same components their prebuilt "Editor"
ships, fetched directly since the `shadcn` CLI's `add` command silently skipped installing the npm
packages its own files import, for reasons not fully diagnosed — installed them by hand instead),
but keep `storyContentSchema` closed. Not "install everything and see what happens": each registry
file was read and trimmed to exactly the allowed block/mark set before being adapted in.

- **New foundation, previously absent** (per this file's earlier note that pulling in shadcn/ui
  "would be inconsistent" — now a deliberate, justified exception): `components.json`
  (`style: new-york`, `baseColor: neutral`), `lib/utils.ts` (`cn()` via `clsx`+`tailwind-merge`),
  and a `components/ui/` directory of shadcn primitives (`button`, `tooltip`, `separator`,
  `dropdown-menu`, `popover`, `input`, plus Plate's own `editor.tsx`/`editor-static.tsx`
  container). `app/globals.css` gained shadcn's semantic token set (`--muted`, `--popover`,
  `--border`, `--ring`, `--primary`, `--secondary`, `--destructive`, `--brand`, `--radius*`)
  **mapped onto the existing brand palette** (`--primary: var(--forest)`, `--ring: var(--accent)`,
  etc.) in all four theme blocks (`:root`, `prefers-color-scheme: dark`,
  `[data-theme="light"]`, `[data-theme="dark"]`) — additive only, since another session had
  in-flight uncommitted edits to this same file at the time. New deps: `class-variance-authority`,
  `tailwind-merge`, `lucide-react`, `@radix-ui/react-{toolbar,tooltip,separator,dropdown-menu,
popover,slot}`, `@platejs/floating`.
- `components/story/editor/` (new directory) holds the adapted registry files: `toolbar.tsx`/
  `fixed-toolbar.tsx` (Radix-backed `Toolbar`/`ToolbarButton`/`ToolbarGroup`, replacing the old
  plain `<button>` toolbar), `paragraph-node.tsx`/`heading-node.tsx`/`blockquote-node.tsx`/
  `link-node.tsx` (Plate's real node components — `heading-node.tsx` trimmed to export only
  H2/H3, not H1/H4-H6), `mark-toolbar-button.tsx`/`history-toolbar-button.tsx`/
  `list-toolbar-button.tsx`/`link-toolbar-button.tsx`/`link-toolbar.tsx`/`table-toolbar-button.tsx`
  (toolbar buttons, several trimmed — see below), `table-node.tsx` (kept as this app's own minimal
  version, not the registry one — see its header comment).
- **Real upgrade, not just a re-skin**: Link now uses Plate's actual floating link-editing popover
  (`link-toolbar.tsx`'s `LinkFloatingToolbar`, via `@platejs/floating`) instead of a
  `window.prompt()`. The href-safety boundary is unmoved by this — `isSafeHref()` was never
  enforced by the old prompt either (a user could still type `javascript:` into it); the converter
  (`plateValueToBlocks()`) dropping unsafe hrefs while keeping the text is documented as the real
  boundary and still is. `story-content-editor.tsx` no longer imports `isSafeHref` at all, since
  nothing in it calls the plugin's insert command directly anymore.
- **Deliberately NOT adopted from the registry**, each for a concrete, checked reason:
  1. `basic-blocks-kit.json`/`basic-marks-kit.json` bundle every heading level, `hr`, and every
     mark (underline/strike/code/highlight/kbd/sub/superscript) into one plugin-array export —
     registering that array whole would blow the closed-schema constraint the same way "install
     the full editor-kit" would have; only the specific H2/H3/Blockquote/Bold/Italic plugins
     needed were kept, each pointed at its own already-adapted node component.
  2. The registry's `table-node.tsx` (~1,460 lines) brings drag-row-reorder, column resize, and
     multi-cell merge/split — each needs data (`colSpan`/`rowSpan`, per-column pixel widths,
     per-cell background/border) that `storyContentSchema`'s table block has no field for, and
     three more Plate packages (`@platejs/dnd`, `@platejs/selection`, `@platejs/resizable`).
     Wiring it in as-is would mean either loosening the schema well past "table blocks" (out of
     this session's chosen scope) or shipping controls that visibly work in the editor and then
     silently vanish on save/reload — worse than not having them. `table-node.tsx` here is the
     same plain grid built in the previous entry (`<div><table><tbody>...`), just relocated;
     `table-toolbar-button.tsx` is the registry version with its Cell (merge/split) submenu
     removed accordingly — Row/Column insert/delete stayed, since those are plain structural
     transforms that don't need the resize/selection UI.
  3. `list-toolbar-button.tsx`'s registry version is a split-button with a style-variant dropdown
     (Circle/Square/LowerAlpha/UpperRoman/...); `storyContentSchema`'s list block only ever stores
     `"ordered" | "unordered"`, and the serializer's `isOrderedListStyle()` only recognizes
     `"decimal"` as ordered — every other variant silently collapses to a plain bullet on
     reload. Replaced with a plain two-button toggle (Bulleted/Numbered) calling the same
     `toggleList()` with exactly Disc/Decimal, so nothing offered in the UI produces a surprise
     after save.
  4. `TableCellHeaderPlugin` ("th") stays unregistered, same reasoning as before — nothing in the
     (trimmed) toolbar ever asks for a header row.
- One real, live-caught bug in this pass: the registry's `editor.tsx` `Editor` component's
  `variant="fullWidth"` (the closest named preset) carries `px-16`/`px-24`/`pb-72` — sized for a
  full-page document editor, not a compact bordered form field. Switched to `variant="none"` with
  this app's own compact padding/`min-h-40`, matching the box's actual size in the form.
  `EditorContainer`'s `h-full` base style was also left in (harmless: with no explicit parent
  height it resolves to `auto`, same as omitting it, confirmed by the rendered layout matching the
  old design).
- Existing test suites (`plate-serialize.test.ts`, `story-content-editor.test.tsx`) needed **no
  changes** — `storyEditorPlugins()`'s externally-observable contract (transform keys, node
  `type` strings, allowed/disallowed set) is unchanged; only what renders each node changed.
- `npm run verify` clean: lint (0 warnings after removing two now-unused imports), typecheck,
  265/265 tests, build. Live-verified in-browser: real Radix toolbar renders (icon buttons,
  grouped with separators, dropdown chevron on Table), Bold toggle produces a real `<strong>`,
  the Table dropdown's grid-size picker opens and renders (its hover-to-size interaction wasn't
  fully exercisable through this session's browser-automation tool — mouse `hover` didn't reliably
  trigger the picker's `onMouseMove` cascade through a nested Radix submenu — but the insert
  mechanism itself, `tf.insert.table()`, is the same one already end-to-end-verified with the
  plain "Table" button in the previous entry), and a full type → save → reload → preview-page
  round trip persisted and rendered correctly.

**2026-08-08 — Added inline image blocks to the story editor.**

User asked to "integrate picture uploading into the editor" using "the image uploader from
Platejs." Planned before implementing (per explicit request): a true Plate inline image node
(`{ type: "img", url }` embedded directly in `content_json`, uploaded through a new lightweight
endpoint) was refused — it has no natural place to enforce Rule 13 (private until approved), Rule
14 (server-side EXIF/GPS strip before publish), or `submit_revision_with_consent()`'s
rights-confirmation gate, all of which are load-bearing, existing, tested infrastructure. Built
instead: an inline image block that's a _reference_ to an already-uploaded, already
rights-confirmed `story_revision_media` row — uploads still go through the exact same route,
bucket, and approval pipeline as the gallery; only the reference is new.

- `lib/validation/story.ts`: `imageBlockSchema` (`{ type: "image", mediaId: uuid }` — no
  altText/caption, deliberately, since those already live on `story_revision_media` and
  duplicating them here would recreate the "duplicate captioned-image state"
  docs/architecture.md's superseded note warned against). New export
  `imageBlockMediaIds(blocks)`, used by every caller that needs to know which mediaIds are placed
  inline (the gallery panel, both public/preview pages' gallery-dedup).
- **The actual new security surface**: `save_revision_draft` (RPC, `supabase/migrations/
20260808130000_content_json_image_blocks.sql`, `CREATE OR REPLACE`) now rejects any `content_json`
  image block whose `mediaId` isn't attached to the _same_ revision's `story_revision_media` --
  without this, a contributor could reference another story's private image by guessing/copying its
  id (Rule 2: client-side Zod's `z.uuid()` check is shape-only, not ownership). Malformed
  (non-uuid) mediaIds are caught via `invalid_text_representation` exception handling rather than
  relying on SQL boolean short-circuit evaluation order, which Postgres doesn't guarantee. **Not
  verified against a live database** -- this machine has no Docker/Supabase CLI (same
  local-verification gap docs/architecture.md already documents); reviewed carefully against the
  existing `update_story_media_caption`/`set_story_cover_media` ownership-check style, but flagging
  this explicitly rather than claiming tested confidence it doesn't have.
- `lib/story/plate-serialize.ts`: `PlateImageNode` (a void node -- `children: [{ text: "" }]`,
  Slate's convention for "nothing editable inside this") ↔ canonical `image` block, both
  directions. Converter drops a structurally-wrong mediaId (non-string) rather than throwing, same
  posture as every other converter case; the real safety boundary is still
  `storyContentSchema.safeParse()` plus the new RPC check above.
- `components/story/editor/image-node.tsx` (new) / `image-toolbar-button.tsx` (new): the toolbar's
  "Image" button uploads through the literal same fetch call
  `components/story/image-upload-manager.tsx` already makes to
  `/stories/[id]/edit/upload` (same `expectedVersion`/`versionRef` bump), then
  `editor.tf.insertNodes({ type: "image", mediaId, children: [{ text: "" }] })` at the cursor.
  `ImageElement` resolves its own signed preview URL via the existing `mintPreviewUrlAction` (same
  120s-signed-URL private-bucket path the gallery thumbnails use) -- this editor only ever shows a
  draft, never approved/public media. `StoryContentEditor` gained an optional `imageUpload` prop
  (`storyId`/`revisionId`/`versionRef`/`onVersionBumped`); the Image button only renders when it's
  passed, but `ImagePlugin` is always registered so existing image blocks still render read-only
  in any future caller without upload context.
- `components/story/content-block-renderer.tsx`: new `ContentBlockMediaMap` prop (`mediaId → {url,
altText, decorative}`) and an `"image"` case -- resolution is the caller's job since the answer
  depends on context (signed private URL for a draft, plain public URL for a published story). A
  `mediaId` missing from the map (e.g. detached after the content_json referencing it was saved)
  renders nothing, never a broken-image icon, matching this component's existing "never throw on
  bad data" posture.
- **Gallery de-duplication, both reading surfaces**: an image placed inline no longer also appears
  in the trailing gallery -- `app/(public)/stories/[id]/page.tsx` and
  `app/(contributor)/stories/[id]/preview/page.tsx` both filter their gallery's media list against
  `imageBlockMediaIds(parsedContent.data)` before handing it to `StoryGallery`/`PreviewGallery`.
  New `components/story/preview-content-body.tsx` (client component) mints signed URLs for the
  preview page's inline images the same way `preview-gallery.tsx` already did for gallery
  thumbnails -- content_json's image blocks only carry a mediaId, never a URL, even in a draft.
  `story-gallery.tsx`'s header comment (which flatly said inline images didn't exist) is updated.
- **Contributor editing panel** (`image-upload-manager.tsx`): images referenced inline are excluded
  from the panel entirely (not shown-but-undeletable) -- removing an image from the story _text_ is
  what returns it to this panel, so there's no separate "can't remove, it's used in your text"
  error state to build. This meant `reorder()` could no longer take raw array indices (Move
  up/down previously spliced a contiguous range; with inline-placed images interleaved and hidden,
  that would reorder across positions the panel doesn't show) -- changed to swap two specific
  mediaIds' positions instead, driven by each visible item's nearest _visible_ neighbor.
- New tests: `plate-serialize.test.ts` (image node round-trip, drops a structurally-bad mediaId),
  `story-content-editor.test.tsx` (`editor.tf.insertNodes` for an image produces exactly `{type,
mediaId}`, nothing else), `content-block-renderer.test.tsx` (resolves via the media map,
  decorative→empty-alt, unresolvable→renders nothing), plus three new/updated cases in
  `lib/validation/story.test.ts` replacing the now-superseded "rejects an image block" test from
  the previous entry (images are allowed now, deliberately, with a narrower shape than "anything
  goes"). `story-content-editor.test.tsx` also needed a `vi.mock()` for `mintPreviewUrlAction` --
  importing the real Server Action module (`"use server"`, itself importing
  `server-only`-guarded `lib/supabase/server`) into a component test broke under Vitest's plain
  module resolution, since only Next's real bundler rewrites that import boundary for client code;
  a real, caught-live packaging quirk, not a hypothetical one.
- `npm run verify` clean: lint, typecheck, 272/272 tests, build. Live-verified in-browser end to
  end: uploaded a real (canvas-generated) test image via the toolbar button, watched it render
  inline with the selected-ring styling; separately confirmed a 1×1-pixel test image legitimately
  failed sharp's processing (the upload route's own documented "still returns 200, records the
  failure to the DB" behavior) and rendered as "Image unavailable," not a crash. Confirmed the
  gallery panel correctly excludes both inline-placed images and shows the new
  count-aware notice; confirmed the preview page renders the successfully-processed image inline
  (via `PreviewContentBody`'s client-side signed-URL minting) and silently skips the failed one,
  with no separate gallery section rendered underneath since every attached image was inline.

**2026-08-08 — Toolbar alignment fix + underline/size/color/highlight/align/emoji.**

Two asks: (1) the toolbar's controls weren't packed left-to-right (`FixedToolbar`'s `justify-between`
was spreading multiple top-level `ToolbarGroup`s evenly across the full width, producing large
uneven gaps -- Plate's own registry pattern wraps every group in one shared `flex w-full` div so
`justify-between` never sees more than one child; fixed by matching that). (2) add Text Size,
Underline, Text Colour, Text Highlighter, Text Alignment, and Emoji -- explicitly "in a fresh
context," i.e. without re-litigating the closed-schema question again. None of the five conflict
with any Engineering Rule (unlike the inline-image request two entries up) -- they're pure text
formatting, so scoped and built directly rather than via another `AskUserQuestion`.

- New `lib/story/text-style-palette.ts`: bounded name↔value maps for fontSize (small/large/huge,
  "normal" = no mark at all)/color/highlight (8 named colors each, Notion's published palette
  values). Shared by the schema (enums against these names), the serializer (reverse-lookup: a raw
  hex/px leaf value outside the map has its mark dropped, same posture as an unsafe link href), and
  the toolbar buttons (which only ever call `addMark()` with a palette value -- no freeform color
  picker or numeric size input was built, unlike Plate's own registry versions of these buttons).
- `lib/validation/story.ts`: `markSchema` gained `"underline"` (a plain literal, same shape as
  bold/italic) and three value-carrying marks (`fontSize`/`color`/`highlight`, each enum-bound to
  the palette). `MAX_MARKS_PER_RUN` raised 3→7. `paragraph`/`heading`/`quote` blocks gained an
  optional `align` (`left`/`center`/`right`/`justify`; undefined means left, mirroring how
  `decorative` etc. default false when absent elsewhere in this schema) -- `list`/`table`/`image`
  blocks don't get one, matching Plate's own `TextAlignPlugin` target scope.
- `lib/story/plate-serialize.ts`: new `PlateText` leaf fields (`underline`, `fontSize`, `color`,
  `backgroundColor`) and `PlateElement.align`, converted both directions through the palette's
  reverse-lookup helpers.
- New packages: `@platejs/basic-styles` (FontColorPlugin/FontBackgroundColorPlugin/FontSizePlugin/
  TextAlignPlugin -- Underline itself was already available from the already-installed
  `@platejs/basic-nodes`). `TextAlignPlugin` is configured with `targetPlugins: ["p", "h2", "h3",
"blockquote"]`, deliberately including blockquote (the upstream registry default only targets
  paragraphs), since `quoteBlockSchema` also carries `align`.
- New `components/story/editor/`: `font-size-toolbar-button.tsx` (bounded 4-item dropdown, not
  Plate's freeform +/- pixel input), `color-toolbar-button.tsx` (one generic swatch-grid component
  parameterized by nodeType+palette, reused for both Text color and Highlight -- not Plate's
  registry version, a freeform hex picker with a persisted custom-color history), `align-toolbar-
button.tsx` (adapted from the registry, trimmed to left/center/right/justify, never "start"/
  "end"), `emoji-toolbar-button.tsx` (a curated 32-emoji grid inserting plain unicode text via
  `editor.tf.insertText()` -- not Plate's `@platejs/emoji` package, which is a searchable database
  with `:colon:` autocomplete; not installed, not needed for a fixed reaction set). Underline
  reuses the existing `MarkToolbarButton` (nodeType="underline"), same as Bold/Italic.
- `components/story/content-block-renderer.tsx`: `applyMark()` gained cases for underline (`<u>`)
  and the three value-carrying marks (inline `style` from the palette maps -- a React style object,
  not a parsed string, so this isn't an HTML-injection path the way `dangerouslySetInnerHTML` would
  be). Paragraph/heading/quote gained `style={{ textAlign: block.align }}` when `align` is set.
- Existing tests updated, not just added to: two tests in `story-content-editor.test.tsx` that
  previously asserted underline was structurally absent (written two entries ago, before this ask)
  now assert the opposite and were renamed/narrowed to just strike/code/hr.
- New tests: value/enum acceptance and out-of-palette rejection in `story.test.ts`; leaf↔mark
  round-trip and out-of-palette-drop in `plate-serialize.test.ts`; real-editor-transform tests
  (`editor.tf.underline.toggle()`, `.fontSize/.color/.backgroundColor.addMark()`,
  `.textAlign.setNodes()` -- the exact commands each toolbar button calls) in
  `story-content-editor.test.tsx`; rendered-output tests (real `<u>`/`<mark>` tags, resolved inline
  styles, no `style` attribute at all for default-left) in `content-block-renderer.test.tsx`.
- `npm run verify` clean: lint, typecheck, 283/283 tests, build. Live-verified in-browser: toolbar
  renders as one packed left-to-right row (Undo/Redo | B/I/U | size/color/highlight | H2/H3/Quote |
  lists/align | link/table/image/emoji); underline, text color (swatch grid, "Clear" option),
  highlight, and huge font size all applied correctly and simultaneously to real selected/typed
  text (confirmed via the live DOM: real `style="color:...; background-color:...; font-size:28px"`
  values matching the palette exactly); center alignment applied to a real paragraph; emoji
  inserted as plain unicode text. Full save → reload → preview-page round trip confirmed every one
  of these renders correctly through the independent `ContentBlockRenderer` path, not just in the
  live editor.

**2026-08-08 — Fixed two real bugs in the previous entry's work: illegible highlighted text, and
an invisible bullet marker.**

Both reported by the user testing the previous entry's build; both were real, not hypothetical.

- **Highlighted text unreadable**: `applyMark()`'s `"highlight"` case set `color: "inherit"`,
  meaning highlighted text picked up the surrounding page's own text color -- near-white in dark
  mode, on top of a pale-yellow (etc.) background. Fixed to a fixed `HIGHLIGHT_TEXT_COLOR` (now
  `TEXT_COLORS.gray`, an existing palette entry, not a new value) that stays legible against every
  highlight color regardless of the page's theme.
- The editor had the identical bug, but the initial fix attempt for it (`FontBackgroundColorPlugin
.withComponent(HighlightLeaf)`, a custom leaf meant to force the same fixed text color) turned out
  to have **no effect at all** -- confirmed by inspecting the actual rendered DOM, which showed
  plain default-rendered spans, not the custom component's `<mark>`. Root cause: FontColorPlugin/
  FontBackgroundColorPlugin are "nodeProps injectors" (`@platejs/basic-styles`) -- they decorate
  whatever the leaf's _default_ render produces with extra inline style; they don't route through a
  per-plugin component the way Bold/Italic/Underline/Link do, so overriding one via
  `.withComponent()` silently does nothing. `highlight-leaf.tsx` was deleted. Fixed instead in
  `color-toolbar-button.tsx`'s (now-exported) `setColorMark()`: setting a highlight now also pairs
  a `color` mark (the same gray) unless the run already has an independently-chosen color, and
  clearing a highlight clears that paired color back out -- but only if it still equals what the
  pairing itself set, so a color the contributor picked on purpose is never silently discarded.
  Editor and published output now use the exact same fixed color.
- **Bullet marker invisible/clipped**: `paragraph-node.tsx`'s list-item branch had `px-0` (zero
  horizontal padding). `list-style-position` defaults to "outside", which renders the marker to the
  _left_ of the padding box -- with none, the bullet rendered flush against (or past) the editor's
  own left edge. Fixed with `pl-6` for list items specifically (ordinary non-list paragraphs keep
  `px-0`, matching `content-block-renderer.tsx`'s public-page list rendering, which already had
  `pl-6` and was unaffected).
- New/updated tests: `content-block-renderer.test.tsx`'s highlight-color assertion updated from the
  old broken value to the new fixed gray; two new `story-content-editor.test.tsx` tests exercising
  `setColorMark()` directly against a real (headless) editor -- pairing on set, clearing on clear,
  and leaving an independently-chosen color alone.
- `npm run verify` clean: lint, typecheck, 285/285 tests, build. Live-verified in-browser after a
  full dev-server restart (this session hit the same Fast-Refresh staleness as the previous entry
  when adding new plugin-registration files -- restarting, not just reloading, is what actually
  picks the change up): bulleted list marker now renders with visible left padding; highlighted
  text confirmed legible via the live DOM (`color: rgb(120,119,116)` paired with the chosen
  highlight's background); reloaded and re-checked on the preview page through the independent
  `ContentBlockRenderer` path, same result.

**2026-08-11 — Rebuilt the story editor as a Bear.app-style Markdown editor, replacing Plate.**

User asked for the "New Story" editor to feel like Bear.app: a clean, distraction-free surface
where you type plain Markdown (`# `, `**bold**`, `- item`) and it renders styled live as you
type, with no floating toolbar chrome. Bear itself is closed-source native Swift, so this
replicates the experience, not the app. Scoped via `AskUserQuestion`/plan mode to a full
replacement of the Plate rich-text editor (not a side-by-side mode), content stored as sanitized
Markdown text rather than the old block/run/mark JSON, and full live-decoration editing (not a
plain textarea + preview pane).

- **Editing surface**: `@uiw/react-codemirror` + `@codemirror/lang-markdown`, with a custom
  `ViewPlugin` (`components/story/editor/markdown-live-decorations.ts`) that dims Markdown
  delimiters (`**`, `#`, `>`, list markers) to low opacity everywhere except the line the
  cursor/selection currently touches, and styles the content between them (bold/italic/heading
  size/strikethrough/inline code/quote/list) regardless of cursor position — the same
  dim-unless-active-line technique Obsidian/Typora use, safer than replacing text with real DOM
  nodes mid-edit since the underlying document text is never rewritten, only overlaid with view
  decorations. `![[mediaId]]` embed tokens render as a small non-editable chip widget off the
  active line, and raw text on it. A small fixed toolbar (`components/story/editor/
markdown-editor.tsx`) inserts/toggles plain Markdown syntax at the cursor via CodeMirror
  transactions — Bold/Italic/Strikethrough/Heading/Quote/Bulleted+Numbered list/Checklist/Link/
  Table/Image upload — much simpler than Plate's toolbar since there's no document tree to keep
  in sync, just text.
- **Storage schema** (`lib/validation/story.ts`): `content_json` stays a jsonb array (Rule 6's
  "defined schema of blocks"), collapsing to exactly one block: `{type:"markdown", text}`.
  `storyContentBlockSchema`/`storyContentSchema` replaced entirely; new `storyContentText()`/
  `markdownToStoryContent()` helpers convert between the one-block array and the plain string
  every other module actually wants. Validation refinements on the text: length ≤ 50,000 chars
  (unchanged), every `[text](href)` link's href still checked via the existing `isSafeHref()`
  (extracted with a regex instead of walking marks), a leading `# ` (h1) is rejected (reserved
  for the story title — h2–h6 allowed, up from h2/h3 only), and standard `![alt](url)` image
  syntax is rejected outright.
- **Images stay reference-only**, exactly as before, via a deliberately non-standard
  `![[<mediaId>]]` embed token (`lib/story/markdown-media.ts`'s `extractMediaIds()`,
  `lib/story/remark-media-embed.ts`'s remark plugin) so a raw URL can never be typed into content
  — preserves the private-bucket/approval/EXIF-strip workflow (Rules 13/14) untouched.
  `save_revision_draft`'s server-side reference-integrity check (added in
  `20260808130000_content_json_image_blocks.sql`) was updated in
  `20260811090000_markdown_content_json.sql` to `regexp_matches()` the embed tokens out of
  `content_json[0].text` instead of walking jsonb "image" blocks — same guarantee (every embedded
  mediaId must be attached to this revision), new extraction mechanism.
- **Public/preview/moderation rendering** (`components/story/content-block-renderer.tsx`): now
  `react-markdown` + `remark-gfm` (tables, strikethrough, task lists) + the media-embed plugin,
  rendering an AST to React elements — never `dangerouslySetInnerHTML`, and raw HTML in the
  source is never passed through (no `rehype-raw`), so Rules 6/7 hold. Kept the same `blocks`/
  `media` prop shape as before (`ContentBlockRenderer({ blocks, media })`), so every consumer —
  public story page, moderation page, contributor preview, the editorial import-preview panel —
  needed zero changes.
- **`StoryContentEditor`** (`components/story/story-content-editor.tsx`) also kept its external
  contract (`initialContent`/`onChange: StoryContentBlock[]`, `replaceContent` ref handle) as a
  thin adapter over the new markdown-text-based `MarkdownEditor`, specifically so
  `story-edit-form.tsx`, `content-import-panel.tsx`, and `preview-content-body.tsx` needed no
  changes at all — a tighter blast radius than the original plan (which assumed a string-based
  prop change would ripple through those three files).
- **`lib/story/content-import.ts`** (HTML/plain-text editorial import) now builds a Markdown
  string instead of a block array — `sanitizeHtmlToBlocks`/`plainTextToBlocks` keep their names
  and `{ok, blocks, report}` return shape (still wrapping the result via
  `markdownToStoryContent()`), but internally walk the DOM emitting Markdown syntax with
  escaping of literal ``* _ [ ] ` ~`` in text, plus a leading-character escape so imported text
  starting with `#`/`-`/`>`/etc. can't be misread as a block marker. Tables/code blocks still
  collapse to a plain-text paragraph line (unchanged behavior); images are still never inlined
  from import.
- **`lib/story/content-quality-checks.ts`** heuristics reimplemented as regexes over the
  Markdown string (via `storyContentText()`) instead of walking blocks/marks — word count strips
  Markdown syntax down to roughly-readable text first; link counting matches `[text](url)`
  directly.
- **Dropped** (no Bear/Markdown equivalent, and Bear itself doesn't have them): underline, custom
  font size, font color, highlight color, and `lib/story/text-style-palette.ts` along with the
  `StoryMark`/`StoryTextRun`/`StoryTableRow` types. **Gained** (standard GFM, previously excluded
  only because Plate's closed plugin set didn't include them): strikethrough, checklists
  (`- [ ]`), fenced/inline code, h4–h6.
- **Deleted**: `lib/story/plate-serialize.ts` (+test), `lib/story/text-style-palette.ts`, the
  Plate-registry-adapted `components/story/editor/{paragraph,heading,blockquote,image,link,
table}-node.tsx`/`toolbar.tsx`/`fixed-toolbar.tsx`/`align`/`color`/`font-size`/`list`/`mark`/
  `link`/`history`/`image`/`table`-toolbar-button.tsx`/`emoji-toolbar-button.tsx`, and the whole
`components/ui/`shadcn-registry directory +`lib/utils.ts` (`cn()`) + `components.json`, once
  confirmed (by grep) they had zero consumers left outside the deleted Plate tree.
- **`package.json`**: removed `platejs`, `@platejs/{basic-nodes,basic-styles,floating,link,list,
table}`, `@radix-ui/react-{dropdown-menu,popover,separator,slot,toolbar,tooltip}`,
  `class-variance-authority`, `lucide-react`, `tailwind-merge`, `use-sync-external-store` (all
  confirmed unused outside the deleted editor tree). Added `@uiw/react-codemirror` +
  `@codemirror/{lang-markdown,language-data,view,state}` (the live-preview Markdown editing
  surface), `react-markdown` + `remark-gfm` (AST-based, non-`dangerouslySetInnerHTML` rendering),
  `unist-util-visit` (the media-embed remark plugin).
- New/updated tests: `lib/validation/story.test.ts` and `components/story/content-block-renderer
.test.tsx` rewritten for the Markdown schema/renderer; `lib/story/content-import.test.ts` and
  `lib/story/content-quality-checks.test.ts` adapted to assert on `storyContentText()` output;
  `components/story/editor/markdown-editor.test.ts` (new) headlessly drives the toolbar's
  transform functions (`wrapSelection`/`toggleLinePrefix`/`insertTable`/`insertMediaToken`)
  against a real `EditorView`, no React rendering — the same "closed-loop, no DOM" style the old
  Plate test used; `components/story/story-content-editor.test.tsx` rewritten as an RTL smoke
  test (initial content renders, toolbar present/hidden by `editable`, `replaceContent()` updates
  the doc and fires `onChange`). `lib/story/plate-serialize.test.ts` deleted with its module.
- Next: live-verify in-browser (typing each Markdown construct, image upload round-trip via the
  `![[mediaId]]` token, h1/raw-image-syntax rejection, mobile viewport) and run `npm run verify`.

**2026-08-12 — Inline, drag-resizable images in the story editor (Bear.app-style).**

User: images embedded via `![[mediaId]]` only showed as a static "🖼 Image" text chip while
editing — asked for them to render as the actual image, resizable by dragging like Bear.app.

- **Syntax extended**: `![[<mediaId>]]` or `![[<mediaId>|<width>]]` once resized
  (`lib/story/markdown-media.ts`) — `width` is the stored CSS-pixel display width, clamped to
  `MIN_EMBED_WIDTH..MAX_EMBED_WIDTH` (60–2000, matching `MAX_PROCESSED_DIMENSION`). New
  `extractMediaEmbeds()`/`clampEmbedWidth()`/updated `mediaEmbedToken(mediaId, width?)`.
  `lib/story/remark-media-embed.ts` carries the optional width through to a `data-width` hast
  attribute; `content-block-renderer.tsx`'s `MediaEmbed` applies it as an explicit
  `width`/`max-width:100%` style (falls back to the original fill-the-column behavior when
  absent) — same rendering path for the public page, moderation, and contributor preview, so a
  resized image looks identical in the editor and once published.
- **`save_revision_draft`** (new migration `20260812090000_media_embed_width.sql`) updated to
  tolerate the optional `|<width>` suffix in its `regexp_matches` image-reference-integrity check
  — same guarantee as before (every embedded mediaId must be attached to this revision), just a
  regex change so a resized image's content_json still gets checked at all.
- **Editor-side rendering** (`components/story/editor/markdown-live-decorations.ts`): images are
  now the one exception to "only reveal raw syntax on the active line" — Bear never shows raw
  image markup, cursor or not, so `MediaImageWidget` always renders as an actual `<img>` (or a
  "Loading image…"/"Image unavailable" status chip while resolving), never falls back to text.
  URLs are resolved via the existing `mintPreviewUrlAction` (confirmed via investigation:
  authorized generically by mediaId, not route-specific — works for both the self-service and
  editorial routes with no separate action needed), cached per editor instance so re-decorating
  on every keystroke doesn't re-mint. A drag handle (bottom-right corner, visible on hover) lets
  the user resize live; on release, it dispatches a document edit replacing the token with the
  new `|<width>` — the underlying Markdown text is the only source of truth, same as every other
  decoration in this file.
- Images are also now atomic for cursor/Backspace/Delete purposes (a small dedicated
  `EditorView.atomicRanges` extension, image-only — NOT reused for the other concealed markup,
  which must stay steppable) so deleting an embedded image is one keystroke, not dozens through
  invisible characters.
- **Real bug found and fixed during this work**: the image widget's `eq()` only compared
  `mediaId`/`width`/`tokenLength`, so once a URL resolved from "loading" to a real signed URL,
  CodeMirror considered the new widget instance equivalent to the old one and reused the stale
  "Loading image…" DOM node instead of calling `toDOM()` again — images never appeared despite
  the network request succeeding. Root cause: `eq()` was comparing the cache's _live_ current
  value against itself (both old and new widget share the same cache Map), which can never
  detect a state transition. Fixed by snapshotting `cache.get(mediaId)` once at construction time
  into a `cachedValue` field and comparing _that_ frozen snapshot in `eq()` instead.
- **Second bug found and fixed**: a top-level `import { mintPreviewUrlAction } from
".../media-actions"` in `markdown-live-decorations.ts` broke the entire test suite —
  `server-only` (pulled in transitively via the action's own module graph) throws unconditionally
  when evaluated outside Next's own bundler, which Vitest doesn't replicate. Fixed with a dynamic
  `import()` inside the cache's `request()` method instead of a static top-level import, deferring
  module evaluation until an image widget actually needs to resolve a URL — never triggered by
  the headless/text-only tests, since none of their fixtures contain image embeds.
- New tests: `lib/story/markdown-media.test.ts` (extraction/clamping/token round-trip),
  `content-block-renderer.test.tsx` gained a stored-width rendering case.
- `npm run lint`/`typecheck`/`test` (273/273)/`build` all clean. Live-verified in-browser: three
  uploaded images render inline immediately (not chips); dragging the resize handle on one
  visibly shrinks it in real time; after save, the Preview page shows that image at the smaller
  stored width while the other two still fill the column, confirming the width round-trips
  through save → parse → render correctly. Hit and worked around the same Turbopack
  stale-export HMR issue noted in earlier entries — a full dev-server restart (not just reload)
  was needed after renaming an export.
