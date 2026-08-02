# Implementation Status — WHV Compass NZ

Read this before starting any task — it reflects what actually exists, not what is planned in
CLAUDE.md or docs/. Update it as part of the Definition of Done for every task.

Last updated: 2026-08-02.

## Status legend

`not started` · `in progress` · `blocked` · `complete`

## Prompt checklist

| #   | Prompt                                                                                                                                                                    | Status                                                                                                                            | Notes                                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0   | Repository inspection & documentation baseline                                                                                                                            | complete                                                                                                                          | CLAUDE.md and docs/ created against an empty repo.                                                                                                                                         |
| 1   | Application foundation (Next.js scaffold, Supabase client/proxy wiring, env validation, local DB workflow scaffolding, quality tooling, public shell + placeholder pages) | **Blocked — implementation complete, local Supabase runtime verification unavailable because no container runtime is installed.** | Limitation accepted by user 2026-08-02. See "Prompt 1 detail" below for exactly what's verified vs. blocked.                                                                               |
| 2   | Authentication, profiles, roles, and contributor identities                                                                                                               | not started                                                                                                                       | Redefined (per your instruction) to include the real sign-in flow, profiles/user_roles schema + RLS, and the contributor identity model — not just client wiring. This is the next prompt. |
| 3   | Core story schema & RLS (stories/story_revisions, images, consent/rights tables)                                                                                          | not started                                                                                                                       |                                                                                                                                                                                            |
| 4   | Storage buckets & policies (private draft bucket, public bucket, promotion strategy)                                                                                      | not started                                                                                                                       |                                                                                                                                                                                            |
| 5   | Public browsing (list/filter/detail, SEO, sitemap/robots scoped to approved stories)                                                                                      | not started                                                                                                                       |                                                                                                                                                                                            |
| 6   | Contributor drafting & private preview                                                                                                                                    | not started                                                                                                                       |                                                                                                                                                                                            |
| 7   | Editor import workflow + moderation queue (approve/reject)                                                                                                                | not started                                                                                                                       |                                                                                                                                                                                            |
| 8   | Reporting, operational launch tooling, and Playwright coverage of critical flows                                                                                          | not started                                                                                                                       |                                                                                                                                                                                            |

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
- No admin/service-role Supabase client and no secret-key env var yet — nothing in this codebase
  performs a privileged operation that would justify one.
- Global public/auth layouts never check the session (kept static/cache-friendly); only
  `(contributor)/layout.tsx` calls `getCurrentUser()`. Documented trade-off: the static header never
  reflects sign-in state.
- Editorial/Moderation/Admin: no nav entry anywhere; implemented as Route Handlers returning a flat
  404, not pages — a page-based `notFound()` was verified (via `curl`) to still return HTTP 200 when
  the route was prerendered/forced-dynamic, because the App Router streams the shell before the 404
  is attached. Route Handlers set the status directly and were verified to return 404.

## Risks

- **Container-runtime gap.** No Docker on this machine — local Supabase stack unverified (see
  Prompt 1 detail). Anyone continuing this project locally without Docker should use the hosted
  development path instead.
- **Global header never reflects auth state, by design.** A signed-in contributor visiting a public
  page still sees "Sign in" in the header. Acceptable for now; revisit if it becomes confusing UX.
- **Staff routes have no real role check yet.** They blanket-404 for everyone, which is correct
  fail-closed behavior today, but is not yet real authorization — Prompt 2/3 needs to replace this
  with actual role-gated pages once `user_roles` exists.
- **Content governance (docs/content-governance.md) describes deletion/withdrawal as needing
  explicit, human-reviewed handling** — real implementation cost not yet scoped into a specific
  prompt. Flag when scoping Prompt 3.
- **npm audit reports 3 high-severity advisories** in `postcss`/`sharp`, both transitive dependencies
  bundled inside `next@16.2.12` itself. `npm audit fix --force` would downgrade to `next@9.3.3` (a
  nonsensical, years-old regression) — not applied. No safe fix currently available; revisit when
  Next.js publishes a patched release.

## Open assumptions

1. Hosting target is assumed to be Vercel + Supabase-hosted Postgres/Auth/Storage — not confirmed.
2. ~~Package manager~~ — confirmed: npm.
3. No existing design system, brand colors, or logo were found — Tailwind v4 defaults used until
   supplied.
4. No existing Supabase project (project ref, keys) was found — assumed not yet created; `.env.local`
   in this environment holds well-formed placeholder values, not a real project.
5. The exact reporting/report-review workflow (Prompt 8) is scoped at "reader can flag, moderator
   re-reviews" per docs/content-governance.md; no dedicated report-triage UI is assumed for MVP
   beyond surfacing reports in the moderation queue.
6. ~~Pending confirmation on the container-runtime limitation~~ — confirmed 2026-08-02: user accepts
   Prompt 1's "blocked on container runtime" classification and wants to proceed to Prompt 2.

## Next prompt

**Prompt 2: Authentication, profiles, roles, and contributor identities** — real Supabase sign-in
(replacing the `/sign-in` placeholder), the `profiles`/`user_roles` schema with RLS, and the
contributor identity model. This also unblocks turning the Editorial/Moderation/Admin routes from
blanket 404s into real role-gated pages.
