---
name: Kakinotes
description: A cinematic dark archive of real, first-person Working Holiday Visa stories
colors:
  # "Night Field" -- the app-wide palette. Values below are the dark
  # rendition (the signature one). The light counterpart is listed under
  # light-* and lives in :root / [data-theme="light"] in app/globals.css.
  background: "#05070a"
  foreground: "#f4f6f5"
  surface: "#0d1218"
  surface-muted: "#10161d"
  border-subtle: "rgba(244, 246, 245, 0.14)"
  accent: "#35d0c4"
  accent-foreground: "#05070a"
  forest: "#0d1a20"
  fern: "#35d0c4"
  tag-background: "rgba(53, 208, 196, 0.14)"
  tag-foreground: "#8fe6da"
  muted-foreground: "#98a6a5"
  destructive: "#ff6b6b"
  light-background: "#f6f3ef"
  light-foreground: "#1b1612"
  light-surface: "#fdfbf8"
  light-surface-muted: "#ece7e1"
  light-border-subtle: "rgba(27, 22, 18, 0.15)"
  light-accent: "#00756e"
  light-accent-foreground: "#ffffff"
  light-tag-background: "rgba(0, 117, 110, 0.11)"
  light-tag-foreground: "#005d57"
  light-forest: "#17110d"
  light-muted-foreground: "#6a635c"
  light-destructive: "#c0392b"
  # Shadow ink -- the warm foreground at low alpha, never neutral black: a
  # black shadow on the warm ground reads as a cold gray smudge.
  shadow-ink-soft: "rgba(27, 22, 18, 0.13)"
  shadow-ink-deep: "rgba(27, 22, 18, 0.55)"
typography:
  display:
    fontFamily: "'Avenir Next', 'Avenir', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "clamp(2.35rem, 5vw, 4.7rem)"
    fontWeight: 800
    lineHeight: 0.98
    letterSpacing: "-0.035em"
  body:
    fontFamily: "'Avenir Next', 'Avenir', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
  label:
    fontFamily: "'Avenir Next', 'Avenir', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontWeight: 700
rounded:
  pill: "999px"
  lg: "0.5rem"
  xl: "0.75rem"
  card: "28px"
  card-compact: "20px"
spacing:
  card-padding: "16px"
  button-padding: "11px 18px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-foreground}"
    rounded: "{rounded.pill}"
    padding: "{spacing.button-padding}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.pill}"
    padding: "{spacing.button-padding}"
  chip:
    backgroundColor: "{colors.tag-background}"
    textColor: "{colors.tag-foreground}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
  card-story:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.xl}"
    padding: "{spacing.card-padding}"
---

# Design System: Kakinotes

## Overview

**Creative North Star: "Night Field"**

Kakinotes reads as a documentary archive shown in a darkened room, not a travel-agency storefront.
A near-black ground lets photography carry the light; one saturated cyan is the only voice raised
above the neutrals, and it is spent on state and emphasis rather than decoration. Structure is
carried by hairline rules and mono numerals — the vocabulary of a catalogue or a record, not a
marketing page. The system is cinematic and credible: confident without being flashy, personal
without being social-media-coded. It explicitly rejects travel-agency gloss (star ratings,
"Explore Now" CTAs, traveller-count badges, avatar-stack social proof) and social-feed energy
(comment threads, like buttons) — see PRODUCT.md's Brand Commitments for the full anti-pattern
list, which this system enforces visually.

This palette began as a scoped exception on the landing page and was promoted to cover every
route. The warm paper / forest / terracotta "Field Journal" system it replaced is gone; no route
still uses it.

**Key Characteristics:**

- Near-black ground with cool off-white ink, and one cyan accent used sparingly
- Heavy sans throughout — no serif anywhere; Geist Mono carries every numeral and column label
- Flat, hairline-ruled surfaces at rest; shadow and lift appear only as a response to interaction
- Full-pill buttons and chips; the primary button is ghost-outline first, filling on hover
- Motion is one authored idea (a lens focus pull) expressed in CSS scroll timelines, never JS
  observers, and always collapses under `prefers-reduced-motion`

