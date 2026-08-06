# Build Prompt — Interactive Landing Page with Featured-Story Carousel

**Use this prompt to implement the landing page inside the Journiq repo.** It is written for an
engineer/agent working in this codebase, and it assumes you have already read `CLAUDE.md` and
`docs/implementation-status.md`. A separate, context-free design brief exists at
`docs/landing-page-story-carousel-brief.md` — that one is for an external design tool. **This**
document is the implementation contract: it names the real files, the real data shape, and the
real acceptance criteria.

---

## 1. The task in one paragraph

Replace the static three-column "Recent stories" grid on the public home page
(`app/(public)/page.tsx`, lines ~88–104) with an **interactive, swipeable, keyboard-operable
featured-story carousel** whose cards are dominated by the story's cover photograph. The hero
above it and the value-prop / bottom-CTA sections below it stay — the carousel must read as a
continuation of that page, not a bolt-on. Data still comes from `listPublishedStories()` on the
server; only the carousel _mechanics_ become a Client Component.

---

## 2. Product guardrails (non-negotiable)

Journiq is a public archive of first-person written Working Holiday Visa (WHV) stories from New
Zealand. Tone: **trustworthy, warm, editorial/documentary, calm confidence.** Not a booking site,
not a social feed, not an advice platform.

**Do not add any of these** (they contradict `docs/product-spec.md` MVP Non-Goals and the
anti-patterns in `docs/design-brief.md`):

- Star ratings, review scores, or "X% recommend" indicators
- "Book Now" / "Explore Now" / purchase-style CTAs
- Traveller-count or social-proof stat badges ("1,250+ travellers!")
- Comments, likes, follows, avatar rows, share counts
- Auto-advancing slides with no pause control
- Any personalised visa/legal/tax/employment advice framing

**Do keep:** the `<PersonalExperienceLabel />` ("personal experience, not advice") messaging that
already exists on the page. The carousel section itself doesn't need a per-card repeat of it, but
don't remove it from the hero.

---

## 3. Data — use what already exists, add nothing to the DB

### Source

`app/(public)/page.tsx` already calls:

```ts
featured = await listPublishedStories({ limit: 6 });
```

Keep this. Consider raising the limit to `8`–`10` so the carousel has enough to be worth
scrolling, but **do not** add filters, a new RPC, or a per-card follow-up query — the RPC already
returns everything a card needs in one round trip (see the comment in
`lib/story/public-queries.ts`).

The existing `try/catch` that degrades to `featured = []` on error must stay. When `featured` is
empty, render **nothing** for this section (current behaviour) — do not render an empty carousel
shell.

### Row shape

Each row matches `StoryCardData` in `components/story/story-card.tsx`:

```ts
export type StoryCardData = {
  story_id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  published_at: string;
  trip_year: number | null;
  travel_style: string | null;
  total_expense_nzd_cents: number | null;
  attribution_value: string | null;
  contributor_slug: string | null;
  cover_image_path: string | null;
  regions: unknown; // [{ region_name, destination_name | null }, ...]
  work_types: unknown; // string[]
  tags: unknown; // string[]
};
```

Note `regions` / `work_types` / `tags` are typed `unknown` because they arrive as JSON from the
RPC. `story-card.tsx` already has the narrowing helpers `firstRegionLabel()` and `stringList()` —
**reuse or extract those**, don't re-write ad-hoc `as any` casts.

### Images

`getPublicImageUrl(story.cover_image_path)` from `lib/story/public-image-url.ts` returns a public
Supabase Storage URL or `null`. It is safe in both Server and Client Components. Rules:

- It returns `null` for a null path, a traversal-y path, or a missing
  `NEXT_PUBLIC_SUPABASE_URL`. **Every card must have a designed "no photo" fallback** — a warm
  `bg-surface-muted` panel that still shows the title/region legibly, not a broken image box.
