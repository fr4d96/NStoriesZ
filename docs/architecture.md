# Architecture — Journiq

Prompts 1–3 (application foundation; authentication/profiles/roles/contributor identity; core story
schema, lifecycle, and RLS) are implemented — see
[docs/implementation-status.md](implementation-status.md) for exactly what's built versus planned.
Sections below describe what actually exists today; deferred/target pieces are marked as such.

## Application structure

Next.js 16 App Router, Turbopack, Server Components by default, strict TypeScript, no `src/`
directory, `@/*` import alias. Actual current tree:

```
app/
  layout.tsx                  # bare shell: <html>/<body>, skip link, sitewide metadata. No
                               # header/footer/session check — stays static/cache-friendly.
  loading.tsx / not-found.tsx / error.tsx / global-error.tsx
  (public)/                   # anonymous-readable, static header+footer in its own layout
    layout.tsx
    page.tsx                  # home
    stories/, contributors/, about/,
    privacy/, terms/, community-guidelines/, copyright/   # placeholders
  (auth)/
    layout.tsx                # reuses the same static header/footer
    actions.ts                # 'use server' — sign-up/in/out, forgot/reset password
    sign-in/, sign-up/, forgot-password/, reset-password/   # page.tsx + client form component each
  auth/callback/route.ts       # NOT in the (auth) group — real URL /auth/callback. Handles both
                                # the `code` (PKCE) and `token_hash`+`type` (email link) shapes.
  (contributor)/
    layout.tsx                 # the ONLY place that resolves the session (getCurrentUser());
                                # redirects to /sign-in or renders its own contributor nav
    actions.ts                 # 'use server' — profile update, contributor identity create/update
    my-stories/                 # real: list from list_my_stories(), status badges, Edit/Preview links
    stories/new/                 # real: title-only form -> create_self_service_draft -> redirect
    stories/[id]/
      edit/page.tsx, actions.ts   # authoring form (Server Actions) + mutation-queue-driven client form
      edit/upload/route.ts        # Node-runtime Route Handler — see "Upload reservation flow"
      preview/page.tsx             # force-dynamic, no-store, noindex — get_story_preview() only
      media-actions.ts             # shared signed-URL minting, used by edit + preview
    account/                    # real: profile form, contributor-identity form, sign-out
  (editor)/editorial/           # real UI as of Prompt 4 Sub-phase 4 — layout.tsx does the role
                                 # check (notFound()), proxy.ts's middleware is the real 404
                                 # guarantee (see "Staff routes" below); dashboard, new/, contributors/,
                                 # [id]/edit/, import-actions.ts
  (moderation)/moderation/route.ts  # still a Route Handler stub — see "Staff routes" below
  (admin)/admin/route.ts            # still a Route Handler stub
lib/
  env.server.ts               # server-only, Zod-validated Supabase env vars
  supabase/
    client.ts                 # browser client (createBrowserClient), typed with Database
    server.ts                 # server client (createServerClient, next/headers cookies), typed
  auth/
    get-current-user.ts       # server-only, cache()-wrapped getClaims() wrapper
    contributor-guard.ts      # pure redirect-decision function, unit-tested directly
    roles.ts                  # server-only, cache()-wrapped "read my own role" query
    staff-guard.ts            # pure resolveStaffAccess() decision function, unit-tested directly
                                # (split out of roles.ts so the test file never imports
                                # "server-only" — see roles.ts vs staff-guard.ts below)
  validation/
    auth.ts                   # Zod: sign-up/in, forgot/reset password
    profile.ts                # Zod: profile update, own-contributor create/update
    safe-redirect.ts           # resolveSafeReturnTo() — the one function every "next" param
                                # (sign-in redirect, auth callback) is required to pass through
    story.ts                   # Zod: text-only content blocks, revision input, consent input,
                                # report input — mirrors the DB constraints, not a substitute for them
  story/
    public-queries.ts          # anon-safe RPC wrappers (get_published_story, list_published_stories, ...)
    contributor-queries.ts     # caller-derived (session, never a userId param) owner-facing reads
    mutations.ts                # thin wrappers over every author/submit/consent/media RPC
    moderation.ts               # staff-facing reads + moderate/report RPC wrappers
    image-validation.ts, image-pipeline.ts  # magic-byte sniffing + the sharp-based pipeline (Sub-phase 2)
    active-lookups.ts           # active-only regions/destinations/tags (Sub-phase 3;
                                #   work_types reader removed 2026-08-16, see "Taxonomy" below)
    rich-text-serialize.ts      # pure Tiptap JSON <-> canonical block/run/mark schema converters
    mutation-queue.ts           # client-side serialized, per-slot-coalescing async mutation queue
components/
  site-header.tsx, site-footer.tsx, mobile-nav-toggle.tsx, contributor-nav.tsx,
  placeholder-page.tsx
  story/
    rich-text-editor.tsx        # Tiptap, constrained to exactly the canonical schema's node/mark set
    content-block-renderer.tsx  # renders the canonical schema as JSX, never dangerouslySetInnerHTML
    image-upload-manager.tsx    # client-side pre-checks + reorder/cover/detach/caption UI
    preview-gallery.tsx         # signed-URL image gallery for the preview page
    story-edit-form.tsx         # the authoring form, owns the shared MutationQueue + version ref
proxy.ts                       # session-cookie refresh AND the redirect-to-sign-in-with-next
                                # decision for signed-out requests; matcher covers /my-stories,
                                # /stories/new, /account, and /stories/:id/(edit|preview)
supabase/
  config.toml, migrations/ (profiles/user_roles/contributors/contributor_links from Prompt 2; the
  full story domain — stories, story_revisions, relations, media, consent, moderation, all
  SECURITY DEFINER functions, public reads — from Prompt 3, see "Story domain" below),
  seed.sql (fictional local-only seed data, including story-domain fixtures — Docker-unverified,
  same limitation as every prior prompt)
types/
  database.ts                  # GENERATED (npm run supabase:types:linked) against the real linked
                                # project — regenerate after every new migration, do not hand-edit
tests/integration/
  story-rls.integration.test.ts   # real Auth/PostgREST calls against the linked hosted dev project,
                                    # run via `npm run test:rls` — see "RLS integration test setup"
scripts/
  rls-test-cleanup.sql, run-rls-cleanup.mjs   # scoped, fail-closed dev-only cleanup for the above
e2e/
  home.spec.ts                 # Playwright smoke test (public nav, staff-route 404s)
  auth.spec.ts                 # sign-up/in/forgot/reset pages render; protected-route redirect
                                # with safe next param; invalid callback link handling
```

`stories/[id]` (public detail — folder named `[id]` to match the sibling `(contributor)/stories/[id]/`
route group), `contributors`/`contributors/[slug]`, `sitemap.ts`/`robots.ts` are real, live as of
Prompt 5 — see "Public discovery and SEO (Prompt 5)" below. Still deferred: any moderation/admin UI
at all (Prompt 4 builds the publication _backend_ only for those roles — see "Media processing and
publication pipeline (Prompt 4)" below — Prompt 6 owns the moderation workspace that will call it).
Self-service authoring (`/stories/new`, `/my-stories`, `/stories/:id/edit`, `/stories/:id/preview`)
and editorial import/consent-approval (`/editorial/*`) are real UI as of Prompt 4 Sub-phases 3–4
respectively — see "Self-service authoring UI" and "Editorial import + consent/approval UI" below.
`/readiness` (the content-readiness dashboard + operational metrics, editor/moderator/admin) is
real UI as of Prompt 7 — see "Content readiness, operational metrics, and launch tooling (Prompt 7)"
below. New Prompt 7 modules not shown in the tree above: `app/(readiness)/readiness/` (layout,
nav, page, actions, verify-form), `lib/story/readiness.ts`, `lib/validation/readiness.ts`,
`lib/story/content-quality-checks.ts`, `components/story/whats-public-summary.tsx`,
`components/sticky-visible.tsx`, `e2e/founding-story-workflow.spec.ts`.

## Authentication boundaries

- Supabase Auth via `@supabase/ssr`, cookie-based sessions. **No client-stored JWT reliance.**
- **The public layout never checks the session.** `app/(contributor)/layout.tsx` calls
  `getCurrentUser()` (wraps `supabase.auth.getClaims()` in React's `cache()`); the three staff
  Route Handlers call `getCurrentUserRole()` (wraps a `user_roles` self-read in `cache()`, itself
  built on `getCurrentUser()`). This is deliberate: it keeps every public page static and
  cache-friendly, at the cost of the global header never reflecting sign-in state — a signed-in
  contributor visiting `/about` still sees "Sign in" in the static header. The `(contributor)`
  layout renders its own nav instead, so there's no contradiction shown to a signed-in user in the
  one place that matters.
- `proxy.ts` refreshes the auth cookie for exactly the contributor routes (`/my-stories/:path*`,
  `/stories/new`, `/account/:path*`) — it does not run on public routes at all, so public traffic
  never invokes Supabase. As of Prompt 2, it also does the redirect-to-sign-in decision for
  signed-out requests to those routes (it's the only place with the actual requested pathname, so
  it's what builds the `?next=` param); the `(contributor)` layout keeps its own `getCurrentUser()`
  check as a defense-in-depth backstop, per Engineering Rule 3.
- Two Supabase client factories exist: `lib/supabase/client.ts` (browser, publishable key) and
  `lib/supabase/server.ts` (server, cookie-bound, per the current official `getAll`/`setAll`
  pattern — `setAll` is wrapped in try/catch because Server Components can't set cookies; the proxy
  is what actually persists a refreshed cookie for GET navigations, and Server Actions/Route
  Handlers can set cookies directly). Both are now generic over `types/database.ts`'s `Database`
  type.
- **No admin/service-role client exists yet, still.** Every Prompt 2 mutation (profile update,
  contributor create/update, role changes, contributor linking) runs as the calling user through
  the regular server client — RLS plus the `SECURITY DEFINER` functions described below are
  sufficient; nothing yet needs to bypass RLS outright. It lands, alongside its secret-key env var,
  with the first operation that actually needs it (e.g. image-derivative promotion in a later
  prompt).
- Roles now exist as data (`user_roles`, enum `app_role`: `user` / `editor` / `moderator` / `admin`).
  `lib/auth/roles.ts` reads the caller's own role only (RLS-enforced); `lib/auth/staff-guard.ts`
  holds the pure `resolveStaffAccess()` decision, split into its own file specifically so it can be
  unit-tested without importing `"server-only"` (the same reason `contributor-guard.ts` is separate
  from `get-current-user.ts`).

## Staff routes (Editorial / Moderation / Admin) — role-gated, still fail closed

`/moderation` and `/admin` are still **Route Handlers** (`route.ts`), not pages, performing a real
role check (`getCurrentUserRole()` + `resolveStaffAccess()`) instead of an unconditional 404. The
reason they stay Route Handlers is unchanged from Prompt 1: a page component calling
`next/navigation`'s `notFound()` gets streamed, and if the route is prerendered (or even forced
dynamic) the initial shell can flush as HTTP 200 before the 404 is attached deeper in the render
tree — verified directly during Prompt 1's build (`curl` showed `200 OK` for a page-based
`notFound()` even under `export const dynamic = "force-dynamic"`). A Route Handler sets the status
directly, with no rendering pipeline in between, so it reliably returns 404. Their real UI is
Prompt 6+ (moderation) — no navigation anywhere links to `/moderation`/`/admin` yet.

`/editorial` gained its real UI in Prompt 4 Sub-phase 4 — the JSON-stub Route Handler was removed
and replaced with real pages under `app/(editor)/editorial/`. This reintroduced exactly the failure
mode above, confirmed live: `app/(editor)/editorial/layout.tsx`'s role check (a plain,
non-streaming Server Component with no `loading.tsx`/Suspense anywhere under it, `notFound()`
called synchronously at the top) still returned **HTTP 200** for a signed-out `curl -i` request,
with the real 404 only appearing deep in the streamed RSC payload
(`NEXT_HTTP_ERROR_FALLBACK;404`) — a non-streaming layout alone was not sufficient to avoid the
Prompt 1 failure mode, contrary to what might be assumed from the code alone. **Fixed by moving the
authorization gate into `proxy.ts` (middleware)**, which runs before any RSC streaming and can set
a real response status directly: `/editorial` and every sub-path (`/editorial/new`,
`/editorial/contributors`, `/editorial/:id/edit`, ...) now query the caller's own role
(`user_roles`, via the same RLS-scoped "read own role" policy every other role check uses) inside
the middleware itself and return the identical flat `{ error: "Not Found" }` / 404 JSON body the
`/moderation`/`/admin` Route Handlers already use, for both signed-out and
signed-in-with-the-wrong-role requests — verified via `curl -i` after the fix, and covered by
`e2e/home.spec.ts`'s pre-existing `"staff routes fail closed with a not-found response"` test
(which already asserted `/editorial` specifically, now genuinely exercising the real HTTP status).
The `layout.tsx` role check is kept as a defense-in-depth backstop, but the middleware check is
what actually provides the guarantee — the general lesson (a page-based `notFound()`, even
non-streaming, is not reliably a true HTTP 404 in this framework version; middleware is, since it
runs before any rendering) should be assumed for any future staff page-based route, not just this
one.

Anyone without the required role — including a perfectly valid session with the wrong role — gets
the identical flat 404 as a signed-out visitor; `resolveStaffAccess()`'s `{ ok: false }` case
deliberately carries no reason, so there is no behavioral difference to probe. `/editorial`'s real
UI is documented in "Editorial import + consent/approval UI (Prompt 4 Sub-phase 4)" below;
`/moderation`/`/admin`'s real UI remains Prompt 6+.

## Data-access conventions

- Every exposed table has RLS enabled — no exceptions (Engineering Rule 3, non-negotiable per
  rule 21). `profiles`, `user_roles`, `contributors`, and `contributor_links` all do as of Prompt 2.
- Server Actions re-validate ownership server-side even though RLS would also reject an unauthorized
  write — defense in depth per Engineering Rule 3. Concretely: every mutation in
  `app/(contributor)/actions.ts` derives the target row from `getCurrentUser()`'s server-known id via
  `.eq("id"/"linked_user_id", user.id)`, never from a client-supplied id field, and the RLS policy on
  the same table independently rejects any row that filter wouldn't already exclude.
- Client-supplied identifiers are only ever used to _look up_ a row; the authorization decision comes
  from the authenticated session + RLS + a server-side re-check. This is why `contributors.linked_user_id`
  can only be set at self-service insert time (`= auth.uid()`, enforced by RLS `WITH CHECK`) or via
  `public.link_contributor_to_user()` (a `SECURITY DEFINER` function that re-derives the caller's role
  server-side before writing) — never by a client passing an arbitrary `linked_user_id`/`contributor_id`
  pair.
- All mutations that matter go through Server Actions — never direct client-side writes to Supabase
  tables. (`lib/supabase/client.ts` exists for future interactive UI, e.g. realtime, but nothing
  currently writes through it.)

## RLS strategy — Prompt 2 (auth/profiles/roles/contributors)

Implemented in `supabase/migrations/`, in this order (each migration's RLS lives alongside the table
it protects, not in a separate file):

1. `20260802085013_helpers.sql` — generic `set_updated_at()` trigger function, reused by every table
   below.
2. `20260802085014_user_roles.sql` — `app_role` enum, `user_roles` table, and two
   `SECURITY DEFINER` functions with an explicit `search_path`:
   - `has_role(user_id, role)` — read-only, used _inside_ RLS policies on other tables. Existing as
     a separate `SECURITY DEFINER` function (rather than an RLS policy that queries `user_roles`
     directly) is what avoids infinite RLS recursion on `user_roles` itself.
   - `admin_set_user_role(target_user_id, role)` — the only way to change a role after account
     creation. Re-derives the caller's own role from the database before writing (never trusts a
     client claim), and refuses to let an admin demote themselves through this path.
     `user_roles` itself has **no INSERT/UPDATE/DELETE RLS policy for `authenticated` at all** — the
     only writers are `handle_new_user()` (below) and `admin_set_user_role()`, both `SECURITY DEFINER`.
     This is what makes "a user cannot assign themselves a protected role" structural, not just an
     application-level check.
3. `20260802085015_profiles.sql` — `profiles` table. SELECT: owner, or anyone when
   `public_profile_enabled = true AND public_slug IS NOT NULL`. UPDATE: owner only, `WITH CHECK
(auth.uid() = id)`. No INSERT policy (only `handle_new_user()` creates rows) and no DELETE policy
   (lifecycle follows `auth.users` via `ON DELETE CASCADE`).
