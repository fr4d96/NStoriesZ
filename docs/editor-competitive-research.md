# Story editor — competitive research and recommendations

Written 2026-08-31. Scope: how comparable platforms make it easy for someone who is **not a
professional writer** to produce a long, illustrated, first-person story — and which of those
patterns are worth copying into Kakinotes' contributor editor.

Read alongside [docs/product-spec.md](product-spec.md) (MVP Non-Goals bind everything below) and
[CLAUDE.md](../CLAUDE.md) Engineering Rules 6, 7, 18, 19, 20.

## What we have today (the baseline this is measured against)

- `components/story/editor/markdown-editor.tsx` — CodeMirror 6 (`@uiw/react-codemirror`),
  plain Markdown text in and out, plus a small always-visible toolbar.
- `components/story/editor/markdown-live-decorations.ts` — Bear.app-style live preview: Markdown
  syntax is concealed except on the line the cursor sits on. Images render inline and are
  drag-resizable.
- `components/story/story-content-editor.tsx` — adapter to `content_json`
  (`[{ type: "markdown", text }]`).
- `components/story/story-edit-form.tsx` — the whole authoring page: title, sub-title, story,
  images, dates, travel style, expenses, locations, tags, editor note.
- `components/story/image-upload-manager.tsx` — the only place images are uploaded; each uploaded
  image gets an "Add to story" button that inserts an `![[mediaId]]` embed token.
- Saving: debounced 600 ms autosave through `lib/story/mutation-queue.ts`, with a
  "Saving…"/"Saved" label in the page header.

Things that already work and needed no change (verified, not assumed):

- **Undo/redo** — `basicSetup` includes `@codemirror/commands`' `history()`, so Cmd/Ctrl-Z and
  Cmd-Shift-Z already work.
- **List continuation** — `markdown()` from `@codemirror/lang-markdown` ships `markdownKeymap` by
  default (`addKeymap` defaults to true), so Enter inside a bullet/numbered/checklist item already
  continues the list, and Backspace at the start of a marker already removes it.
- **Paste a URL over selected text** — `markdown()` also enables `pasteURLAsLink` by default, so
  selecting a phrase and pasting a URL already produces `[phrase](url)`.
- **Find in document** — `basicSetup` includes `searchKeymap`, so Cmd/Ctrl-F opens CodeMirror's own
  find panel inside a long story.

---

## Comparator by comparator

### Long-form writing / publishing

