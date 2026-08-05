# Launch Content Checklist — WHV Compass NZ

A final, per-story gate before telling anyone a story is "live" — use this after
[docs/founding-catalogue-runbook.md](founding-catalogue-runbook.md)'s steps are done and the story
shows `published` in `/readiness`. This is an operational checklist, **not legal advice**.

## Per story, before calling it launched

- [ ] Story shows `published` in `/readiness`, with every readiness item checked (or a documented
      reason it's intentionally not — e.g. no reported cost).
- [ ] The public page (`/stories/<slug>`) has been opened and read, on both a real mobile-width
      viewport and a real desktop-width viewport (Engineering Rule 18 — mobile-first).
- [ ] Attribution shown on the public page exactly matches what the contributor confirmed
      (real name / initial / pseudonym / anonymous — check the actual displayed text, not just the
      type).
- [ ] The "personal experience, not advice" label is visible near the top of the story
      (Engineering Rule 17).
- [ ] Every image renders, in the intended order, with the intended cover image, and alt text
      reads sensibly (not just "present").
- [ ] No exact residential address, live location, passport/visa document, bank detail, or medical
      information appears anywhere in the text or images (Engineering Rule 15) — re-check even if
      this was already checked during import; a final read-through catches things a first pass
      missed.
- [ ] A launch verification has been recorded for this story in `/readiness` (desktop and/or
      mobile), so there's a durable record of who actually looked at the live page and when.
- [ ] The story's contributor has been told it's live (if they wanted to know) and knows how to
      request a correction or removal later (`/copyright`).

## Before announcing the founding catalogue more broadly

- [ ] Every story in the founding batch has completed the per-story checklist above — no partial
      launches where some stories in the batch weren't actually checked.
- [ ] `/readiness`'s operational metrics show zero "missing consent" and zero "open reports" for
      the batch being announced.
- [ ] `/sitemap.xml` and `/robots.txt` have been spot-checked to confirm the new stories are
      discoverable and nothing draft/private is listed (Engineering Rules 10–12).
- [ ] Reporting UI (`/stories/<slug>` → report) has been exercised at least once end-to-end so the
      team knows the reports-triage workspace (`/moderation/reports`) actually works before real
      readers start using it.

## What this checklist is not

- Not a substitute for [docs/content-governance.md](content-governance.md)'s consent/rights rules
  — this checklist assumes those were already satisfied earlier in the runbook.
- Not a bulk-publication tool — every story is still checked individually, by design (this
  platform deliberately has no bulk-publish action).
- Not legal, immigration, or moderation advice — see
  [docs/moderation-guidelines.md](moderation-guidelines.md) for actual content-review judgment
  calls.