4. `20260802085016_contributors.sql` — `attribution_type` and `contributor_status` enums,
   `contributors` table. SELECT: `public_status = 'public'`, or the linked owner, or any of
   editor/moderator/admin (see the Prompt 2 risk note below about this being row-level, not yet
   column-limited, for moderators). INSERT: two policies — self-service
   (`linked_user_id = auth.uid() AND created_by = auth.uid()`) and staff-prepared
   (`linked_user_id IS NULL AND created_by = auth.uid() AND` editor-or-admin). UPDATE: owner or
   editor/admin, but a `BEFORE UPDATE` trigger (`contributors_protect_privileged_fields()`) blocks
   _any_ non-staff change to `linked_user_id` or `created_by`, and blocks escalating `public_status`
   to `archived` — RLS's `WITH CHECK` can't see the pre-update row, so this had to be a trigger, not
   a policy clause. DELETE: admin only (hard delete is an exception path; normal removal is
   archiving, which retains the record per docs/content-governance.md).
5. `20260802085017_contributor_links.sql` — append-only audit table, no INSERT/UPDATE/DELETE RLS
   policy at all. The only writer is `link_contributor_to_user(contributor_id, user_id, note)`
   (`SECURITY DEFINER`), which re-checks the caller is editor/admin, locks the target row
   (`FOR UPDATE`), and raises if it's already linked to someone else — this is what makes
   contributor-identity hijacking structurally impossible rather than an application-level promise.
6. `20260802085018_handle_new_user.sql` — `AFTER INSERT ON auth.users` trigger
   (`SECURITY DEFINER`, explicit `search_path`, `ON CONFLICT DO NOTHING` on both inserts) that
   creates the default `profiles` row and the default `'user'` `user_roles` row for every new
   account. Idempotent by design, so a retried/duplicated trigger invocation never errors.

See "Manual Supabase settings required" in
[docs/implementation-status.md](implementation-status.md) for the project-level auth settings these
migrations assume (email confirmation, password minimum length, redirect allow-list).

### Resolved trade-off (Prompt 2–5): moderator visibility into `contributors` was row-level, not column-level

The Prompt 2 brief asked that "moderators receive only the identity fields necessary for moderation."
Until Prompt 6 Stage 1, `contributors` RLS granted moderators full-row SELECT (same as editor/admin)
rather than a column-restricted view — deferred because Postgres RLS is row-level only (column-level
restriction needs either a dedicated view or per-app-role Postgres roles, more scope than a role model
with no moderation UI yet justified) and no moderation UI existed to need it.

**Resolved in Prompt 6 Stage 1**
(`supabase/migrations/20260805101000_narrow_moderator_contributor_access.sql`, live-verified): rather
than building the view/column-restriction machinery this section originally proposed, the simpler fix
was to remove moderator access to `contributors` entirely — `get_story_for_moderator()` (same stage)
sources attribution/display fields from the revision's own `story_publication_consents` snapshot
(`attribution_type`/`attribution_value`, captured at submission time), never a live `contributors`
join, so no moderator-reachable code path needs table access at all. Confirmed by grepping the whole
repo for `.from("contributors")` before removing the policy: the only remaining call sites are the
contributor's own self-service identity actions and the editor/admin editorial contributor list, both
already covered by separate, untouched policies.

## Story domain (Prompt 3) — schema, lifecycle, and access model

Implemented: `stories`, `story_revisions`, per-revision relations (locations/work types/tags), media,
publication consent, and moderation/reporting. **Storage buckets and the real image-processing
pipeline are Prompt 4** (see "Roadmap" below) — this phase only builds the schema-level guarantees
that make that safe to add later (`promote_story_media()` exists but is deliberately ungranted).

### Governing principle: no direct table access, for anyone

Every table in the story domain (`stories`, `story_revisions`, the three per-revision relation
tables, `story_media`/`story_revision_media`, `story_publication_consents` and its note table,
`moderation_actions`/`moderation_action_notes`, `story_reports`, `editorial_actions`) has RLS
**enabled with zero policies**, and every default PostgREST/Supabase table grant to `anon` and
`authenticated` is explicitly revoked (`20260803090900_lock_down_story_domain_grants.sql`) — this
second step turned out to matter: Supabase grants broad table privileges to `anon`/`authenticated`
by default on schema-`public` tables, independent of RLS, so "RLS enabled with no policies" alone
denies all _rows_ but does not by itself deny the _query_. With both in place, a direct
`supabase.from('stories').select()` is rejected at the grant level (`42501`), not merely
RLS-filtered to an empty result — confirmed directly by the integration suite.

Every read and every write — anonymous, owner, linked contributor, assigned editor, moderator,
admin — goes through a `SECURITY DEFINER` function that re-derives the caller's identity/role from
the database. Only `regions`/`destinations`/`work_types`/`tags` (no ownership, no lifecycle, no
sensitive columns) keep plain RLS with real grants (`active = true` readable by anyone; writes
admin-only).

### Taxonomy: tags only (2026-08-16)

`tags` is the platform's single story taxonomy. `work_types` was retired: every non-fixture row is
`active = false`, no UI reads the table, and no query the app sends passes `p_work_type_id`. Nothing
was dropped — the table, `story_revision_work_types`, `set_revision_work_types()`, and every
`p_work_type_id` parameter remain, because published revisions still carry work-type rows and the
live RLS suite still exercises that RPC. The useful work concepts (Horticulture, Viticulture,
Construction, Tourism, Retail, Farm work, ...) are now ordinary tags.

A contributor may add as many tags as they like, including labels of their own, up to 20 per
revision. `set_revision_tags()` is the enforcing boundary: it deduplicates case-insensitively, folds
a typed label that names an existing `tags` row into a reference to that row (so contributors never
need write access to the admin-managed lookup table), and rejects anything past the cap.

Every function follows one template: `set search_path = ''` (schema-qualify everything), re-derive
caller identity/role from the database (never trust a parameter), lock the row(s) being mutated
(`select ... for update`), check current state (raise a specific exception on anything invalid —
retries are safe, not silently corrupting), write, then
`revoke execute on function ... from public, anon, authenticated;` followed by
`grant execute on function ... to authenticated;` (`, anon` too for the three public-read
functions). Internal `_`-prefixed helpers (`_is_story_owner`, `_revision_is_editable`,
`_latest_valid_consent_for_revision`, `_require_processed_media`, `_authorize_revision_edit`,
`_generate_story_slug`, `_terminalize_active_revision`) get the `revoke` line and **no** `grant` —
Postgres grants `EXECUTE` to `PUBLIC` by default on function creation, so skipping the explicit
revoke would silently make an "internal" helper callable over the API despite the naming
convention.

### Entities

- **`stories`** — stable identity + lifecycle pointer: `contributor_id`, nullable `owner_user_id`
  (null for an editorial import not yet linked to an account), `source_kind`
  (`self_submitted`/`editorial_import`), globally-unique `slug`, `visibility`, `lifecycle_status`,
  `current_draft_revision_id`/`published_revision_id` (both validated by a trigger, see below),
  `assigned_editor_id`, `consent_revoked_at`/`consent_revoked_by`, `version` (optimistic
  concurrency counter for the whole story, not per-revision).
- **`story_revisions`** — versioned content snapshots. `revision_status`:
  `draft`/`submitted`/`approved`/`rejected`/`changes_requested`/`withdrawn`/`superseded`. **Only
  `draft` is ever content-editable** — every other status is frozen forever
  (`story_revisions_protect_immutable_content()`, a `BEFORE UPDATE` trigger that blocks changes to
  any content column once `revision_status <> 'draft'`, regardless of caller). "Going back to
  editing" always means a brand-new revision row (`create_next_draft_revision()`), never reopening
  an old one — this is what makes `revision_id` a true immutable snapshot everywhere it's
  referenced (consent grants, the published pointer, moderation decisions). `trip_year` is an
  independent, directly-entered column (not derived from `trip_start_date`), so a year-only story
  with no exact dates is representable. `content_json` is a controlled block array
  (`paragraph`/`heading`/`quote`/`list`/`table`/`image`, see `lib/validation/story.ts`). An
  `image` block is a _reference_ (`mediaId`) to an already-uploaded, already rights-confirmed
  `story_revision_media` row, positioning it within the text — never a raw URL, and never a
  duplicate of that row's `alt_text`/`caption`/`decorative` (kept structurally separate to avoid
  duplicate captioned-image state; `save_revision_draft` rejects any `mediaId` not attached to the
  same revision). Images not placed inline still render in the trailing gallery, built from the
  same `story_revision_media` rows.
  `editor_note` lives in a sibling table, `story_revision_editor_notes` (staff-only, no owner
  policy at all) — RLS can't hide one column of an otherwise-readable row, so it isn't one.
- **Per-revision relations** — `story_revision_locations` (a trigger enforces the selected
  destination belongs to the selected region), `story_revision_work_types`, `story_revision_tags`.
- **Media** — `story_media` (story-scoped, reusable across revisions) and `story_revision_media`
  (revision-scoped presentation: `alt_text`/`caption`/`decorative`/`sort_order`/`is_cover`, with a
  deterministic `unique (revision_id, sort_order)` and a partial-unique index for at most one cover
  per revision). `attach_story_media()` sets only source-side columns;
  `approved_public_storage_path`/`metadata_removed_at`/`processed_*`/`sha256` can only be set by
  `promote_story_media()`, which **has no grants at all in this phase** — not reachable via the API
  by any role. Prompt 4's real storage-bucket/image-processing pipeline must deliberately establish
  its own trusted access to it (an explicit grant to whatever mechanism it introduces —
  `service_role` does **not** automatically bypass function `EXECUTE` privilege, that's a separate
  privilege system from RLS bypass).
- **Consent** — `story_publication_consents` is append-only: every row is a genuine grant bound to
  one specific, immutable `revision_id` (`unique (revision_id)`), with an `event_number` sequence
  (`unique (story_id, event_number)`) assigned under a row lock. There is exactly **one** way to
  create a grant row: `submit_revision_with_consent()` — consent is recorded atomically with the
  exact submission it authorizes, never as a standalone prior step something else later trusts. An
  editor's early offline evidence gathered during import prep can be _noted_ (`log_editorial_action`,
  plain audit text) but authorizes nothing until re-confirmed at submission time against the exact
  revision being submitted. `confirmation_method = 'account'` requires the caller to be the story's
  linked contributor; the four offline methods (`email`/`written_message`/`in_person`/`other`)
  require the caller to be the assigned editor or an admin, **and** only apply to
  `source_kind = 'editorial_import'` stories. Revocation is a single terminal flag on `stories`
  (`consent_revoked_at`/`consent_revoked_by`, not another event row) — checked by both
  `submit_revision_with_consent()` and `moderate_revision()`'s approve path, and no function ever
  clears it (no restoration path exists in this phase). `internal_note` lives in a sibling table,
  `story_publication_consent_notes` (staff-only).
- **Moderation/reporting** — `moderation_actions` + `moderation_action_notes` (append-only,
  insert-only via `moderate_revision()`), `story_reports` (`reporter_id` nullable —
  `on delete set null` — set from the session at creation time, never null on insert; a partial
  unique index prevents a second `open` report by the same reporter on the same story),
  `editorial_actions` (append-only import-prep audit trail, distinct from `moderation_actions` per
  Engineering Rule 5).

### Lifecycle

`stories.lifecycle_status` only leaves `published` for `archived` — a replacement revision's
`draft`/`submitted`/`rejected`/`changes_requested` cycle happens entirely on
`story_revisions.revision_status` without ever touching the story root, so the previously-published
revision stays live throughout. For **first publication** (`published_revision_id is null`),
`moderate_revision()`'s reject/changes-requested paths _do_ set `stories.lifecycle_status`
accordingly (`rejected`/`changes_requested`), since there's no separately-live published content to
protect yet.

`create_next_draft_revision()` is the single function for "start editing again," covering first-
publication restarts (after `rejected`/`changes_requested`/a withdrawn submission) and starting or
retrying a published-story replacement. It clones the source revision's content, relations, and
media presentation (not `editor_note` — staff-internal, not carried forward automatically). Its
source-selection rule handles all three cases with one comparison: the most recent terminal
revision (`rejected`/`changes_requested`/`withdrawn`) is used **only if its `revision_number` is
newer than the currently published one** — otherwise it clones `published_revision_id`. This avoids
a stale, older terminal revision (e.g. from a long-ago failed first-publication attempt) being
picked over the real currently-published content. Only one draft/replacement can be active at a
time — enforced by requiring `current_draft_revision_id is null` under a row lock before creating a
new one.

`withdraw_unstarted_submission()` reverts a `submitted` revision to `withdrawn` (frozen, like every
other exit — not reopened) and clears the pointer, but **only** if no `moderation_actions` row
already references it. Works identically for a first-publication submission (story reverts to
`draft`) and a replacement (story stays `published`, untouched).

`stories_validate_revision_pointers()` (`BEFORE INSERT OR UPDATE` trigger on `stories`) enforces
that `current_draft_revision_id` references a `draft`-or-`submitted` revision of the _same_ story,
and `published_revision_id` references an `approved` revision of the _same_ story — regardless of
caller.

### Public reads

`get_published_story(slug)`, `list_published_stories(...)`, `get_published_story_media(story_id)`
are the only three functions granted to `anon`. Each independently re-verifies every invariant
inside its own body — `visibility = 'public'`, `lifecycle_status = 'published'`,
`published_revision_id` references an `approved` revision of the same story,
`consent_revoked_at is null`, and a currently-valid, revision-matched consent grant exists — rather
than trusting that some other layer already filtered correctly. All three declare an explicit
`returns table (...)` curated shape, never a bare row type, so a future column added to a base table
can't widen the public shape without a deliberate change here. Displayed attribution comes from the
**consent grant's snapshot** (`attribution_type`/`attribution_value`, captured at submission time),
not a live join to `contributors` — a private contributor's story still shows their chosen
attribution text, `contributors.public_status = 'public'` only controls whether a clickable
`contributor_slug` link is included. `total_expense_nzd_cents` is returned as the exact
contributor-reported figure (self-disclosed for publication, not sensitive account data); cost-band
_filtering_ is deferred to Prompt 5 rather than inventing bucket thresholds now.
`list_published_stories()`'s `p_limit` is hard-clamped server-side to `[1, 50]`.

### Staff reads are role-shaped, not combined

`get_story_for_editor(story_id)` (assigned editor or admin) includes `story_revision_editor_notes`
and never `moderation_action_notes`; `get_story_for_moderator(revision_id)` (moderator or admin)
includes `moderation_actions`/`moderation_action_notes` and never editor notes — a deliberate split
so a role never receives another role's private material by default, with no third combined
function that could quietly bypass the separation. `get_moderation_queue()` is scoped to
`revision_status = 'submitted'` only — not `awaiting_approval` (contributor pre-submission review),
which moderators have no documented need to see. `current_consent_state(story_id)` is authorized by
relationship (`_is_story_owner()` or a staff role), not merely by being signed in, and returns a
named composite type (`consent_state`) rather than the base table's row type.

### Deletion policy

No hard-delete path for any story-domain row in this phase — structural parent/child foreign keys
(`story_revisions.story_id`, every per-revision/media/consent child) are `on delete restrict`,
explicit rather than left as an implicit default, since nothing is designed to delete a story.
Removal from public view is `archive_story()` or the automatic archive that
`revoke_publication_consent()` performs. Every actor/staff-identity foreign key
(`created_by`/`updated_by`/`recorded_by`/`moderator_id`/`handled_by`/`reporter_id`) is nullable with
`on delete set null`, so deleting an `auth.users` row never blocks on a story-domain row — matching
the fix already applied to `contributors.linked_user_id` in Prompt 2.

### A real bug class found during live verification: SQL three-valued logic

