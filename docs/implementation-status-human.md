# Implementation Status — Plain-Language Summary

This is a human-friendly companion to [docs/implementation-status.md](implementation-status.md),
which is the detailed, technical version. This file is updated after each prompt or sub-phase
finishes, so you can see what's been done without reading migration names and function
signatures.

Last updated: after Prompt 6, Stage 3 plus live browser verification (Prompt 6 now fully complete).

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

## Prompt 4 — Actual authoring (complete, all 5 stages done)

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
- **Stage 4 (done — database changes switched on, and two more real bugs found and fixed
  afterward):** The staff screens for preparing
  someone else's story for publication, and the screens a contributor uses to review and approve
  what an editor prepared for them.
  - A new "Editorial" area lets an editor start an import for a contributor (existing or brand
    new), paste in the contributor's original text or pasted rich text (from an email, a Word
    document, wherever) and see exactly how it will be cleaned up and converted before using it,
    manage which contributor accounts are linked to which login without ever exposing that link to
    the browser, mark a draft as "ready for the contributor to review," log a plain note about how
    permission was confirmed (this note by itself never counts as permission — it's just a
    record), and submit on the contributor's behalf when permission was confirmed by phone/email/in
    person rather than through their own account.
  - A contributor whose story an editor prepared now sees a clear "Review" button on their story
    list (previously there was no way to find this at all except by guessing a web address) and can
    approve it, ask for changes, or decline it outright from the same private preview page every
    contributor already uses.
  - Every contributor (self-service or editor-assisted) now also sees the actual "I confirm I have
    permission to publish this" checkboxes and submit button on that same preview page — this had
    been left out on purpose in Stage 3, which stopped at "here's what it'll look like."
  - **Two real, meaningful bugs were found and fixed while building this** (beyond one already
    known and expected gap): (1) the database function that lets a contributor actually approve a
    story an editor prepared for them was, until this fix, structurally incapable of ever
    succeeding — it would always refuse, with no error message pointing at why; found by tracing
    through exactly what "awaiting your approval" was supposed to let someone do. (2) if an editor
    ever unlinks a contributor's account and links it to someone else (a normal, audited action this
    stage adds), that new account could — before this fix — submit publication consent for a
    _different_ person's already-published self-written story, because one function only ever
    checked "is this the linked account" and never "is this actually the story's owner." Both are
    fixed in database migrations that are written and reviewed but **not yet turned on** (see below).
  - **A third thing found live, exactly the way it's supposed to be found**: after building the new
    editorial screens, a direct request to the editorial area's web address returned a normal-looking
    "200 OK" response for someone signed out — even though the actual page content correctly refused
    to show anything. That's a real gap (a scanner or search engine could tell staff pages exist even
    if it can't see inside them), matching a known failure mode this project had already written down
    and guarded against elsewhere. Fixed by moving the "are you allowed here" check earlier, into the
    traffic-cop layer that runs before any page content is even prepared — confirmed by literally
    requesting the page and checking the real response code, both by hand and with an automated test
    that now checks this for real going forward.
  - **All 5 of the above database changes were switched on** (an editor can now open a draft they're
    assigned to; contributor accounts can now only be linked/unlinked through a recorded, audited
    process; a database function now returns a value it previously discarded; plus the two bug fixes
    above), and then **two more real problems were found by actually testing the live result**, the
    same way the earlier bugs in this project were found — by running the real automated test suite
    against the real database, not just by reading the code:
    1. **A genuinely serious one**: fixing the "database function needed to return a value" item
       above required rebuilding that function from scratch, and the rebuild accidentally dropped a
       safety check an earlier prompt had already added — the one that stops a stranger from
       overwriting someone else's private story draft. For self-service stories specifically, that
       safety check went from "always works" to "silently does nothing," meaning **any signed-in
       user could have overwritten anyone else's draft**. Caught immediately, because the same test
       that would normally prove "a stranger cannot do this" was run for real and the hijack attempt
       actually succeeded, genuinely overwriting another account's story title in the live database.
       Fixed the same day, in a follow-up database change, before this was ever exposed to real
       users.
    2. **A smaller, more mechanical one**: the "editor can now open an assigned draft" fix from
       earlier used a name that collided with one the database already used internally for something
       else, which made the whole function break with an error the moment it was actually called for
       real (something that can't be caught just by reading the code — it only shows up when you
       actually run it). Fixed in the same follow-up.
       A third, related weak spot (not something that had actually gone wrong, just the same kind of
       fragile pattern as bug 1 above, found by double-checking every similar spot in the code after
       finding it once) was tightened up at the same time, as a precaution.
       After these three fixes, the full automated safety-test suite was run again and now **passes
       completely (33 out of 33 checks)**, including the specific "can a stranger hijack this draft"
       check that had actually failed before the fix.
  - The two new automated browser tests (a real photo upload through the real screens, and a "what
    if someone pastes way too much text" check) were then run for real against the live database and
    **all pass**. One of the test's own setup values was wrong in a harmless way (it pasted more
    paragraphs than the story format allows in one document, which is a real limit working as
    intended, not a bug) — fixed by adjusting the test to paste a normal amount of text instead.
