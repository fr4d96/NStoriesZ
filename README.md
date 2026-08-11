# Kakinotes

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
- **Prompt 4 — Actual authoring (complete, all 5 stages done; merged to `main`).** Letting
  contributors and editors write and publish stories with images.
  - Stage 1 (done): story text now supports bold, italic, and links.
  - Stage 2 (done): the full image-upload pipeline — private staging for in-progress uploads, a
    processing step that strips personal metadata (GPS, etc.) and resizes photos, and a public
    area only for approved images — plus the actual "publish a story" mechanism, designed so a
    story can never go public with an unprocessed or unapproved image. Live-tested (25/25
    tests); two real bugs found and fixed.
  - Stage 3 (done): the actual screens — a real writing editor (bold/italic/links/headings/
    lists/quotes, nothing else), image upload with captions and reordering, and a private
    "see exactly what this will look like" preview page only the contributor (and staff) can
    see. Verified with 112/112 automated tests, a manual mobile check of every new page, and a
    real signed-in walkthrough (sign in, write a story, format it, save, preview) against the
    live database. Two real bugs found this way and fixed: a missing way to read back a story's
    chosen regions/work types/tags on page reload (now live), and a formatting bug where bolding
    a word mid-sentence silently deleted the spaces around it (confirmed fixed by re-testing the
    exact scenario live). A real image upload still wasn't tested end-to-end — no test image
    file in this environment — left for the final testing stage.
  - Stage 4 (done): the staff side. Editors can now prepare a story on someone else's behalf —
    including pasting in existing text or HTML and having it automatically cleaned up and
    reformatted to match the site's writing style — for the founding collection of
    already-written stories. The person the story is actually about can then review it, approve
    it, ask for changes, or turn it down from their own account. Also added: a proper audit
    trail every time a writer's account gets linked to their identity record, and a "the terms
    changed since you last agreed, please confirm again" safety check. Live-tested (33/33 tests)
    against the real database, plus real end-to-end browser tests including an actual image
    upload for the first time. Two real security bugs found and fixed after the first round of
    testing: one where any signed-in visitor could have overwritten someone else's private
    draft, and one where a database read was ambiguous in a way that broke access for assigned
    editors — both confirmed live before and after the fix.
  - Stage 5 (done): a new automated browser test signs in as one real account, starts a story,
    then signs in as a **second, separate** real account and tries to open the first account's
    story through the actual screens — the missing piece the earlier stages had flagged. It found
    a real problem on the first try: visiting someone else's story-edit or preview page as an
    unrelated signed-in account returned a normal-looking "200 OK" instead of a real "not found" —
    the same shape of issue Stage 4 found and fixed for signed-out visitors to the editorial area,
    just for a signed-in stranger with no connection to that specific story. No private content
    was ever shown, just the wrong status code. Fixed the same way as before (moved the "are you
    allowed to see this" check earlier, before any page content is prepared) across all three
    affected screens; confirmed fixed by checking the real response codes again afterward, for
    both the stranger (now correctly blocked) and the legitimate owner/editor (unaffected).
  - **Prompt 4 is now fully done.** Next up: Prompt 5 (public browsing/search) and Prompt 6
    (moderator review dashboard).
- **Prompt 5 — Public browsing & search (complete; merged to `main`).** The actual public-facing
  site: a homepage, a browsable/filterable story list (region, work type, tags, cost band, search),
  individual story and contributor pages, and the search-engine plumbing (sitemap, robots.txt,
  structured data) so the site can actually be found and indexed. Live-tested (44/44 database tests,
  24/24 browser tests, 153/153 unit tests). Found and fixed three real things along the way: a gap
  where anonymous visitors could read contributor records directly instead of through the intended
  filtered view; a page that returned "200 OK" for a story or contributor page that didn't exist,
  instead of a proper "not found" (the same category of bug found and fixed twice in Prompt 4, this
  time on a public page); and a database bug that broke the very first real page that ever called a
  particular search function (caught by the site failing to build, not silently).
- **Prompt 6 — Editorial & moderation workspace (complete, all 3 stages plus live browser
  verification; merged to `main`).** The staff tools for reviewing, approving, and moderating
  stories, plus a proper reports-triage system for reader-submitted flags.
  - **Stage 1 (backend):** the underlying rules and data — archiving a story now requires a written
    reason, an editor can be reassigned to a different story with a recorded audit trail, and a
    moderator resolving a reader's report on a serious issue (misinformation, harassment, unsafe
    advice, copyright/privacy) must now leave a private note explaining the decision before closing
    it. Also tightened: moderators used to be able to read raw contributor account records directly;
    now they only see the attribution info actually needed for review. Live-tested (69/69 database
    tests). One real bug caught and fixed before anything went live: a reassignment check that would
    have silently let any editor hand an unclaimed story to someone else, when only an admin should
    be able to do that.
  - **Stage 2 (the actual screens):** real moderation and editorial dashboards, replacing the
    placeholder pages that used to just say "not built yet." A moderator can now filter and page
    through submitted stories (labeled as first submissions, replacements, or resubmissions),
    open one to see exactly what was submitted — including a side-by-side comparison against
    what's currently public, if this is a replacement — and approve, reject, or request changes,
    each with its own required or optional reason. Approving a story now runs through a proper
    multi-step process (start the approval, copy each new photo to public storage, then finalize)
    designed so a failure partway through never leaves something half-published — it just leaves the
    attempt safely resumable. Editors got a real filterable queue too, plus the ability to reassign a
    story to a different editor.
  - **Stage 3 (reports triage + polish):** a dedicated page for reviewing reader-submitted reports,
    with filters, a private-notes system staff can use to record why a report was resolved (never
    visible to the person who reported it), and a full written guide for moderators covering things
    like misinformation, harassment, copyright, and when to escalate to an admin — plus a fix for a
    subtle bug where a successful approve/archive action's confirmation message could get silently
    replaced by the page refreshing before anyone saw it.
  - **Then verified for real, in a real browser, against the real database** (not just automated
    database checks): 12 out of 12 browser tests passed, and this caught two more genuine bugs no
    amount of code review had caught — (1) an editor got a real error page just from visiting their
    own story's edit screen, because a database function meant to also let editors see their own
    prep history had accidentally been left moderator-only; and (2) the same "confirmation message
    disappears before you can see it" bug from Stage 3, this time on the main approve/reject screen.
    Both fixed and re-verified live before anything was merged.