`tests/integration/story-rls.integration.test.ts`'s very first ownership test ("another user cannot
read or edit the private draft") caught a genuine authorization bypass: `assigned_editor_id` and
`contributors.linked_user_id` are both nullable columns, and an expression like
`v_story.assigned_editor_id = auth.uid()` evaluates to `NULL` (not `false`) when the column is
`NULL`. `false OR NULL` is also `NULL`, and PL/pgSQL's `IF NULL THEN ... END IF` does **not**
execute the branch (only `TRUE` does) — so
`if not (owner_check or assigned_editor_id = auth.uid()) then raise exception ... end if;` silently
skipped the raise for _every self-service story_ (where `assigned_editor_id` is always null),
regardless of who was calling, letting any signed-in stranger overwrite another contributor's draft.
`has_role()` and `_is_story_owner()` were never affected — both are defined with `exists(...)`,
which always returns a real boolean. Fixed by wrapping every such comparison in
`coalesce(..., false)`, in every function that had the pattern (found and fixed in
`20260803091100_fix_nullable_actor_boolean_logic.sql`). A second, related bug in the same debugging
session: `moderate_revision()`'s approve path set `lifecycle_status = 'published'` but never set
`visibility = 'public'` (which defaults to `'private'` and had no other writer anywhere), so no
story could ever actually satisfy the public-read functions' invariant checks even once approved —
fixed in `20260803091200_fix_publish_sets_visibility.sql`. A third bug — PL/pgSQL's `RETURNS TABLE`
column names are implicit variables in the whole function body, so a bare `where slug = p_slug`
inside a function that `returns table (slug text, ...)` is ambiguous (`42702`) — was fixed in
`20260803091000_fix_returns_table_column_ambiguity.sql`. All three were only discoverable by
actually calling the functions over the real Auth/PostgREST API with real sessions, not by
reviewing the SQL text — the exact reason the integration suite (not just manual review) is part of
this phase's Definition of Done. See
[docs/implementation-status.md](implementation-status.md) "Prompt 3 detail" for the full account.

### RLS integration test setup