- Use a plain `<img>` with the existing eslint-disable comment pattern (these are
  content-addressed remote bucket URLs, not a Next-optimizable static source). Keep
  `loading="lazy"` on off-screen cards; the **first** card may use `loading="eager"` +
  `fetchPriority="high"` since it is near the fold.
- Decorative-only images take `alt=""`. If you surface real alt text later it must come from the
  media record, never a synthesized description.

### Placeholder content while developing

If you have no local Supabase stack, drive the component from a local fixture array of realistic
WHV stories — real NZ regions (Queenstown, Wānaka, Bay of Islands, Central Otago, Marlborough,
Wellington, Nelson), real WHV work (seasonal fruit picking, vineyard pruning, hospitality, ski-
field ops, farm work), and short first-person excerpts. **No lorem ipsum.** Fixtures live in the
test file or a `*.fixtures.ts` beside the component — never seeded into `supabase/seed.sql`
unless it is fictional (Engineering Rule 22).

---

## 4. Files to create / change

| Path                                               | Action | Purpose                                                     |
| -------------------------------------------------- | ------ | ----------------------------------------------------------- |
| `components/home/featured-story-carousel.tsx`      | new    | `"use client"` — carousel mechanics, scroll state, controls |
| `components/home/featured-story-slide.tsx`         | new    | Photo-dominant card. Server-renderable; no client state     |
| `app/(public)/page.tsx`                            | edit   | Swap the grid section for the carousel section              |
| `components/home/featured-story-carousel.test.tsx` | new    | Vitest + RTL: rendering, controls, links, fallback          |
| `app/(public)/page.test.tsx`                       | edit   | Assert the carousel section renders when stories exist      |
| `e2e/home.spec.ts`                                 | edit   | Playwright: keyboard + control operability on the home page |
| `docs/implementation-status.md`                    | edit   | Status, decisions, risks, next prompt (Definition of Done)  |

Do **not** modify `components/story/story-card.tsx` — the `/stories` index and contributor pages
depend on it. If you extract `firstRegionLabel` / `stringList` into a shared module (e.g.
`lib/story/card-fields.ts`), update `story-card.tsx` to import from there and keep its behaviour
byte-identical.

---

## 5. Component architecture

Follow `CLAUDE.md`'s folder conventions: Server Components by default, `"use client"` only where
interactivity requires it.

```
app/(public)/page.tsx                    [server]  fetches stories, owns section chrome
  └─ <FeaturedStoryCarousel stories={featured}>   [client]  scroll state, controls, a11y wiring
       └─ <FeaturedStorySlide story={...} />       [presentational, no state]
```

The client boundary should wrap **only** the scroll container and its controls. Slides are passed
as data (serializable props) — do not put the fetch, the Supabase client, or any secret inside the
client component. Nothing from `lib/supabase/server.ts` or a service-role client may be reachable
from this tree (Engineering Rule 1).

---

## 6. Interaction spec

### Layout

- **Mobile-first.** At `< 640px`: one card fills ~85% of the viewport width with the **next card
  peeking** at the right edge, so it is visually obvious there is more. Never a hard single-card
  cut with no affordance.
- `sm`: ~2 cards visible. `lg`: ~3 cards visible, still with a partial peek.
- Cards are equal height with the cover image at a consistent aspect ratio (`aspect-[4/3]` matches
  the existing `StoryCard`; `aspect-[3/4]` or `[4/5]` is also acceptable here if you want a more
  editorial, photo-forward portrait card — pick one and apply it consistently).
- The section sits inside the page's `mx-auto max-w-5xl px-4 sm:px-6` rhythm, but the **scroll
  track may bleed past that container** on mobile so cards can run to the screen edge. If you do
  this, keep the first card's left edge aligned to the page gutter via scroll padding.

### Movement

Support all three, on every breakpoint:

1. **Prev/next buttons** — real `<button>`s, `aria-label="Previous stories"` / `"Next stories"`,
   visible focus ring, `disabled` (and visually dimmed) at each end. On mobile they may be smaller
   or below the track, but must not be hover-only or hidden.
