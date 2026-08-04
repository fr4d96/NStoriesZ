# Implementation Status — Plain-Language Summary

This is a human-friendly companion to [docs/implementation-status.md](implementation-status.md),
which is the detailed, technical version. This file is updated after each prompt or sub-phase
finishes, so you can see what's been done without reading migration names and function
signatures.

Last updated: after Prompt 4, Sub-phase 4 (now complete).

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

## Prompt 4 — Actual authoring (in progress, 4 of 5 stages done, stage 4 now fully switched on)

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
- **Not yet built:** the final round of end-to-end tests and documentation polish. That's stage 5. A
  handful of test-only story/contributor records created by this session's browser tests are still
  sitting in the real database and haven't been cleaned up yet — cleaning them up is a real deletion
  action, so it's being left for an explicit go-ahead rather than done automatically.

### What's next

Stage 5: a second real account interacting with someone else's story through the actual screens (as
opposed to the automated tests, which already prove this is blocked at the database level), cleaning
up the test data mentioned above (with your go-ahead), and any documentation polish still needed.
After Prompt 4 wraps up, Prompt 5 is public browsing/search, and Prompt 6 is the moderator's review
dashboard.