## Colors

A near-black ground and a cool off-white ink in the signature dark rendition; a **warm** off-white
ground and warm ink in its light counterpart — the same archive seen in daylight rather than in a
darkened room, not a different world. Exactly one saturated accent in both. Values below are written
`dark / light`.

Warmth lives ONLY in the neutrals. The accent stays cool teal in both renditions, so light mode is a
warm ground against a cool signal — not the warm-ground-plus-warm-primary (cream + brown) cliché, and
not a return to the retired Field Journal paper/terracotta world.

### Primary

- **Signal Cyan** (`#35d0c4` dark / **`#00756e` light**): the one accent. CTA fills and outlines,
  the active headline word, active filter chips, the live slide index, focus rings (`--ring`),
  progress fills. This is the one token that cannot simply invert: `#35d0c4` reads at ~10:1 on the
  near-black ground but only ~1.9:1 on a near-white one, so light mode uses a deepened rendition of
  the same hue (187°), which clears 4.5:1 as text on the page ground, on raised surfaces, and on
  `--surface-muted` (its tightest pairing at 4.53:1), as well as under white text as a fill
  (`--accent-foreground` is `#05070a` dark / `#ffffff` light).

### Neutral

- **Void** (`#05070a` dark / `#f6f3ef` light): page ground. Near-black rather than pure black; the
  light counterpart is a warm off-white (~L 0.97 OKLCH at hue 78), never stark `#fff` — a pure-white
  ground under near-black ink glared and read clinical, which is what this rendition replaced.
- **Ink** (`#f4f6f5` dark / `#1b1612` light): body text. 16.2:1 on its own ground.
- **Surface** (`#0d1218` dark / `#fdfbf8` light): raised surfaces — cards, panels, popovers. The
  light value is a warm near-white one step above the ground, never `#ffffff`.
- **Surface Muted** (`#10161d` dark / `#ece7e1` light): image placeholders, muted fills, inset
  wells.
- **Muted Ink** (`#98a6a5` dark / `#6a635c` light): secondary and supporting copy. Both clear
  4.5:1 on their own ground — never dim body text with an opacity below ~60% instead.
- **Fog** (`rgba(244, 246, 245, 0.14)` dark / `rgba(27, 22, 18, 0.15)` light): the only border
  colour in the system — the ink at low opacity, never a gray.
- **Deep Ink Band** (`--forest`: `#0d1a20` dark / `#17110d` light): the footer and other
  always-dark bands that sit slightly apart from the page ground.
- **Destructive** (`#ff6b6b` dark / `#c0392b` light): errors and destructive actions only.
- **Shadow ink** (`rgba(27, 22, 18, 0.13)` soft / `rgba(27, 22, 18, 0.55)` deep): shadows are the
  warm foreground at low alpha, never neutral black — a black shadow on the warm ground reads as a
  cold gray smudge. Same geometry and alpha as before, only the hue is pulled onto the palette.

### Named Rules

**The One Accent Rule.** Signal Cyan is the only colour used for calls-to-action and emphasis.
Semantic status colours (approve-green, reject-red) are permitted in the staff moderation tools,
where they carry meaning rather than brand, and nowhere else.

**The Two Renditions Rule.** Every colour decision is made for both themes at once, and neither is
an inversion of the other. Before adding a literal colour, check it against both grounds; if it
only works on one, it needs a token with two values, not a `dark:` override.

**The Always-Dark Band Rule.** A few surfaces are permanently dark in BOTH themes because they are
full-bleed photography under a scrim: the landing hero and the `.journiq-share` contribute band.
Tokens still flip underneath them, so anything token-driven inside one resolves to the _light_
rendition against a near-black photo — which is how the hero's CTA once rendered as near-black ink
on a near-black photo (1.1:1, effectively invisible) and the accent word came out as the deep teal
instead of the signature cyan. Mark such a section `.nf-dark-band` (`app/globals.css`), which pins
`--foreground`/`--accent`/`--accent-foreground`/`--muted-foreground`/`--border-subtle` to their dark
values so the band behaves exactly as it does in dark mode. A component that can appear both inside
and outside such a band — `.night-button-primary` is the live example — takes `color: inherit`
rather than any token, so it is correct in both without a call-site flag.

