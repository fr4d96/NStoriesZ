# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Readers (public, no account required):** people researching a Working Holiday Visa (WHV) to
  New Zealand — initially concentrated among Malaysian travellers, but the product must not assume
  a single nationality. They want to filter and browse stories by things that map to their own
  plans: region/destination, work type, trip year, travel style, reported cost.
- **Contributors (registered):** people who have completed or are undertaking a WHV and are willing
  to write and publish their story under their own attribution (full name, first name + initial, or
  a pseudonym — their choice, recorded explicitly). They draft, preview privately, and submit for
  moderation.
- **Editors (founding-catalogue only):** staff/volunteers who onboard the initial catalogue —
  importing stories and images that already exist in written form from early contributors,
  structuring them into the platform's block-based schema, and recording attribution/rights
  confirmations before submission.
- **Moderators:** staff who review submitted stories/imports against publication and
  content-governance rules and decide to approve, reject, or request changes. Not the same role as
  editors, even though one person may hold both.

## Product Purpose

Kakinotes helps people considering or undertaking a WHV in New Zealand find real, detailed,
written first-person stories from people who did it — organized so a reader can find stories
relevant to their own situation, and trust that what they're reading is a genuine personal account,
properly attributed, with rights-cleared images. Success is a reader finding a trustworthy,
relevant account of someone else's real WHV experience.

## Positioning

Stories-first: closer to a curated editorial publication or documentary archive than a travel
product. It is explicitly not a social feed, not a planning tool, not a jobs board, and not a
source of personalised advice — every other capability exists only to serve discovery and
trustworthy publication of written stories. No neighboring product could truthfully copy this and
also claim to be a booking site, social network, or advice platform.

## Operating Context

- Curated founding-catalogue import: editor imports an existing written story + images supplied
  outside the platform, structures it into the block schema, records attribution/consent/rights,
  previews privately, then submits for moderation.
- Self-service contribution: contributor registers, drafts using the same structured schema, adds
  images, previews privately at any point exactly as it will appear publicly, submits for
  moderation, and may later submit a revision to an already-published story (the previous approved
  revision stays live until the new revision is itself approved).
- Moderation queue: approve / reject with reason, for both self-service submissions and imports.
- Reporting: readers can flag a published story or image for review.

## Capabilities and Constraints

- Public browsing of approved stories, filterable by region, destination, work type, trip year,
  travel style, and reported cost band; search.
- Structured written stories (defined content blocks — paragraph, heading, quote, list; never
  free-form HTML) with a separate, ordered image gallery (images are not inline with text).
- Image upload with automatic metadata stripping (EXIF/GPS, etc.) before publication; only
  processed, approved derivatives are ever published.
- Contributor attribution (contributor-chosen display name) and an optional public contributor
  profile exposing only contributor-approved fields.
- Revision-safe publishing: edits to a published story never go live until separately approved; an
  unapproved edit never overwrites what's publicly visible.
- Draft, pending, rejected, and archived content is never publicly reachable (no public queries,
  sitemaps, metadata, or URL-guessable previews).
- SEO (indexable pages, sitemap, structured metadata) for approved published stories only.
- Explicitly out of scope (do not build toward these): audio/video stories or transcription,
  comments/likes/follows/messaging or any social mechanic, live job listings, budgeting tools,
  preparation checklists, personal visa-status tools, itinerary planning, interactive maps, native
  mobile apps, other visa-country programs as a shipped surface, or anything that reads as
  personalised immigration/legal/employment/tax/financial advice.
- Nationality, destination, region, and work classification are reference data, not hard-coded UI
  strings or enums — the platform must be able to expand beyond its Malaysia-focused launch without
  code changes.
- Stack: Next.js, Tailwind CSS v4, Supabase (Postgres + RLS + storage). Content is controlled
  structured JSON, never `dangerouslySetInnerHTML` on raw user input.

## Brand Commitments

- Current name: **Kakinotes** (an earlier working name, "Journiq," appears in some older docs —
  code, package.json, and current docs all agree on Kakinotes; treat Journiq references as stale).
- Logo asset: `public/kakinotes-icon.png`.
- Tone: trustworthy, warm, editorial/documentary, calm confidence — not flashy, not salesy, not
  social-media-coded.
- Explicit anti-patterns: no star ratings/review scores on stories, no "Book Now"/"Explore Now"
  purchase-style CTAs, no traveller-headcount or social-proof stat badges, no comment threads/like
  buttons/follow buttons/avatar-stack social proof, no budgeting calculators/checklists/interactive
  maps, no framing that implies personalised visa/legal/financial advice.
- Every public story must carry a visible "personal experience, not advice" label near the top —
  a hard product requirement, not a footnote.
- Existing incumbent palette (`app/globals.css`): forest green + warm paper/sand neutrals with a
  terracotta-orange accent, light/dark via `data-theme` on `<html>`. Typography uses Geist Sans /
  Geist Mono (`next/font/google`) — no new font family should be assumed available.

## Evidence on Hand

- No real contributor content is imported yet — the founding-catalogue import workflow exists to
  bring in real stories/images later. No testimonials, customer logos, benchmarks, or usage stats
  exist; do not fabricate any.
- No separate style guide beyond the current `app/globals.css` tokens and `docs/design-brief.md`
  (note: design-brief.md predates the current palette and still says "no brand palette" — treat the
  live CSS as authoritative over that doc).
- All seed data (users, stories, images) is fictional per Engineering Rule 22 — never real
  contributor content.

## Product Principles

1. Trust over conversion: every design and product decision favors credibility of the
   first-person account over engagement or growth mechanics.
2. Structured, not open-ended: stories are a fixed block vocabulary and a defined image gallery,
   never freeform rich text — this is a constraint, not a limitation to design around.
3. Nothing unapproved is ever public: draft/pending/rejected state and unapproved revisions must
   never leak into any public-facing surface, query, or URL.
4. Data-driven geography and classification: nationality, destination, region, and work type are
   reference data so the product can grow past its Malaysia-focused launch without rework.
5. Personal experience, not advice: every story is one person's account, and the product must never
   read as personalised immigration/legal/financial guidance.

## Accessibility & Inclusion

WCAG AA baseline per Engineering Rule 19 (semantic HTML, labels, contrast, keyboard navigation).
No further product-specific accessibility requirement has been established.
