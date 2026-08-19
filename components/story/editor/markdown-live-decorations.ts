import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { type Extension, type Range, StateEffect } from "@codemirror/state";
import {
  MEDIA_EMBED_REGEX,
  clampEmbedWidth,
  mediaEmbedToken,
  removeMediaEmbeds,
} from "@/lib/story/markdown-media";

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Same markup/animation as components/ui/spinner.tsx, rebuilt with raw DOM
 * APIs since this widget isn't React -- Tailwind's `animate-spin` utility is
 * already compiled into the app's global stylesheet (that component uses
 * it), so referencing the class name here picks up the same CSS rather than
 * duplicating an @keyframes definition.
 */
function buildSpinner(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "animate-spin cm-md-image-spinner");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("role", "status");
  svg.setAttribute("aria-label", "Loading");

  const circle = document.createElementNS(SVG_NS, "circle");
  circle.setAttribute("cx", "12");
  circle.setAttribute("cy", "12");
  circle.setAttribute("r", "9");
  circle.setAttribute("stroke", "currentColor");
  circle.setAttribute("stroke-width", "3");
  circle.setAttribute("class", "cm-md-image-spinner-track");

  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", "M21 12a9 9 0 0 0-9-9");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "3");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("class", "cm-md-image-spinner-head");

  svg.appendChild(circle);
  svg.appendChild(path);
  return svg;
}

/**
 * Bear.app-style "live preview": the raw Markdown text is never rewritten --
 * CodeMirror decorations are a view-layer overlay only, so what's actually
 * stored/typed is always plain Markdown. Delimiter runs (`**`, `#`, `>`,
 * list markers, etc.) are fully CONCEALED (Decoration.replace with no
 * widget -- rendered as nothing, not just faded) everywhere EXCEPT the line
 * the cursor/selection currently touches, where the raw syntax is shown in
 * full so you can see what you're editing. This is the same technique
 * Obsidian/Typora's "live preview" mode uses, and is safer than deleting
 * the characters from the document (which would fight the user's cursor
 * mid-edit): concealed text is still real text at real document positions,
 * just zero-width on screen.
 *
 * Image embeds (`![[mediaId]]`) are the one exception to "conceal only off
 * the active line": Bear never shows raw image markup at all, cursor or not
 * -- you interact with the image itself. See MediaImageWidget below.
 */

class GlyphWidget extends WidgetType {
  constructor(
    readonly glyph: string,
    readonly cls: string,
  ) {
    super();
  }
  eq(other: GlyphWidget) {
    return other.glyph === this.glyph && other.cls === this.cls;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = this.cls;
    span.textContent = this.glyph;
    return span;
  }
  ignoreEvent() {
    return true;
  }
}

// --- Inline image widget: resolves a signed preview URL and lets the user
// drag-resize it, Bear-style ------------------------------------------------

type CacheEntry = string | "loading" | "error";

/** Refires the ViewPlugin's decoration build once an async URL resolves. */
const mediaResolvedEffect = StateEffect.define<void>();

/**
 * Per-editor-instance cache (one per `createMarkdownLiveExtensions()` call,
 * i.e. one per mounted editor) so switching lines/typing doesn't re-mint a
 * signed URL that's already been fetched. Deliberately does NOT refresh on
 * the URL's own ~120s expiry (see lib/story/image-pipeline.ts) -- same
 * accepted known limitation as image-upload-manager.tsx's thumbnail cache
 * for a single authoring session.
 *
 * The Server Action is imported dynamically, not at module scope: this
 * module has no "use client"/"use server" boundary of its own (it's a
 * headless CodeMirror extension, also pulled into non-Next test runners),
 * and the action's own module graph pulls in `server-only` transitively --
 * a static top-level import of it here throws immediately at module-load
 * time outside Next's own bundler (confirmed by the test suite). A dynamic
 * import defers that until an image widget actually needs to resolve a
 * URL, which never happens in headless/text-only tests.
 */
function createMediaUrlCache() {
  const store = new Map<string, CacheEntry>();
  return {
    get: (mediaId: string): CacheEntry | undefined => store.get(mediaId),
    request(mediaId: string, view: EditorView) {
      if (store.has(mediaId)) return;
      store.set(mediaId, "loading");
      import("@/app/(contributor)/stories/[id]/media-actions")
        .then(({ mintPreviewUrlAction }) => mintPreviewUrlAction(mediaId))
        .then((result) => {
          store.set(mediaId, "url" in result ? result.url : "error");
          view.dispatch({ effects: mediaResolvedEffect.of() });
        })
        .catch(() => {
          store.set(mediaId, "error");
          view.dispatch({ effects: mediaResolvedEffect.of() });
        });
    },
  };
}
type MediaUrlCache = ReturnType<typeof createMediaUrlCache>;

