# Content Governance — Journiq

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

**Implemented as of Prompt 5: the public contributor directory (`/contributors`).** Listing is
narrower than `public_status = 'public'` alone — a contributor also needs a usable `public_slug`,
`attribution_type` other than `anonymous` (choosing to be anonymous and also getting a named public
profile page are in tension), and at least one published story (an empty public profile page isn't
useful, and avoids a public directory of accounts with nothing to show). See
`list_public_contributors()`/`get_public_contributor()` in
[docs/architecture.md](architecture.md#public-discovery-and-seo-prompt-5).

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

**Implemented as of Prompt 6 Stage 1:** `reassign_editorial_story()` lets an editorial-import story's
preparation be handed off between editors — an admin may reassign any such story to any eligible
editor; a non-admin editor may only claim a currently-unassigned story for themselves or hand off a
story already assigned to them, never take over a colleague's assignment directly. Every reassignment
is recorded in `editorial_actions` (`action_type = 'reassigned'`), the same append-only audit trail as
every other editorial-preparation action.

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

**Implemented as of Prompt 6 Stage 1 (backend) and Stage 2 (the real approve/reject/archive UI) —
archiving/unpublishing requires a reason, serious reports require a note to close:**
`archive_story()` requires a non-empty `p_reason` (moderator/admin only) — an optional `p_note` is
also accepted, and both are recorded in a new append-only `story_publication_state_actions` audit
row. This applies **only** to a moderator/admin-initiated archive — a contributor's own withdrawal
(`revoke_publication_consent()`, see "Corrections, withdrawal, and deletion" below) stays
reason-free, unchanged, and gets its own audit row (`action_type = 'consent_withdrawn'`) with no
reason required. Separately, `resolve_report()` requires a non-empty internal note (staff-only,
never shown to the reporter, stored in a `story_report_notes` table) when **closing**
(`resolved`/`dismissed`, not the `reviewing` transition) a report in one of four serious categories:
`misinformation`, `unsafe_employment_advice`, `harassment`, `copyright_privacy`. `spam_commercial`/
`other` remain optional either way — these tend to be lower-stakes, more mechanical closures.
`app/(moderation)/moderation/stories/[id]/{page,actions}.tsx` (Stage 2) is the real UI for
approve/reject-or-request-changes/archive, each independently re-checking moderator/admin
server-side; the real reason/note requirements above are enforced both by Zod at the Server Action
boundary and, non-bypassably, by the RPCs themselves (Engineering Rule 3). See
[docs/architecture.md](architecture.md#editorial-and-moderation-workspace-backend-prompt-6-stage-1)
and
[docs/architecture.md](architecture.md#moderationeditorial-workspace-ui-and-orchestration-prompt-6-stage-2)
for the full technical account. **[docs/moderation-guidelines.md](moderation-guidelines.md) (Prompt
6 Stage 3) is the plain-language companion to this section** — concrete request-changes-vs.-reject
criteria tied to this app's actual two-decision `moderateRevision()` lifecycle, the four "serious"
report categories in practice, and an explicit statement that admin escalation is a process/
communication step today, not an in-app feature.

**Implemented 2026-09-02 — an empty story can no longer reach moderation:**
`submit_revision_with_consent()` now refuses a revision whose `content_json` contains no
non-whitespace text at all, raising `WHV03` with a message the contributor reads verbatim. This was
previously only a UI gate (`missingStoryRequirements()`), and the queue had accumulated 14
title-only shells submitted before that gate existed — a moderator opening any of them was shown
"Could not render submitted content.", which read as a system fault rather than a reviewable fact
about the submission. What counts as content is deliberately the same test the contributor-facing
gate applies ("is there any text"), not a minimum length: how long a story must be is editorial
policy for [docs/moderation-guidelines.md](moderation-guidelines.md), not a number to bury in a
migration. Revisions submitted **before** this rule are still fully reviewable — the review page
now names them as empty and suggests request-changes with a pre-filled reason, rather than showing
a rendering error. The queue itself flags them ("No story content") so they need not be opened at
all.

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

**Implemented as of Prompt 5: the actual reader-facing UI.** The Prompt 3 backend above had no
caller until now — `components/story/report-story-form.tsx` (on the public story detail page) +
`app/(public)/stories/[id]/actions.ts#reportStoryAction` are the first. Category selection is the
same 6-value set the `story_reports_category_check` constraint already enforced (misinformation,
unsafe employment advice, harassment, copyright/privacy, spam/commercial, other); details are
optional and length-capped to match. A signed-out visitor sees a sign-in prompt instead of a broken
form — the report widget itself carries no auth check of its own (the story detail page stays a
plain Server Component that never inspects the session), so a signed-out submission is only
discovered when `createStoryReport()` raises, translated into that prompt. A duplicate open report
(the partial unique index above, surfaced as Postgres `23505`) and a genuine new report resolve to
the exact same neutral confirmation text — the UI never reveals whether the caller already has an
open report on a given story, keeping reporter identity/state private per this document's own
requirement, not just at the RLS layer.

**Implemented as of Prompt 6 Stage 3: the staff-facing triage workspace.** Stage 2 only ever
surfaced a story's own open reports inline on its moderation review page
(`listReportsForStaff({ storyId })`); `app/(moderation)/moderation/reports/{page,[id]/page}.tsx` is
the first standalone, cross-story reports queue — filterable by status/category/date range, with a
per-report detail/resolution page. Each queue row links to the report's snapshotted
`published_revision_id` (the exact revision that was live and public at report time, per
`create_story_report()` above — never a re-derived "current" revision, which could be a different,
unrelated in-flight draft for the same story). The detail page renders the report's own internal
notes (`getReportNotes()`, moderator/admin only) and the resolution form
(`resolveReportAction()` → `resolve_report()`); the internal note is never returned to, or rendered
for, the reporter, the contributor, or any public surface — grepped the repo and confirmed
`getReportNotes()`'s only call site is this staff-gated page. See
[docs/architecture.md](architecture.md#reports-triage-and-operational-hardening-prompt-6-stage-3)
for the full technical account, and [docs/moderation-guidelines.md](moderation-guidelines.md) for
how a moderator should actually use this workspace.

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

## Operational readiness (Prompt 7)

The founding-catalogue import process this document describes now has an operational tooling layer
— `/readiness` (editor/moderator/admin), backed by `get_content_readiness_queue()`
(`supabase/migrations/20260806090000_content_readiness_and_metrics.sql`) — that surfaces, per
story, whether each of the steps above (attribution, consent, image rights, identifiable-people
resolution, editorial review, moderation) is actually complete. **This is explicitly an operational
checklist, not legal advice**, and it never gates or bypasses anything: recording a checklist item
or a post-publication launch verification (`record_story_launch_verification()`) has no effect on
`stories.lifecycle_status` or any publication column — the RPCs and RLS policies described
throughout this document remain the only source of truth for what's actually enforced. See
[docs/founding-catalogue-runbook.md](founding-catalogue-runbook.md),
[docs/content-inventory-template.md](content-inventory-template.md), and
[docs/launch-content-checklist.md](launch-content-checklist.md) for the operational process this
tooling supports, and [docs/architecture.md](architecture.md#content-readiness-operational-metrics-and-launch-tooling-prompt-7)
for the technical account. Consistent with "Moderation boundaries" above, there is still no bulk
publication path — every story is reviewed individually, checklist or not.
