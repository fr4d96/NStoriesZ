# Architecture — WHV Compass NZ

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
    active-lookups.ts           # active-only regions/destinations/work_types/tags (Sub-phase 3)
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

### Known trade-off: moderator visibility into `contributors` is row-level, not column-level

The Prompt 2 brief asks that "moderators receive only the identity fields necessary for moderation."
`contributors` RLS currently grants moderators full-row SELECT (same as editor/admin) rather than a
column-restricted view, because Postgres RLS is row-level only — column-level restriction would need
either a dedicated view (with its own security-invoker semantics) or per-app-role Postgres roles
(which Supabase's single `authenticated` role for all signed-in users doesn't give us). Building that
properly is more scope than a role model with no moderation UI yet justifies. No moderation UI exists
until Prompt 7; when it's built, either add a `contributors_for_moderation` view exposing only
`id, display_name, public_slug, attribution_type, public_status, created_at`, or scope the query in
the moderation Server Action to those columns explicitly. Tracked as a risk in
[docs/implementation-status.md](implementation-status.md).

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
  with no exact dates is representable. `content_json` is a controlled block array —
  **text-only** (`paragraph`/`heading`/`quote`/`list`, see `lib/validation/story.ts`); there is no
  inline image block, deliberately — images render as an ordered gallery from
  `story_revision_media`, kept structurally separate to avoid duplicate captioned-image state.
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

**Cleanup is honest, not automatic**: `scripts/rls-test-cleanup.sql` (run via
`npm run test:rls:cleanup`, which reuses the exact same fail-closed guard) deletes, in the
dependency order the domain's `on delete restrict` foreign keys require, every row belonging to a
story whose slug matches `rls-test-%`. A commented-out full-truncate fallback exists for a dev
project that's drifted beyond scoped cleanup, gated by a second explicit env var
(`SUPABASE_RLS_TEST_CONFIRM_FULL_TRUNCATE`). Neither path touches `auth.users`/`profiles`/
`user_roles`/`contributors` — the fixed account pool must survive every cleanup run. Disposable
`regions`/`destinations` rows created by the destination-integrity test are **not** cleaned up
(lookup-table growth from a handful of test runs is a trivial, accepted cost, unlike story-domain
data). Every run otherwise leaves nothing behind once cleanup is run.

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
reported `File.type`), calls `begin_story_media_upload()`, uploads via the regular (RLS-respecting)
server client — never the admin client — to the reserved path, calls
`finalize_story_media_upload()`, and then calls `processStoryMedia()` **synchronously, in the same
request** — there is no background worker/queue in this phase, so the upload response doesn't
return until processing has actually finished (or recorded a specific failure). Any failure after
the reservation step (storage upload fails, `finalize_` rejects a stale version) cancels the
reservation (`cancelPendingStoryMediaUpload`) and best-effort removes any already-uploaded bytes,
so a failed request never leaves an orphaned `pending_upload` row for longer than the request
itself — the maintenance script below is a backstop for the cases that still slip through (e.g. the
client's connection dropping mid-request), not the primary cleanup path.

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
`listPublicRegions`/`listPublicDestinations`/`listPublicWorkTypes`/`listPublicTags`, kept separate
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
- **Prompt 6** — editorial and moderation workspace (queue UI, reports triage). Also owns the real
  publish/archive Server Actions that must call `lib/story/public-cache.ts`'s invalidation helpers
  (see "Caching and invalidation" above).

## Deployment assumptions

- No deployment or push is performed as part of this task.
- Target hosting is assumed to be Vercel (Next.js) + Supabase-hosted Postgres/Auth/Storage — still
  an assumption to confirm, see [docs/implementation-status.md](implementation-status.md).
