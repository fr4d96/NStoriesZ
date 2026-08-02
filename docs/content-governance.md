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

## Editorial assistance

- Editors may structure, lightly copyedit, and format a contributor-supplied story into the platform's
  block schema for the founding catalogue.
- Editorial assistance is preparation, not moderation: an editor readying an import for submission is
  a distinct step and, where the data model allows, a distinct role from the moderator who later
  approves it (Engineering Rule 5). The same person may hold both roles operationally, but the
  workflow and any audit trail treat them as separate actions.
- Editors record attribution, publication consent, and image rights confirmations as part of import
  prep — a story cannot be submitted for moderation without these recorded.

## Moderation boundaries

- A moderator's decision is binary at the revision level: approve or reject with a reason. Moderators
  do not silently edit contributor content to make it publishable; if changes are needed, the revision
  is rejected with a reason and returned to the contributor/editor.
- Approving a revision publishes it via the revision-pointer mechanism (see
  [docs/architecture.md](architecture.md#story-revision-strategy)) — it never overwrites a previously
  published revision in place, so a bad approval can be corrected by publishing a new approved
  revision rather than needing to reconstruct history.
- Moderators act on submitted (pending) revisions only; they do not have blanket edit rights over all
  contributor content.

## Reporting

- Any reader can report a published story or image for review (e.g. suspected impersonation, rights
  dispute, factual concern, inappropriate content).
- A report puts the associated published revision up for re-review by a moderator; it does not
  automatically unpublish the story. Repeated or credible reports are a moderator judgment call,
  documented at implementation time.

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