class MediaImageWidget extends WidgetType {
  // A snapshot of the cache's CURRENT entry, taken once at construction --
  // not read live from `cache` inside eq(). Both the old and new widget
  // instances being compared share the same underlying cache Map, so
  // calling cache.get() live from inside eq() would always compare "the
  // current value" against itself and never detect a loading -> resolved
  // transition; only a frozen-at-build-time snapshot lets eq() tell the two
  // apart and trigger a re-render once the URL actually resolves.
  readonly cachedValue: CacheEntry | undefined;

  constructor(
    readonly mediaId: string,
    readonly width: number | undefined,
    readonly tokenLength: number,
    readonly cache: MediaUrlCache,
  ) {
    super();
    this.cachedValue = cache.get(mediaId);
  }

  eq(other: MediaImageWidget) {
    return (
      other.mediaId === this.mediaId &&
      other.width === this.width &&
      other.tokenLength === this.tokenLength &&
      other.cachedValue === this.cachedValue
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement("span");
    wrap.className = "cm-md-image-wrap";
    wrap.contentEditable = "false";

    const cached = this.cachedValue;
    if (cached === "error") {
      wrap.className = "cm-md-image-status";
      wrap.textContent = "🖼 Image unavailable";
      return wrap;
    }
    if (!cached || cached === "loading") {
      // A small fixed-size box, not the image's eventual (often much
      // larger) target width -- there's no image to fill that width with
      // yet, just a spinner, so reserving the full final size read as an
      // oversized empty frame. Same spinner-in-a-frame idea as
      // image-upload-manager.tsx's loading tiles, scaled down to fit the
      // spinner with a little breathing room instead of the image's size.
      wrap.className = "cm-md-image-wrap";
      const box = document.createElement("div");
      box.className = "cm-md-image-loading-box";
      box.setAttribute("role", "status");
      box.setAttribute("aria-label", "Loading image…");
      box.appendChild(buildSpinner());
      wrap.appendChild(box);
      this.cache.request(this.mediaId, view);
      return wrap;
    }

    const img = document.createElement("img");
    img.src = cached;
    img.alt = "";
    img.draggable = false;
    img.className = "cm-md-image";
    if (this.width) img.style.width = `${this.width}px`;
    wrap.appendChild(img);

    // Removes just this image's embed token(s) from the document -- the
    // underlying upload/attachment is untouched (same split as
    // image-upload-manager.tsx's own "Remove", which instead fully detaches
    // the media; this is the lighter "take it out of the text" action).
    // Reuses removeMediaEmbeds() rather than a raw range delete so a
    // now-empty line collapses the same way handleMediaDetached's cleanup
    // already does for the Images panel's Remove button -- one strip
    // implementation, not two that could drift apart.
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "cm-md-image-remove-button";
    removeButton.setAttribute("aria-label", "Remove image from story");
    removeButton.setAttribute("title", "Remove image from story");
    removeButton.textContent = "×";
    removeButton.addEventListener("mousedown", (e) => e.preventDefault());
    removeButton.addEventListener("click", (e) => {
      e.preventDefault();
      const doc = view.state.doc.toString();
      const stripped = removeMediaEmbeds(doc, this.mediaId);
      if (stripped !== doc) {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: stripped },
        });
      }
      view.focus();
    });
    wrap.appendChild(removeButton);

    const handle = document.createElement("span");
    handle.className = "cm-md-image-resize-handle";
    handle.setAttribute("aria-hidden", "true");
    wrap.appendChild(handle);

    let startX = 0;
    let startWidth = 0;
    const onPointerMove = (e: PointerEvent) => {
      const next = clampEmbedWidth(startWidth + (e.clientX - startX));
      img.style.width = `${next}px`;
    };
    const onPointerUp = () => {
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      const finalWidth = clampEmbedWidth(img.getBoundingClientRect().width);
      const from = view.posAtDOM(wrap);
      const to = from + this.tokenLength;
      view.dispatch({
        changes: {
          from,
          to,
          insert: mediaEmbedToken(this.mediaId, finalWidth),
        },
      });
      view.focus();
    };
    handle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      startX = e.clientX;
      startWidth = img.getBoundingClientRect().width;
      document.addEventListener("pointermove", onPointerMove);
      document.addEventListener("pointerup", onPointerUp);
    });

    return wrap;
  }

  ignoreEvent() {
    return true;
  }
}

