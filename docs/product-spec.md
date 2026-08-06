# Product Spec — Journiq

## Purpose

Journiq exists to help people considering or undertaking a Working Holiday Visa (WHV) in
New Zealand find **real, detailed, written first-person stories** from people who did it — organized
so a reader can find stories relevant to their own situation, and trust that what they're reading is
a genuine personal account, properly attributed, with rights-cleared images.

The product is **stories-first**. It is not a planning tool, not a jobs board, not a social network,
and not a source of professional advice. Every other capability exists to serve the discovery and
trustworthy publication of written stories.

## Audiences

### Readers (public, no account required)

People researching a WHV to New Zealand — initially concentrated among Malaysian travellers, but the
product must not assume a single nationality. Readers want to filter and browse stories by things that
map to their own plans: region/destination, work type, trip year, travel style, reported cost.

### Contributors (registered)

People who have completed or are undertaking a WHV and are willing to write and publish their story
under their own attribution (full name, first name + initial, or a pseudonym — contributor's choice,
recorded explicitly). Contributors draft, preview privately, and submit for moderation.

### Editors (founding-catalogue only)

Staff/volunteers who onboard the initial catalogue: importing stories and images that already exist
in written form from early contributors, formatting them into the platform's structured story schema,
and recording the contributor's attribution and rights confirmations before anything is submitted for
moderation.

### Moderators

Staff who review submitted stories/imports against publication and content-governance rules (see
[docs/content-governance.md](content-governance.md)) and decide to approve, reject, or request changes.
Moderators are not the same role as editors, even though one person may hold both roles.

## Journeys

### Curated founding catalogue (editor-assisted import)

1. Editor imports an existing written story + images supplied by an early contributor (outside the
   platform — e.g. a document and photos).
2. Editor structures the story into the platform's block-based story schema and attaches images.
3. Editor records: contributor attribution as the contributor wants it displayed, publication
   permission confirmation, and image-rights confirmation for each image.
4. Editor (or the contributor, if they have an account) previews the draft privately.
5. Draft is submitted for moderation.
6. Moderator approves → story becomes a published, publicly readable revision. Or rejects with reason.

### Self-service contribution

1. A person registers as a contributor.
2. They create a draft story using the same structured schema, add images.
3. They preview privately, at any point, exactly as it will appear publicly.
4. They submit for moderation when ready.
5. Moderator approves → published revision. Or rejects with reason, draft returns to contributor.
6. Contributor may later submit a revision to a published story; the previous approved revision
   stays live until the new revision is itself approved (Engineering Rule 11).

## MVP scope

- Public browsing of approved stories, filterable by region, destination, work type, trip year,
  travel style, and reported cost band.
- Structured written stories (defined content blocks, not free HTML) with inline images.
- Image upload with automatic metadata stripping before publication.
- Contributor attribution (contributor-chosen display name) and optional public contributor profile
  with only contributor-approved fields visible.
- Editor-assisted import workflow for the founding catalogue.
- Private drafts with an accurate private preview before submission.
- Revision-safe publishing: edits to a published story never go live until separately approved.
- Moderation queue: approve / reject with reason, for both self-service submissions and imports.
- Reporting: a way for readers to flag a published story or image for review.
- Search and the filters listed above.
- SEO (indexable pages, sitemap, structured metadata) for approved published stories only.
- Operational tooling needed to actually launch with the first real contributors' content
  (import UI/scripts, moderation queue, basic admin visibility) — no more than that.

## MVP non-goals

Explicitly out of scope for MVP — do not build:

- Audio or video stories, or transcription of either.
- Comments, likes, following, messaging, or any social/feed mechanic.
- Live job listings.
- Budgeting tools.
- Preparation checklists.
- Personal visa-status or visa-application tools.
- Itinerary planning.
- Interactive maps.
- Native mobile apps.
- Support for other visa-country programs (Australia, Canada, etc.) — data model may be
  country-agnostic where cheap to do so, but no second-country product surface ships in MVP.
- Personalised immigration, legal, employment, tax, or financial advice, or anything that reads as such.
  Every story is explicitly labeled as one person's personal experience (Engineering Rule 17).

## Publishing and trust principles

- A story is either a private draft/pending revision, or a publicly visible **approved published
  revision** — nothing in between is ever publicly reachable (Engineering Rules 10–12).
- Attribution, publication-permission consent, and image-rights confirmation are recorded data, not
  assumptions — see [docs/content-governance.md](content-governance.md).
- Every public story is visibly labeled as a personal experience, not professional advice.
- Nationality, destination, region, and work classification are modeled as reference data so the
  platform can expand beyond its initial Malaysia-focused launch without code changes.
