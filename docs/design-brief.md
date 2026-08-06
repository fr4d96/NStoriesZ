# UI Design Brief — Journiq

This brief is written for an AI design tool ("Claude Design") with no prior context on this
project. It should be self-contained: read this document alone and you should have everything
needed to propose a modern, polished UI for three pages of a Next.js web app.

## 1. Product & audience

**Journiq** is a public website of real, first-person written stories from people who
have completed or are completing a Working Holiday Visa (WHV) in New Zealand. Readers are
people considering or preparing for the same trip — initially concentrated among Malaysian
travellers, but the product must not read as built for one nationality only. Contributors are
past/current WHV travellers who write and publish stories under a name, first-name-plus-initial,
or pseudonym of their choosing.

This is **not** a travel agency, booking site, social feed, or advice platform. It is closer to
a curated editorial publication or documentary archive: detailed, structured, searchable,
trustworthy accounts. There are no bookings, no purchases, no comments/likes/follows, and no
personalised advice. Every story must visibly carry a **"personal experience, not advice"**
label — this is a hard product requirement, not a footnote, so it needs a real place in the
design of the story detail page.

**Tone to design for:** trustworthy, warm, editorial/documentary, calm confidence. Not flashy,
not salesy, not social-media-coded.

**Explicit anti-patterns — do not include any of these:**

- Star ratings or review scores on stories
- "Book Now" / "Explore Now" / purchase-style CTAs
- Traveller headcount or social-proof stat badges (e.g. "1,250+ Happy Travelers")
- Comment threads, like buttons, follow buttons, avatars-in-a-row social proof
- Budgeting calculators, checklists, or interactive maps
- Any framing that implies personalised visa/legal/financial advice

## 2. Visual reference

A reference screenshot (a travel-agency template called "NavikX Technologies") was used as a
starting point for layout craft and visual confidence. Some of it applies here, some doesn't.

**Borrow from the reference:**

- A bold hero section: large headline, supporting copy, real photography
- Rounded card grids for browsing content
- Generous whitespace and a confident, large type scale
- Clear iconography for quick-scan information
- A clean, clear primary navigation bar

**Do not carry over from the reference:**

- Star-rating badges on cards
- "Explore Now" / booking-style CTA language
- Traveller-count stat badges and social-proof avatar stacks
- The specific dark-teal color scheme as a mandatory choice — see palette guidance below

## 3. Design system foundations

### Palette

There is currently no brand palette — only two CSS variables exist (`--background`,
`--foreground`, white/near-black, inverted for dark mode). You have latitude to propose a real
palette. Aim for something warm and editorial rather than corporate-travel-agency: a primary
accent color, a neutral ink/background pair for both light and dark mode, and 1–2 supporting
tones for tags/labels. The reference image's teal/green "calm outdoors" mood is a loose
starting point, not a target to match exactly.

### Typography

The app already uses **Geist Sans** and **Geist Mono** (via `next/font/google`), exposed as CSS
variables `--font-geist-sans` and `--font-geist-mono`. Design a type scale using these existing
fonts rather than introducing a new font family — no new font dependency should be assumed
available.

### Components to specify

- **Header / nav** — already exists and is functional; restyle it, don't redesign its
  structure (it currently handles desktop nav + a mobile dropdown toggle).
- **Footer** — already exists; restyle only.
- **Story card** — used in browse grids and homepage previews. Needs: title, short excerpt,
  destination/region, work type, trip year, contributor attribution (name/pseudonym), and
  visual space for a cover image. No rating, no "Explore Now" button.
- **Filter bar / panel** — for the browse page. Filters: region, destination, work type, trip
  year, travel style, reported cost band. Should work as a sidebar or a top bar; must collapse
  sensibly on mobile.
- **Story detail layout** — story content is a sequence of structured blocks: paragraph,
  heading, quote, list. It is never freeform rich text or raw HTML, so design for a fixed,
  predictable block vocabulary rather than an open-ended rich-text canvas. Images are not
  inline with text — they render as a separate ordered gallery, so the layout needs a distinct
  gallery placement (e.g. after the text, or as a side rail).
- **Contributor attribution chip** — name/pseudonym plus trip metadata (destination, year),
  reusable on both the story card and the story detail page.
- **"Personal experience, not advice" label** — a small, consistently-placed, always-visible
  component near the top of every published story.

### Layout principles

- **Mobile-first**: design the mobile layout first, then scale up to tablet/desktop — don't
  design desktop-down.
- **Accessibility**: semantic HTML structure, visible form labels, sufficient color contrast,
  full keyboard navigability. These are baseline requirements, not stretch goals.

## 4. Pages in scope

### Home

Status: exists today with placeholder copy and unstyled black/white Tailwind — needs a real
visual design.

- Hero: headline + supporting copy + real photography (not a booking search bar — if a search
  affordance is included, frame it as "find a story like yours," not a travel-booking search).
- A short value-proposition or "how this works" section explaining the story-driven,
  personal-experience model.
- A featured/recent-stories preview grid using the story card component.

### Browse / Stories

Status: does not exist yet — fully greenfield.

- Filter bar/panel (region, destination, work type, trip year, travel style, cost band).
- Responsive grid of story cards.
- A designed empty state (no results matching filters).
- A pagination or infinite-scroll pattern for the grid.

### Story Detail

Status: does not exist yet — fully greenfield.

- Reading-first layout: comfortable line length, clear visual hierarchy across
  paragraph/heading/quote/list blocks.
- Ordered image gallery, placed distinctly from the body text (not inline).
- Contributor attribution block.
- The "personal experience, not advice" label, placed prominently near the top.
- A related-stories module at the end of the page.

## 5. Technical constraints

- **No UI/animation libraries are currently installed** — no shadcn/ui, Radix, lucide-react,
  or Framer Motion. If a component library or icon set would meaningfully help, propose it
  explicitly as a suggestion rather than assuming it's already available.
- **Tailwind CSS v4** is the existing styling approach; designs should be expressible in
  utility classes/design tokens compatible with it.
- **Content is structured JSON, never arbitrary HTML** — the story detail design must work
  within a fixed set of block types, not an open rich-text editor's output.
- **Only published stories are ever shown publicly** — draft, pending, and rejected states are
  never part of these three pages' design; you only need to design the single "published,
  approved" reading/browsing experience.