const INLINE_CODE_RE = /`([^`\n]+)`/g;
const LINK_RE = /\[([^\]\n]+)\]\(([^)\n]+)\)/g;
const BOLD_RE = /(\*\*|__)(?!\s)([^\n]+?)(?!\s)\1/g;
const STRIKE_RE = /~~(?!\s)([^\n]+?)(?!\s)~~/g;
const ITALIC_RE = /(\*|_)(?!\s)([^\n*_]+?)(?!\s)\1/g;
const HEADING_RE = /^ {0,3}(#{1,6})(\s+)(?=\S)/;
const QUOTE_RE = /^ {0,3}(>+)( ?)/;
const CHECKLIST_RE = /^(\s*)([-*+])(\s+)\[([ xX])\](\s+)/;
const LIST_RE = /^(\s*)([-*+]|\d+[.)])(\s+)/;
const FENCE_RE = /^\s{0,3}(```|~~~)/;

function computeFencedLines(doc: {
  lines: number;
  line: (n: number) => { text: string };
}) {
  const fenced = new Set<number>();
  let inFence = false;
  for (let i = 1; i <= doc.lines; i++) {
    const isFenceMarker = FENCE_RE.test(doc.line(i).text);
    if (isFenceMarker) {
      fenced.add(i);
      inFence = !inFence;
      continue;
    }
    if (inFence) fenced.add(i);
  }
  return fenced;
}

function collectInlineRanges(
  text: string,
  lineFrom: number,
  active: boolean,
  cache: MediaUrlCache,
): Range<Decoration>[] {
  const claimed = new Array<boolean>(text.length).fill(false);
  const out: Range<Decoration>[] = [];

  const claim = (s: number, e: number) => {
    for (let i = s; i < e; i++) claimed[i] = true;
  };
  const isFree = (s: number, e: number) => {
    for (let i = s; i < e; i++) if (claimed[i]) return false;
    return true;
  };
  // Conceals a delimiter run entirely (not just dimmed) when this isn't the
  // active line -- the raw characters are still in the document, just
  // rendered with zero width.
  const conceal = (s: number, e: number) => {
    if (!active && e > s) {
      out.push(Decoration.replace({}).range(lineFrom + s, lineFrom + e));
    }
  };
  const style = (s: number, e: number, cls: string) => {
    if (e > s)
      out.push(
        Decoration.mark({ class: cls }).range(lineFrom + s, lineFrom + e),
      );
  };

  // Always rendered as an image widget, active line or not -- see the
  // module comment for why images are the one exception to "reveal raw
  // syntax on the active line."
  for (const m of text.matchAll(new RegExp(MEDIA_EMBED_REGEX))) {
    const s = m.index ?? 0;
    const e = s + m[0].length;
    if (!isFree(s, e)) continue;
    claim(s, e);
    const mediaId = m[1].toLowerCase();
    const width = m[2] ? Number(m[2]) : undefined;
    out.push(
      Decoration.replace({
        widget: new MediaImageWidget(mediaId, width, m[0].length, cache),
      }).range(lineFrom + s, lineFrom + e),
    );
  }

  for (const m of text.matchAll(INLINE_CODE_RE)) {
    const s = m.index ?? 0;
    const e = s + m[0].length;
    if (!isFree(s, e)) continue;
    claim(s, e);
    conceal(s, s + 1);
    conceal(e - 1, e);
    style(s + 1, e - 1, "cm-md-code");
  }

  for (const m of text.matchAll(LINK_RE)) {
    const s = m.index ?? 0;
    const e = s + m[0].length;
    if (!isFree(s, e)) continue;
    claim(s, e);
    const textStart = s + 1;
    const textEnd = textStart + m[1].length;
    conceal(s, textStart);
    conceal(textEnd, e);
    style(textStart, textEnd, "cm-md-link");
  }

  for (const m of text.matchAll(BOLD_RE)) {
    const s = m.index ?? 0;
    const e = s + m[0].length;
    if (!isFree(s, e)) continue;
    claim(s, e);
    conceal(s, s + 2);
    conceal(e - 2, e);
    style(s + 2, e - 2, "cm-md-bold");
  }

  for (const m of text.matchAll(STRIKE_RE)) {
    const s = m.index ?? 0;
    const e = s + m[0].length;
    if (!isFree(s, e)) continue;
    claim(s, e);
    conceal(s, s + 2);
    conceal(e - 2, e);
    style(s + 2, e - 2, "cm-md-strike");
  }

  for (const m of text.matchAll(ITALIC_RE)) {
    const s = m.index ?? 0;
    const e = s + m[0].length;
    if (!isFree(s, e)) continue;
    claim(s, e);
    conceal(s, s + 1);
    conceal(e - 1, e);
    style(s + 1, e - 1, "cm-md-italic");
  }

  return out;
}