## Typography

**Display & Body Font:** Avenir Next (with an -apple-system/Segoe UI/Roboto fallback stack for
non-Apple platforms, since Avenir Next is not freely redistributable and isn't bundled). One
family carries the whole interface; display is separated from body by weight and tracking, not by
a second face.
**Mono:** Geist Mono (`--font-geist-mono`, via `next/font/google`) — a structural voice, not just
a code face: every numeral, column label, entry count, and index field is set in it.

**Character:** Heavy, tightly-tracked sans against generous neutrals, with mono used the way a
catalogue uses it — for the parts that are a record rather than prose.

### Hierarchy

- **Display** (`clamp(2.35rem, 5vw, 4.7rem)`, weight 800, line-height 0.98, tracking -0.035em):
  the `.journiq-heading` utility — hero and page headlines.
- **Section** (`clamp(2rem, 4.4vw, 3.6rem)`, weight 800, line-height 1.03, tracking -0.03em): the
  `.night-heading` utility — section headings. Same lettering as Display, one step down.
- **Body** (default weight): all running copy and UI text.
- **Label** (weight 700–900): nav links, button labels, chip text — bold-to-black weight is the
  signal that something is interactive or structural, not just decorative.
- **Record** (Geist Mono, `text-xs`, tracking 0.18em on axis labels): numerals, index fields,
  column headers, entry counts.

### Named Rules

**The No-Serif Rule.** There is no serif in this system. The Georgia display face belonged to the
retired Field Journal palette; reintroducing one anywhere reads as a leftover, not an editorial
flourish.

**The Display-Clamp Rule.** `.journiq-heading` and `.night-heading` both carry a font-size clamp
and are defined after Tailwind's utilities, so they **win** over a `text-xl`-style override at
equal specificity. Use them for page and section headings only; a card- or entry-scale heading
takes the lettering explicitly (`font-extrabold`, `tracking-[-.02em]`) without the class.

**The Mono-Means-Record Rule.** Geist Mono marks data the reader can verify — a position, a year,
a place, a count. Never use it to make prose look technical.

## Layout

Container caps at `max-w-[1440px]` with `px-4 sm:px-6 lg:px-8`; section rhythm is
`py-16 sm:py-24 lg:py-28`. Mobile-first: grids, filter bars, and the header nav all collapse to a
single column / `MobileNavToggle` below the `md` breakpoint, with the header's primary nav and auth
controls hidden entirely on mobile in favour of a toggle. The sticky header holds a fixed
`min-h-[76px]` regardless of transparent/solid state, so toggling never causes layout shift — pages
that tuck content behind a transparent hero header supply their own `-mt-[76px]` rather than the
header changing size.

The landing hero is `h-[92svh]` clamped `min-h-[560px] max-h-[900px]` — `svh` rather than `vh` so a
collapsing mobile URL bar does not resize it mid-scroll, clamped so it stays cinematic on a short
phone without becoming a canyon on a tall desktop.

**The Two Shapes Rule.** A row that needs to become columns uses one grid, not two layouts: the
mobile shape is `[numeral | stacked content]`, and from `md` up an inner wrapper switches to
`display: contents` so its children drop into the parent grid as real columns
(`[numeral | thumb | title | meta | arrow]`). Never duplicate the markup per breakpoint.

## Elevation & Depth

Flat-by-default, lift-on-response. Surfaces sit at rest with a subtle border (`--border-subtle`)
and no shadow — story cards, chips, and inputs are all flat. Shadow and a small `translateY` lift
appear only as a hover/interaction response (story card hover: `shadow-md` + `-translate-y-1`;
buttons and icon controls: `-translate-y-0.5` to `-translate-y-1` plus, on the primary button hover
state, `box-shadow: 0 10px 24px rgba(0,0,0,0.13)`). The one deliberate exception is the featured
story-card-stack carousel, which uses a large diffuse shadow (`0 28px 78px rgba(0, 0, 0, 0.55)`)
to read as a stack of physical photographs rather than flat UI — depth there is a
content-specific, photo-like effect, not a general elevation system.

On the near-black ground a shadow does very little work; separation comes from the surface step
(`--surface` above `--background`) and from hairline rules, with shadow reserved for the two cases
below.

### Shadow Vocabulary

- **Hover lift** (`box-shadow: 0 10px 24px rgba(0, 0, 0, 0.13)`): primary button hover only.
- **Card hover** (Tailwind `shadow-md`): story card hover, paired with a 1px translateY lift.
- **Stack depth** (`box-shadow: 0 28px 78px rgba(0, 0, 0, 0.55)`): the featured story-card-stack
  carousel only — a neutral-dark ink, and not reused elsewhere.
- **Panel** (`box-shadow: 0 22px 70px rgba(0, 0, 0, 0.4)`): the destination-quiz card, the only
  resting shadow in the system.

These four shadow inks are recorded in `.impeccable/design.json` under `extensions.shadows`, which
is where the DESIGN.md format spec puts shadows; they are deliberately not palette colours.

### Named Rules

**The Rest-Is-Flat Rule.** Nothing carries a shadow at rest except the story-card-stack. If a
surface needs to look important while idle, reach for the border or a fill color, not a shadow.

## Shapes

Pill (`border-radius: 999px`) is the signature shape for anything interactive at button/chip scale
— primary/secondary buttons, filter chips, tag badges, icon-only controls (theme toggle, avatar
menu, carousel prev/next), and the destination-quiz progress bar. Cards use a softer `rounded-xl`
(12px, story cards) up to a deliberately large 28px on the featured story-card-stack (20px on
mobile) for its photo-stack feel. Inputs use the smaller `--radius` scale (`rounded-md`, 6px)
inherited from the shadcn/ui token mapping. Borders are always `--border-subtle`, never a harder
gray/black line.

## Components

### Buttons

- **Shape:** full pill (`border-radius: 999px`), `min-height: 46px`, `padding: 11px 18px`.
- **Primary:** `background: var(--accent)`, `color: var(--accent-foreground)`, `font-weight: 900`
  (black). Used via the `.journiq-button` utility class combined with `bg-accent
text-accent-foreground`.
- **Secondary / Ghost:** transparent or outlined — `border border-border-subtle` (or
  `border-white/60` on the transparent hero header), `font-weight: 700–900`, no fill.
- **Hover / Focus:** `translateY(-2px)` lift plus `box-shadow: 0 10px 24px rgba(0,0,0,0.13)` on
  hover (from `.journiq-button:hover`); focus-visible everywhere uses a 3px solid accent outline
  with 3px offset (`:focus-visible { outline: 3px solid var(--accent); outline-offset: 3px; }`).

### Chips / Tags

- **Style:** pill shape, `bg-tag-background` / `text-tag-foreground`, `text-xs`, `px-2 py-0.5`.
  Used for work-type and topic badges on story cards (max 3 shown).
- **Attribution chip:** a circular initial-letter avatar (`h-8 w-8 rounded-full bg-surface-muted`)
  plus name and trip metadata (destination pin icon, trip-year icon) — the reusable identity unit
  across story cards and story detail pages.

### Cards / Containers

- **Corner Style:** `rounded-xl` (12px) for the standard story card; 28px (20px mobile) for the
  featured story-card-stack.
- **Background:** `--surface` (white/dark-surface); `--surface-muted` for image placeholders.
- **Shadow Strategy:** flat at rest; see Elevation & Depth.
- **Border:** `border border-border-subtle` on the standard story card only — the story-card-stack
  relies on its shadow instead of a border.
- **Internal Padding:** `p-4` (16px) content padding under the cover image.

### Inputs / Fields

- **Style:** `rounded-md` (6px, the `--radius` step), `border border-border-subtle`, surface fill,
  `--foreground` text. Labels sit above the field in body weight.
- **Focus:** the global `:focus-visible` treatment — a 3px solid accent outline at 3px offset.
- **Error:** `text-destructive` for messages and field errors. Never a raw `text-red-*`: the
  themed token is the only error colour that clears contrast on both grounds.
- **Note:** the auth forms previously used a hardcoded `bg-black text-white` /
  `dark:bg-white dark:text-black` inversion. That idiom was removed app-wide (35 occurrences
  across 16 files) in favour of `bg-accent` / `text-accent-foreground`; it should not come back.

### Navigation

- **Style:** sticky header, transparent-over-hero gradient (`.journiq-header`) on the home route
  above the scroll threshold, solid (`.journiq-header-solid`, `var(--header-solid)`) everywhere
  else and once scrolled. Because `--header-solid` and `text-foreground` both resolve per theme,
  no route needs a special case — the header is one component in two states, not per-route
  variants. Nav links use `.journiq-nav-link`'s underline-on-hover treatment (accent-coloured
  underline that grows in from the left on hover).