**Medium** ([story editor help](https://help.medium.com/hc/en-us/articles/215194537-Using-the-story-editor),
[tips for writers](https://medium.com/blog/tips-and-tricks-for-medium-writers-1d79498101c3))

- Distraction-free by default: no persistent toolbar, formatting appears on selection, a `+` button
  on an empty line reveals block inserts.
- Drag-and-drop **and multi-select** image placement straight into the body; clicking an image opens
  size/position controls.
- Word count on selection (select all → whole-story count) rather than a permanent counter.
- Autosave with cross-device draft sync.
- A "TK" checker — it warns you before publishing if you left the journalist's placeholder in.
- Paste a link on its own line + Enter → rich embed.

_Worth copying:_ drag/paste images into the body; a completeness check before submit (their TK
warning is a nudge, not a block).
_Not worth copying:_ selection-only word count (see Ghost below — a persistent count is better for
someone unsure whether they've written "enough"); rich link embeds (that is a content-model change,
and closer to the social/feed shape the product spec rules out).

**Substack** ([editor guide](https://on.substack.com/p/how-to-use-the-substack-editor),
[image options](https://support.substack.com/hc/en-us/articles/4414829453204-How-can-I-edit-images-on-a-Substack-post),
[features](https://substack.com/features))

- Drafts autosave and sync between web and app; version history.
- **Post templates** — a writer can save and re-open a skeleton post. This is the closest mainstream
  analogue to a guided outline.
- Alt text and caption are edited **on the image, in place**: click the image, three-dot menu,
  "Edit alt text" / "Edit caption".
- Cmd-K for links, including on images.

_Worth copying:_ alt text/caption edited where the image actually sits (we are worse than this
today — see the gap list below); Cmd-K.
_Not worth copying:_ version history — `story_revisions` already models revisions at the
publication level, and a second, editor-level history would confuse the moderation model
(Engineering Rules 10/11).

**Ghost / Koenig** ([new editor](https://ghost.org/changelog/new-editor/),
[Koenig](https://github.com/TryGhost/Koenig), [editor guide](https://luxethemes.com/resources/ghost-editor-guide))

- Type `/` on an empty line to open a searchable card menu — 30+ card types in Ghost 6, covering
  image, gallery, callout, embed, code, bookmark.
- Cards are self-contained and drag-reorderable; improved undo/redo chaining; explicitly called out
  "much improved mobile editing".
- Ghost's word count / reading-time model (275 wpm, plus a few seconds per image) is documented in
  the [`reading_time` helper](https://ghost.org/docs/themes/helpers/reading_time/).

_Worth copying:_ the slash menu (the single best discoverability pattern in this whole survey) and
the reading-time formula.
_Not worth copying:_ 30+ card types. Most are non-goals here (audio, video, embeds, paywall) or need
a content-model change. Our slash menu should offer exactly what the Markdown schema can already
express.

**WordPress / Gutenberg**
([what writers actually think](https://themeisle.com/blog/writers-bloggers-opinions-of-wordpress-block-editor/),
[UX and accessibility](https://www.abrightclearweb.com/user-experience-accessibility-gutenberg-wordpress-block-editor/))

Mostly a **negative** lesson, and a useful one. Writers describe the block editor as adding friction
versus the old plain writing surface; one quoted writer blames it for years of not blogging. Its
accessibility has been repeatedly criticised. The 2025 Commands API (a command palette) is an
admission that the block UI itself became hard to navigate.

_Worth copying:_ nothing structural.
_Explicitly not worth copying:_ a block-manipulation UI. Our contributors write one continuous
personal story; a block canvas is the wrong shape and Engineering Rule 6 pins the content model
anyway.

**Tumblr** — post-type-first (text / photo / quote / link), extremely low-ceremony, mobile-first.
_Worth copying:_ the low ceremony, which we already have.
_Not worth copying:_ post types; we have exactly one type.

### Travel-story specific

**Polarsteps** ([Stories](https://stories.polarsteps.com/),
[capture tips](https://stories.polarsteps.com/stories/how-to-capture-your-polarsteps-trip-your-way))

- The unit of writing is a **"step"** — one place, one day — not "a story". Small units are far less
  intimidating than a blank long-form page.
- Photos, text and tips per step; the app assembles the whole trip.
- Their own guidance to travellers is essentially a prompt list: _share the unexpected_, _set the
  scene_ with sensory details.

_Worth copying:_ the editorial guidance, as in-product writing prompts.
_Not worth copying:_ GPS tracking and the interactive map — both explicit MVP non-goals.

**Journi** ([site](https://www.journiapp.com/blog)) — groups photos automatically by time and
location, so a story partly writes itself from the camera roll; offline; photo books.
_Worth copying:_ nothing directly — the auto-grouping depends on EXIF time/GPS, and Engineering
Rule 14 requires us to strip that metadata.

**Steller / Exposure.co**
([Exposure](https://exposure.co/), [photo story how-to](https://photography.tutsplus.com/tutorials/how-to-craft-a-compelling-photo-story-with-exposure--cms-25846))

Both are photo-essay-first: a block editor where you insert photo arrangements, text blocks, quotes.
Beautiful output, but the writing surface is secondary to layout.
_Worth copying:_ the idea that a big photo with a caption carries narrative weight — an argument for
making captions and alt text easy, not an argument for a layout editor.
_Not worth copying:_ the grid/layout editor. That is a content-model change.

**Atlas Obscura** ([FAQ / place guidelines](https://www.atlasobscura.com/faq))

Their contributor guidance is short and concrete: lead with the most interesting thing; keep it
short and punchy; original writing only; include what a visitor should know.
_Worth copying:_ short, specific, in-context writing guidance next to the field it applies to —
they do not hide it in a separate style guide.

**Backpacker / WHV blogs (BackpackerGuide.NZ, NZ Pocket Guide, backpackerboard.co.nz)** — these are
WordPress-shaped publications with an editor-facing submission process, not a contributor product.
No editor pattern worth importing; the useful signal is that their contributor pages tell writers
what a good submission contains _before_ they start writing.

### Story elicitation (the closest analogue to our actual problem)

**StoryWorth** ([what is Storyworth](https://welcome.storyworth.com/what-is-storyworth),
[question guide](https://welcome.storyworth.com/blog/a-complete-guide-to-storyworths-questions))

The entire product is a prompt. One question a week, 500+ in the library, answerable by simply
replying to an email. No editor to learn. Photos attach to answers. The book assembles itself.

_Worth copying:_ **prompts are the product** for non-writers. A blank "Tell your story…" placeholder
is the hardest possible starting point.
_Not worth copying:_ the email/phone channel and the year-long drip (both are a different product
shape and the phone path is audio — an MVP non-goal).

**StoryCorps** ([Great Questions](https://storycorps.org/participate/great-questions/),
[conversation tips](https://storycorps.org/participate/tips-for-a-great-conversation/))

Their question design rules are directly reusable: avoid yes/no questions; open with
"Tell me about…" or "What was it like when…"; ask for sensory detail; let the storyteller steer.

_Worth copying:_ the question grammar, if and when we write a prompt library.
_Not worth copying:_ the interview format itself (two people, recorded audio).

### Editor UX generally

**Notion** ([slash commands](https://www.notion.com/help/guides/using-slash-commands),
[keyboard shortcuts](https://www.notion.com/help/keyboard-shortcuts))

- `/` opens a searchable block menu; typing narrows it. Markdown shortcuts (`# `, `- `, `[] `) work
  inline as you type.
- Notion's stated design goal is that everything is reachable without the mouse.

_Worth copying:_ both. We already have live Markdown shortcuts; the slash menu is the missing half.

**Bear** ([iOS shortcuts](https://bear.app/faq/ios-keyboard-shortcuts/),
[markdown](https://bear.app/faq/how-to-use-markdown-in-bear/)) — the model our editor already
copies. The part we did **not** copy is Bear's mobile "Formatting Keyboard": a formatting row that
sits above the on-screen keyboard, always in reach.

_Worth copying:_ keeping formatting reachable on mobile while the keyboard is up.

**Craft** — an outline-first document editor with strong mobile ergonomics.
_Worth copying:_ nothing specific beyond what Notion/Bear already cover.

---

## Concrete gaps found in our editor while doing this

Each of these was verified against the code or a headless CodeMirror run, not assumed.

1. **Pasting from Google Docs / Word / Notion loses every bit of formatting.** CodeMirror reads
   `text/plain` from the clipboard. Headings become plain lines, bold/italic/links vanish, lists
   become stray characters. CLAUDE.md says contributor content _already exists_ — so pasting is the
   likely first thing a contributor does, and it is currently the worst-supported action in the
   editor.
2. **No slash menu, and the toolbar has no keyboard path.** Every toolbar button is mouse-only in
   practice; Cmd/Ctrl-B, -I and -K do nothing.
3. **No word count or reading time.** A contributor has no idea whether their story is "long
   enough", and `runContentQualityChecks()` quietly flags anything under 150 words to editors
   without ever telling the contributor.
4. **On mobile the toolbar scrolls away.** It sits at the top of the editor box; once you are three
   paragraphs down with the keyboard up, it is off-screen.
5. **Alt text and captions become uneditable once an image is placed in the story.**
   `image-upload-manager.tsx` filters placed images out of the panel
   (`visibleMedia = media.filter((m) => !inlineMediaIds.has(m.mediaId))`), and alt text/caption are
   only editable in that panel. So the natural order — insert the photo where it belongs, then
   describe it — is impossible. This is also a WCAG problem (Engineering Rule 19) and it feeds the
   `images_missing_alt_text` moderation warning.
6. **A toast fires on every autosave.** `story-edit-form.tsx` calls `showToast("Draft saved.")`
   inside the debounced save, so writing a paragraph produces a stream of green toasts. No
   comparator does this; all of them use a quiet inline indicator.
7. **`closeBrackets()` is on** (via `basicSetup`) — a code-editor default in a prose editor.
   Confirmed by headless run: typing `"` after a space yields `""`, `(` yields `()`, `[` yields
   `[]`. An apostrophe directly after a word (`don't`) is correctly left alone, so this is a mild
   irritation rather than a bug.

---

## Prioritised recommendations

Scored contributor value (how much easier writing gets) against implementation cost, within the
additive-only, keep-CodeMirror, keep-the-Markdown-model constraints.

| #   | Recommendation                                                                         | Value         | Cost       | Status                                     |
| --- | -------------------------------------------------------------------------------------- | ------------- | ---------- | ------------------------------------------ |
| 1   | Rich paste: convert pasted HTML to our Markdown through a controlled, tested transform | Very high     | Medium     | **Built**                                  |
| 2   | Slash-command menu (`/`) for headings, lists, quote, checklist, table, link            | High          | Low–Medium | **Built**                                  |
| 3   | Word count + reading time under the editor                                             | High          | Low        | **Built**                                  |
| 4   | Keyboard shortcuts: Cmd/Ctrl-B, -I, -K                                                 | High          | Low        | **Built**                                  |
| 5   | Sticky toolbar so formatting stays reachable on mobile                                 | High (mobile) | Low        | **Built**                                  |
| 6   | Alt text + caption editable for images already placed in the story                     | High          | Medium     | **Built**                                  |
| 7   | Writing prompts / outline starter for a blank story                                    | Very high     | Medium     | **Recommended — needs a product decision** |
| 8   | Drag-and-drop / paste an image straight into the story body                            | High          | High       | **Recommended**                            |
| 9   | Completeness nudge in the editor ("still needed: a location, a tag")                   | Medium        | Low–Medium | **Recommended**                            |
| 10  | Replace the per-save toast with a quiet "Saved · 2 min ago"                            | Medium        | Low        | **Recommended**                            |
| 11  | Focus / distraction-free mode                                                          | Medium        | Medium     | **Recommended**                            |
| 12  | Turn `closeBrackets()` off for prose                                                   | Low           | Very low   | **Recommended**                            |
| 13  | Block/card editor, embeds, layout grids, version history in the editor                 | —             | —          | **Rejected**                               |

### Reasoning for the top items

**1. Rich paste.** Biggest single win, and the only one that changes whether an existing story can be
moved into Kakinotes at all. The product already owns a tested HTML→Markdown transform for editorial
import (`lib/story/content-import.ts`), which proves the shape is right; the contributor-side paste
needed a browser-safe sibling because `content-import.ts` calls Node's `Buffer` and pulls in
`node-html-parser` (~200 KB) — neither belongs in the client bundle. See "What was built" below for
how Engineering Rule 7 is satisfied.

**2. Slash menu.** Notion and Ghost both converged on this, and it is the only pattern that makes
block formatting _discoverable_ without permanent chrome. It is also cheap here: CodeMirror's own
autocomplete already renders `role="listbox"` / `role="option"` / `aria-selected` and drives
`aria-activedescendant` on the editor, with Arrow/Enter/Escape/Ctrl-Space bound — so we get the
[WAI-ARIA combobox behaviour](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/) without writing a
menu, which is exactly the Rule 19 trap a hand-rolled menu would fall into.

**3. Word count + reading time.** Every long-form comparator has one. It is the cheapest possible
answer to "have I written enough?", and it lets the contributor see the same signal
`runContentQualityChecks()` already computes for editors instead of being surprised at moderation.
Reading time uses Ghost's 275 wpm.

**4/5. Shortcuts and a sticky toolbar.** Rule 19 says everything must be keyboard-operable, and Rule
18 says mobile-first. Both are small and both were plainly missing.

**6. Alt text where the image is.** Substack's model. Ours is the inverse today and it produces
stories with no alt text at all.

### Reasoning for the things deliberately NOT built

**7. Writing prompts / outline starter — needs a product decision, not code.** This is the
highest-value idea in the whole survey (StoryWorth's entire business is this insight), and the
mechanism is cheap: a "Start from an outline" button that inserts `##` headings, or a rotating
prompt under the editor. What is _not_ cheap and _not_ mine to decide is **the prompt copy itself**.
The section headings of a WHV story ("Getting the visa", "Finding work", "What it cost") sit right
next to the line the product spec draws: Kakinotes publishes personal experience and explicitly not
personalised visa, legal, employment, tax or financial advice, and Engineering Rule 17 requires
every story to carry a "personal experience, not advice" label. A prompt that reads _"Explain how to
get your visa"_ invites exactly the content moderation exists to keep out; one that reads _"What was
the day you found your first job like?"_ (StoryCorps' grammar — open, past tense, personal, sensory)
does not. That difference is editorial policy. It should be written by whoever owns
[docs/moderation-guidelines.md](moderation-guidelines.md) and
[docs/content-governance.md](content-governance.md), reviewed for the advice boundary, and stored as
**data** (a table or a content file) rather than hard-coded — the same rule CLAUDE.md already applies
to nationality and work classification. Recommended shape: 8–12 prompts, StoryCorps grammar, one
shown at a time under the editor with "show me another", plus a single "insert an outline" action
that drops in `##` headings the contributor can rename or delete.

**8. Paste/drag an image straight into the body.** Genuinely valuable — Medium's drag-and-drop is the
nicest thing in this survey. Not built because it is not additive: uploads currently run through
`image-upload-manager.tsx`'s reservation flow (`beginMediaUploadAction` → direct-to-storage PUT →
`versionRef` bump on the shared `MutationQueue`), and doing it from inside the editor means either
hoisting that machinery out of the panel or duplicating it. Both mean restructuring
`story-edit-form.tsx`, which the brief rules out. The right sequencing is: extract the upload
routine into a hook first, as its own change, then let both the panel and the editor call it.

**9. Completeness nudge.** The submit gate already exists on the preview page
(`missingRequirements` in `app/(contributor)/stories/[id]/preview/page.tsx`). Mirroring it into the
editor means either importing a server-page concern into a client form or duplicating the list — and
a duplicated gate that drifts is worse than one gate in one place. Do it properly by lifting
`missingRequirements` into a shared pure function first.

**10. Quiet the save toast.** Left alone on purpose: removing existing behaviour is not additive, and
"how loud should saving be" is a product preference. But every comparator is quieter than we are, and
the header already shows "Saving…"/"Saved", so the toast adds nothing except motion while typing.

**11. Focus mode.** Real value, but it changes how the whole authoring page is laid out (the story
field is one of eleven on that page), and doing it well means deciding what happens to the image
panel, the location picker and the submit path while focused. That is a design decision.

**12. `closeBrackets()`.** One line (`basicSetup={{ closeBrackets: false }}`). Left out only because
it is a behaviour change to existing typing rather than an addition, and it is genuinely arguable —
auto-closing `[` is helpful for links, auto-closing `"` is not.

**13. Rejected outright.** A block/card editor (Ghost, Gutenberg, Exposure), rich link/media embeds
(Medium), layout grids (Steller), and an in-editor version history (Substack) are all rejected: they
either require changing `content_json`'s block schema — Engineering Rule 6, with every renderer,
migration and moderation path depending on it — or they land inside the MVP non-goals (audio/video,
social mechanics, maps). Auto-grouping photos by time and place (Journi) is rejected for a different
reason: it needs the EXIF timestamps and GPS that Engineering Rule 14 requires us to strip.

---

## What was built (2026-08-31)

Additive only. CodeMirror, the Markdown content model and the `![[mediaId]]` embed flow are
unchanged; `content_json`'s block schema is untouched; no migration and no database write.

- **`lib/story/html-paste.ts` (new)** — HTML → Markdown for pasted rich text.
  - Parses with the browser's `DOMParser` into a **detached, inert** document. Scripts never run and
    the parsed tree is never attached to the page or assigned via `innerHTML`, so Engineering Rule 7
    holds: no `dangerouslySetInnerHTML`, no raw HTML anywhere near the DOM or storage.
  - Same policy as the editorial importer: `script`/`style`/`iframe`/`object`/`embed`/`form`/`svg`/
    `math`/`noscript`/`template` subtrees are dropped whole and never read for text; container tags
    are unwrapped; unsupported leaves (`img`, `video`, `audio`, `input`, …) are dropped; `h1`
    collapses to `##` because `#` is reserved for the story title; every `href` goes through
    `isSafeHref()` and an unsafe one loses the link but keeps the text.
  - **Reads Google Docs' inline styles, not just tags.** Google Docs emits
    `<span style="font-weight:700">` rather than `<strong>`, and wraps the whole document in
    `<b style="font-weight:normal" id="docs-internal-guid-…">`. A tag-only converter loses every bit
    of emphasis from the single most likely source AND renders the entire paste bold. Only
    `font-weight`, `font-style` and `text-decoration: line-through` are read; the style attribute is
    inspected and discarded, never propagated.
  - `<br>` becomes a Markdown **hard** break (two trailing spaces) — a deliberate difference from the
    editorial importer's bare `\n`, which is a soft break and renders as a space, silently merging
    two lines the writer separated on purpose.
  - Escapes literal Markdown characters and leading block markers via the new
    **`lib/story/markdown-escape.ts`**, which `content-import.ts` now imports too, so the two
    "external text → our Markdown" paths cannot drift.
  - Hard caps: 2,000,000 characters, 20,000 nodes, depth 60. Looser than the importer's
    (2 MB / 5,000 / 40) on purpose: this runs in the contributor's own browser on their own
    clipboard, so the threat model is "don't hang the tab", and Google Docs' one-span-per-run markup
    means a long story legitimately passes 5,000 nodes. Anything over a cap, or any failure, returns
    `{ ok: false }` and the paste falls back to CodeMirror's plain-text paste. Never truncated.
  - No new dependency: `DOMParser` is a browser/jsdom built-in.
- **Paste handling** in `markdown-editor.tsx` — only engages when the clipboard actually carries
  `text/html`; a plain-text paste is untouched, so pasting Markdown still works exactly as before.
- **Slash-command menu** (`components/story/editor/slash-commands.ts`) —
  `@codemirror/autocomplete`, triggered by `/` at the start of a line's content only, so "24/7", a
  date or a URL never pops it open mid-sentence. Offers Heading, Smaller heading, Bulleted list,
  Numbered list, Checklist, Quote, Link, Table and Photo (which focuses the Images panel rather than
  uploading anything). Keyboard: Arrows, Enter, Escape, Ctrl-Space, all from CodeMirror's stock
  `completionKeymap`.
  - It ships with its own theme, and that was **not** cosmetic. CodeMirror's completion styling
    picks `&light`/`&dark` from the `EditorView.darkTheme` facet, and this editor sets `theme="none"`
    so it inherits the page's colours — leaving `darkTheme` false. The first browser check showed a
    white popup with the editor's near-white inherited text in dark mode: every option below the
    selected one was invisible. It now paints from `--surface` / `--foreground` / `--accent`.
- **Keyboard shortcuts** — Cmd/Ctrl-B bold, Cmd/Ctrl-I italic, Cmd/Ctrl-K link; the toolbar buttons
  advertise them in their tooltips/labels.
- **Word count and reading time** — under the editor, live, 275 wpm (Ghost's number), embed tokens
  and Markdown syntax stripped before counting.
- **Sticky toolbar** — pinned at `top-[76px]`, not `top-0`, because `components/site-header.tsx` is
  itself `sticky top-0 z-40` over a `min-h-[76px]` bar and a toolbar at 0 would vanish behind it. At
  375px the eleven buttons wrapped to three stacked rows of chrome above the writing area, so the
  button group scrolls sideways instead — one row on a phone, one row on desktop, and tabbing to a
  button still scrolls it into view. The photo button uses the app's own `GalleryIcon` rather than
  the 🖼 emoji, which rendered in full colour among otherwise monochrome glyphs.
- **Alt text and captions for placed images** — the image panel keeps images already in the story,
  in their own "N images in your story" group, with alt text, caption and the decorative flag still
  editable (plus Set as cover and Remove; no "Add to story", no reorder). Those three controls were
  extracted into a shared `MediaTextFields` component, which also gained the `aria-label`s they
  never had — a placeholder is not an accessible name.
