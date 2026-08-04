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

**Implemented as of Prompt 4 (Sub-phase 4):** `submit_revision_with_consent()` gained a required
`p_expected_terms_version` parameter and a `WHV01` safety check (a stable Postgres SQLSTATE, not
just a message prefix, so `lib/story/rpc-errors.ts` can detect it structurally) — if the terms
version the caller last agreed to no longer matches `current_terms_version()`, submission is
rejected until the contributor re-confirms against the current terms, even for a revision they'd
otherwise be free to resubmit. Four offline confirmation methods (`email`, `written_message`,
`in_person`, `other`) were added alongside the original `confirmation_method = 'account'` path,
for the founding editorial-import catalogue where the contributor's permission was recorded
before the platform existed: callable only by the story's assigned editor or an admin, and only on
an `editorial_import`-source story (never for a contributor's own self-service submission, which
must always use `'account'`). Every offline confirmation still requires the same
`image_rights_confirmed_at`/`identifiable_people_state` data as the self-service path — "offline"
only changes who's asserting consent happened and how, never what's required to have happened. A
related narrow exception: the contributor's own "approve" action in the editorial-review workflow
below (Editorial assistance section) is allowed to resubmit the exact revision the story is
currently `awaiting_contributor_approval` on, in addition to the ordinary editable-draft path.

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

**Implemented as of Prompt 4 (Sub-phases 2 and 4), end to end:** the placeholder
`promote_story_media()` referenced by earlier revisions of this document was dropped outright
(`supabase/migrations/20260804090200_story_media_processing_functions.sql`) and never shipped with
any grants — nothing should go looking for it. What actually ships and runs, live-verified
end-to-end (including a real Storage byte round trip) by `e2e/editorial-upload.spec.ts`:

- `lib/story/image-pipeline.ts` decodes every upload with `sharp`, independently re-verifies the
  real magic bytes (never trusting the client's declared content type or the upload Route
  Handler's own earlier sniff), strips all metadata (EXIF/GPS and similar), and resizes it —
  running server-side, using the service-role admin client only inside this one module.
- `record_processed_story_media()` (service-role only, never reachable via the public API) records
  the processed result once that pipeline has actually succeeded — it is the only function allowed
  to write the processed-image columns, and rejects any storage path that doesn't match the
  expected content-addressed naming convention.
- `finalize_story_publication()` is the single atomic publication transaction: it promotes each
  attached image from the private bucket to the public one (verifying the copy landed, per
  Engineering Rule 14) and flips the story's published pointer, all in one transaction — replacing
  the old `moderate_revision()` approve path entirely (that function now only handles
  reject/changes-requested; calling it with `'approve'` raises, directing callers to
  `begin_story_publication_attempt()`/`finalize_story_publication()` instead).

Draft images remain private-bucket-only until this pipeline runs and a moderator's approval
actually promotes them (Engineering Rules 13–14) — nothing here changes that invariant, it's the
concrete implementation of it.

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

**Implemented as of Prompt 4 (Sub-phase 4) — the actual editorial import workflow, this
principle's first real implementation:**

- `create_editorial_import_draft()` starts a new `editorial_import`-source story, either against an
  existing unlinked contributor or a freshly-created one, and assigns the calling editor as
  `assigned_editor_id`.
- The editor pastes the contributor's existing plain text or HTML into the import panel
  (`components/story/content-import-panel.tsx`); `lib/story/content-import.ts`'s
  `plainTextToBlocks()`/`sanitizeHtmlToBlocks()` convert it into the platform's controlled block
  schema (Engineering Rule 6) and sanitize any HTML before it ever becomes structured content
  (Engineering Rule 7) — never `dangerouslySetInnerHTML` on the pasted input. Both return a full
  `ImportReport` (blocks produced, anything dropped or rewritten) so the editor can see exactly what
  changed before accepting it.
- `log_editorial_action()` records the editor's preparatory evidence (e.g. "contributor emailed
  permission on file") as a plain, non-authorizing audit note — logging it grants nothing on its
  own; only the actual consent RPC (`submit_revision_with_consent()`, see Publication consent above)
  turns it into a real publication grant.
- `mark_editorial_draft_awaiting_approval()` (surfaced as "Mark ready for contributor review" in
  `app/(editor)/editorial/[id]/editorial-controls.tsx`) freezes the draft and flips the story to
  `awaiting_contributor_approval` — the editor cannot keep editing it once handed off.
- The contributor's own review step (`components/story/contributor-review-panel.tsx`, rendered only
  to the linked contributor while the story is in that state) is the actual moderation-adjacent
  decision point named in this section's second bullet: approve (submits the editor-prepared
  revision under the contributor's own consent, via the narrow `awaiting_contributor_approval`
  submission exception described in Publication consent above), request changes
  (`request_editorial_changes()`, hands the draft back to the editor with a note), or decline
  (`decline_editorial_publication()`, ends the import without publishing). None of these three are
  reachable by the editor who prepared the draft — only by the contributor it's actually about,
  keeping "preparation" (editor) and the contributor's own publication decision structurally
  separate, the same way Engineering Rule 5 keeps editorial prep separate from staff moderation.

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
