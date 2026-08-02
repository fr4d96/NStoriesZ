# Content Governance — WHV Compass NZ

This governs how stories and images get from a contributor or editor into public view, and how they
can be corrected or removed afterward. It exists because the product's core value proposition is
trust: every published story must be a real person's account, published with their actual permission,
using images they actually have the rights to share.

## Contributor attribution

- Every story has exactly one contributor of record, recorded internally with an account/identity link.
- The contributor chooses how they are displayed publicly: full name, first name + initial, or a
  pseudonym. This choice is stored explicitly per contributor (or per story, if a contributor wants
  different display names on different stories) — never inferred or defaulted without their input.
- A public contributor profile shows only fields the contributor has explicitly marked public
  (Engineering Rule 16). Nothing is public by default beyond the display name and their published
  stories.

**Implemented as of Prompt 2** (see
[docs/architecture.md](architecture.md#rls-strategy--prompt-2-authprofilesrolescontributors)):
`contributors.attribution_type` (`real_name` / `display_name` / `pseudonym` / `anonymous`) and
`contributors.display_name` are the contributor's explicit, stored choice — set via the account
page's "Contributor identity" form, never defaulted or inferred. `contributors.public_status`
(`private` / `public` / `archived`) gates public visibility: `private` (the default) is visible only
to the linked owner and staff; only `public` is visible to anonymous/other-user queries.
`profiles.public_profile_enabled` + `profiles.public_slug` is the equivalent opt-in for the
account-level profile page (separate concept from a contributor's public byline — see
[docs/architecture.md](architecture.md) "Data-access conventions"). A contributor record may exist
before any linked account (`linked_user_id IS NULL`) for the founding-catalogue import case below;
linking it to a real account afterward is a trusted, staff-only, audited operation
(`public.link_contributor_to_user()`), never a self-service claim of an existing record.

## Publication consent

- No story is submitted for moderation without an explicit, recorded publication-permission
  confirmation from the contributor (or, for founding-catalogue imports, from the person who supplied
  the original story to the editor).
- Consent is recorded as data tied to the specific story/revision being published — a generic
  "I agree to terms" is not sufficient; the record should make clear the contributor understood this
  specific story would be public.
- Consent for a revision does not automatically carry over in a way that lets an editor invent new
  content on a contributor's behalf; substantive changes during editorial preparation should be
  confirmed with the contributor before submission where practical.

**Implemented as of Prompt 3** (see
[docs/architecture.md](architecture.md#story-domain-prompt-3--schema-lifecycle-and-access-model)):
`story_publication_consents` is append-only — every grant row is bound to one specific, immutable
`revision_id` (a revision is frozen the instant it leaves `draft`, so binding consent to a
`revision_id` _is_ binding to a frozen content snapshot), recorded by exactly one function,
`submit_revision_with_consent()`, atomically with the submission it authorizes — there is no
standalone "consent recorded early, trusted later" path. An editor's preparatory evidence gathered
during import prep can be logged as a plain audit note (`log_editorial_action()`) but authorizes
nothing until it's re-confirmed at the moment of submission, against the exact revision being
submitted — this is exactly "consent for a revision does not automatically carry over": editing a
revision after a grant produces a new revision with a new id, and the old grant no longer matches,
so submission requires a fresh one. `confirmation_method = 'account'` requires the caller to be the
story's linked contributor; the four offline methods require the caller to be the assigned editor or
an admin, on an editorial-import story only. Revocation
(`revoke_publication_consent()`, contributor or admin) is a terminal, story-wide flag — no function
ever re-grants after it, matching "full deletion/restoration is a slower, human-reviewed path" below
for the analogous case; a published story is archived automatically in the same transaction.

## Image rights

- Every image attached to a story requires a recorded confirmation that the uploader/contributor has
  the right to share it publicly (their own photo, or explicit permission from whoever took it).
- Draft images are stored in a private bucket and are never publicly reachable before approval
  (Engineering Rule 13).
- Only processed, approved derivatives with metadata stripped (EXIF/GPS and similar) are promoted to
  the public bucket on approval (Engineering Rule 14). Originals are not published.
- The platform does not collect or store passport scans, visa/immigration documents, bank credentials,
  exact live locations, or medical records in any image or field, including seed/test data
  (Engineering Rule 15) — editors and moderators should reject/redact any submission that includes
  these even incidentally (e.g. a photo of a visa approval letter).

**Implemented as of Prompt 3, schema-level:** `submit_revision_with_consent()` requires
`image_rights_confirmed_at` and a resolved `identifiable_people_state` (`confirmed`/`not_applicable`
— never `pending`/`declined`) whenever the revision has at least one attached image.
`moderate_revision()`'s approve path independently re-verifies every attached image is both
processed and approved (`story_media.approved_public_storage_path is not null and
metadata_removed_at is not null`) before publishing — an unprocessed image blocks publication
structurally. `promote_story_media()` (the function that would set those processed/approved columns)
exists but has **no grants at all** in this phase, so no role can self-approve an image yet — the
actual storage buckets and the image-processing pipeline that will call it are Prompt 4.

## Editorial assistance

- Editors may structure, lightly copyedit, and format a contributor-supplied story into the platform's
  block schema for the founding catalogue.
- Editorial assistance is preparation, not moderation: an editor readying an import for submission is
  a distinct step and, where the data model allows, a distinct role from the moderator who later
  approves it (Engineering Rule 5). The same person may hold both roles operationally, but the
  workflow and any audit trail treat them as separate actions.
- Editors record attribution, publication consent, and image rights confirmations as part of import
  prep — a story cannot be submitted for moderation without these recorded.

**Implemented as of Prompt 2:** an editor (or admin) can create an unlinked `contributors` row
(`linked_user_id IS NULL`) to prepare a founding-catalogue contributor's identity ahead of an
account existing. **Publication consent and image-rights confirmation records are implemented as of
Prompt 3**, per the sections above.

## Moderation boundaries

- A moderator's decision is binary at the revision level: approve or reject with a reason. Moderators
  do not silently edit contributor content to make it publishable; if changes are needed, the revision
  is rejected with a reason and returned to the contributor/editor.
- Approving a revision publishes it via the revision-pointer mechanism (see
  [docs/architecture.md](architecture.md#story-domain-prompt-3--schema-lifecycle-and-access-model)) —
  it never overwrites a previously published revision in place, so a bad approval can be corrected by
  publishing a new approved revision rather than needing to reconstruct history.
- Moderators act on submitted (pending) revisions only; they do not have blanket edit rights over all
  contributor content.

**Implemented as of Prompt 3:** `moderate_revision()` is the only path from `submitted` to
`approved`/`rejected`/`changes_requested`, structurally — no role, including admin, has a direct
`UPDATE` path to `revision_status`; a `BEFORE UPDATE` trigger additionally freezes every content
column the instant a revision leaves `draft`, so a moderator (or anyone) literally cannot rewrite
content, not just by convention. Every decision is recorded, append-only, in `moderation_actions`
(user-facing reason) with staff-only internal notes in a sibling table
(`moderation_action_notes`) — never visible to the contributor or to editors (a deliberate
`get_story_for_editor()`/`get_story_for_moderator()` split, so one role's private material is never
handed to another by default).

## Reporting

- Any reader can report a published story or image for review (e.g. suspected impersonation, rights
  dispute, factual concern, inappropriate content).
- A report puts the associated published revision up for re-review by a moderator; it does not
  automatically unpublish the story. Repeated or credible reports are a moderator judgment call,
  documented at implementation time.

**Implemented as of Prompt 3:** `create_story_report()` requires the target to be currently public
and published, snapshots `published_revision_id` at report time, and derives `reporter_id` from the
session (never client-supplied) — a signed-in reader is required for MVP, per the brief.
`list_my_reports()` lets a reporter see only their own; `resolve_report()` (moderator/admin) is the
only path from `open`/`reviewing` to `resolved`/`dismissed`. A partial unique index prevents the same
reporter opening a second report on the same story while one is still open.

## Corrections, withdrawal, and deletion

- A contributor can submit a correcting revision at any time; the previously published revision stays
  live until the correction is itself approved (Engineering Rule 11).
- A contributor can request withdrawal of their own published story. Withdrawal removes it from public
  view; the underlying record should be retained (not hard-deleted) unless the contributor specifically
  requests deletion, to preserve moderation history and support future audits.
- A contributor can request full deletion of their story and images. This is a slower, explicit,
  human-reviewed path (not a self-service one-click hard delete in MVP) given the founding-catalogue
  content may have been imported on someone else's behalf — the exact mechanics are an implementation
  decision to make explicitly, not something to leave implicit.

**Implemented as of Prompt 3:** corrections and withdrawal are built; full deletion is not (as
planned above). `create_next_draft_revision()` is the correcting-revision path — the previously
published revision stays live, untouched, through the entire lifecycle of the correction attempt,
including if it's rejected or changes are requested. `revoke_publication_consent()` is the
withdrawal path — it archives a published story (removing it from every public-read function) and
retains every underlying record; no function ever deletes a story, revision, consent, or moderation
row (every structural foreign key in the domain is `on delete restrict`, deliberately, so this is
enforced at the schema level, not just by which functions happen to exist). Full deletion remains
out of scope, exactly as planned.