function buildDecorations(
  view: EditorView,
  cache: MediaUrlCache,
): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const doc = view.state.doc;
  const fencedLines = computeFencedLines(doc);
  const selRanges = view.state.selection.ranges;
  const isActiveLine = (line: { from: number; to: number }) =>
    selRanges.some((r) => r.from <= line.to && r.to >= line.from);

  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = doc.lineAt(pos);
      const active = isActiveLine(line);
      const text = line.text;

      if (fencedLines.has(line.number)) {
        ranges.push(
          Decoration.line({ attributes: { class: "cm-md-code-line" } }).range(
            line.from,
          ),
        );
        pos = line.to + 1;
        continue;
      }

      const headingMatch = HEADING_RE.exec(text);
      const quoteMatch = QUOTE_RE.exec(text);
      const checklistMatch = CHECKLIST_RE.exec(text);
      const listMatch = !checklistMatch ? LIST_RE.exec(text) : null;

      if (headingMatch) {
        const level = headingMatch[1].length;
        ranges.push(
          Decoration.line({
            attributes: { class: `cm-md-heading cm-md-h${level}` },
          }).range(line.from),
        );
        if (!active) {
          ranges.push(
            Decoration.replace({}).range(
              line.from,
              line.from + headingMatch[0].length,
            ),
          );
        }
      } else if (quoteMatch) {
        ranges.push(
          Decoration.line({ attributes: { class: "cm-md-quote" } }).range(
            line.from,
          ),
        );
        if (!active) {
          ranges.push(
            Decoration.replace({}).range(
              line.from,
              line.from + quoteMatch[0].length,
            ),
          );
        }
      } else if (checklistMatch) {
        const checked = checklistMatch[4].toLowerCase() === "x";
        ranges.push(
          Decoration.line({
            attributes: {
              class: checked
                ? "cm-md-checklist cm-md-checked"
                : "cm-md-checklist",
            },
          }).range(line.from),
        );
        const markerStart = line.from + checklistMatch[1].length;
        const markerEnd = line.from + checklistMatch[0].length;
        if (!active) {
          ranges.push(
            Decoration.replace({
              widget: new GlyphWidget(
                checked ? "☑" : "☐",
                "cm-md-checkbox-glyph",
              ),
            }).range(markerStart, markerEnd),
          );
        } else {
          ranges.push(
            Decoration.mark({ class: "cm-md-list-marker" }).range(
              markerStart,
              markerEnd,
            ),
          );
        }
      } else if (listMatch) {
        ranges.push(
          Decoration.line({ attributes: { class: "cm-md-list" } }).range(
            line.from,
          ),
        );
        const [, indent, marker] = listMatch;
        const markerStart = line.from + indent.length;
        const markerEnd = line.from + listMatch[0].length;
        // Ordered markers ("1.") stay visible (they carry real information
        // -- the sequence number) but bulleted markers ("-"/"*"/"+") become
        // a real bullet glyph off the active line, matching Bear.
        if (/\d/.test(marker)) {
          ranges.push(
            Decoration.mark({ class: "cm-md-list-marker" }).range(
              markerStart,
              markerEnd,
            ),
          );
        } else if (!active) {
          ranges.push(
            Decoration.replace({
              widget: new GlyphWidget("•", "cm-md-bullet-glyph"),
            }).range(markerStart, markerEnd),
          );
        } else {
          ranges.push(
            Decoration.mark({ class: "cm-md-list-marker" }).range(
              markerStart,
              markerEnd,
            ),
          );
        }
      }

      const bodyStart =
        (headingMatch?.[0].length ?? 0) ||
        (quoteMatch?.[0].length ?? 0) ||
        (checklistMatch?.[0].length ?? 0) ||
        (listMatch?.[0].length ?? 0);
      for (const r of collectInlineRanges(
        text.slice(bodyStart),
        line.from + bodyStart,
        active,
        cache,
      )) {
        ranges.push(r);
      }

      pos = line.to + 1;
    }
  }

  return Decoration.set(ranges, true);
}