`tests/integration/story-rls.integration.test.ts`, run via `npm run test:rls` (not part of
`npm run verify`/default `vitest run` — real network calls to the real linked hosted dev project, no
Docker needed unlike the local stack). Fail-closed: refuses to run unless
`SUPABASE_RLS_TEST_URL`/`_PROJECT_REF`/`_PUBLISHABLE_KEY`/`_CONFIRM` and five accounts' credentials
are all set in `.env.test.local` (gitignored, separate variable namespace from the app's runtime
`NEXT_PUBLIC_SUPABASE_*` vars so it can never silently inherit whatever `.env.local` points at); the
URL must contain the configured project ref; `SUPABASE_RLS_TEST_CONFIRM` must exactly equal
`i-confirm-${ref}-is-a-disposable-dev-project` (forces typing the specific ref, so a stale
confirm value can't be silently reused against a different project later). Runs serially
(`vitest.rls.config.ts`, `fileParallelism: false`) since several scenarios deliberately share the
fixed accounts and the one-active-draft-per-story lock.

**Fixed pool of five pre-created, pre-confirmed accounts** (owner, other, editor, moderator,
admin) — not signed up fresh per run. This is a deliberate, one-time manual setup, not an oversight:
the linked dev project has email confirmation **on** (established during Prompt 2), so a freshly
signed-up disposable account can never obtain a session; a fixed, already-confirmed pool sidesteps
that instead of asking the project to disable a real security control for the sake of a test. To
set up: create five accounts (via the app's sign-up flow, confirming each), then, as an existing
admin (or once via direct SQL for the very first admin), call
`admin_set_user_role(user_id, 'editor'|'moderator'|'admin')` for three of them. Populate
`.env.test.local` with their emails/passwords plus the four connection vars above (see
`.env.local`'s sibling — never committed, never `.env.example`). Per-run uniqueness comes from
randomizing the **data** these accounts create (`rls-test-<random>-...` slugs/titles), not the
accounts.

**Cleanup runs automatically after a passing run** (changed 2026-08-16 — it was manual-only before):
`scripts/rls-test-cleanup.sql` (run via `npm run test:rls:cleanup`, which reuses the exact same
fail-closed guard) deletes, in the dependency order the domain's `on delete restrict` foreign keys
require, every row belonging to a story matching EITHER of two signals: a slug matching `rls-test-%`,
or ownership by one of the fixed `@whv-compass-test.example` test accounts. (The second signal was
added the same day, after `/stories/new` stopped letting a caller's title reach
`_generate_story_slug()` at creation time — see that migration's own note in the script — which broke
the first signal for anything created through the real "New Story" page and renamed afterward, e.g.
`e2e/cross-contributor-access.spec.ts`. Both signals only ever match disposable test data; no real
contributor can own that email domain.) `package.json` wires that command as npm's `posttest:rls`
hook, so a **successful** `npm run test:rls` tears itself down; a **failing** run does not (npm skips
`post*` hooks on a non-zero exit), leaving the broken run's data in place for debugging. Running it by
hand still works unchanged.

Why it changed: the suite publishes its fixture stories, nothing removed them between runs, and
"remember to run cleanup" did not hold — the public `/stories` listing and landing page eventually
carried 204 `rls-test-%` stories against 12 real ones. The guard, the `rls-test-%` scoping, and the
separately-gated full-truncate path are all unchanged, which is what makes automating it safe.

A commented-out full-truncate fallback exists for a dev project that's drifted beyond scoped cleanup,
gated by a second explicit env var (`SUPABASE_RLS_TEST_CONFIRM_FULL_TRUNCATE`). Neither path touches
`auth.users`/`profiles`/`user_roles`/`contributors` — the fixed account pool must survive every
cleanup run.

The suite's disposable `regions`/`destinations`/`work_types`/`tags` fixtures **are** deleted by the
scoped path (by the same `rls-test-%` slug prefix), and since 2026-08-16 they are also created with
`active = false`, so even between runs they never reach a user-facing dropdown — every such list
(`lib/story/active-lookups.ts`, `lib/story/public-queries.ts`) filters on `active = true`. That
belt-and-braces matters because the earlier "lookup-table growth is a trivial, accepted cost"
assumption turned out to be wrong: real contributors were being shown five copies of "RLS Test Tag A"
in the story editor's tag suggestions and the public `/stories` filter.

## Local vs. hosted Supabase development

**Docker is not available in this environment**, so the local CLI stack (`supabase start`) has not
been run or verified here. As of Prompt 2, this project is actively using the **hosted development**
path instead: linked to project `ybhydepjaantkngngvuf` (`supabase link --project-ref
ybhydepjaantkngngvuf`), with all migrations applied via `supabase db push` and reviewed with
`--dry-run` first each time. `.env.local` holds this project's real URL and publishable key. Two
supported paths exist in general:

### Local (needs Docker)

```bash
npm run supabase:start      # supabase start
npm run supabase:reset      # supabase db reset — LOCAL ONLY
npm run supabase:stop       # supabase stop
npm run supabase:migration:new -- <name>
npm run supabase:types      # atomic: writes to a .tmp file, only replaces types/database.ts on success
```

### Hosted development project (works without Docker)

Link to a **dedicated Supabase development project — never production**:

```bash
npx supabase link --project-ref <dev-project-ref>
```

Then:

```bash
npm run supabase:types:linked   # supabase gen types typescript --linked --schema public, same atomic write
```

Rules, enforced by convention (no script does these automatically):

- **Never** run `supabase db reset` against a linked project.
- **Never** auto-run `supabase db push` — migrations are reviewed (`supabase db diff` /
  inspect the SQL) and applied manually and deliberately: `supabase db push`.
- The project ref and any keys stay out of committed files — only in `.env.local` / your shell,
  never `.env.example`.

## Environment variables — who reads what

- `npm run dev` / `build` / `start`: read `.env.local` (untracked), copied from `.env.example` and
  pointed at a dedicated Supabase **development** project.
- Vitest: unit tests never make a live Supabase call — Supabase modules are mocked at the import
  boundary (see `lib/auth/contributor-guard.test.ts` for the pattern: test the pure decision
  function, not the Server Component that calls Supabase).
- Playwright: the smoke spec only visits public routes, which never call Supabase (see
  "Authentication boundaries" above), so it runs fine against whatever `.env.local` has — even
  well-formed placeholder values — without a live network call.
- `tests/integration/*.integration.test.ts` (currently just the story-domain RLS suite): explicitly
  named/tagged as integration tests, excluded from `vitest.config.ts`'s default include, run only via
  `npm run test:rls` with its own `.env.test.local` — see "RLS integration test setup" above.

## Testing strategy

- Vitest + React Testing Library: component/page content assertions and pure logic
  (`resolveContributorAccess`, `resolveStaffAccess`, `resolveSafeReturnTo`, every Zod schema), not
  fragile rendering of async Server Component layouts.
- Server Actions (`app/(auth)/actions.ts`, `app/(contributor)/actions.ts`) are unit-tested with the
  Supabase client and `next/navigation`'s `redirect()` mocked at the import boundary (same "test the
  boundary, not the live call" convention as the Supabase modules note below) — this is what verifies
  ownership scoping (`.eq("id", user.id)` always uses the _session's_ id, never a form field),
  generic auth error messages, and that `redirect()` only ever receives a `resolveSafeReturnTo()`-
  validated target.
- Playwright: `e2e/home.spec.ts` (public nav, staff-route 404s for signed-out visitors) and
  `e2e/auth.spec.ts` (sign-up/in/forgot/reset pages render; a signed-out visit to a protected
  contributor route redirects to `/sign-in?next=<path>`; an invalid `/auth/callback` link redirects
  to a friendly sign-in error instead of crashing). The protected-route redirect test is the first
  Playwright spec to actually exercise `proxy.ts`'s Supabase call. `.env.local` now points at a real
  linked Supabase project (see below), so this call is a genuine round trip, not a DNS failure — it
  was originally confirmed fast/non-flaky against placeholder values too, before the project was
  linked. `e2e/editorial-upload.spec.ts` and `e2e/content-import-body-size.spec.ts` (Prompt 4
  Sub-phase 4) sign in as the real fixed `editor` test account and exercise the real multipart
  upload Route Handler and Server Action body-size margin end-to-end, against the linked hosted
  project. `e2e/cross-contributor-access.spec.ts` (Prompt 4 Sub-phase 5) signs in as two
  independent, fixed test accounts (`owner`/`other`, plus a spot-check using `editor`) in two fully
  separate browser contexts and proves one contributor's session cannot read, preview, or upload to
  another contributor's story through the real pages — this is the UI-level counterpart to
  `tests/integration/story-rls.integration.test.ts`'s API-level cross-account denial tests, and it
  found a real, live-reproducing bug: `app/(contributor)/stories/[id]/edit/page.tsx`,
  `app/(contributor)/stories/[id]/preview/page.tsx`, and `app/(editor)/editorial/[id]/edit/page.tsx`
  all leaked a live HTTP 200 to a per-row-unauthorized visitor (`get_my_story_with_draft()`/
  `get_story_preview()` raise a Postgres exception rather than returning zero rows for an
  unauthorized caller, and neither an uncaught exception nor an explicit `notFound()` call deep in
  these particular Server Component trees set a real HTTP status in this app's current
  Next.js/Turbopack setup — the same failure mode already documented below for `/editorial`'s
  role-level check). Fixed the same way: `proxy.ts` now runs the same authorization RPC itself,
  before any RSC render can commit a 200, and returns a real 404 directly if it's denied — see
  `proxy.ts`'s `canReadStoryDraft`/`canPreviewStory` and their call sites for the current
  implementation.
- `npm run verify` = format:check + lint + typecheck + test + build (non-destructive, no server).
  `npm run verify:full` adds the Playwright run, reusing the build `verify` already produced
  (Playwright's `webServer` is `npm run start` only — never rebuilds) so nothing builds twice.
- **Server-side modules with native, WASM, or self-resolving dependencies MUST have Playwright
  coverage — Vitest cannot substitute, and a green `next build` proves nothing.** Vitest imports
  such a module directly in plain Node and never touches Next's bundler at all; `next build` can
  compile cleanly while the emitted chunk fails the moment a request actually reaches it. This is
  not hypothetical: the PDF/Canva importer shipped with 384 passing Vitest tests and a green build
  while both of its Route Handlers threw at runtime under Turbopack, because
  `require.resolve("pdfjs-dist/package.json")` is a bundler-visible call that Turbopack rewrites to
  its own module identifier instead of a filesystem path (full account in
  [docs/implementation-status.md](implementation-status.md), "2026-08-18 — PDF/Canva import:
  Turbopack fix"). Playwright is the only layer here that runs the real production build, so it is
  the only layer that can catch this class of bug. `e2e/pdf-import.spec.ts` is the pattern to copy:
  it asserts a real `200` and real rendered bytes from the route, and it was verified to fail when
  the fix is reverted. The packages this applies to today are `pdfjs-dist`, `@napi-rs/canvas`, and
  `sharp` (see `next.config.ts`'s `serverExternalPackages`).
- **RLS is now live-verified, not just reviewed.** Every policy in the Prompt 2 migrations was
  manually reviewed against the anonymous/owner/other-user/editor/moderator/admin matrix, and then
  the schema was pushed to a real linked Supabase project (`ybhydepjaantkngngvuf`) and exercised
  directly against its Auth/PostgREST APIs: signup → trigger-created `profiles`/`user_roles` rows,
  anonymous read denial, self-role-escalation denial (both direct `PATCH` and the `admin_set_user_role`
  RPC), and contributor-identity-hijack denial all behaved exactly as designed. This also surfaced and
  fixed a real bug — see "Known trade-off" below and
  [docs/implementation-status.md](implementation-status.md) "Prompt 2 detail" for the full account.
  What's _not_ yet verified: the real email-link round trip through `/auth/callback` (the project's
  redirect allow-list hasn't been confirmed configured — see implementation-status.md "Manual Supabase
  settings required").

## Media processing and publication pipeline (Prompt 4 Sub-phase 2)

Built after seven rounds of plan review (see the approved plan for the full decision history).
Backend and migrations only — no moderation UI ships in this sub-phase; Prompt 6 owns that UI and
will call `begin_story_publication_attempt()`/`finalize_story_publication()` directly. All 9
migrations are pushed and live-verified against the linked hosted project — see
[docs/implementation-status.md](implementation-status.md) "Prompt 4 detail" for the full account,
including the real bug the RLS integration suite's live run surfaced in
`scripts/rls-test-cleanup.sql` (the new attempt/copy-attempt tables' `on delete restrict` foreign
keys needed a cleanup-order fix). **Live-verified as of Sub-phase 4:** a full round trip through
actual Storage bytes (upload → `sharp` processing → public-bucket copy) is now exercised for real,
end-to-end, by `e2e/editorial-upload.spec.ts` — the gap this section previously deferred to
Sub-phase 5 is closed.

### Storage buckets

Two buckets, created in `20260804090700_story_media_storage_buckets.sql`:

- `story-images-private` — never public. Holds original uploads
  (`{story_id}/{media_id}/original.<ext>`) and processed-derivative staging
  (`{story_id}/{media_id}/processed-{sha256}.<ext>`, content-addressed). Writes are gated by
  `_can_write_reserved_media_path()`, a Storage RLS helper that parses the object path strictly
  (exactly three components, the first two valid UUIDs, no traversal/backslashes/percent-encoding)
  and requires an exact match against a real, still-`pending_upload`, still-editable reservation,
  authorized via the same relationship set `_authorize_revision_edit()` uses — a direct Storage API
  write to an arbitrary or another user's path fails at this policy, not merely because the app
  chooses not to attempt it. Reads are gated by `_can_access_story_media()`.
- `story-images-public` — world-readable by design. Every write (INSERT/UPDATE/DELETE) is
  restricted to `service_role` — no client, including an authorized owner or moderator, ever
  writes to this bucket directly. The only code path that ever does is
  `copyStoryMediaToPublic()` in `lib/story/image-pipeline.ts`, and only as part of an active
  publication attempt.

### The media processing-state machine

`story_media.processing_state`: `pending_upload → uploaded → processing → processed | failed →
promotion_pending → promoted`. Enforced at two independent DB levels — a `BEFORE UPDATE` trigger
(`story_media_validate_processing_state_transition()`) allow-listing exactly the valid `(old, new)`
pairs, and state-dependent `CHECK` constraints ensuring a state can't exist without its required
fields (e.g. `approved_public_storage_path is not null` if and only if `processing_state =
'promoted'`) — regardless of which function attempts a change. `promoted` is immutable: a
same-state `promoted → promoted` update is only a no-op if every recorded value is unchanged;
changing any of them is rejected by the trigger.

Column semantics, made unambiguous (a real ambiguity in the original Prompt 3 `width`/`height`
columns, which always described the _processed_ derivative despite the generic name): renamed to
`processed_width`/`processed_height`, with new `source_width`/`source_height` columns for the
original upload. Both pairs are **server-detected via a real `sharp` decode during processing**,
never client-supplied — `finalize_story_media_upload()` only records the raw observed byte size
(read directly from `storage.objects`, not trusted from the client) at upload time; true MIME type
and dimensions aren't known until `record_processed_story_media()` runs. `source_mime_type` is the
one exception forced by an inherited Prompt 3 `NOT NULL` constraint: `begin_story_media_upload()`
must insert _some_ value at reservation time, so it stores the client-declared MIME as a
non-authoritative placeholder (used only to pick the reserved path's extension) — this value is
never trusted for any validation or safety decision, and is overwritten with the server-detected
true value the moment processing succeeds.

### Upload reservation flow

`begin_story_media_upload()` / `finalize_story_media_upload()` / `cancel_pending_story_media_upload()`
supersede Prompt 3's single-step `attach_story_media()` (dropped). The DB row is created _before_
the storage write, but as an explicit reservation (`pending_upload`), never a claim that bytes
exist — `finalize_` is the step that runs after the storage write succeeds. Authorization for both
is exactly `_authorize_revision_edit()`, reused verbatim (not a separately maintained relationship
list). The 12-image-per-revision limit is enforced transactionally, under a lock on the revision
row, counting already-joined `story_revision_media` rows plus not-yet-finalized `pending_upload`
reservations together. `finalize_story_media_upload()` is safely retryable after a stale-version
error without re-uploading bytes: object-existence/size and re-derived authorization are checked
first (version-independent), and only the final join-creation step is version-gated — a repeat
call after the row has already moved past `pending_upload` is a no-op. No automatic reaper runs
inside these functions; an abandoned reservation is cleaned up only by explicit cancellation or the
maintenance script (below).

Concrete upload endpoint: `app/(contributor)/stories/[id]/edit/upload/route.ts` (Sub-phase 3,
built), `export const runtime = "nodejs"`, `MAX_UPLOAD_BYTES = 15 MiB`. The Route Handler
authenticates, rejects an oversized `Content-Length` header early, buffers the multipart body via
`request.formData()`, sniffs real magic bytes from the buffered bytes (never trusts the client's
reported `File.type`), **normalizes a HEIC upload to JPEG** (see "HEIC normalization" below),
calls `begin_story_media_upload()`, uploads via the regular (RLS-respecting)
server client — never the admin client — to the reserved path, calls
`finalize_story_media_upload()`, and then calls `processStoryMedia()` **synchronously, in the same
request** — there is no background worker/queue in this phase, so the upload response doesn't
return until processing has actually finished (or recorded a specific failure). Any failure after
the reservation step (storage upload fails, `finalize_` rejects a stale version) cancels the
reservation (`cancelPendingStoryMediaUpload`) and best-effort removes any already-uploaded bytes,
so a failed request never leaves an orphaned `pending_upload` row for longer than the request
itself — the maintenance script below is a backstop for the cases that still slip through (e.g. the
client's connection dropping mid-request), not the primary cleanup path.

### HEIC normalization (`lib/story/heic.ts`)

iPhones shoot HEIC by default, and a HEIC file transferred to a computer (rather than picked
straight out of the iOS photo picker, which often auto-converts) arrives as HEIC. Sharp's prebuilt
libvips can _parse_ a HEIC container but cannot decode one — its bundled libheif ships no HEVC
decompressor ("Support for this compression format has not been built in"), because that decoder is
patent-encumbered. AVIF (AV1 in the same container) decodes fine; an iPhone photo does not. So the
route handler decodes HEIC with `heic-decode` (a WASM libheif build, imported lazily so non-HEIC
uploads never pay for its ~6 MB payload) and re-encodes the raw pixels to **JPEG** via sharp,
**before** a path is reserved or any row is written.

Normalizing at the boundary is deliberate: HEIC never becomes a fourth format anywhere downstream.
The buckets' `allowed_mime_types`, the `begin_story_media_upload()` /
`record_processed_story_media()` MIME whitelists, `story_media.source_mime_type`, and the
pipeline's own sniff all still see exactly `image/jpeg | image/png | image/webp`, so no migration,
RLS change, or storage-policy change was needed. The trade-off: the stored "original" for a HEIC
upload is that JPEG transcode, not the HEIC bytes — acceptable because the original is private
staging material only, and the published derivative is always a re-encode of it.

**PNG was tried first and reverted** — a real-photo test proved it non-viable. A lossless PNG
re-encode of an ordinary 4284x5712 iPhone photo came to 51 MB against a 5 MB JPEG re-encode of the
exact same pixels, and both `MAX_UPLOAD_BYTES` and the storage buckets' own `file_size_limit`
(`supabase/migrations/20260804090700_story_media_storage_buckets.sql`) are fixed at 15 MiB — so PNG
would reject perfectly ordinary uploads at both the app layer and, even if that check were relaxed,
the storage layer too (a schema change, not a config tweak). PNG's losslessness buys nothing back
here regardless: the HEIC source is already lossy HEVC, so a lossless re-encode of it just spends
far more bytes on the same already-lossy pixels.

**Does not** pre-check dimensions via a separate `sharp(bytes).metadata()` parse ahead of decoding —
that was the first implementation, and it was a real bug: sharp's bundled libheif enforces its own
hard ceiling of 16 references in a HEIC container's `iref` box, and an ordinary modern iPhone photo
routinely exceeds it (Portrait mode / Deep Fusion / Live Photo all link extra image items —
thumbnail, depth map, portrait matte — via `iref`), throwing `Security limit exceeded: Number of
references in iref box (N) exceeds the security limits of 16` on files `heic-decode` (the separate
WASM libheif build actually used for the real decode) opens without issue. Reproduced directly
against a real 3.5 MB iPhone photo before the fix. `MAX_INPUT_PIXELS` (the decompression-bomb guard)
is now enforced from the dimensions `heic-decode` itself returns, checked immediately after decode
and before the (comparatively expensive) JPEG re-encode — not before the HEIC decode. That is an
accepted narrowing of the guard, not an oversight: this endpoint requires an authenticated
contributor with edit rights on the revision (never anonymous), and the compressed input is already
bounded by `MAX_UPLOAD_BYTES` before it reaches here. libheif applies the container's `irot`/`imir`
transforms while decoding, so the JPEG is upright and carries no metadata at all.

Sniffing lives in `lib/story/image-validation.ts`, split in two on purpose:
`sniffImageMimeType()` (the three _stored_ formats — used by the storage-facing pipeline, and still
rejects HEIC) and `sniffUploadMimeType()` (those three plus HEIC — used only at the upload
boundary). HEIC detection is an ISO-BMFF `ftyp` brand check; `avif`/`avis` and the video brands are
deliberately excluded.

### Processing (`lib/story/image-pipeline.ts` — the one module allowed to import `lib/supabase/admin.ts`)

Enforced by two independent layers: `import "server-only"` (build-time — webpack errors if a
client bundle transitively imports it) and an ESLint `no-restricted-imports` rule
(`eslint.config.mjs`) banning `@/lib/supabase/admin` everywhere except this one file.

`processStoryMedia(mediaId)`: downloads the original, sniffs magic bytes (JPEG/PNG/WebP only, no
extra dependency — three fixed signatures), decodes with `sharp({ limitInputPixels: 50_000_000 })`
(decompression-bomb guard), rejects animated sources (checked via `metadata.pages` — **requires
decoding with `{ pages: -1 }`**, otherwise `pages` is always `undefined` even for a genuinely
animated source; found via a unit test that tried to build an animated fixture), auto-orients via
`.rotate()` then re-encodes (sharp strips all metadata by default unless `withMetadata()` is
called, which it never is — verified directly in `lib/story/image-pipeline.test.ts` against a
source with real embedded EXIF), resizes to a 2000px long-edge cap, computes the sha256 of the
_processed_ bytes, and stages the result at a content-addressed private path. Verifies the actually
stored object's bytes/hash before treating the operation as complete — an upload call returning
success is never trusted blindly. Records the result via `record_processed_story_media()`
(`service_role`-only), or a specific failure via `record_story_media_processing_failed()`.

`copyStoryMediaToPublic(mediaId, approvalAttemptId)`: called only as part of an active publication
attempt. Calls `begin_story_media_copy_attempt()` (flips `processed → promotion_pending` and
records a durable, retained-forever `story_media_public_copy_attempts` row _before_ any public
write is attempted), copies the already-processed bytes to the public bucket's content-addressed
path, verifies the copy, and records `verified` or `failed`. Idempotent: a content-addressed path
can never have two different byte sequences recorded as "correct" under it, so a retry either finds
the existing object already correct or overwrites it with a freshly-verified copy.

`mintMediaPreviewSignedUrl(mediaId)`: looks up the private staging path via
`get_media_private_path_for_preview()` (`service_role`-only, no caller-identity check of its own —
safe only because the calling Server Action already ran `authorize_story_media_preview()` on its
own regular client first) and mints a 120-second signed URL. **A signed URL does contain the object
path as part of its structure** — that's normal; the actual guarantee is that no raw path is ever
returned as an independent, client-inspectable value, and the browser only ever receives the final
bearer URL, minted only after server-side authorization. Once minted, the URL works for anyone
holding it until expiry — the security boundary is entirely who is allowed to _mint_ one, not who
uses it afterward.

### Publication attempts

`story_publication_attempts`: a trusted parent, `id` minted server-side by
`begin_story_publication_attempt(revision_id)` (moderator/admin only) — no function anywhere
accepts a client-generated attempt id as the _origin_ of a new attempt, though the minted id is
legitimately passed back and used as a reference by every later call, each of which independently
re-verifies it (exists, `active`, matches revision/media, caller is `initiated_by` or an admin).
Only one attempt may be `active` per revision at a time, enforced by a partial unique index, not
merely an application check. `story_media_public_copy_attempts` is append-and-update,
**never-delete** — a row is retained and marked `resolved_at`/`resolution` (`promoted` / `abandoned`
/ `superseded`), giving a permanent, queryable audit trail of every publication attempt.

`finalize_story_publication(revision_id, approval_attempt_id, ...)` is the single atomic
publication transaction, called through the moderator's own regular client (the copy work above
already ran via the admin client separately). **No `expectedVersion` parameter** — submitted
revisions are already immutable (`story_revisions_protect_immutable_content()`), so the attempt's
own active/finalized/abandoned state plus row locks are the concurrency boundary, not the authoring
version. For every attached media item, it accepts either already-`promoted` (reused unchanged from
a prior publication — `create_next_draft_revision()` can clone media that's already public; never
recopied, never re-transitioned) or `promotion_pending` with a `verified` copy for _this exact_
attempt (only this category transitions to `promoted`, with `approved_public_storage_path` taken
from the copy-attempt record, never a fresh parameter). Idempotent: retrying an already-`finalized`
attempt is a safe no-op. `moderate_revision()` is narrowed to `reject`/`changes_requested` only —
`'approve'` now raises, directing callers to the attempt-based flow, which is what makes it the only
path to approval rather than an optional one. Both `finalize_story_publication()` and
`moderate_revision()`'s reject/changes-requested path lock the attempt row and re-check `active`
status, so a race between "finalize this attempt" and "reject this revision instead" resolves to
exactly one winner (the loser gets a clear "already resolved" error); a reject after a partial
approval attempt reverses `promotion_pending` media back to `processed` and marks the copy-attempt
rows `resolved`/`abandoned` — never touching an already-`promoted` (fully terminal) row.

### Submission requires processed media, not merely uploaded

`submit_revision_with_consent()` (migration `20260804090500`) now raises unless every attached
`story_revision_media` row's underlying `story_media.processing_state` is `processed` or later —
object existence alone (`uploaded`) is not enough. This closes the gap where a contributor or
reviewing contributor could submit/approve content whose images hadn't actually finished
processing. A zero-image revision is unaffected (the check is vacuously satisfied).

### Private preview — a dedicated RPC, never a reused staff function

`get_story_preview(story_id)` authorizes owner, linked contributor, assigned editor, or admin, and
**returns no storage path of any kind** — only `media_id` and presentation fields — since anything
a regular-client-reachable `SECURITY DEFINER` function returns is visible to the browser over
PostgREST. It structurally excludes `story_revision_editor_notes`/`moderation_action_notes` (no
column, no join to either exists in the function body) rather than relying on a UI component to
simply not render fields it was handed. `authorize_story_media_preview(media_id)` is a separate,
path-free "yes/no" check backing the signed-URL mint flow above.

`_can_access_story_media()` (used by both the above and the private bucket's read policy) scopes a
moderator's access to media attached to a revision that is either currently `submitted` or one
they've already acted on via `moderation_actions` — never a blanket grant merely from holding the
role, which would otherwise leak an unrelated draft's images to a moderator reviewing a different
revision of the same story.

### Maintenance — fail-closed, dry-run by default

`scripts/cleanup-abandoned-media-uploads.mjs` (`npm run media:cleanup:pending`), mirroring
`scripts/run-rls-cleanup.mjs`'s isolation pattern: dedicated `SUPABASE_MAINTENANCE_*` env vars
loaded only via `--env-file=.env.maintenance.local` (never falls back to `.env.local`), a
project-ref-bound confirm string, dry-run by default (`--execute` required for anything
destructive), a hard-coded 100-row batch bound. SQL only ever `SELECT`s candidates
(`pending_upload` reservations older than 24h; unresolved copy-attempts older than 1h) — actual
Storage object deletion always goes through the Storage API, and every database mutation goes
through one of two new, narrow, `service_role`-only RPCs
(`maintenance_cancel_abandoned_reservation()` / `maintenance_resolve_orphaned_copy_attempt()`)
rather than raw SQL, so maintenance mutations respect the same transition trigger/state constraints
as every other path.

### A known pre-existing `npm audit` advisory, reconfirmed unaffected

Adding `sharp` as a direct dependency surfaces `GHSA-f88m-g3jw-g9cj` (libvips CVEs, `<0.35.0`) in
`npm audit` — but the flagged node is `next/node_modules/sharp` (the old copy Next.js bundles
internally), not this project's own directly-installed `sharp@^0.35.3`, which is already the fixed
version. Same pre-existing, already-documented `next`-transitive risk as the `postcss` advisory,
not a new one introduced here.

## Self-service authoring UI (Prompt 4 Sub-phase 3)

Built entirely on top of the Sub-phase 2 backend above — no new migrations were needed for the
authoring form/upload/preview flow itself (one narrow exception, noted below).

- **Rich text**: `lib/story/rich-text-serialize.ts` (pure) converts Tiptap/ProseMirror JSON to and
  from the canonical block/run/mark schema. `components/story/rich-text-editor.tsx` wraps
  `@tiptap/react` + `@tiptap/starter-kit` (added as dependencies — React 19 support confirmed via
  `npm view @tiptap/react peerDependencies` before installing), configured to disable every
  node/mark the schema doesn't support (underline, strike, code, code block, horizontal rule, hard
  break), cap headings to H2/H3, and validate link hrefs through `isSafeHref()` at the editor
  level, not only at the Zod boundary. Its closed-loop test drives a real headless `Editor`
  instance through every allowed command and proves the disallowed ones don't exist on the
  configuration at all.
- **Rendering**: `components/story/content-block-renderer.tsx` renders the same schema as real
  JSX — no `dangerouslySetInnerHTML` anywhere in this stack (Rule 7) — used today by the preview
  page, reusable unchanged by the future public story page.
- **Mutation queue**: `lib/story/mutation-queue.ts` is the client-side answer to "many small
  autosave-style mutations, each carrying an `expectedVersion`, must never race each other in
  flight." Per-slot coalescing collapses rapid edits (e.g. every keystroke) into one call; strict
  global serial execution means a later mutation always observes the version the previous one
  produced; a stale-version conflict is reported via callback and never silently discards
  in-memory form state.
- **Edit page**: `app/(contributor)/stories/[id]/edit/page.tsx` + `actions.ts` — nine Server
  Actions (fields/locations/work types/tags/media caption/reorder/cover/detach/cancel-pending-
  upload), each Zod-validating input and returning `{ok:true} | {ok:false, error}` instead of
  throwing (so the mutation queue's conflict detection, which pattern-matches the RPCs' own
  `"Stale version for ..."` error text, works uniformly). `components/story/story-edit-form.tsx`
  (client) owns one `MutationQueue` and one shared `version` ref for the whole form, including the
  image manager.
- **Images**: `components/story/image-upload-manager.tsx` does fast client-side pre-checks
  (type/size — UX feedback only) before POSTing to the upload Route Handler (see "Upload
  reservation flow" above), then reorder/cover-select/detach (detach-and-retain only, never
  delete) and alt-text-required-unless-decorative, enforced both client- and server-side.
- **Preview**: `app/(contributor)/stories/[id]/preview/page.tsx` calls `get_story_preview()`
  exclusively, `export const dynamic = "force-dynamic"` plus `robots: {index:false,follow:false}`;
  `proxy.ts` sets `Cache-Control: no-store` for this path specifically, since a Server Component
  page can influence caching but can't append an arbitrary response header itself.
  `components/story/preview-gallery.tsx` and the image manager's thumbnails both go through the
  shared `app/(contributor)/stories/[id]/media-actions.ts#mintPreviewUrlAction` — authorize via
  `authorize_story_media_preview()` on the caller's own regular client first, then mint via
  `mintMediaPreviewSignedUrl()`; the raw storage path is never sent to the browser. Signed URLs
  expire after 120 seconds; a thumbnail minted early in a long editing session can go stale before
  the page is closed — accepted as a known limitation for this sub-phase rather than building
  proactive refresh logic.
- **Routing**: `proxy.ts`'s protected-path matcher gained a regex
  (`/^\/stories\/[^/]+\/(edit|preview)(\/.*)?$/`) alongside the pre-existing static-string list,
  since a dynamic `:id` segment can't be expressed as a literal path.
- **The one narrow migration this sub-phase actually needed**:
  `story_revision_locations`/`story_revision_work_types`/`story_revision_tags` (Prompt 3) have RLS
  enabled with no policies — every access is a `SECURITY DEFINER` function — but only the writer
  RPCs existed; there was no reader for the edit form to load a draft's prior selections on page
  load. `supabase/migrations/20260804091000_get_revision_selections.sql` adds
  `get_revision_selections()`, symmetric with the writers, same edit-rights authorization.
  **Applied** to the linked hosted project (with explicit go-ahead) and confirmed in sync — see
  [docs/implementation-status.md](implementation-status.md) for why this migration was needed (a
  gap found during this sub-phase, not anticipated when it was scoped).

## Editorial import + consent/approval UI (Prompt 4 Sub-phase 4)

Complete — all 8 migrations (the 5 originally planned, plus 3 corrective migrations written after a
live `test:rls` run against the newly-pushed schema found two real bugs) are pushed and
live-verified against the hosted project (`test:rls` 33/33, both new Playwright specs passing). See
[docs/implementation-status.md](implementation-status.md) "Prompt 4 Sub-phase 4 detail" for the full
account, including every bug found (both before and after the push) and the corrective migrations
that fixed them.

- **Source-kind-partitioned authorization, made explicit and structural.** A story's real owner for
  access-control purposes was, before this sub-phase, resolved by `_is_story_owner()`/several other
  functions checking `stories.owner_user_id OR the story's contributor's linked_user_id` together —
  correct-looking, but wrong once contributors can be relinked (this sub-phase's own new RPCs, below,
  make that a normal operation): `owner_user_id` is only ever meaningful for
  `source_kind = 'self_submitted'` (fixed at creation, never re-derived from contributor linkage);
  the contributor's _live_ `linked_user_id` is only ever meaningful for `source_kind =
'editorial_import'` (where `owner_user_id` is a stale creation-time snapshot, frequently null).
  Every place that resolves "is this caller allowed to act as the story's owner" now branches on
  `source_kind` first and checks only the ONE relevant field — never an OR across both regardless of
  source kind. Fixed in `_is_story_owner()`, `list_my_stories()`, `get_story_preview()`,
  `_can_write_reserved_media_path()` (migration `20260804092200`), and
  `submit_revision_with_consent()`'s own inlined `confirmation_method = 'account'` check (migration
  `20260804092100`, found independently during this sub-phase, not named in the approved plan's own
  list of 4). `assigned_editor_id`/admin checks are a different, always-valid relationship in both
  source kinds and are unaffected by this partition.
- **Restricted, audited contributor linking.** `contributors.linked_user_id` could previously be
  changed by any staff caller via a bare `UPDATE` (the existing
  `contributors_protect_privileged_fields()` trigger only ever blocked _non-staff_ assignment,
  never staff, and never audited the change at all outside `link_contributor_to_user()`'s own
  narrow path). `20260804092400_restrict_contributor_linking_to_named_rpcs.sql` closes this: a new
  private `_set_contributor_linked_user()` helper sets a transaction-local GUC
  (`app.contributor_link_operation`, `is_local = true` — scoped to exactly the one `UPDATE`
  statement's transaction, never manually cleared) that the trigger now requires to match the
  transition direction for _every_ caller including staff, with the single narrow exemption for the
  literal `ON DELETE SET NULL` FK cascade (detected precisely: `new.linked_user_id is null AND
auth.uid() is null` together — the only trigger-firing context in this schema with no active
  session at all). New `unlink_contributor_from_user()` (editor/admin only) is the audited
  counterpart to the existing `link_contributor_to_user()`; `contributor_links` gains an
  `event_type` column (`'linked'`/`'unlinked'`) so its history reads as a coherent timeline.
  Unlinking concerns the contributor _identity_ only — it never touches any story, and the
  source-kind partitioning above already guarantees a self-service story's access can never be
  affected by relinking the contributor record it happens to reference.
- **Consent/terms-version hardening.** `submit_revision_with_consent()` gained a required (not
  defaulted) `p_expected_terms_version` parameter — a mismatch against `current_terms_version()`
  raises with a stable `WHV01` SQLSTATE (`lib/story/rpc-errors.ts#isTermsChangedError()`), the same
  structured-error pattern this codebase already used for `23505`. New
  `get_consent_terms_version(revision_id)` reader is revision-scoped (consent is bound to one
  immutable revision, never a story-wide "latest"). Both function signature changes
  (`submit_revision_with_consent`, `save_revision_draft` — the latter now returns the new
  `story.version` instead of `void`) required a genuine `DROP FUNCTION` + `CREATE FUNCTION` (return
  type and required-parameter changes are not expressible via `CREATE OR REPLACE`), verified safe
  beforehand via `pg_depend` (zero dependents on the old signatures) against the live project.
- **The awaiting-approval submission dead-end**, closed with a narrow carve-out inside
  `submit_revision_with_consent()` itself (not by widening `_revision_is_editable()`, which must
  keep rejecting every other field-editing RPC while a draft awaits contributor review — see
  implementation-status.md for the full reasoning): a linked contributor can now actually submit
  (i.e. "approve") the exact current draft revision of a story that is
  `awaiting_contributor_approval`.
- **Editorial staff UI** (`app/(editor)/editorial/`) — dashboard, new-import form, a contributors
  list deriving `is_linked` at the TypeScript boundary (`lib/story/editorial-queries.ts`, selecting
  `linked_user_id` server-side but never including it in anything returned to a Client Component —
  the application-code equivalent of the story domain's curated-return-shape convention, applied to
  a table that, unlike the story domain, does have ordinary RLS grants), and the editorial edit page
  — reusing `components/story/story-edit-form.tsx`/`rich-text-editor.tsx`/`image-upload-manager.tsx`
  and the existing upload Route Handler **completely unchanged** for the underlying authoring
  mechanics (all three already worked for an assigned editor via `_authorize_revision_edit()`).
  `story-edit-form.tsx` gained one new optional prop (`showContentImport`) purely additive — every
  self-service call site that omits it is unaffected.
- **Content import** (`lib/story/content-import.ts`, new `node-html-parser` dependency) —
  `plainTextToBlocks()`/`sanitizeHtmlToBlocks()` convert arbitrary pasted text/HTML into the
  canonical block schema with full rejection (never truncation) on byte-length/node-count/nesting-depth
  ceilings, dangerous-subtree removal, safe-container unwrapping, nested list/blockquote flattening,
  table/pre/code-to-plain-text conversion, deterministic `<br>` handling, and the existing
  `isSafeHref()` reused for the link-safety matrix. "Use this content" integrates with the mutation
  queue as a destructive replace on the same `"fields"` slot, gated by a synchronous ref
  (`applyingImportRef`) that excludes autosave races, only updating visible state after a
  successful save. A real gap found while wiring this up: `rich-text-editor.tsx` is deliberately
  _uncontrolled_ (see its own code comment), so a successful import additionally needs an
  imperative `RichTextEditorHandle.replaceContent()` (new, additive, `forwardRef` +
  `useImperativeHandle`) to resync the visible ProseMirror document — without it, the next
  keystroke's `onChange` would have derived its snapshot from the stale pre-import document and
  silently reverted the import.
- **Contributor-side review/consent UI** — `app/(contributor)/stories/[id]/preview/page.tsx` gained
  `components/story/submit-consent-panel.tsx` (consent-at-submission, shown whenever the current
  revision is genuinely submittable) and `components/story/contributor-review-panel.tsx`
  (approve/request-changes/decline, shown only while `awaiting_contributor_approval` and the viewer
  is the linked contributor). `app/(contributor)/my-stories/page.tsx` now shows a "Review" CTA
  instead of a dead "Edit" link in that state (`current_draft_revision_id` stays set while awaiting
  approval, but the revision itself is frozen).
- **Server Action body-size margin** — `next.config.ts`'s
  `experimental.serverActions.bodySizeLimit` is `"2.5mb"`, a deliberate +25% margin over
  `lib/story/content-import.ts`'s `MAX_IMPORT_INPUT_BYTES` (2,000,000 bytes, the authoritative
  product-level limit enforced inside the action itself) — confirmed against the installed Next
  16.2.12's own shipped type declarations that this config key is still nested under `experimental`
  in this version, not promoted to top-level.
- **Testing** — `tests/integration/fixtures/tiny.png` (new, committed — a genuinely tiny valid PNG
  generated once via `sharp`) backs a new `e2e/editorial-upload.spec.ts` exercising the real
  multipart upload Route Handler as a signed-in editor, and `e2e/content-import-body-size.spec.ts`
  proves the three-tier body-size behavior above. Both skip themselves (not a hard failure) when
  `.env.test.local`'s editor credentials aren't present; both depend on
  `get_my_story_with_draft()` authorizing the assigned editor
  (`20260804092000`/`20260804092500` — see implementation-status.md), now pushed, and both **pass
  for real (4/4)** against the live project. `content-import-body-size.spec.ts`'s
  `BELOW_PRODUCT_LIMIT` fixture needed a fix while running these for real: its original text
  produced 1000 blocks, over `storyContentSchema`'s separate 200-block cap (a real, correctly-firing
  limit, not a bug) — reduced to stay under that cap so the test reaches the success path it's
  actually named for. New `scripts/cleanup-editorial-e2e-fixtures.mjs` mirrors
  `cleanup-abandoned-media-uploads.mjs`'s fail-closed pattern, deletes Storage objects through the
  real Storage API and verifies each is actually gone via a follow-up `list()` before deleting any
  database row — written, and (per a separate explicit go-ahead requirement) not yet executed, so
  the fixture data these Playwright runs created is still on the hosted project.

## Public discovery and SEO (Prompt 5)

Public reading/browsing (`/`, `/stories`, `/stories/[id]` — the folder is named `[id]` to match
`(contributor)/stories/[id]/`, a Next.js requirement that every route sharing a URL position across
route groups use the same dynamic-segment name; the value is still a slug, not a UUID —
`/contributors`, `/contributors/[slug]`), search/filter/sort, SEO metadata/sitemap/robots, and
reader reporting. Builds only on top of the story domain's existing public-read model
(`get_published_story`/`list_published_stories`/`get_published_story_media`, the only three
functions ever granted to `anon`) — no new table gains a direct grant.

### Public RPCs — extended, not replaced

`list_published_stories()` (migration `20260805100100`, corrected by `20260805100400`, see "A real
bug class" below) now returns everything a story card needs in one call — `cover_image_path`
(lateral join to `story_revision_media`/`story_media`, preferring the explicit cover, falling back
to the first image by `sort_order`), `regions`/`work_types`/`tags` (same curated JSON shape
`get_published_story` already used), and gained `p_cost_band`, `p_has_reported_expense`,
`p_exclude_story_id` (related-stories module), and `p_search` filters — never a per-card follow-up
query. Cost bands (`under_5k` / `5k_15k` / `15k_30k` / `30k_plus`, boundaries at exactly
`500000`/`1500000`/`3000000` cents) were a deliberate Prompt 5 product decision, not invented while
writing Prompt 3's migrations (see "Cost-band bucket thresholds" in implementation-status.md's
former Risks list — now resolved).

Three new anon-granted functions, same template as every existing public-read function (`set
search_path = ''`, explicit `returns table`, re-verify every invariant inside the body, `revoke`
then `grant execute ... to anon, authenticated`):

- `list_distinct_public_travel_styles()` — `travel_style` has no lookup table (free text), so
  filter options must come from what's actually in use among public stories, never a hardcoded list.
  Scans the same public+approved+consent-valid invariant `list_published_stories` checks; dedupes
  case-insensitively/trimmed via `distinct on (lower(trim(...)))`.
- `list_public_contributors(cursor, limit)` / `get_public_contributor(slug)` — the contributor
  directory/detail. Deliberately narrower than "`public_status = 'public'`" alone: requires a usable
  `public_slug`, excludes `attribution_type = 'anonymous'` (a contributor who chose to be anonymous
  shouldn't also get a named public profile page), and excludes contributors with zero published
  stories (computed via a lateral join against the same public+approved+consent-valid invariant,
  never a plain count against `stories`, which has no anon grant either way).

### `contributors` table grants — a real gap found and closed

`contributors` uses ordinary RLS (not the story domain's zero-grant model, see the Prompt 2 RLS
strategy section above) — Supabase's default per-table grants meant `anon` had direct
SELECT/INSERT/UPDATE/REFERENCES on every column, including `linked_user_id` and `created_by`, which
must never be public (Engineering Rule 16). RLS was still filtering _rows_ correctly
(`public_status = 'public'` only), but a direct anon `select('*')` on a public row would have leaked
both UUID columns — the exact same class of gap Prompt 3 found and fixed for the story domain in
`20260803090900_lock_down_story_domain_grants.sql`. Fixed in `20260805100000`: `revoke all on
public.contributors from anon`. `authenticated` grants are untouched — every existing
`.from("contributors")` call site in the app (self-service identity, editorial contributor list) is
authenticated-only, grepped and confirmed before making the change. All public contributor reads now
go through the two curated functions above instead.

### Cookie-free public client — what actually makes ISR effective

`lib/supabase/server.ts` calls `next/headers`' `cookies()`, which unconditionally opts a route out
of static rendering/ISR in the App Router regardless of `export const revalidate` — true even for a
page that never actually uses the session. `lib/supabase/public.ts#createPublicClient()` is a
plain `@supabase/supabase-js` client (no cookies, `persistSession: false`) used by every function in
`lib/story/public-queries.ts` (including new cookie-free duplicates of the lookup-table reads,
`listPublicRegions`/`listPublicDestinations`/`listPublicTags`, kept separate
from `lib/story/active-lookups.ts` so the authoring UI's existing cookie-bound queries are
untouched). This is what lets `/` and `/sitemap.xml` (revalidate 60/3600) actually build as static
(`○`) routes. `/stories`, `/stories/[id]`, `/contributors`, `/contributors/[slug]` still render
dynamically (`ƒ`) — `searchParams` usage and un-enumerated dynamic segments (no
`generateStaticParams`) force per-request rendering in the App Router independent of the Supabase
client used; `export const revalidate` on those pages has no practical effect without
`generateStaticParams`, documented here rather than silently overclaimed. `createStoryReport()`
(the one mutation this prompt's UI performs) still goes through the cookie-bound server client,
since it genuinely needs the caller's session.

### A public per-row 404 gap — the same failure mode, found again

`app/(public)/stories/[id]/page.tsx` and `app/(public)/contributors/[slug]/page.tsx` each call a
plain `notFound()` for a non-existent slug — live-verified via Playwright to still return HTTP 200
(the exact same "a page-based `notFound()` deep in an RSC tree doesn't set a real HTTP status"
failure mode already documented above for `/editorial` and the Prompt 4 Sub-phase 5 per-row leaks).
Not a security leak this time (a public row is public either way), but a real correctness bug
against both the brief's "denial of ... non-existent ... content" requirement and basic SEO hygiene
(a 200 for a dead link is a soft-404, and this project's own sitemap/robots work would be
undermined by serving one). Fixed the same proven way: `proxy.ts` gained
`publishedStoryExists()`/`publicContributorExists()` (calling `get_published_story`/
`get_public_contributor` — anon-safe, no auth needed) and matches `/stories/:id` /
`/contributors/:slug` in its matcher, returning a small real-HTML 404 (`publicNotFound()`, status
404, distinct from the flat JSON `flatNotFound()` staff routes use — a public 404 is not a stealth
response, so it gets a readable page instead) before any RSC render can commit a 200. `/stories/new`
is explicitly excluded from the story-slug check (a real static route, not a slug) since the
existing sign-in-redirect logic already runs first for signed-out visitors but a signed-in visitor
reaches the new check too. This adds one DB round trip per public detail-page request in
middleware, on top of the page component's own (unavoidable) fetch of the same row — the same
"correctness over the redundant-query cost" tradeoff already accepted for the private per-row cases.

### Search

`story_revisions.search_vector` (generated `tsvector`, title weighted `'A'`, excerpt weighted
`'B'`) with a GIN index, matched via `websearch_to_tsquery`. Uses Postgres's `'simple'` text-search
configuration, not `'english'` — deliberate: titles/excerpts are full of NZ place names, Māori
terms, and personal names that English stemming/stopword rules would mangle; `'simple'` still
tokenizes and case-folds, just skips stemming (documented tradeoff: less recall on English
word-form variants). One real, live-confirmed quirk this surfaced: a hyphenated query string (e.g.
a slug fragment) is parsed by `websearch_to_tsquery` as a strict phrase requiring the _entire_
hyphenated compound to exist as one lexeme in the target document — a partial hyphenated substring
of a longer hyphenated title therefore never matches, confirmed directly against the live database.
Space-separated queries (real user search terms) are unaffected — they AND-match regardless of
word order, verified the same way. Basic Postgres full-text over title+excerpt only, not a
dedicated search service — appropriate at this scale, a documented scaling note rather than an
oversight.

### Caching and invalidation — what exists today, and what Prompt 6 must call

`lib/story/public-cache.ts` exports `invalidateStoryPublicCache(slug)` /
`invalidateContributorPublicCache(slug)` (`revalidatePath` on the detail page, the index, `/`, and
`/sitemap.xml`). Deliberately **not** called from `lib/story/moderation.ts#archiveStory()` or
`lib/story/mutations.ts#revokePublicationConsent()` themselves — `revalidatePath`/`revalidateTag`
belongs at the Server Action/Route Handler orchestration boundary that calls a reusable
domain/repository function, not inside the function itself. Grepped and confirmed at the time of
writing: neither function has any real UI caller yet (Prompt 6, not started, is what will add the
actual publish/archive Server Actions). Until then, the only real mechanism keeping public pages
eventually consistent is the `export const revalidate = 60` on `/` and `/stories`/`/stories/[id]`/
`/contributors`/`/contributors/[slug]` (the latter four's practical effect is limited per the
"cookie-free public client" section above, since they're forced dynamic anyway — meaning they're
already fresh on every request without needing invalidation) and `revalidate = 3600` on
`/sitemap.xml`. Every future Server Action that calls `finalize_story_publication()`, `archiveStory()`,
or `revokePublicationConsent()` successfully must call the matching helper immediately after — see
the doc comment in `lib/story/public-cache.ts` for the exact call sites.

### Reporting UI

The backend (`create_story_report`, `story_reports_category_check` matching exactly the required 6
categories, the reporter-story-open partial unique index) was already fully built in Prompt 3 with
no UI caller — Prompt 5 added only `components/story/report-story-form.tsx` +
`app/(public)/stories/[id]/actions.ts#reportStoryAction`. Deliberately starts closed with no auth
check of its own: the story detail page itself never calls `getCurrentUser()` (keeping it as close
to static as the forced-dynamic constraints above allow), so a visitor's auth state is discovered
only when they submit — `createStoryReport()`'s existing "You must be signed in" error becomes a
`needs-sign-in` UI state rather than a page-level redirect. A duplicate open report (Postgres
`23505` on the partial unique index) and a genuine success resolve to the identical neutral
confirmation, never revealing report state to the caller (per docs/content-governance.md's private
reporter identity requirement).

### A real bug class found again: bare-identifier ambiguity in a function with no real caller

`list_published_stories()`'s lateral consent-lookup subquery (`where story_id = s.id`, inside `join
lateral (select * from story_publication_consents where ...)`) is bare — and
`list_published_stories()`'s own `returns table (story_id uuid, ...)` makes `story_id` an implicit
PL/pgSQL variable across the whole function body, the exact bug class already fixed twice before in
this codebase (`20260803091000`, `20260804092500`). This exact line was already fixed correctly
once, in `20260803091000` (`spc.story_id = s.id`) — but Prompt 5's `DROP FUNCTION` + `CREATE
FUNCTION` (needed for the new return columns) was authored from an earlier, pre-fix copy of the
function body and silently reintroduced the bare form. Never caught by `npm run test:rls` (the
existing 33 tests never actually called `list_published_stories` — the page it powers was a
placeholder until this prompt) — found live by `app/sitemap.ts`'s build-time call, `list_published_stories`'s
first-ever real caller. Fixed in a corrective migration, `20260805100400`, restoring the qualified
form. Lesson reaffirmed: when reconstructing a function via `DROP`+`CREATE`, diff against the
_current_ live signature/body (e.g. via `pg_get_functiondef`), never a possibly-stale copy carried
over from an earlier read.

## Editorial and moderation workspace backend (Prompt 6 Stage 1)

Backend/migrations only — no UI (`app/(moderation)/`, `app/(editor)/` routes are untouched this
stage; Stage 2 owns the queue/review pages). Eight new migrations
(`20260805100500`–`20260805101200`), all reviewed against Engineering Rules 2, 3, 10–14 but **not**
pushed to the linked hosted project this stage — see
[docs/implementation-status.md](implementation-status.md) "Prompt 6 detail — Stage 1" for exactly
what remains to be pushed and live-verified with explicit go-ahead.

### Archive/unpublish reason, and a new minimal audit table

`archive_story(p_story_id, p_expected_version)` gained a required `p_reason text` and optional
`p_note text` (`20260805100500`) — a `DROP FUNCTION`/`CREATE FUNCTION`, since a required parameter
changes the signature. Rather than force this into `moderation_actions` (which requires a
`revision_id` and a `story_revision_status` `new_status` — archiving is a story-level lifecycle
event with no revision or `story_revision_status` value of its own), a new minimal append-only table,
`story_publication_state_actions` (`story_id`, `actor_id`, `action_type` in
`('archived', 'consent_withdrawn')`, `reason`, `note`, `created_at`), was added instead. A `CHECK`
constraint enforces the reason requirement at the table level, not merely inside `archive_story()` —
so the "archiving requires a reason, withdrawal doesn't" invariant can't silently drift even if a
future function also ever inserts an `'archived'` row.
`revoke_publication_consent()` (contributor-initiated withdrawal) gained a matching audit insert with
**no reason parameter added** — it must stay reason-free per docs/content-governance.md.

### Editorial reassignment

`reassign_editorial_story(p_story_id, p_editor_id, p_note, p_expected_version)`
(`20260805100600`) — restricted to `source_kind = 'editorial_import'` stories only (self-service
stories have no "prepared by" editor concept to reassign; grepped every self-service authoring
function and confirmed none ever sets `assigned_editor_id`). Authorization: an admin may reassign any
such story to any user independently verified (via `has_role()`, never trusted from the caller) to
hold `editor` or `admin`; a non-admin editor may only **claim** a currently-unassigned story for
themselves or **hand off** a story currently assigned to them — never reassign a story assigned to a
different editor, mirroring `mark_editorial_draft_awaiting_approval()`'s existing
`assigned_editor_id = auth.uid() or admin` pattern rather than inventing a new authorization shape.
Locks and version-checks the story row first, records an `editorial_actions` row
(`action_type = 'reassigned'`). **A real gap found while writing this, left unfixed (out of scope for
Stage 1)**: `create_editorial_import_draft()` always resolves `p_assigned_editor_id` via
`coalesce(p_assigned_editor_id, auth.uid())`, so there is currently no RPC path that leaves
`assigned_editor_id` null on an editorial-import story — the "unclaimed pool" branch this function
and `list_editorial_queue()` (below) both support can never actually be exercised against a story
created through today's real API. Flagged, not fixed, since adding an "unassign" capability is scope
creep beyond what Stage 1 asked for.

Note: the brief's literal parameter list (`p_note text default null, p_expected_version integer`)
is not valid PostgreSQL — a parameter without a default cannot follow one that has a default in a
positional signature. `p_expected_version` is declared `integer default null` and the function raises
explicitly if it is null, which preserves "required in practice" while staying syntactically valid.

### Report internal notes and serious-category enforcement

New `story_report_notes` (`20260805100700`) mirrors `moderation_action_notes`'s shape exactly —
staff-insert-only, no update/delete, RLS enabled with zero policies, no direct grants. `resolve_report()`
(`DROP FUNCTION`+`CREATE FUNCTION` — a new parameter changes the signature) gained an optional
`p_internal_note`, now **required** when closing (`resolved`/`dismissed`, never on the `reviewing`
transition) a report whose `category` is one of `misinformation`, `unsafe_employment_advice`,
`harassment`, `copyright_privacy`; `spam_commercial`/`other` stay optional. The existing "can't
re-resolve an already-closed report" invariant is unchanged. A new `get_report_notes(story_report_id)`
reader (moderator/admin only) is the only other way to read the table besides `resolve_report()`'s own
insert — never folded into `list_reports_for_staff()`'s return shape.

### Moderation queue rebuild

`get_moderation_queue()` (`20260805100800`, `DROP FUNCTION`+`CREATE FUNCTION` — return shape changes)
gained `p_status` (`'submitted'` default — the real actionable queue — or `'recently_reviewed'`, a
distinct branch over `moderation_actions` ordered by `created_at desc`), `p_source_kind`,
`p_region_id`, `p_work_type_id`, `p_consent_method`, `p_date_from`/`p_date_to`, and pagination
(`p_limit` clamped to `[1, 50]` matching `list_published_stories()`'s convention, `p_offset`), plus
`is_replacement boolean` (`published_revision_id is not null` at query time) and `submission_kind text`
(`'first' | 'replacement' | 'resubmission'`). **Judgment call, documented in the migration's own SQL
comment**: `submission_kind` prioritizes `'resubmission'` over `'replacement'` — if the story has any
prior terminal revision (`rejected`/`changes_requested`/`withdrawn`) with a lower `revision_number`
than the row being labelled, it's a resubmission regardless of whether it's also technically a
replacement of a live publication. Total row count is returned as a `count(*) over()` window column
rather than a separate count function — one round trip, consistent with `list_published_stories()`'s
Prompt 5 "everything a caller needs in one call" precedent. Ordering is deterministic
(`submitted_at asc, revision_id asc` for the submitted branch; `created_at desc, id asc` for
recently-reviewed).

### Moderator review data — split across purpose-built functions, not one growing table

Per the brief's own suggestion, `get_story_for_moderator(p_revision_id)` (`20260805100900`,
`DROP FUNCTION`+`CREATE FUNCTION`) was rebuilt rather than widened further: it now returns full
publishable content (title/excerpt/content_json/trip dates/trip_year/travel_style/expense), a
**consent snapshot** joined directly from `story_publication_consents` on `revision_id` (unique per
revision — never a live `contributors` join, so attribution/confirmation-method/image-rights fields
can never leak `linked_user_id`/`created_by`), and a path-free media list
(`alt_text`/`caption`/`is_cover`/`sort_order`/`processing_state`, same "no storage path" convention as
`get_story_preview()`). Moderation-action history moved to a new `get_story_moderation_history(story_id)`;
editorial-prep history to a new `get_story_editorial_history(story_id)` — moderators are allowed to see
this for review purposes, but it stays a distinct function/call, never merged into the editor-only
`get_story_for_editor()`. `list_reports_for_staff()` (below) gained a `p_story_id` filter instead of a
separate "reports for a story" function. A new `get_published_revision_snapshot(story_id)`
(moderator/admin only) returns the currently-published revision's content for diffing against a
replacement under review.

### Narrowed moderator access to `contributors`

The Prompt 2 "known trade-off" (moderator row-level, not column-level, visibility into `contributors`)
is resolved for real, not merely narrowed further: `20260805101000` drops the
"contributors: staff read all contributor records" policy and replaces it with an editor/admin-only
equivalent. Grepped the whole repo for `.from("contributors")` before making this change — the only
call sites are a contributor's own self-service identity actions (already covered by the separate
owner policy) and the editorial contributor list/creation flow (editor/admin, already covered by the
new policy). No moderator-reachable code path anywhere touches `contributors` directly once
`get_story_for_moderator()` sources attribution from the consent snapshot instead — removing the
access entirely was simpler and safer than building the column-restricted view the original risk note
considered.

### Reports queue and editorial queue

`list_reports_for_staff()` (`20260805101100`, `DROP FUNCTION`+`CREATE FUNCTION` — new parameters
change the signature) gained `p_category`, `p_date_from`/`p_date_to`, `p_story_id`, and pagination
(`p_limit` clamped, `p_offset`), deterministic order (`created_at desc, id asc`). `story_report_notes`
is never joined into this function's return.

New `list_editorial_queue(p_status, p_search, p_limit, p_offset)` (`20260805101200`) does **not**
replace `list_assigned_editorial_stories()` — grepped and confirmed `app/(editor)/editorial/page.tsx`
still calls it directly, so it's kept unchanged. Covers `awaiting_contributor_approval`/
`changes_requested`/every other `lifecycle_status` filter value, scoped to: admin sees every
`editorial_import` story regardless of assignment; a non-admin editor sees stories assigned to them
plus the (currently unreachable, see "Editorial reassignment" above) unclaimed pool. `p_search` is a
simple `ilike` substring match on title/slug — deliberately not the `websearch_to_tsquery` machinery
`list_published_stories()` uses for public search, since a small internal staff tool doesn't need it.

### Concurrency/idempotency discipline, reconfirmed

Every new/changed function in this stage follows the same discipline `finalize_story_publication()`
and the narrowed `moderate_revision()` already established: `archive_story()` (already
version-checked, reason validation added without weakening it), `reassign_editorial_story()` (row
lock + version check, explicit "stale version" exception), `resolve_report()` (already locks and
rejects re-resolving a closed report — that invariant is untouched, only the note requirement is
added). No function in this stage introduces a new state-machine transition that could race against
an existing one; the queue-reading functions (`get_moderation_queue()`, `list_reports_for_staff()`,
`list_editorial_queue()`) are all `stable`, read-only, and take no lock.

## Moderation/editorial workspace UI and orchestration (Prompt 6 Stage 2)

Builds the real UI/orchestration layer on top of Stage 1's backend — no new migrations were
required for the queue/review pages or Server Actions themselves, but two small, targeted gaps
found while wiring them up ARE new migrations. **Editorial update (Prompt 6 Stage 3): both were
since pushed and `test:rls`-verified** — the "NOT pushed this stage" framing below reflects the
state at the moment Stage 2 was written; see docs/implementation-status.md "Prompt 6 detail — Stage
1" for the confirmation that all 10 migrations (this pair included) are live, and "Prompt 6 detail
— Stage 3" for the `callUntypedRpc()` cleanup this made possible.

### `app/(moderation)/moderation/route.ts` deleted, replaced with real pages

A Route Handler and a page cannot coexist at the same route segment, so this was an explicit
delete-then-create. `app/(moderation)/moderation/layout.tsx` mirrors
`app/(editor)/editorial/layout.tsx` exactly (the entire moderator/admin role check happens
synchronously at the top of a plain, non-streaming Server Component with no Suspense boundary
under it) — still only a defense-in-depth backstop; `proxy.ts`'s new `STAFF_MODERATION_PATH` check
is what actually guarantees the real 404 for a signed-out or wrong-role visitor, for the same
"a page-based `notFound()` can flush a 200 before it attaches" reason `STAFF_EDITORIAL_PATH`
already documents.

### Review page `[id]` param: revision_id, not story_id

`app/(moderation)/moderation/stories/[id]/page.tsx` uses a **revision id**, not a story id.
`get_story_for_moderator()`'s own key is `revision_id`, and the brief's own emphasis on reviewing
"the exact submitted revision" is unambiguous with a revision-id URL in a way a story-id URL isn't
(a story can have several revisions across its lifetime — rejected, changes_requested,
resubmitted — so "the story's current revision" would need an extra lookup that doesn't exist as a
moderator-scoped function today). `story_id` (needed for moderation/editorial history and reports,
none of which are keyed by revision) is derived from the fetched row, never re-parsed from the URL.

### A genuine gap found while wiring this up: `get_story_for_moderator()` had no `slug`/`story_version`

Neither field is exposed by ANY moderator-accessible function as of Stage 1: `stories` carries no
RLS policies at all (every access is a `SECURITY DEFINER` function), and `get_story_for_editor()` is
editor-assigned/admin scoped, not moderator. The review page's real approve/archive Server Actions
structurally need both — `slug` to call `invalidateStoryPublicCache()` after a successful
publish/archive, `story_version` for `archive_story()`'s/`reassign_editorial_story()`'s required
`expectedVersion` optimistic-concurrency parameter. `supabase/migrations/20260805110000_moderator_story_detail_slug_version.sql`
(DROP+CREATE, diffed against the current live body per this codebase's own "never reconstruct from a
stale copy" lesson) adds both columns. **Since pushed** (see docs/implementation-status.md "Prompt 6
detail — Stage 1"/"Stage 3") — `npm run supabase:types:linked` was regenerated afterward, and
`lib/story/moderation.ts#getStoryForModerator()`'s temporary `callUntypedRpc()` call (Stage 1's own
escape hatch) has since been converted back to a plain typed call, same cleanup Stage 1 already did
once for itself.

### Per-row moderation-existence check: a new, deliberately narrow RPC

`proxy.ts`'s `/moderation/stories/[revisionId]` per-row check calls a new
`can_view_moderation_review(p_revision_id)` (moderator/admin only, existence-only — returns just the
revision id if it exists and the caller holds an allowed role), added by
`supabase/migrations/20260805110100_moderation_review_existence_check.sql` (also **since pushed**).
Deliberately not a reuse of `get_story_for_moderator()` itself: that function builds the entire
review payload (content_json, consent snapshot, a `jsonb_agg` of every attached media item) on every
call — reusing it in middleware would mean fetching that whole payload on every request just to
decide a 404, exactly the cost the brief called out to avoid. This function intentionally does not
filter on `revision_status`, since a moderator must be able to keep viewing a review page after a
decision is made (moderation history, the `recently_reviewed` queue).

### Approve-flow orchestration: begin → copy media → finalize, with an explicit partial-failure contract

The looping/partial-failure decision is factored into a pure(-ish), unit-tested function,
`lib/story/publish-orchestration.ts#runApproveOrchestration()`, injected with the three real
side-effecting operations (`beginStoryPublicationAttempt`, `copyStoryMediaToPublic`,
`finalizeStoryPublication`) by the Server Action
(`app/(moderation)/moderation/stories/[id]/actions.ts#approveStoryAction()`). Contract: only media
whose `processingState !== 'promoted'` is copied (this also naturally retries a `promotion_pending`
item, which `begin_story_media_copy_attempt()`'s own idempotent branch handles); if ANY copy fails,
the loop stops immediately and `finalizeStoryPublication()` is never called — the attempt is left in
its recoverable `active` state (this matches `finalize_story_publication()`'s own re-entrant design:
a later retry of the whole orchestration, or an explicit reject/changes-requested via
`moderateRevision()`, can still resolve it cleanly, since `moderate_revision()` already abandons an
active attempt and reverts any `promotion_pending` media back to `processed`). A `finalize` failure
is reported the same way (attempt id surfaced, nothing silently swallowed). `invalidateStoryPublicCache(slug)`
is called by the Server Action ONLY after the orchestration reports `{ ok: true }` — never inside the
orchestration function itself, matching `lib/story/public-cache.ts`'s own "call at the orchestration
boundary, not inside a reusable domain function" rule.

### Archive/reject Server Actions

`archiveStoryAction()` re-derives the story's slug server-side via `getStoryForModerator(revisionId)`
rather than trusting a client-supplied slug (Engineering Rule 2) — this is the only moderator-
accessible slug source as of this stage's `get_story_for_moderator()` extension above.
`moderateDecisionAction()` (reject/changes_requested) requires a non-empty `userFacingReason`,
Zod-validated in the new `lib/validation/moderation.ts`. Every action independently re-derives
`getCurrentUserRole()`/`resolveStaffAccess()`, matching `app/(editor)/editorial/[id]/editorial-actions.ts`'s
established convention — never trusting the route group's layout guard alone.

### Editorial workspace: `list_editorial_queue()` wired in, reassignment, editorial-history panel

`app/(editor)/editorial/page.tsx` now calls `listEditorialQueue()` (status filter + free-text search

- pagination, via `count(*) over()`'s `total_count`) instead of the flat, unfiltered
  `listAssignedEditorialStories()` — a single filterable view rather than separate tabs, since
  `list_editorial_queue()`'s own `p_status` parameter already covers every `lifecycle_status`
  generically. `app/(editor)/editorial/reassign-actions.ts` wraps `reassignEditorialStory()`, editor/
  admin only; a non-admin editor's out-of-rule reassignment attempt is not pre-filtered out of the UI —
  `reassign_editorial_story()`'s own rejection message is surfaced verbatim, per the brief. The
  reassignment form (`app/(editor)/editorial/reassign-form.tsx`) takes a raw target-editor-id field,
  not a picker — **no staff-directory listing function exists anywhere in this codebase** (grepped) to
  safely populate a name-based dropdown; flagged as a real, pre-existing gap below, not fixed (adding
  one is a judgment call beyond this stage's scope). `getStoryEditorialHistory()` is now rendered via a
  new `app/(editor)/editorial/editorial-history-panel.tsx` on `app/(editor)/editorial/[id]/edit/page.tsx`,
  in every state the page can render (draft, awaiting-contributor-approval, not-editable) — kept
  strictly read-only and separate from the moderation-history section on the moderator's review page,
  per Engineering Rule 5.

### Route protection

`STAFF_MODERATION_PATH` in `proxy.ts` mirrors `STAFF_EDITORIAL_PATH` exactly (moderator/admin role
check, identical flat 404 for signed-out and wrong-role). `MODERATION_REVIEW_PAGE_PATH` (exact-match
only, same reasoning as `STORY_EDIT_PAGE_PATH`/`EDITORIAL_EDIT_PAGE_PATH`) gates
`/moderation/stories/[revisionId]` via the new `can_view_moderation_review()` RPC above.

### Diff view

The replacement/resubmission diff on the review page is a plain before/after two-column render
(`get_published_revision_snapshot()` vs. the submitted revision), both through the existing
`ContentBlockRenderer` component — no diff algorithm or library was added (Engineering Rule 20: no
existing diff library in this codebase, and a block-by-block before/after render is sufficient per
the brief's own instruction not to over-build this).

### Safe links

The only user-supplied link surface reachable from this page is `content_json`'s own link marks,
already routed through `ContentBlockRenderer`, which — per that component's own doc comment — relies
on `href` having already been validated by `isSafeHref()` (`lib/validation/story.ts`) at write time
and never re-validates at render time. No other field this stage's review page renders
(attribution/consent/report fields, etc.) is treated as a clickable link, so no second call site for
`isSafeHref()` was needed; noted here rather than fabricating one.

### Tests

`lib/validation/moderation.test.ts` (queue search-param parsing — every field parses independently,
never throws, same convention as `lib/validation/discovery.test.ts`; Zod schema edge cases for the
required-reason fields). `lib/story/publish-orchestration.test.ts` (the approve-flow partial-failure
contract above, fully unit-tested with injected fakes — no real Supabase/storage involved).
`e2e/moderation.spec.ts` added, following `tests/integration/story-rls.integration.test.ts`'s own
fixture-creation pattern (direct RPC calls through a signed-in client) for speed/reliability rather
than a slower, more brittle UI-driven fixture flow — **not run this session**, since this stage's two
new migrations are unpushed (same live-migration precondition every other Prompt-6-touching e2e spec
in this repo has needed before it could run for real).

## Reports triage and operational hardening (Prompt 6 Stage 3)

The final stage of Prompt 6 — a dedicated reports-triage workspace, a real moderator-facing
guidelines document, and a recovery-hardening review. **No new migration was required**: every RPC
this stage's UI calls (`listReportsForStaff()`, `resolveReport()`, `getReportNotes()`,
`create_story_report()`) already exists and was already pushed/`test:rls`-verified in Stage 1 — this
stage is UI/orchestration/documentation only, the same shape Stage 2 was for the queue/review pages.

### Reports-triage queue and detail pages

`app/(moderation)/moderation/reports/page.tsx` — filterable (status/category/date-range, same
GET-searchParams convention as the stories queue), paginated queue over `listReportsForStaff()`.
`lib/validation/moderation.ts` gained `parseReportsQueueSearchParams()`/`REPORTS_QUEUE_PAGE_SIZE`,
mirroring `parseModerationQueueSearchParams()`'s "every field parses independently, never throws"
convention exactly. Pagination here is a simple "did we get a full page" heuristic
(`rows.length === REPORTS_QUEUE_PAGE_SIZE` implies a next page), not a `total_count` window column
— `list_reports_for_staff()` `returns setof public.story_reports` (confirmed by reading the live
migration body), unlike `get_moderation_queue()`/`list_editorial_queue()`, which both added a
`count(*) over()` column. Adding one here would itself be a new migration, out of scope for a stage
that otherwise needs none.

**Judgment call on the review-page link target:** each report row links to
`/moderation/stories/[report.published_revision_id]`, not a re-derived "story's current submitted
revision." `story_reports.published_revision_id` is snapshotted once, at report-creation time
(`create_story_report()` requires the target to currently be public/published, and inserts the
story's live `published_revision_id` at that moment), and is never updated afterward (the column's
FK is `on delete restrict`, and no function ever writes to it after insert — grepped). This is
deliberately the correct target: a report is about what a reader actually saw and flagged, i.e. the
live published content, not whatever unrelated draft/replacement might separately be in flight for
the same story. Confirmed both `get_story_for_moderator()` and `can_view_moderation_review()` place
no `revision_status` filter on their lookups (read both function bodies directly), so this link
resolves correctly regardless of whether that revision is still the current publication or has since
been superseded — exactly what a moderator triaging a historical report needs to see.

`app/(moderation)/moderation/reports/[id]/page.tsx` is a dedicated detail/resolution page (not an
inline expand on the queue row) — same "own page, own `actions.ts`" shape as
`app/(moderation)/moderation/stories/[id]/`, chosen so it has its own bookmarkable URL and Server
Action target. **A genuine constraint found while wiring this up**: `list_reports_for_staff()` has
no by-report-id filter (only status/category/date-range/story — confirmed by reading its full
parameter list), and its `p_limit` is clamped to `[1, 50]` server-side, so an unscoped "fetch
everything and find the matching id" would silently miss any report past the first page. Rather than
add a new by-id RPC for this (a new migration, out of this stage's otherwise-zero-migration scope),
the detail page requires a `storyId` query parameter — populated by the queue page's own link, which
already has `row.story_id` in hand — and re-fetches scoped with the existing `p_story_id` filter,
the same filter the story review page already uses for a story's own reports. A direct/bookmarked
visit without `storyId` gets a clear "go back to the queue" message rather than an unscoped scan or
a confusing 404.

`getReportNotes()`'s result (private internal notes) is read only inside this page, server-side —
grepped the whole repo and confirmed this is the only call site anywhere. It is never passed through
any prop, cache, or response reachable from a reporter/contributor/public surface; the resolution
form (`resolve-form.tsx`) never receives note _contents_ from a prior report, only the category/
current status needed to compute whether a note is required for the next transition.

### Resolution Server Action and the note-requirement mirror

`app/(moderation)/moderation/reports/[id]/actions.ts#resolveReportAction()` — same independent
`resolveStaffAccess(await getCurrentUserRole(), ["moderator", "admin"])` re-check every other Server
Action in this route group performs, Zod-validates via the existing `resolveReportSchema`, calls
`resolveReport()`. A new pure helper, `reportNoteRequired(category, status)` in
`lib/validation/moderation.ts`, mirrors `resolve_report()`'s own note-requirement rule (non-empty
note required only when closing — `resolved`/`dismissed`, never `reviewing` — one of the four
serious categories) for the client-side `required` attribute on the note textarea
(`resolve-form.tsx`). This is a fast/friendly UI check only; `resolve_report()` itself remains the
actual, non-bypassable source of truth (Engineering Rule 3) — unit-tested directly in
`lib/validation/moderation.test.ts` against every combination (serious/non-serious ×
reviewing/resolved/dismissed).

### Per-row existence check: a deliberate, documented gap

`STAFF_MODERATION_PATH` in `proxy.ts` already gates `/moderation/reports` and
`/moderation/reports/[id]` with the same flat moderator/admin role check as every other
`/moderation` route — this fully covers authorization here, since (unlike a story's editor-scoped
draft) **any** moderator/admin may view **any** report; there is no per-row authorization narrower
than role to enforce. What the established `MODERATION_REVIEW_PAGE_PATH`/
`can_view_moderation_review()` pattern additionally buys the story review page is a real HTTP 404
for a nonexistent _id_, guarding against the documented "a page-based `notFound()` deep in an RSC
tree doesn't always set a real HTTP status" bug class this codebase has found and fixed more than
once (public story/contributor pages, the editorial/self-service edit pages). `/moderation/reports/
[id]` has no equivalent middleware-level existence check — adding one would need a new,
narrow "does this report exist" RPC (there isn't one today), which is a new migration, and this
stage otherwise needs none. **Flagged as a real, accepted gap, not silently built around**: the
practical risk is low (the affected population is already role-gated to moderator/admin only, so
this is a possible wrong-status-code edge case for a same-role staff member hitting a bogus id, not
a cross-role information leak), but a future stage adding any new per-row moderation RPC should
consider folding a lightweight existence check in at the same time.

### Recovery hardening

Reviewed against the brief's own list of recovery scenarios:

- **Partial public-media copy / failed finalization**: `runApproveOrchestration()`'s existing
  stop-and-leave-`active` contract (see "Approve-flow orchestration" above) is sufficient as-is — a
  moderator re-clicking "Approve and publish" on the same review page naturally retries the whole
  begin→copy→finalize loop, and `begin_story_publication_attempt()`/`finalize_story_publication()`
  are both re-entrant by design (a fresh attempt id is minted each time; already-`promoted` media is
  skipped by the copy loop's own `processingState !== 'promoted'` filter). No new UI was added for
  this — the brief's own framing ("versus just re-clicking Approve") already anticipated that this
  is likely sufficient, and confirming that by re-reading `publish-orchestration.ts` and its test
  file was this session's actual verification step, not new code.
- **Orphan copy-attempt/reservation objects**: already covered by Prompt 4's
  `supabase/migrations/20260804090800_maintenance_reconciliation_functions.sql` (service_role-only
  `maintenance_cancel_abandoned_reservation()`/`maintenance_resolve_orphaned_copy_attempt()`) plus
  `scripts/cleanup-abandoned-media-uploads.mjs` — confirmed these still exist and are unchanged;
  nothing rebuilt.
- **Repeated approval requests**: idempotent by design, confirmed by re-reading
  `begin_story_publication_attempt()` (a partial unique index allows only one active attempt per
  revision) and `finalize_story_publication()` — not re-litigated.
- **Archive/withdrawal cleanup retries**: both `archive_story()` and `revoke_publication_consent()`
  lock and version-check the story row before acting, and their audit inserts
  (`story_publication_state_actions`) are a plain append, not a state machine with its own
  failure mode — confirmed idempotent-enough (a retried archive on an already-archived story simply
  fails the version/state check with a clear error, it doesn't corrupt anything), not re-litigated.
- **Cache-invalidation failure — a real, found gap, fixed this stage**:
  `app/(moderation)/moderation/stories/[id]/actions.ts` called
  `invalidateStoryPublicCache(slug)` directly (no `try`/`catch`) immediately after a successful
  `approveStoryAction()`/`archiveStoryAction()` database mutation. `invalidateStoryPublicCache()`
  calls Next's `revalidatePath()` several times in a row; if that ever throws (a framework-level
  hiccup unrelated to whether the underlying publish/archive succeeded), the exception would
  propagate out of the Server Action, surfacing as an unhandled error to the moderator even though
  the DB mutation had already committed — a successful publish/archive would look like a failure.
  Fixed with a new `invalidatePublicCacheSafely(slug, action)` wrapper in that same file: catches
  and logs (via the new `lib/log.ts#logStaffAction()`, below) rather than letting the exception
  propagate, so a cache-invalidation hiccup can never mask a successful mutation. The public pages'
  own `revalidate = 60` window (documented in `lib/story/public-cache.ts`'s header comment) is the
  existing fallback if on-demand invalidation itself fails.

### Minimal structured operational logging

Grepped the whole repo first (no `console.error`/logger convention exists anywhere outside test
files) — this stage adds one new, deliberately small module, `lib/log.ts#logStaffAction()`, a single
function taking `{ actor, action, target, outcome, detail? }` and emitting one JSON line via
`console.log`/`console.error` depending on outcome. This is operational visibility only, not a
second audit system — the DB audit tables (`moderation_actions`, `editorial_actions`,
`story_publication_state_actions`, `story_reports.handled_by`/`handled_at`) remain the actual source
of truth for "what happened and why." Never logs story bodies, secrets, tokens, or private note
contents — only a fixed actor id/action name/target id/outcome, matching this app's existing
audit-table philosophy. Wired into every protected action this stage touches: `approveStoryAction()`,
`moderateDecisionAction()`, `archiveStoryAction()` (all in `stories/[id]/actions.ts`),
`reassignEditorialStoryAction()` (`app/(editor)/editorial/reassign-actions.ts`), and the new
`resolveReportAction()`.

### Tests

`lib/validation/moderation.test.ts` gained coverage for `parseReportsQueueSearchParams()` (same
never-throws convention as the other two queue parsers), `resolveReportSchema`, and the new
`reportNoteRequired()` pure helper across every serious/non-serious × reviewing/resolved/dismissed
combination. No new RPC was added, so `tests/integration/story-rls.integration.test.ts` needed no
changes — Stage 1's own report-note/resolution coverage already exercises every RPC this stage's UI
calls. `e2e/reports-triage.spec.ts` added, following `e2e/moderation.spec.ts`'s own fixture pattern
(direct RPC calls through a signed-in client) — **not run this session**: unlike Stage 1/2, this
spec needs no unpushed migration to become runnable, but it still needs the same live-project
`SUPABASE_RLS_TEST_*` credential pool every other real e2e spec in this repo requires, and this
session does not run Playwright against the live project regardless.

## Content readiness, operational metrics, and launch tooling (Prompt 7)

Operational tooling for onboarding the founding catalogue safely — a per-story readiness
checklist, privacy-conscious admin counts, advisory (non-blocking) content-quality checks, a
same-story duplicate-image warning, an explicit "what's public" summary shown to a contributor
before they approve, and three new runbook docs. No bulk publication was built — every story is
still reviewed individually, per the brief's own constraint (see "No bulk publication" below).

### Two new migrations

- `supabase/migrations/20260806090000_content_readiness_and_metrics.sql` — new append-only
  `story_launch_verifications` table (RLS enabled, zero policies, same convention as every other
  story-domain table) + `record_story_launch_verification()` (editor/moderator/admin, requires the
  target story to actually be `published`, purely observational — it never touches
  `lifecycle_status` or any publication column); `get_content_readiness_queue()` (editor/moderator/
  admin, one row per story with every checklist signal computed from existing tables); and
  `get_operational_metrics()` (editor/moderator/admin, seven aggregate counts only — no per-user or
  per-story breakdown). Two disclosed simplifications, documented in the migration's own header
  comment rather than left implicit: (1) the brief's "attribution choice confirmed" / "publication
  consent complete" / "contributor approval complete" collapse to one boolean,
  `publication_consent_complete`, because `submit_revision_with_consent()` records all three
  atomically in one `story_publication_consents` row — there is no separate schema state to
  distinguish them; (2) `alt_text_complete` is currently structurally guaranteed true for any row
  that could exist at all (`story_revision_media_alt_text_required`, Prompt 3, already makes the
  failing case unrepresentable), kept anyway as a real guard against future constraint drift.
- `supabase/migrations/20260806090100_add_sha256_to_story_preview_media.sql` — `create or replace`
  (not `DROP`+`CREATE`; the `RETURNS TABLE` shape is unchanged, only the media `jsonb` gains a key)
  on `get_story_preview()`, adding `'sha256'` to each media object. Diffed against the live body via
  `execute_sql` (`pg_get_functiondef`) immediately before writing this migration, confirming it
  matched the last migration that had touched the function (`20260804092200`) exactly — the same
  "reconstruct from the live body, not a stale copy" discipline this codebase has needed more than
  once. sha256 is a hash of the already-processed, already-metadata-stripped derivative, never a
  storage path — safe to expose to the story's own owner/editor, which is who this function already
  authorizes.

Both applied via the Supabase MCP `apply_migration` tool; `get_advisors` reviewed afterward — only
the same, already-established `rls_enabled_no_policy` (on the new table) and
`authenticated_security_definer_function_executable` (on the two new functions) classes every other
`SECURITY DEFINER` function in this codebase already produces, nothing new. `types/database.ts`
regenerated via the MCP `generate_typescript_types` tool.

### Content readiness dashboard (`/readiness`)

A new, third staff route group — `app/(readiness)/readiness/` — reachable by **editor, moderator,
or admin**, not scoped to only one existing workspace, since readiness spans both editorial prep
and moderation state. `proxy.ts` gained `STAFF_READINESS_PATH`, mirroring
`STAFF_EDITORIAL_PATH`/`STAFF_MODERATION_PATH` exactly (same flat 404 for signed-out and
wrong-role); the layout's own role check is the defense-in-depth backstop, same split as every
other staff route group. `page.tsx` renders the operational-metrics summary
(`get_operational_metrics()`) above a filterable (source/lifecycle-status), paginated queue
(`get_content_readiness_queue()`) — each story shown as a checklist of ✓/○ items, never framed as
legal advice. A published story additionally shows a `<details>` disclosure
(`verify-form.tsx`, client) to record a launch verification (`record_story_launch_verification()`)
— desktop/mobile checkboxes + an optional note, purely observational. `editorial-nav.tsx` and
`moderation-nav.tsx` both gained a "Readiness" link for discoverability.

### Advisory content-quality checks

`lib/story/content-quality-checks.ts` — pure, no DB/network dependency, exporting
`runContentQualityChecks()`. Checks: thin body (word-count heuristic), unclear dates, missing
region/work type, absolute visa/employment claims ("guaranteed"), a specific street address or
live-location statement, potentially identifying details (email/phone/passport-ID-shaped strings),
employer accusations, excessive promotional links, images missing alt text, images with unresolved
rights. **Deliberately advisory-only, per the brief's own instruction** ("automated checks may flag
content but must not automatically decide publication") — nothing here blocks a save, a submission,
or an approval; it exists to prompt a human reviewer to look closer. Small, conservative regex word
lists — false positives are expected and fine (advisory), false negatives are far more likely given
the narrow lists; not wired into a page yet in this pass (a future prompt can surface these as
badges on the editorial/moderation review pages without touching this pure module).

### Duplicate-image warning

`components/story/image-upload-manager.tsx` now computes a same-story `sha256` collision check
(from the `sha256` field `get_story_preview()`/`getStoryPreview()` now returns per media item —
`lib/story/contributor-queries.ts#RevisionMediaItem` gained the field) and shows a small amber
"Possible duplicate" note under any image whose hash matches another already-attached image in the
same story. Advisory only — an editor may legitimately want the same photo attached twice (e.g. a
differently-cropped version later reuses the same original bytes before cropping).

### "What's public" summary

`components/story/whats-public-summary.tsx` — a plain-language, human-readable list of exactly what
a reader will see if this story is approved (attribution text + type, title/excerpt/body, the trip
metadata fields, image count and caption count), shown above the contributor's own approve/submit
panel on the private preview page (`app/(contributor)/stories/[id]/preview/page.tsx`). Deliberately
reads only from `get_story_preview()`'s existing return shape — never queries
`story_revision_editor_notes`/`moderation_action_notes`/`story_publication_consent_notes`, so
internal editorial/moderation notes are structurally unreachable from this component, not merely
omitted by convention.

### A real bug found and fixed via live e2e testing: the confirmation that vanishes

Building `e2e/founding-story-workflow.spec.ts` (below) reproduced, live, the exact bug class Prompt
6 Stage 3 already found and fixed twice (`review-controls.tsx`, `resolve-form.tsx`): a Server
Component page conditionally renders `{someServerComputedBoolean && <ClientPanel/>}`; the panel's
own successful Server Action call triggers `revalidatePath()`, which flips that boolean on the very
next render (because the mutation it just performed changed the underlying state); React then
unmounts the whole panel — discarding whatever success/error message it was about to show — before
a human (or Playwright) can ever observe it. Concretely: `preview/page.tsx`'s
`isAwaitingThisContributorsApproval` flips `false` the instant the contributor's own "Approve &
submit for moderation" click succeeds (the story's `lifecycle_status` moves off
`awaiting_contributor_approval`), unmounting `ContributorReviewPanel` — and its confirmation message
— immediately. The self-service `canSubmitOwnConsent`/`SubmitConsentPanel` pairing has the identical
structural flaw.

Fixed with a new, narrow, reusable primitive, `components/sticky-visible.tsx#StickyVisible`: a
client component whose mount decision is taken once, from the initial `show` prop, via
`useState(show)`, and never re-derived from later prop changes — so a later server re-render that
would have unmounted the panel instead leaves it (and whatever it's currently showing) alone.
`preview/page.tsx`'s three previously-inline `{cond && <div>...}` blocks (the "what's public"
summary, `ContributorReviewPanel`, `SubmitConsentPanel`) are now all wrapped in
`<StickyVisible show={cond}>`. Confirmed live: `e2e/founding-story-workflow.spec.ts` failed with
this exact symptom (the confirmation `getByRole("status")` never appearing) before the fix, and
passes after it — the full 37-spec Playwright suite was re-run afterward with zero regressions.

### No bulk publication

Per the brief's own explicit constraint, no bulk-publish/bulk-approve/bulk-moderate function or UI
was built — every story is still reviewed individually. `lib/story/no-bulk-publication.test.ts` is
a structural regression test (not a UI assertion): it fails the moment any bulk-shaped
publish/approve/moderate function name appears anywhere in `lib/story/` or the generated Supabase
RPC surface (`types/database.ts`), regardless of whether it's ever wired into a page. The two
scoped bulk-metadata-operation and staff-directory-picker ideas the brief floated as optional were
deliberately not built this pass (out of scope, not silently dropped — see
docs/implementation-status.md "Prompt 7 detail").

### Documentation

`docs/founding-catalogue-runbook.md` (the 12-step process, referencing `/readiness` throughout
rather than duplicating its checklist), `docs/content-inventory-template.md` (a tracking template,
explicitly instructed to live outside this repository — it will hold real contributor references),
`docs/launch-content-checklist.md` (a final per-story and per-batch gate before calling a launch
"done"). None of these three files are legal advice — each says so explicitly.

### Tests

`lib/story/content-quality-checks.test.ts` (13 cases, one per heuristic plus a clean-story
baseline), `components/story/whats-public-summary.test.tsx` (4 cases), `lib/validation/readiness.test.ts`
(search-param parser + the launch-verification Zod schema), `lib/story/no-bulk-publication.test.ts`
(the structural regression test above). `e2e/founding-story-workflow.spec.ts` — the "critical
Playwright founding-story workflow" acceptance criterion: signs in as the fixed `editor`/`owner`/
`moderator` test accounts, drives the real UI through editor import → save → "Mark ready for
contributor review" → the linked contributor's own "Approve & submit for moderation" → moderator
"Approve and publish" → confirms the finished story appears correctly in `/readiness` with
consent/editorial-review both checked. **Run and passing live** (`--workers=1`, same shared-queue
reasoning as `e2e/moderation.spec.ts`), including surfacing and proving the fix for the
"vanishing confirmation" bug above. `npm run test:rls` re-run afterward: still 69/69, unaffected
(this prompt's only SQL changes are additive/read-only). `npm run verify`: 212/212 unit tests (up
from 182), 33-route build (up from 32).

## Landing page rebuild — card-stack carousel, discovery sections, and manual theming

Full rebuild of the public home page (`app/(public)/page.tsx`) from a supplied design mockup
(`journiq_landing_page_card_stack.html`), going beyond the earlier scroll-snap carousel prompt
(`docs/landing-page-carousel-implementation-prompt.md`). Guardrail decisions made explicit up
front (design-brief anti-patterns, MVP non-goals): no hotlinked stock photography anywhere, no
newsletter (no backend for it), no hardcoded region names, no fabricated stats.

### Card-stack carousel

`components/home/featured-story-stack.tsx` (`"use client"`) replaces the previous scroll-snap
`FeaturedStoryCarousel`. Depth-layered cards (`data-active`, up to 4 visible depths) driven by
pointer-event drag with a throw-past-threshold/velocity animation, plus prev/next buttons, dots,
and arrow-key support. The composed transform (base depth position + live drag offset) is
expressed as CSS custom properties in `app/globals.css` (`.story-stack-card` and its
`is-dragging`/`is-throwing-left`/`is-throwing-right` variants) since Tailwind utilities can't
express that calc() directly; the throw variants use `!important` so they override the depth-based
base rule regardless of which depth a card's index recomputes to after the slide index changes.
`components/home/featured-story-slide.tsx` is the two-pane (cover photo + copy) card face —
presentational only, reuses `firstRegionLabel`/`stringList` (`lib/story/card-fields.ts`),
`getPublicImageUrl`, and `AttributionChip`, same "no photo" fallback and stretched-link pattern as
`StoryCard`.

### Discovery sections

- `components/home/story-filter-grid.tsx` — client-side chip filter over an already-fetched story
  batch; chip labels are whichever work-type/tag names actually appear in that batch (never
  hardcoded), so a chip never yields zero results.
- `components/home/region-explorer.tsx` — real `regions`/`destinations` (`listPublicRegions()`/
  `listPublicDestinations()`), restricted to regions that appear in the fetched story batch, each
  linking to `/stories?region=<id>` (the existing filter param `parseStorySearchParams` already
  handles). No photography, no fabricated counts.
- `components/home/destination-quiz.tsx` + `lib/story/region-match.ts` — a 4-question quiz whose
  answers carry trait signals (real `work_types`/`tags` names), scored against the fetched stories'
  own `regions`/`work_types`/`tags` by `matchRegion()` (pure function, unit-tested). No region name
  is hardcoded in the quiz; if nothing matches, it degrades to a plain "browse all stories" link
  rather than fabricating a result. `lib/story/card-fields.ts` gained `regionNames()` (every region
  name a story is tagged with, not just the first) to support both this and the region explorer.

### Manual theme toggle

`app/globals.css` moved from `@media (prefers-color-scheme: dark)`-only tokens to a
`data-theme="light"|"dark"` attribute model — `:root[data-theme="dark"]` outranks the plain
`:root` pseudo-class regardless of source order or the media query, so an explicit choice always
wins. `app/layout.tsx` sets `data-theme` via a blocking inline `<script>` in `<head>` (reads
`localStorage["journiq-theme"]`, falls back to `matchMedia`) before first paint, avoiding both a
flash of the wrong theme and a hydration mismatch. `components/theme-toggle.tsx` (`"use client"`)
toggles the attribute and persists the choice; wired into `components/site-header.tsx` (both the
desktop `<nav>` and the mobile-only control row) since it's a site-wide control, not homepage-only.

## Roadmap (corrected)

- **Prompt 4 — complete.** Editor/self-service authoring UI, image upload, storage buckets,
  contributor approval flow. Sub-phase 2 (storage, admin client, media pipeline, publication
  backend), Sub-phase 3 (self-service authoring/drafting/preview UI), Sub-phase 4 (editorial
  import, consent/approval UI — all migrations pushed and live-verified), and Sub-phase 5 (the
  cross-contributor UI-level access test, the per-row `notFound()`-as-200 fix it found, and this
  final docs pass) are all done — see "Media processing and publication pipeline", "Self-service
  authoring UI", "Editorial import + consent/approval UI", and the Playwright bullet in "Testing
  strategy" above.
- **Prompt 5 — complete.** Public discovery (browse/filter/search, story/contributor detail pages),
  SEO (metadata, canonical, JSON-LD, sitemap, robots), and reader reporting UI — see "Public
  discovery and SEO (Prompt 5)" above for the full account, including the contributor-table grant
  fix, the public per-row 404 fix, and the bare-identifier bug corrective migration.
- **Prompt 6 — complete, all 3 stages.** Stage 1 (backend/migrations), Stage 2 (queue/review UI +
  orchestration), and Stage 3 (reports-triage UI, moderation guidelines doc, recovery-hardening
  review) are all done. All 10 migrations (including Stage 2's slug/story_version on
  `get_story_for_moderator()` and `can_view_moderation_review()`) are pushed and live-verified
  (`test:rls` 69/69) — see "Editorial and moderation workspace backend (Prompt 6 Stage 1)",
  "Moderation/editorial workspace UI and orchestration (Prompt 6 Stage 2)", and "Reports triage and
  operational hardening (Prompt 6 Stage 3)" above.
- **Prompt 7 — complete.** Content readiness dashboard (`/readiness`), operational metrics,
  advisory content-quality checks, same-story duplicate-image warnings, an explicit "what's public"
  contributor summary, and three founding-catalogue runbook docs. 2 migrations pushed and
  live-verified (`test:rls` 69/69, unchanged). `e2e/founding-story-workflow.spec.ts` run live,
  found and fixed a real "vanishing confirmation" bug (`components/sticky-visible.tsx`) — see
  "Content readiness, operational metrics, and launch tooling (Prompt 7)" above.

## Deployment assumptions

- No deployment or push is performed as part of this task.
- Target hosting is assumed to be Vercel (Next.js) + Supabase-hosted Postgres/Auth/Storage — still
  an assumption to confirm, see [docs/implementation-status.md](implementation-status.md).
