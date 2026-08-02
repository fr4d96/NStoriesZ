# Implementation Status — WHV Compass NZ

Read this before starting any task — it reflects what actually exists, not what is planned in
CLAUDE.md or docs/. Update it as part of the Definition of Done for every task.

Last updated: 2026-08-02.

## Status legend

`not started` · `in progress` · `blocked` · `complete`

## Prompt checklist

| #   | Prompt                                                                                                                                                                    | Status                                                                                                                            | Notes                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 0   | Repository inspection & documentation baseline                                                                                                                            | complete                                                                                                                          | CLAUDE.md and docs/ created against an empty repo.                                                                      |
| 1   | Application foundation (Next.js scaffold, Supabase client/proxy wiring, env validation, local DB workflow scaffolding, quality tooling, public shell + placeholder pages) | **Blocked — implementation complete, local Supabase runtime verification unavailable because no container runtime is installed.** | Limitation accepted by user 2026-08-02. See "Prompt 1 detail" below for exactly what's verified vs. blocked.            |
| 2   | Authentication, profiles, roles, and contributor identities                                                                                                               | **complete — migrations applied and live-verified against a real linked Supabase project.**                                       | See "Prompt 2 detail" below for what was live-verified (including a real bug found and fixed), and the role/RLS matrix. |
| 3   | Core story schema & RLS (stories/story_revisions, images, consent/rights tables)                                                                                          | not started                                                                                                                       | This is the next prompt.                                                                                                |
| 4   | Storage buckets & policies (private draft bucket, public bucket, promotion strategy)                                                                                      | not started                                                                                                                       |                                                                                                                         |
| 5   | Public browsing (list/filter/detail, SEO, sitemap/robots scoped to approved stories)                                                                                      | not started                                                                                                                       |                                                                                                                         |
| 6   | Contributor drafting & private preview                                                                                                                                    | not started                                                                                                                       |                                                                                                                         |
| 7   | Editor import workflow + moderation queue (approve/reject)                                                                                                                | not started                                                                                                                       | Also where `/editorial` and `/moderation` get real UI instead of a role-gated JSON stub.                                |
| 8   | Reporting, operational launch tooling, and Playwright coverage of critical flows                                                                                          | not started                                                                                                                       |                                                                                                                         |

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

## Migration summary

All in `supabase/migrations/`, applied in filename order:

| File                                                   | Adds                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20260802085013_helpers.sql`                           | `public.set_updated_at()` — shared `updated_at` maintenance trigger function.                                                                                                                                                                                                                                                                     |
| `20260802085014_user_roles.sql`                        | `app_role` enum; `user_roles` table + RLS; `public.has_role()` (SECURITY DEFINER, used inside other tables' RLS); `public.admin_set_user_role()` (SECURITY DEFINER, the only post-creation role-change path).                                                                                                                                     |
| `20260802085015_profiles.sql`                          | `profiles` table + RLS (owner read/write; public read only when opted in with a slug).                                                                                                                                                                                                                                                            |
| `20260802085016_contributors.sql`                      | `attribution_type`, `contributor_status` enums; `contributors` table + RLS + `contributors_protect_privileged_fields()` trigger (blocks non-staff changes to `linked_user_id`/`created_by`/archiving).                                                                                                                                            |
| `20260802085017_contributor_links.sql`                 | `contributor_links` audit table (no direct-write RLS policy at all); `public.link_contributor_to_user()` (SECURITY DEFINER, editor/admin-only, the sole write path).                                                                                                                                                                              |
| `20260802085018_handle_new_user.sql`                   | `handle_new_user()` trigger on `auth.users` — creates the default `profiles` + `user_roles('user')` row for every new account, idempotently.                                                                                                                                                                                                      |
| `20260802093000_fix_contributors_unlink_on_delete.sql` | Fixes a bug found during live verification (see "Prompt 2 detail" above): `contributors_protect_privileged_fields()` now only blocks non-staff _assignment_ of `linked_user_id`, not clearing it to `null` — otherwise the `ON DELETE SET NULL` FK action itself got blocked, breaking user deletion for anyone with a linked contributor record. |

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
  moderation UI queries this table yet (Prompt 7), but must be tightened (view or scoped query) when
  that UI is built.
- **Sign-up and RLS/trigger behavior are live-verified (see "Prompt 2 detail"); the email-link
  round trip specifically is not.** Sign-up, self-escalation denial, and contributor-hijack denial
  were all exercised directly against the real Auth/PostgREST APIs. What's still unverified: actually
  clicking a real confirmation/reset email and landing on `/auth/callback` with a real `token_hash` —
  the redirect allow-list for that hasn't been confirmed configured on the project (see "Manual
  Supabase settings required"), so this is the next thing to check, not a re-litigation of the schema.
- **Content governance (docs/content-governance.md) describes deletion/withdrawal as needing
  explicit, human-reviewed handling** — real implementation cost not yet scoped into a specific
  prompt. Flag when scoping Prompt 3. Publication consent and image-rights confirmation records
  (also content-governance.md) are likewise Prompt 3+ — only the contributor identity model itself
  is implemented so far.
- **npm audit reports 3 high-severity advisories** in `postcss`/`sharp`, both transitive dependencies
  bundled inside `next@16.2.12` itself. `npm audit fix --force` would downgrade to `next@9.3.3` (a
  nonsensical, years-old regression) — not applied. No safe fix currently available; revisit when
  Next.js publishes a patched release.

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

**Prompt 3: Core story schema & RLS** — `stories` (identity + published-revision pointer) and
`story_revisions` (versioned content + draft/pending/approved/rejected/archived status), the images
table, and the publication-consent/image-rights confirmation records described in
docs/content-governance.md. This is what the `/stories/new` and `/my-stories` placeholders, and the
now-role-gated-but-content-free `/editorial` and `/moderation` stubs, actually need before Prompt 7
(the editor import + moderation UI) can be built on top of them.
