# WHV Compass NZ

A public platform for detailed, written first-person stories from Working Holiday Visa travellers
in New Zealand. See [docs/product-spec.md](docs/product-spec.md) for what this is and isn't.

Start with [CLAUDE.md](CLAUDE.md) — product context, engineering rules, commands, and the
Definition of Done — and [docs/implementation-status.md](docs/implementation-status.md) for what's
actually built versus planned (or
[docs/implementation-status-human.md](docs/implementation-status-human.md) for a plain-language
version of the same thing).

## Getting started

```bash
cp .env.example .env.local   # fill in a Supabase development project's values
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

See [docs/architecture.md](docs/architecture.md) for the full application, auth, and database
workflow, including the local-vs-hosted Supabase development setup.

## Changelog

Plain-language summary of what's been built, prompt by prompt. Full technical detail lives in
[docs/implementation-status.md](docs/implementation-status.md); the same summary in longer form
lives in [docs/implementation-status-human.md](docs/implementation-status-human.md), which is
updated after every prompt or sub-phase.

- **Prompt 0 — Foundations doc.** Baseline documentation (rules, architecture,
  content-governance policy) written before any code existed.
- **Prompt 1 — App skeleton.** Basic Next.js app shell, pages, layout, quality tooling, and
  Supabase wiring. Blocked on one thing: no Docker on this machine, so the local Supabase test
  stack has never been run — everything else works.
- **Prompt 2 — Sign-in & accounts.** Sign up, sign in, password reset, automatic profiles, four
  user roles (user/editor/moderator/admin), and a contributor identity separate from login
  accounts. Live-tested against the real Supabase project; one real bug found and fixed
  (deleting a linked user was broken).
- **Prompt 3 — The story data model.** The full database structure for stories: drafts,
  submissions, moderation decisions, publishing, images, consent records, reader reports.
  Nobody — not even an admin — can read or write these tables directly; every action goes
  through a guarded function that re-checks permissions. Live-tested end-to-end (23/23 tests);
  3 real security bugs found and fixed, including one that would have let a stranger overwrite
  someone else's private draft.
- **Prompt 4 — Actual authoring (in progress, 3 of 5 stages done).** Letting contributors and
  editors write and publish stories with images.
  - Stage 1 (done): story text now supports bold, italic, and links.
  - Stage 2 (done): the full image-upload pipeline — private staging for in-progress uploads, a
    processing step that strips personal metadata (GPS, etc.) and resizes photos, and a public
    area only for approved images — plus the actual "publish a story" mechanism, designed so a
    story can never go public with an unprocessed or unapproved image. Live-tested (25/25
    tests); two real bugs found and fixed.
  - Stage 3 (done): the actual screens — a real writing editor (bold/italic/links/headings/
    lists/quotes, nothing else), image upload with captions and reordering, and a private
    "see exactly what this will look like" preview page only the contributor (and staff) can
    see. Verified with 110/110 automated tests and a manual mobile check of every new page;
    a real signed-in walkthrough and a real image upload weren't tested end-to-end because this
    environment has no live login credentials — that's left for the final testing stage. One
    small gap found along the way: the database was missing a way to read back a story's chosen
    regions/work types/tags on page reload, so a small addition is staged and waiting for a
    go-ahead before it goes live.
  - Stages 4–5 (not yet built): the staff screens for preparing someone else's story for
    publication and reviewing/approving it, plus final end-to-end tests and docs.
  - Next up after Prompt 4: Prompt 5 (public browsing/search) and Prompt 6 (moderator review
    dashboard).