- **Stage 5 (done):** The final round of end-to-end tests and documentation polish.
  - Built a new automated browser test that signs in as one real test account, starts a story, then
    signs in as a **second, completely separate** real test account and tries to open the first
    account's story through the actual screens — the edit page, the private preview page, and (as a
    spot-check) the equivalent editorial screen. This is the missing piece Stage 3 flagged: the
    database-level tests already proved a stranger can't read someone else's data, but nothing had
    proved the actual web pages behave the same way when a real signed-in stranger clicks through to
    them.
  - **This test found a real problem, live, on the first try.** Visiting someone else's story-edit
    or preview page as an unrelated signed-in account came back with a normal-looking "200 OK"
    response — the exact same shape of issue Stage 4 found and fixed for the editorial area's
    signed-out case, just for a different, more specific situation (a signed-in stranger with no
    connection to _this particular_ story, rather than someone with no staff role at all). No
    private content was ever actually shown — the page just returned the wrong status code and a
    generic error/not-found-looking screen instead of a proper "not found." Fixed the exact same way
    as before: moved the "are you actually allowed to see this specific story" check earlier, into
    the traffic-cop layer that runs before any page content is prepared, for all three affected
    screens. Confirmed fixed by literally requesting the pages again and checking the real response
    code, both for the stranger (now a real 404, as it should be) and for the legitimate
    owner/editor (still works normally, unaffected).
  - Fixed a formatting-only issue that was blocking a fully clean test run (some documentation files
    had drifted out of the project's auto-formatting style over past sessions) — no content changed,
    just whitespace/table layout.
  - Updated this document, the detailed technical version, the content-governance policy doc, and
    the architecture doc to reflect everything Prompt 4 actually shipped, replacing several
    now-outdated notes that still described earlier, since-superseded plans.
  - The handful of test-only story/contributor records created by this and earlier sessions'
    browser tests are still sitting in the real database — cleaning them up is a real deletion
    action against the live project, so it's being left for an explicit go-ahead rather than done
    automatically.

## Prompt 5 — Public browsing & search (complete)

This is where the site actually became a public website, not just a private authoring tool: a
homepage, a browsable and filterable story list (by region, work type, tags, cost band, and free-
text search), individual story and contributor pages, and the behind-the-scenes plumbing (sitemap,
robots.txt, structured data) that lets search engines actually find and index the site.

Live-tested against the real database and real browser: 44 out of 44 database-level safety checks
passed, 24 out of 24 real browser tests passed, and 153 out of 153 smaller automated tests passed.

Three real things were found and fixed along the way:

- Anonymous visitors could read contributor account records directly from the database, bypassing
  the intended public-facing view entirely — a gap left over from an earlier prompt, found by
  auditing what anonymous visitors could actually reach, not something this prompt introduced.
- Visiting a story or contributor page that doesn't exist returned a normal "200 OK" instead of a
  proper "not found" — the same shape of bug found and fixed twice already in Prompt 4, this time on
  a public-facing page rather than a staff one. Fixed the same way: check first, before any page
  content is prepared.
- A database bug broke the very first real page that ever called a particular search function — the
  site failed to build outright rather than silently misbehaving, which is exactly the point of
  testing with the real thing instead of just reading the code.

## Prompt 6 — Editorial & moderation workspace (complete, all 3 stages plus live browser

verification)