2. **Swipe / drag / trackpad** — native horizontal scroll, no JS drag emulation needed.
3. **Keyboard** — Left/Right arrow keys move the track when the carousel region has focus, and
   Tab reaches every card link and control in visual order. Do not trap focus.

**Preferred implementation: native CSS scroll-snap, no new dependency.**
`overflow-x-auto snap-x snap-mandatory scroll-smooth` on the track, `snap-start` (or
`snap-center`) on each slide, `scroll-padding-inline-start` matching the gutter. Move by calling
`scrollBy({ left: cardWidth, behavior })` on a ref. Read position from an `onScroll` handler (or
an `IntersectionObserver` on the slides) to drive the dots and button disabled state — do **not**
keep a separate "current index" that can desync from where the user actually scrolled.

If you believe a library (embla-carousel, Framer Motion, Radix) is genuinely necessary, **state
why explicitly in the PR/commit description** per Engineering Rule 20 and get agreement first.
None are currently installed.

### Position feedback

A row of dots or a slim progress bar showing where you are in the set. Dots need not be clickable;
if you make them clickable they must be `<button>`s with `aria-label="Go to story N"`. Hide them
from screen readers (`aria-hidden`) if you already provide a live-region announcement — don't
double-announce.

### Motion

- **No auto-advance.** (If a product decision later adds one, it needs a visible pause control —
  but do not add one now.)
- Respect `prefers-reduced-motion`. `app/globals.css` already forces
  `scroll-behavior: auto` and near-zero transition durations under that query — so pass
  `behavior: "smooth"` conditionally, or rely on the CSS and verify the snap still lands correctly
  with reduced motion on. Test both states.

---

## 7. Card content and visual system

Show, per card:

- **Cover photo** — full-bleed within the card, the dominant visual element
- **Title** — `text-lg font-semibold tracking-tight`
- **Excerpt** — clamped to 2 lines (`line-clamp-2`), omitted entirely when `null`
- **Region/destination** — via `firstRegionLabel(regions)`
- **Attribution + trip year** — reuse `<AttributionChip name={attribution_value ?? "Anonymous"}
tripYear={trip_year} destination={regionLabel} />`
- **Up to 3 chips** from `work_types` + `tags`

### The whole card is one link

Use the existing **stretched-link** pattern from `story-card.tsx`: a `<Link
href={`/stories/${slug}`}>` around the title containing `<span className="absolute inset-0"
aria-hidden="true" />`, on a `relative` card root. This keeps a single real `<a>` per card for
keyboard and screen-reader users and avoids nested anchors. **Do not** use a `div` with `onClick`,
and **do not** pass `contributorSlug` to `AttributionChip` inside the card (it would nest an `<a>`
inside the stretched link).

### Tokens — never hardcode hex

Use the Tailwind v4 theme tokens already mapped in `app/globals.css`:

| Token                                       | Use                               |
| ------------------------------------------- | --------------------------------- |
| `bg-background` / `text-foreground`         | page                              |
| `bg-surface`                                | card background                   |
| `bg-surface-muted`                          | section band, "no photo" fallback |
| `border-border-subtle`                      | card outline, hairlines           |
| `bg-accent` / `text-accent-foreground`      | primary CTA, active dot           |
| `bg-tag-background` / `text-tag-foreground` | chips                             |

Both light and dark themes must work — the app follows `prefers-color-scheme` only, there is no
manual toggle. The one place hex is currently hardcoded is text over the hero photo-backdrop
(`#f3ece0`); if you place text over a cover photo, add a gradient scrim
(`bg-gradient-to-t from-black/70`) so contrast holds regardless of the photograph.

Match existing card feel: `rounded-xl border border-border-subtle bg-surface`,
`transition-shadow hover:shadow-md`, and `group-hover:scale-[1.03]` on the image.

