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
  moveMediaEmbed,
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

/**
 * The image currently being dragged, if any. Module-level rather than
 * carried in dataTransfer: dataTransfer only holds strings, and the drop
 * handler needs the token's exact source range in the document, which a
 * string round-trip cannot give back unambiguously when the same photo is
 * embedded twice.
 */
let activeImageDrag: {
  view: EditorView;
  from: number;
  to: number;
  /** The dragged photo's own element, so a drop onto itself is ignored. */
  wrap: HTMLElement;
} | null = null;

/**
 * Applies moveMediaEmbed() (lib/story/markdown-media.ts, where the actual
 * text transform lives and is unit-tested) to the editor's document.
 *
 * Replaces the document wholesale, which is the same approach the remove
 * button above already takes -- CodeMirror records it as one undoable
 * change either way.
 */
function moveEmbed(
  view: EditorView,
  from: number,
  to: number,
  targetPos: number,
  mode: "line" | "inline" = "line",
): void {
  const doc = view.state.doc.toString();
  const next = moveMediaEmbed(doc, from, to, targetPos, mode);
  if (next === doc) return;
  view.dispatch({
    changes: { from: 0, to: doc.length, insert: next },
    // Park the cursor after the moved token so the next keystroke types
    // where the photo now is, not wherever it used to be.
    selection: { anchor: Math.min(next.length, targetPos) },
  });
  view.focus();
}

/**
 * Where a dragged photo would land, given the pointer position.
 *
 * Two shapes, because there are two things a drop can mean. Over another
 * photo, the horizontal half decides: left of it or right of it, on the
 * SAME line, which is how photos end up side by side. Anywhere else, the
 * vertical half of the line under the pointer decides above or below — the
 * convention every list reorder uses, and the reason a drop indicator is
 * drawn at all: from a raw character position, dropping a photo
 * mid-sentence would split the sentence, which is never what was meant.
 */
type DropTarget =
  | { mode: "line"; pos: number }
  | { mode: "inline"; pos: number; rect: DOMRect; side: "left" | "right" };

/** The document range of the embed token rendered by `wrap`, if it is one. */
function tokenRangeAtDOM(
  view: EditorView,
  wrap: HTMLElement,
): { from: number; to: number } | null {
  const from = view.posAtDOM(wrap);
  const rest = view.state.sliceDoc(
    from,
    Math.min(view.state.doc.length, from + 64),
  );
  const match = new RegExp(`^${MEDIA_EMBED_REGEX.source}`, "i").exec(rest);
  if (!match) return null;
  return { from, to: from + match[0].length };
}

/**
 * The photo whose box contains this point, if any.
 *
 * Geometry, deliberately, rather than `document.elementFromPoint` or
 * `event.target`. An image widget is `contentEditable="false"` inside
 * CodeMirror's editable host, and the browser will not treat such an island
 * as a drop target: `dragover` fires happily over `.cm-line` and then STOPS
 * the moment the pointer crosses onto a photo (observed directly — the
 * event log for a real drag goes dragenter(.cm-line), dragover(.cm-line),
 * dragenter(.cm-md-image), dragend, with no dragover and no drop). Any
 * detection keyed on what the pointer is "over" therefore never fires
 * exactly where side-by-side placement needs it to.
 *
 * The companion half of the fix is `.cm-md-image-wrap { pointer-events:
 * none }` while a drag is running (see the dragging class below), which
 * lets those dragover events keep reaching the editable line underneath.
 * Together they mean the drop target no longer depends on hit-testing at
 * all — only on where the pointer actually is.
 */
function wrapAtPoint(
  view: EditorView,
  x: number,
  y: number,
  exclude: HTMLElement | null,
): HTMLElement | null {
  const wraps = view.dom.querySelectorAll<HTMLElement>(".cm-md-image-wrap");
  for (const wrap of wraps) {
    if (wrap === exclude) continue;
    const r = wrap.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
      return wrap;
    }
  }
  return null;
}

