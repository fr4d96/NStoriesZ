# Content Inventory Template — WHV Compass NZ

A tracking template for the founding catalogue, used alongside
[docs/founding-catalogue-runbook.md](founding-catalogue-runbook.md). Keep this **outside** this
repository (a spreadsheet, or your team's own tracker) — it will end up holding references to
real people and real, unpublished content, which must never be committed to Git (Engineering Rule
22). The columns below are a checklist of fields, not a mandate to use this exact file format.

Do not collect more than you need — in particular, never record a passport number, visa/immigration
document, bank detail, exact live address, or medical information in this tracker or anywhere else
(Engineering Rule 15), even if a contributor mentions one in passing while you're gathering the
story.

## Fields

| Field                            | Notes                                                                                                                                                          |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Internal story reference         | A short, private label you use to track this story before it has a platform slug (e.g. "SG-source-doc-14"). Not shown anywhere in the app.                     |
| Contributor display name         | The name/pseudonym they chose (Engineering Rule 16) — the exact text that will show publicly.                                                                  |
| Contact status                   | e.g. "reached, awaiting reply" / "confirmed" / "unreachable" — status only, not a phone number or address.                                                     |
| Permission status                | Not asked / asked / confirmed in writing / declined. Note _how_ it was confirmed (email, message, in person) — this becomes the consent `confirmation_method`. |
| Attribution preference           | real name / first name + initial / pseudonym / anonymous.                                                                                                      |
| Story title                      | Working title is fine before import; update once finalized.                                                                                                    |
| Trip dates or year               | Exact dates if known, otherwise just the year.                                                                                                                 |
| Regions                          | One or more regions/destinations the story covers.                                                                                                             |
| Work types                       | e.g. fruit picking, hospitality, packhouse.                                                                                                                    |
| Travel style                     | budget / mid_range / comfort, if the contributor described one.                                                                                                |
| Expense information availability | Whether the contributor shared a total cost figure, or declined to.                                                                                            |
| Image count                      | How many images are available for this story.                                                                                                                  |
| Image-rights status              | Not confirmed / confirmed for all images / confirmed for some (list which).                                                                                    |
| Editing status                   | Not started / text imported / metadata complete / images attached / ready for contributor review.                                                              |
| Contributor approval status      | Not yet requested / awaiting contributor / approved / changes requested / declined.                                                                            |
| Moderation status                | Not submitted / submitted / approved / rejected / changes requested.                                                                                           |
| Publication URL                  | `/stories/<slug>` once published.                                                                                                                              |
| Removal or correction status     | None / correction submitted / withdrawal requested / removed.                                                                                                  |

## Suggested workflow

Add one row per story as soon as you know it exists (step 1 of the runbook), then update the
status columns as you move through the runbook's later steps. `/readiness` in the app gives a
live, per-story readiness view once a story actually exists in the platform — use this
spreadsheet for the pre-import steps (contact, permission, rights) that happen before anything is
created in the app at all, and cross-check against `/readiness` afterward rather than duplicating
its per-field checklist by hand.
