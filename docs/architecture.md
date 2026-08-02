# Architecture — WHV Compass NZ

Prompt 1 (the application foundation) is implemented — see
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
    sign-in/page.tsx          # placeholder — no working sign-in flow yet
  (contributor)/
    layout.tsx                 # the ONLY place that resolves the session (getCurrentUser());
                                # redirects to /sign-in or renders its own contributor nav
    my-stories/, stories/new/, account/   # placeholders, auth already enforced by the layout
  (editor)/editorial/route.ts       # Route Handlers, not pages — see "Staff routes" below
  (moderation)/moderation/route.ts
  (admin)/admin/route.ts
lib/
  env.server.ts               # server-only, Zod-validated Supabase env vars
  supabase/
    client.ts                 # browser client (createBrowserClient)
    server.ts                 # server client (createServerClient, next/headers cookies)
  auth/
    get-current-user.ts       # server-only, cache()-wrapped getClaims() wrapper
    contributor-guard.ts      # pure redirect-decision function, unit-tested directly
components/
  site-header.tsx, site-footer.tsx, mobile-nav-toggle.tsx, contributor-nav.tsx,
  placeholder-page.tsx
proxy.ts                       # session-cookie refresh, matcher scoped to /my-stories,
                                # /stories/new, /account only
supabase/
  config.toml, migrations/ (empty), seed.sql (empty placeholder)
types/
  database.ts                  # hand-written placeholder — no schema exists yet
e2e/
  home.spec.ts                 # Playwright smoke test
```

Target/deferred pieces not yet built: `stories/[slug]`, `contributors/[slug]`, `sitemap.ts`/
`robots.ts`, `lib/validation/`, `lib/story/`, `lib/images/`, `lib/supabase/admin.ts`, real schema
under `supabase/migrations/`.

## Authentication boundaries

- Supabase Auth via `@supabase/ssr`, cookie-based sessions. **No client-stored JWT reliance.**
- **The public and auth layouts never check the session.** Only `app/(contributor)/layout.tsx`
  calls `getCurrentUser()` (which wraps `supabase.auth.getClaims()` in React's `cache()`). This is
  deliberate: it keeps every public page static and cache-friendly, at the cost of the global
  header never reflecting sign-in state — a signed-in contributor visiting `/about` still sees
  "Sign in" in the static header. The `(contributor)` layout renders its own nav instead, so there's
  no contradiction shown to a signed-in user in the one place that matters.
- `proxy.ts` refreshes the auth cookie, but its `matcher` is scoped to exactly the contributor
  routes (`/my-stories/:path*`, `/stories/new`, `/account/:path*`) — it does not run on public
  routes at all. There's no cookie-presence guessing; public traffic simply never invokes Supabase.
- Two Supabase client factories exist: `lib/supabase/client.ts` (browser, publishable key) and
  `lib/supabase/server.ts` (server, cookie-bound, per the current official `getAll`/`setAll`
  pattern — `setAll` is wrapped in try/catch because Server Components can't set cookies; the proxy
  is what actually persists a refreshed cookie).
- **No admin/service-role client exists yet.** Nothing in this codebase performs a privileged
  operation that would justify one. It lands, alongside its secret-key env var, with the first
  operation that actually needs it (e.g. image-derivative promotion in a later prompt).
- Roles (contributor / editor / moderator / admin) don't exist as data yet — see "Staff routes"
  below for how that gap is handled today.

## Staff routes (Editorial / Moderation / Admin) — fail closed, not role-gated

There is no role model yet, so `/editorial`, `/moderation`, and `/admin` are **Route Handlers**
(`route.ts`), not pages, that unconditionally return HTTP 404. This was a deliberate implementation
choice: a page component calling `next/navigation`'s `notFound()` gets streamed, and if the route is
prerendered (or even forced dynamic) the initial shell can flush as HTTP 200 before the 404 is
attached deeper in the render tree — verified directly during this build (`curl` showed `200 OK` for
a page-based `notFound()` even under `export const dynamic = "force-dynamic"`). A Route Handler
sets the status directly, with no rendering pipeline in between, so it reliably returns 404.

No navigation anywhere links to these routes. When real roles exist (Prompt 2+), these become
actual role-gated pages instead of blanket 404s.

## Data-access conventions (target — no schema exists yet)

- Every exposed table will have RLS enabled — no exceptions (Engineering Rule 3, non-negotiable per
  rule 21).
- Server Actions/Route Handlers will re-validate ownership, role, and state server-side even though
  RLS would also reject an unauthorized write — defense in depth per Engineering Rule 3.
- Client-supplied identifiers (contributor ID, story ID, revision ID, status) will only ever be used
  to _look up_ a row; the authorization decision comes from the authenticated session + RLS + a
  server-side re-check.
- All mutations that matter will go through Server Actions or Route Handlers — never direct
  client-side writes to Supabase tables.

## RLS strategy, story revision strategy, storage strategy (target — Prompt 2+)

Unchanged from the original design, not yet implemented:

- `profiles` (public-editable) vs. `user_roles` (protected: contributor/editor/moderator/admin) as
  separate tables, the latter writable only by privileged server-side logic.
- `stories` (identity + published-revision pointer) vs. `story_revisions` (versioned content +
  status: draft/pending/approved/rejected/archived).
- Public SELECT policy on `story_revisions` matches only the approved, published revision — never a
  bare "latest" query.
- Two storage buckets (`story-images-private`, `story-images-public`); on approval, a server-side job
  strips metadata and promotes derivatives — draft originals never served publicly.

## Local vs. hosted Supabase development

**Docker is not available in this environment**, so the local CLI stack (`supabase start`) has not
been run or verified here. Two supported paths exist:

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
  (`resolveContributorAccess`), not fragile rendering of async Server Component layouts.
- Playwright: one smoke spec (`e2e/home.spec.ts`) — home page loads with correct title/heading,
  every primary public nav link resolves without a 404, and the three staff routes return 404.
- `npm run verify` = format:check + lint + typecheck + test + build (non-destructive, no server).
  `npm run verify:full` adds the Playwright run, reusing the build `verify` already produced
  (Playwright's `webServer` is `npm run start` only — never rebuilds) so nothing builds twice.

## Deployment assumptions

- No deployment or push is performed as part of this task.
- Target hosting is assumed to be Vercel (Next.js) + Supabase-hosted Postgres/Auth/Storage — still
  an assumption to confirm, see [docs/implementation-status.md](implementation-status.md).