function resolveDropTarget(
  view: EditorView,
  x: number,
  y: number,
  draggedWrap: HTMLElement | null,
): DropTarget | null {
  const overWrap = wrapAtPoint(view, x, y, draggedWrap);
  if (overWrap) {
    const range = tokenRangeAtDOM(view, overWrap);
    if (range) {
      const rect = overWrap.getBoundingClientRect();
      const side = x < rect.left + rect.width / 2 ? "left" : "right";
      return {
        mode: "inline",
        pos: side === "left" ? range.from : range.to,
        rect,
        side,
      };
    }
  }

  const pos = view.posAtCoords({ x, y });
  if (pos == null) return null;
  const block = view.lineBlockAt(pos);
  const line = view.state.doc.lineAt(pos);
  return {
    mode: "line",
    pos: y < block.top + block.height / 2 ? line.from : line.to,
  };
}

/** Moves an embed one non-blank line earlier (-1) or later (+1). */
function moveEmbedByLine(
  view: EditorView,
  from: number,
  to: number,
  direction: -1 | 1,
): void {
  const doc = view.state.doc;
  const line = doc.lineAt(from);
  let n = line.number + direction;
  while (n >= 1 && n <= doc.lines && doc.line(n).text.trim() === "") {
    n += direction;
  }
  if (n < 1 || n > doc.lines) return;
  const neighbour = doc.line(n);
  moveEmbed(view, from, to, direction === -1 ? neighbour.from : neighbour.to);
}

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

    // --- Move: drag, or the two buttons for everyone who cannot drag ---
    //
    // The photos in a story stack vertically, and before this the only way
    // to reorder them was to delete an embed and re-add it from the Photos
    // step. The whole wrap is the drag surface (dragging the photo itself
    // is what people try first); the grip is the affordance that says so.
    const controls = document.createElement("span");
    controls.className = "cm-md-image-controls";

    const grip = document.createElement("span");
    grip.className = "cm-md-image-grip";
    grip.setAttribute("aria-hidden", "true");
    grip.title = "Drag to move this photo";
    grip.textContent = "⠿";
    controls.appendChild(grip);

    const currentRange = () => {
      const from = view.posAtDOM(wrap);
      return { from, to: from + this.tokenLength };
    };

    // Drag-and-drop is pointer-only, so it can never be the sole way to do
    // something (Engineering Rule 19 / WCAG 2.1.1). These buttons are the
    // keyboard and touch path to the identical operation, and they are
    // genuinely faster for a one-place nudge.
    for (const [direction, glyph, label] of [
      [-1, "↑", "Move photo earlier"],
      [1, "↓", "Move photo later"],
    ] as const) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "cm-md-image-move-button";
      button.setAttribute("aria-label", label);
      button.title = label;
      button.textContent = glyph;
      // mousedown default would move the text cursor into the widget and
      // also start the wrap's own drag; neither is wanted from a button.
      button.addEventListener("mousedown", (e) => e.preventDefault());
      button.addEventListener("click", (e) => {
        e.preventDefault();
        const { from, to } = currentRange();
        moveEmbedByLine(view, from, to, direction);
      });
      controls.appendChild(button);
    }
    wrap.appendChild(controls);

    wrap.draggable = true;
    wrap.addEventListener("dragstart", (e) => {
      const { from, to } = currentRange();
      activeImageDrag = { view, from, to, wrap };
      if (e.dataTransfer) {
        // Firefox refuses to start a drag with an empty dataTransfer, and
        // the token is the honest plain-text representation anyway -- a
        // drop into some other app pastes something meaningful.
        e.dataTransfer.setData("text/plain", view.state.sliceDoc(from, to));
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setDragImage(img, img.width / 2, 20);
      }
      wrap.classList.add("cm-md-image-dragging");
      // Lets dragover keep firing while the pointer is over ANY photo --
      // see wrapAtPoint()'s comment. Without it the browser stops
      // delivering drag events the moment the cursor crosses onto a
      // contentEditable="false" widget, which is precisely where a
      // side-by-side drop has to be detected.
      // contentDOM, NOT view.dom: EditorView.theme() scopes every selector
      // it generates *under* the editor root, so a rule written as
      // ".cm-md-dragging-images .cm-md-image-wrap" compiles to
      // ".cm-editor .cm-md-dragging-images .cm-md-image-wrap" and can never
      // match a class sitting on the root itself. .cm-content is a
      // descendant, and the wraps are inside it.
      view.contentDOM.classList.add("cm-md-dragging-images");
    });
    wrap.addEventListener("dragend", () => {
      activeImageDrag = null;
      wrap.classList.remove("cm-md-image-dragging");
      view.contentDOM.classList.remove("cm-md-dragging-images");
      hideDropIndicator(view);
    });

    const handle = document.createElement("span");
    handle.className = "cm-md-image-resize-handle";
    handle.setAttribute("aria-hidden", "true");
    wrap.appendChild(handle);

    // The resize handle and the remove button live INSIDE the drag surface,
    // so without this, grabbing either one starts a move instead of doing
    // its own job. Toggling `draggable` on hover is the reliable way --
    // stopPropagation on their pointer events does not prevent the drag,
    // because the drag originates from the element the pointer is over.
    for (const control of [handle, removeButton, ...controls.children]) {
      if (control === grip) continue;
      control.addEventListener("mouseenter", () => {
        wrap.draggable = false;
      });
      control.addEventListener("mouseleave", () => {
        wrap.draggable = true;
      });
    }

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
 * A horizontal accent rule showing exactly which line boundary a dragged
 * photo will land on. Without it the drop is a guess -- the pointer is
 * somewhere over a paragraph and "above or below this line?" is invisible.
 *
 * One element per editor, parented to the scroller and positioned in the
 * scroller's own coordinate space, so it stays put while the document
 * scrolls under a long drag.
 */