// Atomic ranges for image tokens only (not the other concealed markup) --
// so Backspace/Delete/arrow-key navigation treats an embedded image as one
// object, the way clicking/deleting an image in Bear behaves, rather than
// stepping through dozens of invisible characters one at a time. Recomputed
// independently of buildDecorations (not reusing its output) because
// atomicRanges must never include the Decoration.mark ranges used for
// bold/italic/etc. styling -- only true replace/hide ranges are meant to be
// atomic.
function computeImageAtomicRanges(view: EditorView): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.sliceDoc(from, to);
    for (const m of text.matchAll(new RegExp(MEDIA_EMBED_REGEX))) {
      const s = from + (m.index ?? 0);
      ranges.push(Decoration.replace({}).range(s, s + m[0].length));
    }
  }
  return Decoration.set(ranges, true);
}

const imageAtomicRangesPlugin = ViewPlugin.fromClass(
  class {
    ranges: DecorationSet;
    constructor(view: EditorView) {
      this.ranges = computeImageAtomicRanges(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.ranges = computeImageAtomicRanges(update.view);
      }
    }
  },
);

/**
 * Builds the full live-preview extension set for one editor instance. A
 * factory (not a static export) because the inline-image URL cache
 * (createMediaUrlCache) must be scoped per editor, not shared globally.
 */
export function createMarkdownLiveExtensions(): Extension[] {
  const cache = createMediaUrlCache();
  const decorationsPlugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, cache);
      }
      update(update: ViewUpdate) {
        const resolved = update.transactions.some((tr) =>
          tr.effects.some((e) => e.is(mediaResolvedEffect)),
        );
        if (
          update.docChanged ||
          update.viewportChanged ||
          update.selectionSet ||
          resolved
        ) {
          this.decorations = buildDecorations(update.view, cache);
        }
      }
    },
    { decorations: (v) => v.decorations },
  );

  return [
    decorationsPlugin,
    imageAtomicRangesPlugin,
    EditorView.atomicRanges.of(
      (view) => view.plugin(imageAtomicRangesPlugin)?.ranges ?? Decoration.none,
    ),
    markdownLiveTheme,
  ];
}

// "Avenir Next" is macOS/iOS-only (matches Bear's own default editor font);
// the rest of the stack is cross-platform fallbacks so Windows/Linux/
// Android readers still get a comparable humanist sans, never a serif or
// the browser's generic default.
export const MARKDOWN_EDITOR_FONT_FAMILY =
  '"Avenir Next", "Avenir", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

const MONOSPACE_FONT_FAMILY =
  "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";