- **Mobile:** primary nav and auth controls collapse behind `MobileNavToggle`; a signed-in user
  instead sees `UserAvatarMenu`, which folds the primary nav links into its own dropdown
  (`extraItems`) rather than keeping a separate hamburger.

### Auth Modal (signature component)

- Native `<dialog>`-based modal (`.journiq-modal`) with a standards-track `@starting-style` /
  `transition-behavior: allow-discrete` entrance-and-exit animation (opacity + `translateY(12px)
scale(0.96)` → resting state), backdrop fades independently. Fully collapses to no transition
  under `prefers-reduced-motion`.

## Do's and Don'ts

### Do:

- **Do** reserve Signal Cyan for CTAs, focus states, active filter chips, and the active-nav
  underline — see The One Accent Rule.
- **Do** decide every colour for both themes at once, and give it a token with two values rather
  than a `dark:` override — see The Two Renditions Rule.
- **Do** keep surfaces flat at rest and reserve shadow for hover response, the story-card-stack's
  photo-depth effect, or the quiz panel — see The Rest-Is-Flat Rule.
- **Do** use full-pill shape for any new interactive control at button/chip scale.
- **Do** set numerals, counts, and record fields in Geist Mono — see The Mono-Means-Record Rule.
- **Do** gate all new motion behind `prefers-reduced-motion: reduce` **and**
  `@supports (animation-timeline: view())`, matching every existing animation in
  `app/globals.css` — see The CSS-Timeline Rule.