const dropIndicators = new WeakMap<EditorView, HTMLElement>();

function indicatorFor(view: EditorView): HTMLElement {
  let el = dropIndicators.get(view);
  if (!el) {
    el = document.createElement("div");
    el.className = "cm-md-image-drop-indicator";
    view.scrollDOM.appendChild(el);
    dropIndicators.set(view, el);
  }
  return el;
}

function showDropIndicator(view: EditorView, target: DropTarget): void {
  const scrollerBox = view.scrollDOM.getBoundingClientRect();
  const el = indicatorFor(view);

  if (target.mode === "inline") {
    // A vertical bar down the edge of the photo you are dropping beside --
    // the same shape a column-reorder shows, and unmistakably different
    // from the horizontal "new line here" rule.
    const x =
      (target.side === "left" ? target.rect.left : target.rect.right) -
      scrollerBox.left +
      view.scrollDOM.scrollLeft;
    el.style.left = `${x - 1}px`;
    el.style.right = "auto";
    el.style.top = `${target.rect.top - scrollerBox.top + view.scrollDOM.scrollTop}px`;
    el.style.width = "2px";
    el.style.height = `${target.rect.height}px`;
    el.style.display = "block";
    return;
  }

  const coords = view.coordsAtPos(target.pos);
  if (!coords) return;
  el.style.left = "0";
  el.style.right = "0";
  el.style.width = "auto";
  el.style.height = "2px";
  el.style.top = `${coords.top - scrollerBox.top + view.scrollDOM.scrollTop}px`;
  el.style.display = "block";
}

function hideDropIndicator(view: EditorView): void {
  const el = dropIndicators.get(view);
  if (el) el.style.display = "none";
}

/**
 * Editor-level drag handling for image embeds. Only engages while one of
 * THIS editor's images is being dragged: any other drag (text, a file
 * dropped in from the desktop) falls through to CodeMirror's own handling
 * untouched, which is what returning false from these handlers means.
 */
