# Landing Page — Interactive Story Carousel Brief

For an AI design/build tool with no prior context on this project. Read this document alone and
you should have everything needed to build one interactive React/Next.js landing page.

## 1. What this is

**Journiq** is a public website of real, first-person written stories from people who have
completed or are completing a Working Holiday Visa (WHV) in New Zealand. Readers are people
considering or preparing for the same trip. Contributors are past/current WHV travellers who
write and publish stories under a name, first-name-plus-initial, or pseudonym of their choosing.

This is **not** a travel agency, booking site, social feed, or advice platform. It is closer to a
curated editorial publication or documentary archive: detailed, structured, searchable,
trustworthy accounts. There are no bookings, no purchases, no comments/likes/follows, and no
personalised advice.

**Tone:** trustworthy, warm, editorial/documentary, calm confidence. Not flashy, not salesy, not
social-media-coded.

**Explicit anti-patterns — do not include any of these:**

- Star ratings or review scores on stories
- "Book Now" / "Explore Now" / purchase-style CTAs
- Traveller headcount or social-proof stat badges (e.g. "1,250+ Happy Travelers")
- Comment threads, like buttons, follow buttons, avatars-in-a-row social proof
- Autoplaying carousels with no pause control, or carousels that trap keyboard focus

## 2. This task specifically

Build the **home page hero + featured-stories carousel** as an interactive component. The rest of
the home page (value-prop section, bottom CTA band) already exists and is out of scope — focus
entirely on replacing the current static "Recent stories" grid with an interactive carousel, and
make sure it integrates visually with the existing hero above it.

### What the carousel must do

- Display a row of **story cards**, each driven by a cover image as the dominant visual (see data
  shape below) — the cover photo should read as the primary identity of the card, not a small
  thumbnail next to a text block.
- Users can move through stories via: left/right arrow controls, swipe/drag on touch and trackpad,
  and keyboard (arrow keys when the carousel has focus). Do not rely on hover-only interaction —
  this must work on mobile.
- Show partial adjacent cards (peek the edge of the next/previous card) rather than hard-cutting
  to a single centered card, so it's visually obvious there's more to scroll.
- Include visible position feedback (e.g. dots, or a subtle progress indicator) — not required to
  be clickable, but the user should be able to tell where they are in the set.
- Respect `prefers-reduced-motion`: no forced auto-advancing, and any transition/slide animation
  should degrade to an instant or minimal-motion swap.
- Each card is a real link to that story's detail page (`/stories/[slug]`) — the whole card should
  be clickable/tappable, not just a small "read more" text link, and it must remain a real `<a>`/
  `<Link>` under the hood (not a `div` with an onClick) for keyboard and screen-reader users.
- Include a "Browse all stories" link/button near the carousel that goes to `/stories`, for anyone
  who wants the full filterable list instead of scrolling the carousel.

### Card content (per story)

Each card is built from this data shape (already defined in the codebase as `StoryCardData`):

```ts
{
  title: string;
  excerpt: string | null;
  trip_year: number | null;
  travel_style: string | null; // e.g. "backpacker", "settled in one place"
  attribution_value: string | null; // contributor's chosen display name/pseudonym
  cover_image_path: string | null; // resolve via getPublicImageUrl() -- may be null, design a "no photo" fallback state
  regions: [{ region_name: string; destination_name: string | null }, ...];
  work_types: string[]; // e.g. "hospitality", "fruit picking"
  tags: string[];
}
```

On each card, show: cover photo (full-bleed within the card), title, a short excerpt (1–2 lines,
truncated), region/destination, and contributor attribution with trip year. Up to 2–3 small tag
chips (work type/travel style) is fine. **No rating, no "Explore Now" button, no traveller-count
badge** — see anti-patterns above.

Use realistic placeholder content for design/dev purposes — real NZ regions (Queenstown,
Wanaka, Auckland, Bay of Islands, Wellington, Central Otago...), real WHV work types (seasonal
fruit picking, hospitality, farm work, tourism/hospitality in ski towns), and short first-person-
sounding excerpts. Do not use lorem ipsum.

## 3. Visual system to match (already established — don't invent a new one)

This page must feel like a continuation of the existing site, not a separate microsite.

### Palette

Warm, editorial — **not** a cold corporate-travel-agency teal. CSS custom properties already
defined in `app/globals.css`:

