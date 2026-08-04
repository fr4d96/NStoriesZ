# Implementation Status — WHV Compass NZ

Read this before starting any task — it reflects what actually exists, not what is planned in
CLAUDE.md or docs/. Update it as part of the Definition of Done for every task.

Last updated: 2026-08-05.

## Status legend

`not started` · `in progress` · `blocked` · `complete`

## Prompt checklist

| #   | Prompt                                                                                                                                                                    | Status                                                                                                                                                                                                  | Notes                                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | Repository inspection & documentation baseline                                                                                                                            | complete                                                                                                                                                                                                | CLAUDE.md and docs/ created against an empty repo.                                                                                                       |
| 1   | Application foundation (Next.js scaffold, Supabase client/proxy wiring, env validation, local DB workflow scaffolding, quality tooling, public shell + placeholder pages) | **Blocked — implementation complete, local Supabase runtime verification unavailable because no container runtime is installed.**                                                                       | Limitation accepted by user 2026-08-02. See "Prompt 1 detail" below for exactly what's verified vs. blocked.                                             |
| 2   | Authentication, profiles, roles, and contributor identities                                                                                                               | **complete — migrations applied and live-verified against a real linked Supabase project.**                                                                                                             | See "Prompt 2 detail" below for what was live-verified (including a real bug found and fixed), and the role/RLS matrix.                                  |
| 3   | Core story schema & RLS (stories/story_revisions, media, consent/rights, moderation, reporting)                                                                           | **complete — migrations applied and live-verified (23/23) against a real linked Supabase project, including 3 real bugs found and fixed.**                                                              | See "Prompt 3 detail" below.                                                                                                                             |
| 4   | Editor/self-service authoring UI, image upload, storage buckets, contributor approval flow                                                                                | **complete — all 5 sub-phases done: all 8 migrations pushed and live-verified (`test:rls` 33/33); the cross-contributor UI-level access spec found and fixed a real per-row `notFound()`-as-200 leak.** | Built on `prompt-4-authoring-images`; PR #5 (Sub-phases 1–4) already merged to `main`, Sub-phase 5 lands as a follow-up PR. See "Prompt 4 detail" below. |
| 5   | Public discovery (browse/filter/detail, SEO, sitemap/robots, cost-band UI)                                                                                                | not started                                                                                                                                                                                             | Roadmap corrected in Prompt 3 (previously numbered 5, content unchanged).                                                                                |
| 6   | Editorial and moderation workspace (queue UI, reports triage)                                                                                                             | not started                                                                                                                                                                                             | Roadmap corrected in Prompt 3 — was previously numbered 7; `/editorial` and `/moderation` get real UI here instead of a role-gated JSON stub.            |
| 7   | Operational launch tooling and Playwright coverage of critical flows                                                                                                      | not started                                                                                                                                                                                             | Renumbered from 8 — reporting itself is done (Prompt 3); contributor drafting/private preview folded into Prompt 4.                                      |

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

## Migration summary

All in `supabase/migrations/`, applied in filename order:

