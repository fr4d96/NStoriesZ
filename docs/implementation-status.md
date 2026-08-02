# Implementation Status — WHV Compass NZ

Read this before starting any task — it reflects what actually exists, not what is planned in
CLAUDE.md or docs/. Update it as part of the Definition of Done for every task.

Last updated: 2026-08-02.

## Status legend

`not started` · `in progress` · `blocked` · `complete`

## Prompt checklist

| # | Prompt | Status | Notes |
|---|--------|--------|-------|
| 0 | Repository inspection & documentation baseline (this task) | complete | Repo was empty (no files, not a git repo). CLAUDE.md and docs/ created. No code, no Next.js/Supabase scaffold yet. |
| 1 | Project scaffold (Next.js App Router, TypeScript, Tailwind, ESLint, Vitest, Playwright config) | not started | |
| 2 | Supabase project wiring (SSR client factories, middleware, env vars, generated types placeholder) | not started | |
| 3 | Core schema & RLS (reference data, profiles/user_roles, stories/story_revisions, images, consent/rights tables) | not started | |
| 4 | Storage buckets & policies (private draft bucket, public bucket, promotion strategy) | not started | |
| 5 | Public browsing (list/filter/detail, SEO, sitemap/robots scoped to approved stories) | not started | |
| 6 | Contributor drafting & private preview | not started | |
| 7 | Editor import workflow + moderation queue (approve/reject) | not started | |
| 8 | Reporting, operational launch tooling, and Playwright coverage of critical flows | not started | |

## Decisions made so far

- Documentation-first approach for this task; no code, schema, or scaffolding introduced yet.
- Repository is not currently a git repository — no commit/version-control action was taken as part
  of this task (see Open assumptions).

## Risks

- **No version control yet.** All future migrations, RLS policies, and code changes should be tracked
  in git from the start (per Engineering Rule 8/Architecture testing strategy expectations around
  versioned migrations). Risk of losing work if scaffolding begins before `git init`.
- **No scaffold exists.** Every command listed in CLAUDE.md (`npm run dev`, etc.) is aspirational —
  running any of them today will fail. Do not assume tooling exists without checking `package.json`.
- **Content governance (docs/content-governance.md) describes deletion/withdrawal as needing explicit,
  human-reviewed handling** — this has real implementation cost (audit trail, soft-delete vs. hard
  delete semantics) that hasn't been scoped into a specific prompt yet. Flag when scoping Prompt 3.

## Open assumptions

Record any assumption made in the absence of explicit user direction; confirm or correct before
relying on it in implementation.

1. Hosting target is assumed to be Vercel + Supabase-hosted Postgres/Auth/Storage — not confirmed.
2. Package manager is assumed to be npm — not confirmed (could be pnpm/yarn).
3. No existing design system, brand colors, or logo were found — Tailwind defaults assumed until
   supplied.
4. No existing Supabase project (project ref, keys) was found — assumed not yet created.
5. `git init` was **not** performed as part of this task since it wasn't explicitly requested;
   assumed the user wants to decide when/how to initialize version control.
6. The exact reporting/report-review workflow (Prompt 8) is scoped at "reader can flag, moderator
   re-reviews" per docs/content-governance.md; no dedicated report-triage UI is assumed for MVP beyond
   surfacing reports in the moderation queue.

## Next prompt

See the exact recommended next prompt at the end of the completion report in this conversation
(Prompt 1: project scaffold). Do not start Prompt 1 without confirming assumptions 1–2 above with the
user, since they affect scaffold commands and config.
