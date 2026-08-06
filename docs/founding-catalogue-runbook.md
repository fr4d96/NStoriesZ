# Founding Catalogue Runbook — Journiq

This is an operational runbook for editors bringing the platform's first real contributor
stories onto Journiq. It is **not legal advice** — see
[docs/content-governance.md](content-governance.md) for the actual consent/rights rules this
runbook exists to satisfy, and [docs/moderation-guidelines.md](moderation-guidelines.md) for how
a moderator ultimately reviews the result.

**Never place real contributor content, contact details, or images in Git, fixtures,
screenshots, or automated tests.** Fictional data only in this repository (Engineering Rule 22).
Real founding-catalogue import happens in a staging/production Supabase project, driven through
the app's own UI (`/editorial/*`) — never by hand-editing `supabase/seed.sql` or committing a
real story.

Use [docs/content-inventory-template.md](content-inventory-template.md) to track every story
through the steps below, and [docs/launch-content-checklist.md](launch-content-checklist.md)
once it's ready to actually go live. `/readiness` (Prompt 7) gives a live, per-story view of
where each story stands against most of these steps — check it as you go rather than only at the
end.

## 1. Inventory existing stories

Before touching the app, list every story you have permission to import: who wrote it, where the
text/images currently live (a document, an email, a folder of photos), and roughly how complete
it is. Record each one as a row in the content inventory (see template).

## 2. Confirm contributor contact and attribution preference

Reach the actual person the story is about (not just whoever supplied the file). Confirm:

- How they want to be identified publicly: real name, first name + initial, a pseudonym, or fully
  anonymous (`contributors.attribution_type`).
- The exact display text if it isn't simply their name (e.g. a chosen pseudonym).

Do not guess or default this. Record only what's needed to reach them again later (see the
content-inventory template's "Contact status" field — it deliberately avoids collecting more
personal data than necessary, per Engineering Rule 15).

## 3. Confirm written publication permission

Get explicit confirmation that they're happy for this specific story to be published on this
platform. A generic "sure, go ahead" in a message is enough to act on, but **record how and when**
it was given — this becomes the `confirmation_method`/`publication_confirmed_at` you'll enter at
submission time (see step 9). Keep the original evidence (the email, the message) outside the
app, wherever your team keeps such records — it is never uploaded to this repository or to
`editorial_actions`' free-text notes as anything beyond a short reference ("confirmed via email,
2026-08-04").

## 4. Confirm image ownership and identifiable-person permission

For every image you plan to attach:

- Confirm the contributor (or whoever supplied it) actually has the right to share it publicly —
  their own photo, or explicit permission from whoever took it.
- If any person is identifiable in the photo (a face, a name tag, anything that could single
  someone out), confirm that person is also comfortable with it being published, or don't use the
  photo.
- **Never** include a photo of a passport, visa/immigration document, bank card, or anything with
  an exact live address visible (Engineering Rule 15) — reject/redact these outright, even if the
  contributor doesn't think of them as sensitive.

## 5. Create a contributor record

In `/editorial/contributors`, create the contributor record if one doesn't already exist (you can
do this before an account exists — the record stays unlinked until they sign up, if ever). Enter
their confirmed display name and attribution type from step 2.

## 6. Import story text

In `/editorial/new`, start an editorial-import draft against that contributor. Paste the
contributor's existing text (plain text or HTML) into the import panel — **always preview the
conversion before accepting it** (`components/story/content-import-panel.tsx`). Read the
conversion report: anything dropped, anything converted to plain text (tables/code blocks),
anything flagged as an unsafe link. If the preview looks wrong, adjust the source text and
re-paste rather than accepting a bad conversion.

This platform never scrapes a social-media post or third-party site automatically — always start
from text the contributor (or whoever supplied it) actually gave you directly.

## 7. Add structured metadata

Still in the editorial edit page, fill in: title, excerpt, trip start/end date or at least a trip
year, region/destination, work type(s), tags, travel style, and reported cost if the contributor
shared one. `/readiness` will show these as outstanding until they're set.

## 8. Upload and process images

Use the image manager to upload each confirmed image (step 4). For each one: write real alt text
(unless it's genuinely decorative), add a caption if useful, and use the manual reorder controls
to put them in a sensible order. Pick one cover image. Watch for a "possible duplicate" warning —
it means two uploaded images hash to the same processed bytes; confirm that's intentional before
leaving both attached.

## 9. Complete contributor review

Once the draft is ready, use "Mark ready for contributor review" so the contributor (if they have
an account) can review it themselves, or use the offline-confirmation path recorded in the consent
panel — matching exactly how permission was actually given in step 3 (`email` / `written_message`
/ `in_person` / `other`). Confirm image rights and identifiable-people state honestly; these are
required whenever the story has at least one attached image.

If the contributor has no account and reviewing it themselves isn't practical, the offline
confirmation path exists precisely for this — but the same rights/consent facts must still be
true and recorded, not skipped.

## 10. Submit to moderation

Once contributor approval is complete, the story moves into the moderation queue automatically.
A moderator (a different step from editorial prep, per Engineering Rule 5) reviews it against
[docs/moderation-guidelines.md](moderation-guidelines.md) and approves, rejects, or requests
changes.

## 11. Verify the public page on desktop and mobile

After approval, actually load the published story on `/stories/<slug>` yourself, on both a desktop
viewport and a mobile viewport. Confirm the title/excerpt/body render correctly, images appear in
the right order with the right cover, and attribution shows exactly what was confirmed in step 2.
Record this check in `/readiness` (the "Record verification" control under a published story) —
this is a manual, human confirmation step; nothing automated performs it, and recording it never
changes the story's publication state on its own.

## 12. Record requested corrections or removal

If the contributor later asks for a correction, that's a normal new revision through the same
authoring flow (`create_next_draft_revision()`) — the previously published version stays live
until the correction is itself approved. If they ask for the story to come down, use the
withdrawal path (`revoke_publication_consent()`); full deletion is a slower, explicit,
human-reviewed path, not a one-click action — see
[docs/content-governance.md](content-governance.md#corrections-withdrawal-and-deletion). Track
either outcome in the content inventory's "Removal or correction status" field.

## Staging import — a documented manual procedure

Real content is never imported into this repository. To rehearse or dry-run an import before
touching a real project:

1. Use a **dedicated Supabase staging project** (never production, never the shared dev project
   this repo's automated tests use), linked via `supabase link --project-ref <staging-ref>`.
2. Run the same migrations (`supabase db push`) so the staging schema matches.
3. Create one or two **fictional** contributor/story fixtures through the real UI (not
   `seed.sql`) to prove the workflow end to end — this is exactly what
   `e2e/founding-story-workflow.spec.ts` automates, with fictional data, against the same shared
   dev project the rest of this repo's e2e specs already use.
4. Only once the workflow is proven, repeat steps 1–11 above against the real staging (then
   production) project with real, permissioned content — never by writing SQL directly.

## Logs and error reports

Server logs (`lib/log.ts#logStaffAction()`) record actor id, action name, target id, and outcome
only — never a story body, a contributor's private contact details, or note contents. Don't
paste real draft bodies into bug reports, tickets, or chat when debugging an import issue; link to
the story by its id/slug instead.
