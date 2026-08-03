# Implementation Status — Plain-Language Summary

This is a human-friendly companion to [docs/implementation-status.md](implementation-status.md),
which is the detailed, technical version. This file is updated after each prompt or sub-phase
finishes, so you can see what's been done without reading migration names and function
signatures.

Last updated: after Prompt 4, Sub-phase 3.

---

## Prompt 0 — Foundations doc

Set up the project's baseline documentation (rules, architecture, content-governance policy)
before any code existed.

## Prompt 1 — App skeleton

Built the basic Next.js app shell: pages, layout, quality tooling (linting, formatting, tests),
and the wiring to talk to Supabase. **Status: blocked on one thing** — this machine has no
Docker, so the _local_ Supabase test stack has never been run. Everything else works.

## Prompt 2 — Sign-in & accounts

People can now sign up, sign in, reset passwords, and get a profile automatically. Added the
four user roles (regular user, editor, moderator, admin) and a "contributor" identity separate
from login accounts. **Fully tested against your real Supabase project** — including confirming
a stranger can't promote themselves to admin, and can't hijack someone else's contributor
identity. Found and fixed one real bug along the way (deleting a linked user was broken).

## Prompt 3 — The story data model

Built the entire database structure for stories: drafts, submissions, moderation decisions,
publishing, images, consent records, and reader reports. The design principle here is strict:
**nobody, not even an admin, can read or write these tables directly** — every single action has
to go through a guarded function that re-checks who's allowed to do what. Live-tested end-to-end
(23/23 tests) against your real project, including catching and fixing 3 real security bugs (one
of which would have let any signed-in stranger overwrite someone else's private draft).

## Prompt 4 — Actual authoring (in progress, 3 of 5 stages done)

This is the current work: letting contributors and editors actually write and publish stories
with images.

- **Stage 1 (done):** Upgraded the story-text format so it supports bold, italic, and links, not
  just plain text.
- **Stage 2 (done):** Built the entire behind-the-scenes machinery for image uploads — a private
  storage area for uploads-in-progress, a processing step that strips personal metadata (like
  GPS location) from photos and resizes them, and a public storage area only for approved
  images. Also built the actual "publish a story" mechanism moderators will use — designed so a
  story can never accidentally go public with an unprocessed or unapproved image. All of this
  has been pushed live and tested against your real database (25/25 tests passing), and two real
  bugs were found and fixed in the process.
- **Stage 3 (done):** Built the actual screens. A contributor can now start a new story, write it
  in a real formatting toolbar (bold, italic, headings, bulleted/numbered lists, quotes, links —
  and nothing else; the toolbar is physically incapable of producing anything the database would
  reject), add and caption photos, choose which regions/work types/tags apply, and see a private
  "here's exactly what this will look like" preview page that only they (and staff) can open.
  Every save happens automatically in the background as they type, without ever losing their
  place if two tabs are open at once. Verified with 112 automated tests (up from 89) and by
  actually signing in with a real test account and writing a real story through the browser —
  title, formatted body, bold text — and watching it save and preview correctly against your
  real database. One small gap was found and fixed along the way: the database had no way to
  read back which regions/work types/tags a contributor had already picked when they reopened a
  draft — that fix has since been turned on for real, with your go-ahead. A second, more visible
  bug was also found this way and fixed immediately: bolding a word in the middle of a sentence
  (e.g. "picking **apples** in") was silently deleting the spaces around it, so it would have
  rendered as "picking**apples**in" — never caught by the automated tests because none of them
  happened to check a mid-sentence formatted word specifically. Confirmed fixed by re-testing the
  exact same scenario live afterward. **What still hasn't been tested**: the real photo-upload
  path end to end (this working environment can browse and type, but has no real image file to
  upload), and a second contributor account interacting with someone else's story — both wait for
  the final testing stage (Stage 5).
- **Not yet built:** the staff screens for preparing someone else's story for publication and for
  reviewing/approving submissions. That's stages 4–5, still to come.

### What's next

Stage 4: editor-assisted import for existing stories, plus the review/approval screens — then
stage 5 (final end-to-end tests and documentation). After Prompt 4 wraps up, Prompt 5 is public
browsing/search, and Prompt 6 is the moderator's review dashboard.
