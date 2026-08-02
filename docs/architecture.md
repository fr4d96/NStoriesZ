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
    my-stories/, stories/new/   # still placeholders — schema/RPCs exist (Prompt 3), UI is Prompt 4
    account/                    # real: profile form, contributor-identity form, sign-out
  (editor)/editorial/route.ts       # Route Handlers, not pages — see "Staff routes" below
  (moderation)/moderation/route.ts
  (admin)/admin/route.ts
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
components/
  site-header.tsx, site-footer.tsx, mobile-nav-toggle.tsx, contributor-nav.tsx,
  placeholder-page.tsx
proxy.ts                       # session-cookie refresh AND the redirect-to-sign-in-with-next
                                # decision for signed-out requests, matcher scoped to /my-stories,
                                # /stories/new, /account only
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

Target/deferred pieces not yet built: `stories/[slug]`, `contributors/[slug]`, `sitemap.ts`/
`robots.ts`, storage buckets and the real image-processing pipeline (`promote_story_media()` exists
but is deliberately ungranted until then), `lib/supabase/admin.ts` (no privileged operation exists
yet to justify a service-role client — see "Authentication boundaries" below), real
authoring/editorial/moderation UI (the schema and RPCs exist; `/stories/new`, `/my-stories`, and the
three staff routes are still placeholders/role-gated API stubs — see "Roadmap" below for exactly
which prompt builds each UI).

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

`/editorial`, `/moderation`, and `/admin` are still **Route Handlers** (`route.ts`), not pages, now
performing a real role check (`getCurrentUserRole()` + `resolveStaffAccess()`) instead of an
unconditional 404. The reason they stay Route Handlers is unchanged from Prompt 1: a page component
calling `next/navigation`'s `notFound()` gets streamed, and if the route is prerendered (or even
forced dynamic) the initial shell can flush as HTTP 200 before the 404 is attached deeper in the
render tree — verified directly during Prompt 1's build (`curl` showed `200 OK` for a page-based
`notFound()` even under `export const dynamic = "force-dynamic"`). A Route Handler sets the status
directly, with no rendering pipeline in between, so it reliably returns 404.

Anyone without the required role — including a perfectly valid session with the wrong role — gets
the identical flat 404 as a signed-out visitor; `resolveStaffAccess()`'s `{ ok: false }` case
deliberately carries no reason, so there is no behavioral difference to probe. Authorized staff
currently get a minimal JSON stub (`{ ok: true, role, message: "... not built yet" }`) — the real
editorial/moderation/admin UI is Prompt 7+. No navigation anywhere links to these routes yet.

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
  linked.
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

## Roadmap (corrected)

- **Prompt 4** — editor/self-service authoring UI, image upload, storage buckets, contributor
  approval flow (the schema, RLS, and RPCs this UI needs are done as of Prompt 3).
- **Prompt 5** — public discovery: browse/filter/detail pages, SEO, sitemap, cost-band UI (the exact
  cost-band thresholds are a Prompt 5 design decision — deliberately not invented in Prompt 3).
- **Prompt 6** — editorial and moderation workspace (queue UI, reports triage).

## Deployment assumptions

- No deployment or push is performed as part of this task.
- Target hosting is assumed to be Vercel (Next.js) + Supabase-hosted Postgres/Auth/Storage — still
  an assumption to confirm, see [docs/implementation-status.md](implementation-status.md).