### Don't:

- **Don't** add star ratings, review scores, "Book Now"/"Explore Now" CTAs, traveller-count
  badges, or avatar-stack social proof — confirmed anti-patterns in PRODUCT.md's Brand Commitments.
- **Don't** introduce a second accent colour competing with Signal Cyan. Semantic status colours
  are permitted only in the staff moderation tools, where they carry meaning rather than brand.
- **Don't** reintroduce a serif anywhere — see The No-Serif Rule.
- **Don't** style a control with a hardcoded `bg-black … dark:bg-white` inversion. That idiom was
  removed app-wide; primary actions take `bg-accent` / `text-accent-foreground`.
- **Don't** reach for a raw `text-red-*` for errors; use `text-destructive`, the only error colour
  that clears contrast on both grounds.
- **Don't** add a persistent shadow to a surface at rest outside the two documented exceptions.
- **Don't** reintroduce a scroll reveal that defaults to `opacity: 0` — content must be readable
  with no JS and in browsers without scroll timelines.
- **Don't** use emoji or Unicode glyphs as an icon system; icons are drawn SVG from
  `components/icons.tsx`.
- **Don't** render a placeholder dash for a field a story does not carry.

## Theming mechanics

`data-theme="light"|"dark"` on `<html>` is the single source of truth. A blocking inline script in
`app/layout.tsx` sets it before first paint (reads `localStorage`, falls back to `matchMedia`), and
`components/theme-toggle.tsx` flips it at runtime.

**The One Switch Rule.** That same attribute drives Tailwind's `dark:` variant, via
`@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *))` at the top of
`app/globals.css`. Without it Tailwind v4 keys `dark:` to the OS `prefers-color-scheme` while the
tokens key to `data-theme`, and the two silently disagree whenever a visitor's explicit choice
differs from their OS setting — which is exactly the bug it was added to fix. Never remove that
declaration, and never introduce a second theming signal alongside it.

