# Moderator Guidelines — WHV Compass NZ

Read this before your first shift. It explains what you're deciding, why, and where the line sits
between your judgment and something you should hand up to an admin. It complements
[docs/content-governance.md](content-governance.md) (the policy source of truth) and
[docs/architecture.md](architecture.md) (the technical implementation) — this document is the
practical, plain-language version for the person actually sitting in the queue.

## You are not a legal, immigration, or employment expert — and you don't need to be

**Say this out loud to yourself before every shift:** you are not an immigration lawyer, an
employment lawyer, an accountant, or a licensed financial adviser, and neither is anyone else on
this team unless explicitly told otherwise. WHV Compass NZ exists to publish **first-person
experience** — "here is what happened to me" — not advice, and not authoritative fact-checking of
New Zealand immigration or employment law.

That means your job is narrower and more mechanical than it might feel:

- You are not verifying whether a contributor's account of the law is _correct_. You are checking
  whether it's presented as **personal experience** or as an **authoritative instruction**.
- A story that says "my visa took 11 weeks to process and it drove me crazy waiting" is a
  first-person account — publish it as written (subject to the rest of this document).
- A story that says "WHV visas always take exactly 11 weeks, don't bother applying earlier than
  that" is stated as fact/instruction, and it's wrong or unverifiable often enough that you should
  not let it stand unqualified.
