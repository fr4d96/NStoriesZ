# Architecture — WHV Compass NZ

Prompts 1 and 2 (application foundation; authentication, profiles, roles, and contributor identity)
are implemented — see [docs/implementation-status.md](implementation-status.md) for exactly what's
built versus planned. Sections below describe what actually exists today; deferred/target pieces are
marked as such.

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
    my-stories/, stories/new/   # still placeholders (Prompt 3+)
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
components/
  site-header.tsx, site-footer.tsx, mobile-nav-toggle.tsx, contributor-nav.tsx,
  placeholder-page.tsx
proxy.ts                       # session-cookie refresh AND the redirect-to-sign-in-with-next
                                # decision for signed-out requests, matcher scoped to /my-stories,
                                # /stories/new, /account only
supabase/
  config.toml, migrations/ (profiles, user_roles, contributors, contributor_links, triggers, RLS),
  seed.sql (fictional local-only seed data)
types/
  database.ts                  # GENERATED (npm run supabase:types:linked) against the real linked
                                # project — regenerate after every new migration, do not hand-edit
e2e/
  home.spec.ts                 # Playwright smoke test (public nav, staff-route 404s)
  auth.spec.ts                 # sign-up/in/forgot/reset pages render; protected-route redirect
                                # with safe next param; invalid callback link handling
```

Target/deferred pieces not yet built: `stories/[slug]`, `contributors/[slug]`, `sitemap.ts`/
`robots.ts`, `lib/story/`, `lib/images/`, `lib/supabase/admin.ts` (no privileged operation exists yet
to justify a service-role client — see "Authentication boundaries" below), real editorial/moderation
UI (the three staff routes are role-gated API stubs, not pages yet).

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

## Story revision strategy, storage strategy (target — Prompt 3+)

Unchanged from the original design, not yet implemented:

- `stories` (identity + published-revision pointer) vs. `story_revisions` (versioned content +
  status: draft/pending/approved/rejected/archived).
- Public SELECT policy on `story_revisions` matches only the approved, published revision — never a
  bare "latest" query.
- Two storage buckets (`story-images-private`, `story-images-public`); on approval, a server-side job
  strips metadata and promotes derivatives — draft originals never served publicly.

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
  well-formed placeholder values — without a live network call. Any future test that does need a
  real Supabase round trip must be explicitly named/tagged as an integration test; none exist yet.

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

## Deployment assumptions

- No deployment or push is performed as part of this task.
- Target hosting is assumed to be Vercel (Next.js) + Supabase-hosted Postgres/Auth/Storage — still
  an assumption to confirm, see [docs/implementation-status.md](implementation-status.md).