const markdownLiveTheme = EditorView.baseTheme({
  // Transparent/inherited rather than @uiw/react-codemirror's default light
  // theme (white background, black text) -- this editor sits inside pages
  // that switch between the app's own light/dark themes (see
  // document.documentElement.dataset.theme in app/layout.tsx), and a fixed
  // white box looked jarring in dark mode.
  "&": { fontSize: "1rem", backgroundColor: "transparent", color: "inherit" },
  ".cm-content": {
    fontFamily: MARKDOWN_EDITOR_FONT_FAMILY,
    lineHeight: "1.7",
    caretColor: "currentColor",
  },
  ".cm-line": { padding: "0 2px" },
  ".cm-cursor": { borderLeftColor: "currentColor" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "color-mix(in srgb, currentColor 20%, transparent)",
  },
  ".cm-placeholder": {
    color: "color-mix(in srgb, currentColor 45%, transparent)",
    fontFamily: MARKDOWN_EDITOR_FONT_FAMILY,
  },
  ".cm-md-heading": { fontWeight: "600", lineHeight: "1.3" },
  ".cm-md-h1": { fontSize: "1.6em" },
  ".cm-md-h2": { fontSize: "1.4em" },
  ".cm-md-h3": { fontSize: "1.2em" },
  ".cm-md-h4": { fontSize: "1.1em" },
  ".cm-md-h5": { fontSize: "1.05em" },
  ".cm-md-h6": { fontSize: "1em" },
  ".cm-md-quote": {
    borderLeft: "3px solid color-mix(in srgb, currentColor 25%, transparent)",
    paddingLeft: "0.75em",
    fontStyle: "italic",
    opacity: "0.9",
  },
  ".cm-md-list, .cm-md-checklist": { paddingLeft: "0.25em" },
  ".cm-md-list-marker": {
    color: "color-mix(in srgb, currentColor 70%, transparent)",
    fontWeight: "600",
  },
  ".cm-md-bullet-glyph": { fontWeight: "700", paddingRight: "0.15em" },
  ".cm-md-checkbox-glyph": { fontSize: "1.05em", paddingRight: "0.2em" },
  // Struck through to read as "done", but never dimmed as a whole line --
  // a full-opacity strikethrough is legible; a dimmed-and-struck line
  // easily reads as "not there at all."
  ".cm-md-checked": { textDecoration: "line-through" },
  ".cm-md-bold": { fontWeight: "700" },
  ".cm-md-italic": { fontStyle: "italic" },
  ".cm-md-strike": { textDecoration: "line-through" },
  ".cm-md-code": {
    fontFamily: MONOSPACE_FONT_FAMILY,
    fontSize: "0.9em",
    backgroundColor: "color-mix(in srgb, currentColor 10%, transparent)",
    borderRadius: "3px",
  },
  ".cm-md-code-line": {
    fontFamily: MONOSPACE_FONT_FAMILY,
    fontSize: "0.9em",
    backgroundColor: "color-mix(in srgb, currentColor 6%, transparent)",
  },
  ".cm-md-link": { textDecoration: "underline", textUnderlineOffset: "2px" },
  ".cm-md-image-wrap": {
    position: "relative",
    display: "inline-block",
    maxWidth: "100%",
    verticalAlign: "top",
    margin: "0.25em 0",
    lineHeight: "0",
  },
  ".cm-md-image": {
    display: "block",
    maxWidth: "100%",
    height: "auto",
    borderRadius: "6px",
  },
  ".cm-md-image-status": {
    display: "inline-block",
    padding: "0.4em 0.8em",
    borderRadius: "6px",
    backgroundColor: "color-mix(in srgb, currentColor 10%, transparent)",
    fontSize: "0.9em",
    lineHeight: "1.5",
  },
  ".cm-md-image-resize-handle": {
    position: "absolute",
    right: "4px",
    bottom: "4px",
    width: "14px",
    height: "14px",
    borderRadius: "4px",
    backgroundColor: "color-mix(in srgb, currentColor 70%, transparent)",
    boxShadow: "0 0 0 2px color-mix(in srgb, canvas 80%, transparent)",
    cursor: "nwse-resize",
    opacity: "0",
    transition: "opacity 120ms ease",
  },
  ".cm-md-image-wrap:hover .cm-md-image-resize-handle": { opacity: "0.85" },
  ".cm-md-image-remove-button": {
    position: "absolute",
    top: "4px",
    right: "4px",
    width: "20px",
    height: "20px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0",
    border: "none",
    borderRadius: "4px",
    lineHeight: "1",
    fontSize: "14px",
    color: "canvas",
    // Fixed dark red, not currentColor-derived like the resize handle --
    // this is a destructive action and should read as one regardless of
    // theme, the same way every other delete affordance in the app
    // (text-destructive) is a red distinct from ordinary UI chrome.
    backgroundColor: "#7f1d1d",
    boxShadow: "0 0 0 2px color-mix(in srgb, canvas 80%, transparent)",
    cursor: "pointer",
    opacity: "0",
    transition: "opacity 120ms ease",
  },
  ".cm-md-image-wrap:hover .cm-md-image-remove-button": { opacity: "0.85" },
  ".cm-md-image-remove-button:hover": { opacity: "1" },
  ".cm-md-image-loading-box": {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "56px",
    height: "56px",
    borderRadius: "6px",
    border: "1px solid color-mix(in srgb, currentColor 20%, transparent)",
    backgroundColor: "color-mix(in srgb, currentColor 8%, transparent)",
    color: "color-mix(in srgb, currentColor 45%, transparent)",
  },
  ".cm-md-image-spinner": {
    width: "24px",
    height: "24px",
  },
  ".cm-md-image-spinner-track": { opacity: "0.25" },
  ".cm-md-image-spinner-head": { opacity: "0.9" },
});