| Token                 | Light     | Dark      | Use                                    |
| --------------------- | --------- | --------- | -------------------------------------- |
| `--background`        | `#fffdfa` | `#16130f` | page background                        |
| `--foreground`        | `#201a14` | `#f3ece0` | body text                              |
| `--surface`           | `#ffffff` | `#1e1a14` | card background                        |
| `--surface-muted`     | `#f5efe6` | `#241f18` | section background, muted panels       |
| `--border-subtle`     | `#e7ddcd` | `#362e23` | hairlines, card borders                |
| `--accent`            | `#b5522a` | `#e2825a` | primary CTA, active state (terracotta) |
| `--accent-foreground` | `#fffdfa` | `#16130f` | text/icons on top of `--accent`        |
| `--tag-background`    | `#efe4d3` | `#2c2519` | tag/chip background                    |
| `--tag-foreground`    | `#5b4a32` | `#d8c8ac` | tag/chip text                          |

Both a light theme (default) and a dark theme (`prefers-color-scheme: dark`) must work — there is
no manual theme toggle in this app; it follows the OS preference only.

The hero directly above the carousel already uses a full-bleed illustrated alpenglow skyline of
the Remarkables (Queenstown) in this same terracotta/warm-ink palette — reuse or extend that
mood (warm dusk/dawn light, not the mockup-teal look) if the carousel section touches or
transitions from the hero, rather than introducing a new color language.

### Typography

**Geist Sans** (already the app's font, via `next/font/google`, exposed as `--font-geist-sans`).
Do not introduce a new font family. Headline weight is semibold/bold with tight tracking; body
copy is regular weight.

### Components already in the codebase — reuse conventions, don't reinvent

- Cards elsewhere in the app use `rounded-xl`, a `border-border-subtle` outline on `bg-surface`,
  and a subtle `hover:shadow-md` with the cover image scaling slightly on hover
  (`group-hover:scale-[1.03]`) — carry this same tactile feel into the carousel cards.
- Tag chips: `rounded-full bg-tag-background px-2 py-0.5 text-xs text-tag-foreground`.
- Primary buttons: `rounded-md bg-accent text-accent-foreground px-5 py-2.5 text-sm font-medium
hover:opacity-90`. Secondary/outline buttons: `rounded-md border border-border-subtle px-5
py-2.5 hover:bg-surface`.
- Every published story carries a small "personal experience, not advice" label elsewhere on the
  site (a pill with a bullet, `rounded-full border border-border-subtle bg-surface-muted`) — the
  carousel section doesn't need to repeat this per-card, but keep it in mind if you add any new
  section-level messaging near the carousel.

## 4. Technical constraints

- **Next.js (App Router) + React Server Components by default; `"use client"` only where the
  carousel's interactivity actually requires it.** Keep the data-fetching parent (which stories to
  show) server-side, and isolate client-side state (current slide index, drag handling) to the
  smallest possible client component.
- **Tailwind CSS v4** utility classes, using the design tokens above — don't hardcode hex values
  in component code where a token already exists.
- **No new UI/animation library dependency without saying why.** No component library is
  currently installed (no shadcn/ui, Radix, embla-carousel, Framer Motion, etc.) — if you want to
  add one for the carousel mechanics, name it explicitly and explain the tradeoff instead of
  silently assuming it's available. A hand-built carousel using native CSS scroll-snap
  (`overflow-x-auto`, `snap-x`, `snap-mandatory` / `snap-center`) is a reasonable dependency-free
  default and is preferred unless there's a good reason not to.
- **Accessibility (baseline, not optional):** semantic HTML, visible focus states on every
  interactive control, full keyboard operability (tab to the carousel, arrow keys to move, tab
  again to reach each card's link), sufficient color contrast for text over the cover photos
  (add a gradient scrim under text if needed), and appropriate `aria-label`s on the prev/next
  controls and the carousel region itself (e.g. `aria-roledescription="carousel"` or an
  `aria-live="polite"` region announcing the current story, whichever pattern you implement
  cleanly — don't half-implement ARIA carousel semantics).
- **Mobile-first.** Design and build the mobile layout first (single card, swipeable, peeking
  neighbor), then scale up to tablet/desktop (multiple cards visible, arrow controls become more
  prominent since hover is available).
- Images come from a Supabase public storage bucket via a `getPublicImageUrl(path)` helper — treat
  cover photos as external/remote URLs (not something you can pass through Next's built-in image
  optimizer's static list), and always render a graceful empty/fallback state when
  `cover_image_path` is null.

## 5. Deliverable

A single interactive React component (plus a small client sub-component for the carousel
mechanics if you split server/client concerns) that can replace the current static "Recent
stories" grid section on the home page, built mobile-first, matching the palette/typography/
component conventions above, using realistic placeholder NZ WHV story content, and satisfying the
accessibility and reduced-motion requirements in Section 4.