The bare `:root` block plus the `prefers-color-scheme` block are only the pre-hydration/no-JS
fallback; an explicit `[data-theme]` attribute always wins, because attribute selectors outrank the
plain `:root` pseudo-class regardless of source order.

## The archive index

Structure seed `494761b9` (`--scope surface --mode persuade`), assigned candidate 7: **the archive
index**. The page's spine is a real catalogue, not a sequence of photo-card grids.

The page previously carried three separate browse surfaces — a featured stack, a filter-chip card
grid, and a region tile grid — all rendering the same small batch of stories in three shapes. Those
are consolidated into one `StoryIndex` (`components/home/story-index.tsx`): hairline-ruled entries
(`.nf-entry`), mono numerals, and columns that are fields the story actually carries. Section order
is hero → featured lead → index → why-you-can-trust → quiz → contribute.

**The Real Fields Rule.** Every index column is a field the record actually holds (place, work,
trip year). A field a story lacks is omitted, never rendered as a placeholder dash, and never
estimated. Filter axes are built only from values present in the fetched batch, and an axis is
rendered only when it can actually split that batch — a control that would return everything is
not shown.

**The Separate Axes Rule.** Place (regions), Work (work types), and Topic (tags) are distinct
filter axes. Never merge tags into the Work axis: it files "South Island" as a kind of job.

## Motion — the focus pull

One authored idea, varied: content resolves from soft to sharp the way a lens pulls focus, matching
the world's documentary-photography premise. `.nf-pull` (blur + rise, for section heads and large
blocks) and `.nf-lift` (rise only, shorter throw, for repeated rows — twelve elements blurring at
once reads as a broken page, not a focus pull). `.nf-hero-pull` runs the same grammar once on load.

**The CSS-Timeline Rule.** Scroll-linked motion uses CSS `animation-timeline` (`view()` / `scroll()`),
never a JS IntersectionObserver or scroll listener. The whole block is gated behind
`@supports (animation-timeline: view())` **and** `prefers-reduced-motion: no-preference`, so content
is fully visible by default — with no JS, in browsers without scroll timelines (Firefox today), and
for reduced-motion visitors. The previous `Reveal` component defaulted to `opacity: 0` and was
deleted; never reintroduce a reveal whose resting state is invisible.

A `.nf-progress` reading hairline under the sticky header is driven by `animation-timeline:
scroll(root block)` — same rule, no listener.

## Signature components

- **Primary button** (`.night-button-primary`): pill, `1px solid var(--accent)` outline at rest,
  fills solid cyan with `--accent-foreground` text on hover — ghost-first, not filled-first.
- **Secondary action** (`.night-button-ghost`): plain underlined text link, not a second button
  shape — mirrors the "or see how this works" pattern in the hero.
- **Index entry** (`.nf-entry`): hairline top rule, no card border and no card background — the
  section reads as one continuous record rather than stacked tiles. Hover (pointer devices only)
  tints the row with `color-mix(in srgb, var(--accent) 7%, transparent)` and insets it 0.75rem;
  `:focus-within` gets the same tint so keyboard traversal reads identically.
- **Filter axis row**: edge-to-edge horizontal scroll on phones (`.nf-scroll-x`, scrollbar hidden —
  the cut-off chip is the affordance), wrapping normally from `sm` up.
- **Featured story card** (`FeaturedStorySlide`): deliberately **not** the stretched-link pattern
  `StoryCard` uses. The card is draggable, and a full-card `<a>` fights that gesture — it made the
  whole surface interactive, which the stack's pointer-down guard rejected, so the card could not
  be dragged at all. Only the title and the explicit "Read story" button navigate; every other
  part of the card is drag surface.
- **No kicker/eyebrow labels.** The `Eyebrow` component was deleted. Headings carry their own
  weight.
- **No glyph or emoji icons.** `DestinationQuiz`'s answer labels previously opened with emoji
  standing in for an icon system; those were removed rather than replaced, since the labels are
  self-describing. Icons are drawn SVG from `components/icons.tsx`.