| File                                                              | Adds                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20260802085013_helpers.sql`                                      | `public.set_updated_at()` — shared `updated_at` maintenance trigger function.                                                                                                                                                                                                                                                                                                                |
| `20260802085014_user_roles.sql`                                   | `app_role` enum; `user_roles` table + RLS; `public.has_role()` (SECURITY DEFINER, used inside other tables' RLS); `public.admin_set_user_role()` (SECURITY DEFINER, the only post-creation role-change path).                                                                                                                                                                                |
| `20260802085015_profiles.sql`                                     | `profiles` table + RLS (owner read/write; public read only when opted in with a slug).                                                                                                                                                                                                                                                                                                       |
| `20260802085016_contributors.sql`                                 | `attribution_type`, `contributor_status` enums; `contributors` table + RLS + `contributors_protect_privileged_fields()` trigger (blocks non-staff changes to `linked_user_id`/`created_by`/archiving).                                                                                                                                                                                       |
| `20260802085017_contributor_links.sql`                            | `contributor_links` audit table (no direct-write RLS policy at all); `public.link_contributor_to_user()` (SECURITY DEFINER, editor/admin-only, the sole write path).                                                                                                                                                                                                                         |
| `20260802085018_handle_new_user.sql`                              | `handle_new_user()` trigger on `auth.users` — creates the default `profiles` + `user_roles('user')` row for every new account, idempotently.                                                                                                                                                                                                                                                 |
| `20260802093000_fix_contributors_unlink_on_delete.sql`            | Fixes a bug found during live verification (see "Prompt 2 detail" above): `contributors_protect_privileged_fields()` now only blocks non-staff _assignment_ of `linked_user_id`, not clearing it to `null` — otherwise the `ON DELETE SET NULL` FK action itself got blocked, breaking user deletion for anyone with a linked contributor record.                                            |
| `20260803090000_lookup_tables.sql`                                | `regions`, `destinations`, `work_types`, `tags` + plain RLS (active-only public read, admin write).                                                                                                                                                                                                                                                                                          |
| `20260803090100_stories.sql`                                      | `story_source_kind`/`story_visibility`/`story_lifecycle_status` enums; `stories` table, RLS enabled with zero policies, no direct grants.                                                                                                                                                                                                                                                    |
| `20260803090200_story_revisions.sql`                              | `story_revision_status` enum; `story_revisions` table + content-immutability trigger; `story_revision_editor_notes` (staff-only); `stories_validate_revision_pointers()` trigger.                                                                                                                                                                                                            |
| `20260803090250_story_internal_helpers.sql`                       | `_is_story_owner()`, `_revision_is_editable()` — no API grants.                                                                                                                                                                                                                                                                                                                              |
| `20260803090300_story_revision_relations.sql`                     | `story_revision_locations` (+ region/destination integrity trigger), `story_revision_work_types`, `story_revision_tags`; shared `_protect_revision_child_immutability()` trigger.                                                                                                                                                                                                            |
| `20260803090400_story_media.sql`                                  | `story_media`, `story_revision_media` (+ one-cover/alt-text/sort-order/processed-derivative constraints, cross-story-attachment trigger); `_require_processed_media()`.                                                                                                                                                                                                                      |
| `20260803090500_story_publication_consents.sql`                   | `identifiable_people_state` enum; append-only `story_publication_consents` (+ `unique(revision_id)`, `unique(story_id, event_number)`); `story_publication_consent_notes`; `_latest_valid_consent_for_revision()`.                                                                                                                                                                           |
| `20260803090600_moderation.sql`                                   | `moderation_actions` + `moderation_action_notes`, `story_reports`, `editorial_actions` — all append-only / no direct grants.                                                                                                                                                                                                                                                                 |
| `20260803090700_story_lifecycle_functions.sql`                    | The full authoring/submission/moderation/consent/media/report RPC surface (~35 functions) — see docs/architecture.md "Story domain" for the complete list.                                                                                                                                                                                                                                   |
| `20260803090800_story_public_reads.sql`                           | `get_published_story`, `list_published_stories`, `get_published_story_media` — the only three functions granted to `anon`.                                                                                                                                                                                                                                                                   |
| `20260803090900_lock_down_story_domain_grants.sql`                | Bug fix: explicit `revoke all ... from public, anon, authenticated` on every story-domain table — Supabase grants broad table privileges by default independent of RLS, so "RLS enabled, no policies" alone denied rows but not the query itself.                                                                                                                                            |
| `20260803091000_fix_returns_table_column_ambiguity.sql`           | Bug fix: qualifies bare column references in `get_published_story`/`list_published_stories`/`get_story_for_moderator` that collided with their own `RETURNS TABLE` output-column names.                                                                                                                                                                                                      |
| `20260803091100_fix_nullable_actor_boolean_logic.sql`             | Bug fix: wraps every `nullable_column = auth.uid()` ownership/role comparison in `coalesce(..., false)` across 9 functions — see "Prompt 3 detail" above.                                                                                                                                                                                                                                    |
| `20260803091200_fix_publish_sets_visibility.sql`                  | Bug fix: `moderate_revision()`'s approve path now also sets `stories.visibility = 'public'`, not just `lifecycle_status`.                                                                                                                                                                                                                                                                    |
| `20260804090000` – `20260804090800` (9 files)                     | Prompt 4 Sub-phase 2 — storage buckets, media processing-state machine, upload reservation, publication-attempt system. See "Prompt 4 detail" above and `docs/architecture.md`. **Applied and live-verified.**                                                                                                                                                                               |
| `20260804091000_get_revision_selections.sql`                      | Prompt 4 Sub-phase 3 — `get_revision_selections()`, the missing reader for `story_revision_locations`/`story_revision_work_types`/`story_revision_tags`, symmetric with the existing writer RPCs. Applied via `supabase db push` with explicit go-ahead; confirmed in sync via `supabase migration list`.                                                                                    |
| `20260804092000_assigned_editor_can_read_draft.sql`               | Prompt 4 Sub-phase 4 — bug fix: `get_my_story_with_draft()` now also authorizes the story's assigned editor, not just `_is_story_owner()`. **Applied.** (Introduced an ambiguous-column bug, fixed by `20260804092500` below.)                                                                                                                                                               |
| `20260804092100_submit_consent_requires_terms_version.sql`        | Prompt 4 Sub-phase 4 — `DROP`+`CREATE` of `submit_revision_with_consent()`: new required `p_expected_terms_version` (raises `WHV01` on mismatch); new `current_terms_version()`/`get_consent_terms_version()` readers; source-kind-partitions the `confirmation_method = 'account'` check; fixes the awaiting-approval submission dead-end. **Applied.**                                     |
| `20260804092200_source_kind_partitioned_authorization.sql`        | Prompt 4 Sub-phase 4 — bug fix: `_is_story_owner()`, `list_my_stories()`, `get_story_preview()`, `_can_write_reserved_media_path()` all source-kind-partitioned (self_submitted checks `owner_user_id` only; editorial_import checks the live `linked_user_id` only — never an OR across both). **Applied.**                                                                                 |
| `20260804092300_save_revision_draft_returns_version.sql`          | Prompt 4 Sub-phase 4 — `DROP`+`CREATE` of `save_revision_draft()`: now returns the authoritative new `story.version` instead of `void`. **Applied.** (The `DROP`+`CREATE` accidentally dropped a `coalesce(...,false)` ownership-check wrapper — a real, live-confirmed security regression, fixed by `20260804092600` below.)                                                               |
| `20260804092400_restrict_contributor_linking_to_named_rpcs.sql`   | Prompt 4 Sub-phase 4 — `contributor_links` gains `event_type`; new private `_set_contributor_linked_user()` helper + a transaction-local GUC the `contributors_protect_privileged_fields()` trigger now requires for every `linked_user_id` transition (except the literal `ON DELETE SET NULL` cascade); new `unlink_contributor_from_user()` RPC, editor/admin-only, audited. **Applied.** |
| `20260804092500_fix_get_my_story_with_draft_ambiguous_column.sql` | Prompt 4 Sub-phase 4 corrective — bug fix, found via live `test:rls` after the initial push: qualifies the bare `assigned_editor_id` reference `20260804092000` added, ambiguous against `get_my_story_with_draft()`'s own `RETURNS TABLE` output column of the same name (Postgres `42702`, live-confirmed). Same fix pattern as `20260803091000`. **Applied.**                             |
| `20260804092600_fix_save_revision_draft_nullable_actor_bug.sql`   | Prompt 4 Sub-phase 4 corrective — **security bug fix**, found via live `test:rls` after the initial push: restores the `coalesce(...,false)` wrapper around `save_revision_draft()`'s ownership check that `20260804092300`'s `DROP`+`CREATE` had silently dropped, closing a live-confirmed hole that let any authenticated user overwrite any self-service story's draft. **Applied.**     |
| `20260804092700_fix_submit_consent_offline_actor_bug.sql`         | Prompt 4 Sub-phase 4 corrective — hardening (not live-exploited): wraps `submit_revision_with_consent()`'s offline-confirmation `assigned_editor_id = auth.uid()` check in the same `coalesce(...,false)` pattern, found via proactive re-audit after the two bugs above. **Applied.**                                                                                                       |

## Role and RLS matrix

`app_role`: `user` (default) · `editor` · `moderator` · `admin`. Assigned via `user_roles`, structurally
unwritable by ordinary clients (see docs/architecture.md).

| Table               | Anonymous                                                 | Owner (self)                                                                    | Other authenticated user | Editor                                                                                                                              | Moderator                                                                 | Admin                                                                          |
| ------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `profiles`          | Read only if `public_profile_enabled AND public_slug` set | Read/update own row (no INSERT/DELETE for anyone)                               | Same as anonymous        | Same as anonymous                                                                                                                   | Same as anonymous                                                         | Same as anonymous                                                              |
| `user_roles`        | None                                                      | Read own role only                                                              | None                     | Read own role only                                                                                                                  | Read own role only                                                        | Read own + all others; only writer of role changes (via `admin_set_user_role`) |
| `contributors`      | Read only `public_status = 'public'` rows                 | Read/update own linked row; cannot change `linked_user_id`/`created_by`/archive | Same as anonymous        | Read all rows; create unlinked rows; update any row (still can't self-archive via the non-staff path — they ARE staff, so they can) | Read all rows (see architecture.md's noted row-vs-column-level trade-off) | Read/update/delete all rows; create unlinked rows                              |
| `contributor_links` | None                                                      | Read own link history                                                           | None                     | Read all link history; the only role (with admin) that can write, and only through `link_contributor_to_user()`                     | None                                                                      | Read all link history; can write via the same function                         |

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
- **Moderator visibility into `contributors` is row-level, not column-level** (see
  docs/architecture.md "Known trade-off"). Moderators can currently read the full row, including
  `linked_user_id`/`created_by`, rather than a restricted field set — acceptable today because no
  moderation UI queries this table yet (Prompt 6, per the roadmap correction below), but must be
  tightened (view or scoped query) when that UI is built.
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
- **Cost-band bucket thresholds are not decided.** `total_expense_nzd_cents` is stored and returned
  exactly as reported; `list_published_stories()` has no `p_cost_band` filter parameter in this
  phase — deliberately deferred to Prompt 5 rather than inventing thresholds while writing migrations.
- **A handful of disposable `regions`/`destinations` rows accumulate** in the linked dev project from
  the RLS suite's destination-integrity test (`rls-test-` prefixed) — not covered by
  `scripts/rls-test-cleanup.sql`, which only scopes to story-domain tables. Trivial, accepted cost;
  revisit if it ever becomes noisy enough to matter (unlikely at test-suite run frequency).

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
- `docs/design-brief.md` (untracked, Prompt 5 UI-planning material, unrelated to authoring/images)
  remains in the working tree, content untouched — only its Prettier formatting was fixed so it
  stops blocking a clean `npm run verify` for whoever picks up Prompt 5.

**Next up: Prompt 5 (public discovery — browse/filter/detail pages, SEO, sitemap, cost-band UI) and
Prompt 6 (editorial/moderation workspace — queue UI, reports triage).** Both are unblocked now that
Prompt 4 is fully done.