Typography is **Geist Sans** via `--font-geist-sans`. Do not introduce a new font.

### Section chrome

Keep a heading and the escape hatch:

```tsx
<h2>Recent stories</h2>            // or "Stories from the road"
<Link href="/stories">Browse all stories</Link>
```

The "Browse all stories" link must remain — carousels are for browsing, `/stories` is the real
filterable index.

---

## 8. Accessibility acceptance criteria

Baseline, not optional (Engineering Rule 19):

- [ ] Carousel region is labelled: `role="region"`, `aria-roledescription="carousel"`,
      `aria-label="Featured Working Holiday stories"`.
- [ ] Slides are in a scrollable container with `tabindex="0"` **or** each slide's link is
      independently tabbable — whichever you choose, verify Tab order matches visual order.
- [ ] Prev/next buttons have `aria-label`s and correct `disabled` state at the ends.
- [ ] Visible focus ring on every interactive element (the global `:focus-visible` outline in
      `globals.css` handles this — don't override it with `outline-none`).
- [ ] Text over imagery meets WCAG AA contrast via a scrim.
- [ ] Either an `aria-live="polite"` announcement of position **or** proper ARIA carousel
      semantics — pick one and implement it fully. Half-implemented ARIA is worse than none.
- [ ] Works with `prefers-reduced-motion: reduce`.
- [ ] Fully operable at 375px width with touch only.

---

## 9. Testing requirements

**Vitest + RTL** (`components/home/featured-story-carousel.test.tsx`):

- Renders one slide per story with correct `href="/stories/[slug]"`
- Renders the "no photo" fallback when `cover_image_path` is `null`
- Renders chips from `work_types`/`tags`, capped at 3
- Handles malformed `regions`/`work_types` JSON (non-array, wrong shape) without throwing
- Next button calls `scrollBy` / advances position; prev is disabled at index 0
- Arrow-key handling moves the track
- Renders nothing (or a stable empty state) for an empty story list

Note `jsdom` does not implement layout or smooth scrolling — stub `scrollBy`/`scrollTo` and assert
on the call, not on pixel positions.

**Update `app/(public)/page.test.tsx`** — its mock currently returns `[]`; add a case with two
fixture stories asserting the carousel section and its links render.

**Playwright** (`e2e/home.spec.ts`) — extend the existing home test:

- Carousel region is visible on `/`
- Next button advances (assert a different card is in view, or scroll offset changed)
- A card link navigates to a `/stories/[slug]` page returning < 400
- The existing h1, nav-link, and staff-route-404 assertions still pass

---

## 10. Definition of Done

From `CLAUDE.md`, all of these must hold:

- [ ] Acceptance criteria in §6–§9 met and demonstrably testable
- [ ] No RLS/storage policy touched — this is a read-only public surface. Confirm the carousel
      reads **only** `listPublishedStories()`, i.e. approved+published revisions only
      (Engineering Rules 10, 12)
- [ ] No service-role key, secret, or real contributor data introduced (Rules 1, 15, 22)
- [ ] No new dependency added without a stated justification (Rule 20)
- [ ] `npm run verify` passes (format:check, lint, typecheck, test, build)
- [ ] `npm run verify:full` passes, or the Playwright failure is explained
- [ ] Verified at 375px **before** desktop (Rule 18), in both light and dark scheme
- [ ] `docs/implementation-status.md` updated with status, decisions, risks, next prompt
- [ ] `docs/architecture.md` updated only if the component structure convention changed

### Verify commands

```bash
npm run verify
```

```bash
npm run verify:full
```

---

## 11. Out of scope

Do not, in this task: redesign the hero, change the value-prop three-column section, change the
bottom CTA band, touch `/stories` or its filters, add a new RPC or migration, add auto-play, or
add any MVP Non-Goal from `docs/product-spec.md` (comments, likes, follows, maps, video, live
jobs, budgeting).