- When in doubt, the fix is almost always to **soften language into first-person framing** ("in my
  case...", "when I applied...") rather than to adjudicate the underlying legal or factual
  question yourself. You are not expected to know current visa processing times, tax thresholds,
  or minimum wage figures — you are expected to notice when a story states one of these as
  settled fact and route it back to be reframed or sourced.
- Every published story already carries a "personal experience, not advice" label (Engineering
  Rule 17) — this is a platform-level disclaimer, not a substitute for your own read of an
  individual story. Don't let the presence of that label make you less careful about a story that
  reads as instructional despite the label.

If you are ever unsure whether something crosses from "my story" into "official guidance," treat
it as if it does, and use request-changes (below) to ask for it to be reframed or linked to an
authoritative source (Immigration New Zealand, Inland Revenue, Employment New Zealand) rather than
asserted directly.

## Working categories of concern

These aren't the report categories verbatim (see "Report categories" below for those) — they're
the kinds of problems you'll actually encounter while reading a submitted revision or a reader
report, and how to think about each.

### Immigration misinformation

Confident, specific claims about visa rules, processing times, eligibility, or outcomes, stated as
universal fact rather than "this is what happened to me." The risk is real: a reader may plan
their own visa application around a stranger's out-of-date or simply wrong account.

- Low-risk example: "I found the online application form confusing" — subjective, first-person,
  fine as-is.
- Needs softening: "You need to show $X in savings to qualify" — even if it was true when the
  contributor applied, visa financial requirements change. Ask for "when I applied, in [year], I
  needed to show..." framing, or a link to the official INZ page instead of a bare number.
- Reject outright if the claim is specific, confidently wrong, and not correctable by a small edit
  (e.g., a fabricated visa category that doesn't exist).

### Unsafe or unlawful employment advice

Advice that would put a reader at legal, financial, or physical risk if followed — e.g.,
suggesting working under the table, ignoring a visa's work-hour conditions, or an employer
practice that sounds like exploitation presented as normal/acceptable.

- A contributor recounting "my employer paid me in cash and it was a mess" is describing what
  happened to them — that's a legitimate cautionary story.
- A contributor writing "just get paid in cash, it's easier and nobody checks" is advice, not
  recollection, and normalizes something that can genuinely harm a reader (wage theft exposure,
  visa condition breaches). Request changes: reframe as "this happened to me and I wouldn't
  recommend it" rather than an instruction.

### Employer/individual allegations, defamation, and unverifiable claims

A story can honestly describe a bad personal experience with a named employer or person. The line
you're watching for is between **recounting an experience** ("I worked at [employer] and wasn't
paid for two weeks") and **making an allegation presented as established fact** about specific
wrongdoing you have no way to verify ("[employer] is running an illegal scheme to defraud
workers").

- You cannot verify the underlying facts, and you shouldn't try to — that's not your job and this
  platform has no investigative process for it.
- First-person, specific, plausible personal experience: generally fine, even if unflattering to a
  named business — that's the value of the platform.
- Sweeping, unverifiable accusations of criminal or systemic wrongdoing, especially when framed as
  established fact rather than "in my experience": request changes to reframe as personal
  experience, or reject if the contributor won't.
- Named private individuals (a specific coworker, host, landlord) get more caution than named
  businesses — see "Privacy and identifiable people" below.

### Harassment and hate

Content demeaning a person or group based on nationality, ethnicity, religion, gender, sexuality,
disability, or similar — whether about a specific individual or a broader group (e.g., generalizing
negatively about "people from [country]" or "locals here are all..."). This is a reject, not a
request-changes, unless the offending material is small and clearly excisable (a single sentence
you can ask the contributor to remove while the rest of the story stands fine).

### Privacy and identifiable people

The consent snapshot you see on the review page includes `identifiable_people_state`
(`confirmed`/`not_applicable`) — this is the contributor's own attestation about images, not a
check you're re-deriving. Your job on top of that:

- Watch for images or text that make a **third party** (not the contributor) identifiable in a way
  they plainly did not consent to — a recognizable face in a photo the story frames negatively, a
  named private individual's personal details (workplace, address-adjacent detail, phone/social
  handle).
- The platform does not collect passport scans, visa/immigration documents, bank credentials, exact
  live location, or medical records in any form (Engineering Rule 15) — if you spot one of these
  even incidentally in an image (e.g., a photo of a visa approval letter, a bank card visible on a
  desk), that revision cannot be approved as-is. Request changes naming the specific image/detail
  to remove.

### Copyright and image permission

Every attached image requires a recorded rights confirmation (`confirmation_method`,
`image_rights_confirmed_at` on the review page) before a revision can even be submitted — you are
not independently proving copyright, you're checking that the confirmation is present and the image
content is consistent with a personal photo (not, say, an obvious stock-photo watermark or a
screenshot of someone else's social media post). If something looks off despite the recorded
confirmation, request changes and ask for clarification rather than approving on faith.

### Spam and undisclosed promotion

Content that exists mainly to promote a business, service, or affiliate link rather than recount an
experience — a story that reads like an advertisement, or repeated near-identical stories pushing
the same employer/tour operator/agency. Distinguish this from a contributor genuinely recommending
somewhere they stayed or worked — genuine recommendation embedded in a real personal account is
fine; the tell for spam is that the "experience" framing is thin and the promotional content is the
actual point.

### Dangerous travel advice

Specific recommendations that could put a reader in physical danger if followed literally — unsafe
route suggestions, encouraging skipping standard safety precautions, understating a real hazard
(e.g., "the trail is basically flat and safe for anyone" for something with a real avalanche or
exposure risk). Same pattern as employment advice: recounting "I did this and it was risky" is fine
and often the most useful kind of story; presenting the risky choice as a universal recommendation
is not.

## Request-changes vs. reject

`moderateRevision()` gives you exactly two decisions on a submitted revision, both requiring a
user-facing reason: **reject** and **changes_requested**. There is no third "approve with edits"
option — moderators do not edit contributor content directly (see
[docs/content-governance.md](content-governance.md) "Moderation boundaries"), so the choice is
always about what happens to the _contributor's_ next step.

**Request changes** when the story is fundamentally sound — a real, first-person account, no
harassment/hate, no fabricated or dangerous instruction — but has one or more specific, nameable
problems a contributor could reasonably fix themselves: a claim stated as fact that should be
softened to first-person, an image that needs to be removed or re-confirmed, a promotional aside
that needs trimming, a factual claim that needs an authoritative link instead of a bare assertion.
Your `userFacingReason` should be specific enough that the contributor knows exactly what to change
— "please reframe the visa timeline as your own experience rather than a general rule" is useful;
"needs work" is not.

**Reject** when the story's core content is the problem, not a fixable detail — pervasive
harassment/hate, a story that is substantially about a single unverifiable, serious allegation
against a named party, content built around unlawful/dangerous instruction with no salvageable
first-person account underneath, or clear spam/promotion with no real experience content to keep.
Reject is also the right call for a resubmission that made the same mistake again after an earlier
changes-requested reason already explained it clearly — persistent disregard for specific feedback
is itself a signal.

When genuinely unsure which of the two applies, lean toward **request changes** — it's the
reversible, lower-friction option for the contributor, and a rejected story can always be
resubmitted as a fresh revision later if the contributor disagrees and wants to try again through
the normal flow. Reject is for cases where you don't expect a straightforward fix to produce a
publishable story.

## Admin escalation

**There is no in-app "escalate" button.** Do not tell a contributor or reporter that something has
been "escalated" as if a tracked workflow state exists for it — it doesn't. If something needs an
admin's attention, this is a process step you handle outside the app (a message to the admin
on-call, whatever your team's actual out-of-band channel is), not a feature this platform provides
today.

Escalate to an admin when:

- A reassignment needs to move an editorial-import story to a **specific** editor and you're not
  an admin — `reassign_editorial_story()` only lets a non-admin editor claim an unassigned story or
  hand off their own; assigning a story to someone else's queue is admin-only.
- A report or revision raises a question genuinely outside "is this first-person, is it
  harassment, is it dangerous, is it spam" — e.g., a suspected pattern of coordinated abuse across
  multiple accounts, a legal threat received about published content, or anything that feels like
  it needs a policy decision rather than an application of this document.
  Reassignment aside, a single report or story rarely needs to actually change hands — most
  escalation is "let an admin know," not "hand off the row" — but if the row itself does need a
  different decision-maker, say so plainly when you escalate rather than resolving it yourself
  under uncertainty.
- You are the one who prepared an editorial import (as an editor) and are now also the moderator
  reviewing it, or otherwise have any personal conflict of interest — hand the actual review off to
  another moderator/admin rather than deciding on your own submission-adjacent work.

## Consent withdrawal and removal

A contributor can withdraw their own published story at any time via `revoke_publication_consent()`
— this is their own self-service action, not something you do on their behalf, and it stays
reason-free by design (see [docs/content-governance.md](content-governance.md) "Corrections,
withdrawal, and deletion"). It archives the story (removing it from every public-read function)
immediately, in the same transaction, and retains the underlying record.

As a moderator/admin, you have a separate, parallel path: `archiveStory()` (the "Archive /
unpublish this story" control on the review page), used when **you** are the one deciding a
published story should come down — a serious report was upheld, or content that was live turns out
to violate this document after the fact. Unlike a contributor's own withdrawal, your archive action
**requires a reason** — write one a future moderator or the contributor themselves could understand
if they asked why their story was taken down. This is intentionally the same effect
(archived, removed from public view, record retained) but a structurally distinct, reason-required
path, so the two are never confused in the audit trail. Neither path is a route to deleting a
story outright — full deletion remains a slower, human-reviewed process outside this document's
scope (see [docs/content-governance.md](content-governance.md)).

## Report categories, and when a note is required

`resolve_report()` requires a non-empty internal note whenever you **close** (`resolved` or
`dismissed` — never on the `reviewing` transition) a report in one of four categories:
`misinformation`, `unsafe_employment_advice`, `harassment`, `copyright_privacy`. These are the four
categories most likely to need a record of what you actually checked or decided, for anyone
reviewing your decision later. `spam_commercial`/`other` stay optional — these tend to be lower-
stakes, more mechanical closures ("clearly promotional, dismissed" is usually enough context on its
own).

Your internal note is **never shown to the reporter or the contributor** — write it for a future
moderator or admin, not for the person who filed the report. A good note says what you actually did:
"Reviewed the flagged paragraph, reframed as personal experience per contributor's resubmission" or
"Confirmed employer name matches a publicly reported dispute, kept as personal account, no
changes needed" — not just "seems fine."

A report puts a **published** story up for your re-review; it does not automatically unpublish
anything (see [docs/content-governance.md](content-governance.md) "Reporting"). If, after reviewing
a report, you conclude the story should genuinely come down, use the archive path above with a real
reason — resolving the report itself only closes the report, it does not touch the story's
publication state.

## A short mental checklist before you decide

1. Is this first-person experience, or does it read as an instruction/authoritative claim? If the
   latter, can it be reframed, or does it need to go?
2. Would a reader be at real risk (financial, legal, physical, or immigration-status risk) if they
   took this at face value?
3. Is any private third party identifiable in a way they didn't agree to?
4. Are all attached images rights-confirmed, and consistent with that confirmation?
5. Is this actually an experience, or promotion wearing an experience's clothes?
6. If I'm requesting changes, could the contributor act on my reason without guessing what I mean?
7. If I'm rejecting, am I confident a straightforward edit wouldn't have fixed it?
8. Am I the right person to decide this, or does it need another moderator/admin's eyes first?

None of this requires you to be a lawyer, an immigration adviser, or an investigator. It requires
you to read carefully, write a clear reason, and know when to hand something up rather than guess.