const imageDragHandlers = EditorView.domEventHandlers({
  // Cancelling dragenter is what marks the editor a valid drop target.
  // Chrome mostly infers it from dragover alone; Firefox does not, and
  // without this a drop there is refused outright.
  dragenter(event, view) {
    if (!activeImageDrag || activeImageDrag.view !== view) return false;
    event.preventDefault();
    return true;
  },
  dragover(event, view) {
    const drag = activeImageDrag;
    if (!drag || drag.view !== view) return false;
    const target = resolveDropTarget(
      view,
      event.clientX,
      event.clientY,
      drag.wrap,
    );
    if (!target) return false;
    // preventDefault is what actually permits a drop here -- without it the
    // browser treats the editor as an invalid target and the drop never
    // fires at all.
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    showDropIndicator(view, target);
    return true;
  },
  dragleave(event, view) {
    if (!activeImageDrag || activeImageDrag.view !== view) return false;
    // Only when the pointer has left the scroller itself, not on the
    // dragleave fired for every child element it passes over.
    if (view.scrollDOM.contains(event.relatedTarget as Node | null)) {
      return false;
    }
    hideDropIndicator(view);
    return false;
  },
  drop(event, view) {
    const drag = activeImageDrag;
    if (!drag || drag.view !== view) return false;
    event.preventDefault();
    hideDropIndicator(view);
    view.contentDOM.classList.remove("cm-md-dragging-images");
    drag.wrap.classList.remove("cm-md-image-dragging");
    const target = resolveDropTarget(
      view,
      event.clientX,
      event.clientY,
      drag.wrap,
    );
    activeImageDrag = null;
    if (!target) return true;
    moveEmbed(view, drag.from, drag.to, target.pos, target.mode);
    return true;
  },
});

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
    imageDragHandlers,
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
    // Right margin, not just vertical: two embeds on one line render as two
    // inline-block images, and without it they touch. The space character
    // moveMediaEmbed() inserts between them collapses to almost nothing at
    // this line-height.
    margin: "0.25em 0.4em 0.25em 0",
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
  ".cm-md-image-controls": {
    position: "absolute",
    top: "4px",
    left: "4px",
    display: "flex",
    alignItems: "center",
    gap: "2px",
    opacity: "0",
    transition: "opacity 120ms ease",
  },
  ".cm-md-image-wrap:hover .cm-md-image-controls": { opacity: "0.9" },
  // Keyboard users never trigger :hover, so the controls must also appear
  // when anything inside them takes focus -- otherwise the move buttons are
  // reachable by Tab but invisible.
  ".cm-md-image-controls:focus-within": { opacity: "1" },
  ".cm-md-image-grip": {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    // 24px, not the 20px the older remove/resize chrome uses: these are new
    // controls and WCAG 2.2's 24x24 minimum target size applies to them.
    width: "24px",
    height: "24px",
    borderRadius: "4px",
    fontSize: "12px",
    lineHeight: "1",
    color: "canvas",
    backgroundColor: "color-mix(in srgb, currentColor 70%, transparent)",
    boxShadow: "0 0 0 2px color-mix(in srgb, canvas 80%, transparent)",
    cursor: "grab",
  },
  ".cm-md-image-move-button": {
    width: "24px",
    height: "24px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0",
    border: "none",
    borderRadius: "4px",
    fontSize: "12px",
    lineHeight: "1",
    color: "canvas",
    backgroundColor: "color-mix(in srgb, currentColor 70%, transparent)",
    boxShadow: "0 0 0 2px color-mix(in srgb, canvas 80%, transparent)",
    cursor: "pointer",
  },
  ".cm-md-image-move-button:hover": {
    backgroundColor: "color-mix(in srgb, currentColor 90%, transparent)",
  },
  ".cm-md-image-dragging": { opacity: "0.4" },
  // Only while a photo is being dragged. See wrapAtPoint(): a
  // contentEditable="false" widget silently stops receiving drag events
  // inside an editable host, so the photos are made transparent to
  // hit-testing and the editable line underneath keeps delivering them.
  // `:not(.cm-md-image-dragging)` matters: making the DRAG SOURCE itself
  // non-hit-testable mid-drag makes Chrome abandon the drag outright
  // (observed — the event log collapses to dragstart, dragend, with no
  // dragenter or dragover at all). Only the other photos need to be
  // transparent, and the source is excluded from targeting anyway.
  ".cm-md-dragging-images .cm-md-image-wrap:not(.cm-md-image-dragging)": {
    pointerEvents: "none",
  },
  ".cm-md-image-drop-indicator": {
    position: "absolute",
    // left/right/top/width/height are all set inline by
    // showDropIndicator(): the same element serves as a horizontal "new
    // line here" rule and a vertical "beside this photo" bar.
    borderRadius: "2px",
    backgroundColor: "currentColor",
    opacity: "0.75",
    pointerEvents: "none",
    display: "none",
    zIndex: "5",
  },
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