This is the staff side of the platform: the tools moderators use to review and approve or reject
submitted stories, the tools editors use to prepare and hand off stories, and a proper system for
handling reader-submitted reports.

**Stage 1 — the underlying rules.** Before building any screens, the actual business rules had to
exist in the database:

- Archiving (unpublishing) a story now requires a written reason — no more silent removals.
- An editor's assignment to a story can now be handed off to a different editor, with a recorded,
  auditable trail of who did it and why.
- When a moderator resolves a reader's report about something serious — misinformation, harassment,
  unsafe advice, a copyright or privacy concern — they must now leave a private note explaining the
  decision before the report can be closed. Less serious reports (spam, "other") don't require one.
- Moderators used to be able to read raw contributor account records directly from the database.
  That's now closed off entirely — moderators get exactly the attribution information they need for
  review, nothing more, sourced from the actual consent record rather than a live account lookup.

Live-tested against the real database: 69 out of 69 checks passed. One real, if narrow, bug was
caught and fixed _before_ anything went live: a reassignment safety check had a subtle logic gap
that would have silently let any editor hand an unclaimed story to someone else, when that decision
is supposed to require an admin.

**Stage 2 — the actual screens.** Real moderation and editorial dashboards, replacing pages that
used to just say "not built yet, come back in a later prompt." A moderator can now:

- Filter and page through submitted stories, each clearly labeled as a first submission, a
  replacement for an already-published story, or a resubmission after a previous rejection.
- Open any one of them to see exactly what was submitted, including — for a replacement — a
  side-by-side view of what's currently public versus what's being proposed.
- Approve, reject, or request changes, each with its own reason (required for reject/request-changes,
  optional for approve).

Approving a story runs through a proper multi-step process behind the scenes — start the approval,
copy each new photo into public storage, then finalize — specifically designed so that if anything
fails partway through, nothing is ever left half-published. The attempt just sits safely, waiting to
be retried or explicitly rejected, instead of leaving a story in a broken in-between state.

Editors got a real filterable dashboard too (instead of one flat unsorted list), plus the ability to
formally reassign a story to a different editor.

**Stage 3 — reports triage and polish.** A dedicated page for reviewing reader-submitted reports —
filterable, paginated, with a private-notes system staff can use to record why a report was closed
(never visible to whoever submitted the report). Also added: a full written guide for moderators
covering topics like immigration misinformation, harassment, copyright, dangerous travel advice, and
when something needs to go to an admin instead of being handled directly — written in plain
language for someone on their first shift, not a technical spec. Along the way, a subtle bug was
found and fixed: after a moderator successfully approved or archived a story, the confirmation
message on screen could get silently swapped out by the page automatically refreshing itself before
anyone actually saw it — the action worked correctly the whole time, but the moderator had no way to
tell that from the screen.

**Then verified for real, in an actual browser, against the real live database** — not just
automated database-level checks. All 12 real browser tests passed, and getting there caught two more
genuine bugs that no amount of reading the code had caught:

1. An editor got a genuine error page just from visiting their **own** story's edit screen. The
   database function meant to show an editor their own prep history had accidentally been restricted
   to moderators and admins only when it was first built — a real, live-reproducing mistake, not a
   hypothetical one, confirmed by literally watching the server produce the error before fixing it.
2. The same "confirmation message disappears before anyone can see it" bug from Stage 3 turned up
   again, this time on the main story-review screen where a moderator approves or rejects a
   submission.

Both were fixed and then re-confirmed by running the exact same browser tests again — all 12 still
pass — before anything was merged.

### What's next

**Prompt 6 is now fully done.** Next up: Prompt 7 (operational launch tooling — health checks,
deployment runbook, and broader automated-test coverage of the platform's most critical flows).
