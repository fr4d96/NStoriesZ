"use client";

import * as React from "react";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { markdown as markdownLang } from "@codemirror/lang-markdown";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState, Prec } from "@codemirror/state";
import { autocompletion } from "@codemirror/autocomplete";

import { DEFAULT_EMBED_WIDTH } from "@/lib/story/markdown-media";
import { GalleryIcon } from "@/components/icons";
import { htmlPasteToMarkdown } from "@/lib/story/html-paste";
import {
  markdownImageCount,
  markdownWordCount,
  readingTimeMinutes,
} from "@/lib/story/markdown-text";
import { createMarkdownLiveExtensions } from "./markdown-live-decorations";
import {
  insertMediaToken,
  insertTable,
  toggleLinePrefix,
  wrapSelection,
} from "./markdown-commands";
import { createSlashCommandSource, slashMenuTheme } from "./slash-commands";

// The four transforms moved to ./markdown-commands.ts so slash-commands.ts
// could reuse them without importing this client component (a cycle). They
// are re-exported here so the original import path -- used by
// markdown-editor.test.ts -- keeps working.
export {
  wrapSelection,
  toggleLinePrefix,
  insertTable,
  insertMediaToken,
} from "./markdown-commands";

export type MarkdownEditorHandle = {
  replaceValue: (text: string) => void;
  /**
   * Inserts an already-uploaded image's embed token at the cursor. Images
   * are uploaded exclusively through image-upload-manager.tsx's "Images"
   * panel now (never from within this editor -- see this file's removed
   * ImageButton/ImageUploadContext, superseded by that panel's own "Add to
   * story" action); this is the other half of that flow, called via
   * StoryContentEditorHandle from story-edit-form.tsx.
   */
  insertMedia: (mediaId: string, width?: number) => void;
};

export type MarkdownEditorProps = {
  initialValue: string;
  onChange: (text: string) => void;
  editable?: boolean;
  ariaLabel?: string;
  /**
   * Takes the contributor to the Images panel. Wired to the slash menu's
   * "Photo" entry and the toolbar's image button -- uploading still happens
   * only in image-upload-manager.tsx, so this points at it rather than
   * duplicating the upload flow.
   */
  onRequestImages?: () => void;
};

// --- Paste ----------------------------------------------------------------

/**
 * Rich paste. CodeMirror's own paste handler reads `text/plain`, so pasting
 * a story out of Google Docs / Word / Notion used to lose every heading,
 * bold, italic, link and list -- the single biggest friction point found in
 * docs/editor-competitive-research.md, and one contributors hit immediately
 * because CLAUDE.md says their content already exists elsewhere.
 *
 * The conversion itself (and the Engineering Rule 7 reasoning behind it)
 * lives in lib/story/html-paste.ts. Nothing HTML-shaped survives it: the
 * only thing inserted is a Markdown string, identical in kind to typed text.
 *
 * Falls back to CodeMirror's normal plain-text paste whenever there is no
 * HTML flavour, the conversion fails, or a limit is hit -- never a partial
 * or truncated insert.
 */
function createPasteHandler(onNotice: (message: string | null) => void) {
  return EditorView.domEventHandlers({
    paste(event, view) {
      const clipboard = event.clipboardData;
      if (!clipboard) return false;

      const html = clipboard.getData("text/html");
      if (!html.trim()) return false;

      // "Select a phrase, paste a URL over it" is already handled by
      // @codemirror/lang-markdown's `pasteURLAsLink`, and it produces a
      // better result than converting the source page's anchor markup would.
      // Copying a link out of a web page puts BOTH text/plain and text/html
      // on the clipboard, so without this the feature would silently stop
      // working.
      const plain = clipboard.getData("text/plain").trim();
      if (!view.state.selection.main.empty && /^https?:\/\/\S+$/i.test(plain)) {
        return false;
      }

      const result = htmlPasteToMarkdown(html);
      if (!result.ok) return false;

      event.preventDefault();
      view.dispatch(view.state.replaceSelection(result.markdown));
      view.focus();
      onNotice(
        result.unsafeLinksRemoved > 0
          ? `Pasted. ${result.unsafeLinksRemoved} link${
              result.unsafeLinksRemoved === 1 ? "" : "s"
            } couldn't be kept — only web links (http/https) are allowed. The words are still there.`
          : null,
      );
      return true;
    },
  });
}

// --- Toolbar ---------------------------------------------------------------

function ToolbarButton({
  label,
  title,
  onClick,
  disabled,
}: {
  label: React.ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="flex h-8 min-w-8 items-center justify-center rounded px-1.5 text-sm font-medium hover:bg-surface-muted disabled:opacity-40"
    >
      {label}
    </button>
  );
}

const MARKDOWN_GUIDE_URL = "https://www.markdownguide.org/cheat-sheet/";

function MarkdownGuideLink() {
  return (
    <a
      href={MARKDOWN_GUIDE_URL}
      target="_blank"
      rel="noopener noreferrer"
      title="Markdown syntax guide (opens in a new tab)"
      aria-label="Markdown syntax guide (opens in a new tab)"
      className="flex h-8 w-8 items-center justify-center rounded-full border border-current text-xs font-semibold italic hover:bg-surface-muted"
    >
      i
    </a>
  );
}

/**
 * `sticky top-[76px]`, not `top-0`: components/site-header.tsx is itself
 * `sticky top-0 z-40` with a `min-h-[76px]` bar, so a toolbar pinned to 0
 * would sit underneath it and disappear. Sticking below the header is what
 * makes formatting reachable on a phone once you are several paragraphs
 * into a story with the keyboard up -- Engineering Rule 18, and the one
 * thing Bear's mobile "Formatting Keyboard" does that we did not.
 */
function EditorToolbar({
  getView,
  onRequestImages,
}: {
  getView: () => EditorView | null;
  onRequestImages?: () => void;
}) {
  const run = (fn: (view: EditorView) => void) => () => {
    const view = getView();
    if (view) fn(view);
  };

  return (
    <div className="sticky top-[76px] z-10 flex items-center gap-1 rounded-t-md border-b border-border-subtle bg-surface px-1.5 py-1">
      {/* Scrolls sideways rather than wrapping. At 375px the eleven buttons
          just overflow, and wrapping cost three stacked rows of chrome above
          the writing area on a phone -- the opposite of Engineering Rule 18.
          Keyboard users are unaffected: tabbing to a button scrolls it into
          view automatically. */}
      <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
        <ToolbarButton
          title="Heading"
          label="H"
          onClick={run((v) => toggleLinePrefix(v, "## "))}
        />
        <ToolbarButton
          title="Bold (Ctrl/Cmd+B)"
          label={<strong>B</strong>}
          onClick={run((v) => wrapSelection(v, "**", "**", "bold text"))}
        />
        <ToolbarButton
          title="Italic (Ctrl/Cmd+I)"
          label={<em>i</em>}
          onClick={run((v) => wrapSelection(v, "*", "*", "italic text"))}
        />
        <ToolbarButton
          title="Strikethrough (~~text~~)"
          label={<span className="line-through">S</span>}
          onClick={run((v) => wrapSelection(v, "~~", "~~", "struck text"))}
        />
        <div className="mx-1 h-5 w-px bg-surface-muted" />
        <ToolbarButton
          title="Quote"
          label="❝"
          onClick={run((v) => toggleLinePrefix(v, "> "))}
        />
        <ToolbarButton
          title="Bulleted list"
          label="•"
          onClick={run((v) => toggleLinePrefix(v, "- "))}
        />
        <ToolbarButton
          title="Numbered list"
          label="1."
          onClick={run((v) => toggleLinePrefix(v, "1. "))}
        />
        <ToolbarButton
          title="Checklist"
          label="☑"
          onClick={run((v) => toggleLinePrefix(v, "- [ ] "))}
        />
        <div className="mx-1 h-5 w-px bg-surface-muted" />
        <ToolbarButton
          title="Link (Ctrl/Cmd+K)"
          label="🔗"
          onClick={run((v) =>
            wrapSelection(v, "[", "](https://)", "link text"),
          )}
        />
        <ToolbarButton
          title="Table"
          label="▦"
          onClick={run((v) => insertTable(v))}
        />
        {onRequestImages && (
          <ToolbarButton
            title="Add a photo (opens the Images panel)"
            label={<GalleryIcon className="h-4 w-4" />}
            onClick={onRequestImages}
          />
        )}
      </div>
      <div className="shrink-0">
        <MarkdownGuideLink />
      </div>
    </div>
  );
}

// --- Editor ------------------------------------------------------------

export const MarkdownEditor = React.forwardRef<
  MarkdownEditorHandle,
  MarkdownEditorProps
>(function MarkdownEditor(
  {
    initialValue,
    onChange,
    editable = true,
    ariaLabel = "Story content",
    onRequestImages,
  },
  ref,
) {
  // Uncontrolled, like the Plate editor this replaces: `value` is only ever
  // read from this lazy initializer, never resynced from a changing prop --
  // resyncing on every parent re-render would fight the user's cursor
  // position (mutation queue debouncing means the parent re-renders often).
  const [initial] = React.useState(initialValue);
  const cmRef = React.useRef<ReactCodeMirrorRef>(null);
  const getView = React.useCallback(() => cmRef.current?.view ?? null, []);

  // Mirrors the document purely so the word count below can be derived from
  // it. Safe with the uncontrolled `value` above: @uiw/react-codemirror only
  // rewrites the document when the `value` PROP changes, and `initial` never
  // does -- a re-render alone (which already happens on every keystroke via
  // the parent's own setContent) does not touch the document.
  const [text, setText] = React.useState(initialValue);
  const [pasteNotice, setPasteNotice] = React.useState<string | null>(null);

  const handleChange = React.useCallback(
    (value: string) => {
      setText(value);
      // Clears a stale paste notice on the next edit. The paste's own
      // dispatch runs this synchronously BEFORE createPasteHandler sets the
      // notice, so a just-pasted message survives its own paste and is
      // dismissed by whatever the contributor types next.
      setPasteNotice(null);
      onChange(value);
    },
    [onChange],
  );

  React.useImperativeHandle(
    ref,
    () => ({
      replaceValue: (text: string) => {
        const view = getView();
        if (!view) return;
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: text },
        });
      },
      insertMedia: (mediaId: string, width?: number) => {
        const view = getView();
        if (view) insertMediaToken(view, mediaId, width ?? DEFAULT_EMBED_WIDTH);
      },
    }),
    [getView],
  );

  // Split in two on purpose. Everything that must never be rebuilt lives in
  // the `[]`-memoized half below: the language (rebuilding it would throw
  // away the parse state) and createMarkdownLiveExtensions() (whose signed
  // image-URL cache is per editor instance -- a new one every render would
  // re-mint a URL for every embedded image on every keystroke). Only the
  // slash-command source depends on `onRequestImages`, so even a caller
  // passing a fresh arrow function each render can at worst reconfigure
  // that one facet; CodeMirror keeps the plugin instances behind the
  // extension values that did not change.
  const stableExtensions = React.useMemo(
    () => [
      markdownLang(),
      EditorView.lineWrapping,
      createPasteHandler(setPasteNotice),
      // Ctrl/Cmd+B, +I and +K. Prec.high so these win over anything the
      // default keymap might bind later. Every one of them is also a
      // toolbar button, and every toolbar button is a real <button> -- so
      // formatting is reachable by mouse, by keyboard shortcut, and by
      // tabbing to the toolbar (Engineering Rule 19).
      Prec.high(
        keymap.of([
          {
            key: "Mod-b",
            run: (view) => {
              wrapSelection(view, "**", "**", "bold text");
              return true;
            },
          },
          {
            key: "Mod-i",
            run: (view) => {
              wrapSelection(view, "*", "*", "italic text");
              return true;
            },
          },
          {
            key: "Mod-k",
            run: (view) => {
              wrapSelection(view, "[", "](https://)", "link text");
              return true;
            },
          },
        ]),
      ),
      // Renames the completion popup's own accessible name, which CodeMirror
      // otherwise labels "Completions".
      EditorState.phrases.of({ Completions: "Story formatting commands" }),
      slashMenuTheme,
      ...createMarkdownLiveExtensions(),
    ],
    [],
  );

  const extensions = React.useMemo(
    () => [
      ...stableExtensions,
      autocompletion({
        override: [createSlashCommandSource({ onRequestImages })],
        // No type icons: this is a prose menu, not a code completion list.
        icons: false,
      }),
    ],
    [stableExtensions, onRequestImages],
  );

  const words = markdownWordCount(text);
  const minutes = readingTimeMinutes(words, markdownImageCount(text));

  return (
    <div>
      {editable && (
        <EditorToolbar getView={getView} onRequestImages={onRequestImages} />
      )}
      <div aria-label={ariaLabel} role="textbox" aria-multiline="true">
        <CodeMirror
          ref={cmRef}
          value={initial}
          onChange={handleChange}
          editable={editable}
          extensions={extensions}
          basicSetup={{
            lineNumbers: false,
            foldGutter: false,
            highlightActiveLine: false,
            // Configured explicitly above instead. Two `autocompletion()`
            // calls would mean two competing configs for one facet.
            autocompletion: false,
          }}
          theme="none"
          placeholder="Tell your story… or type / for headings, lists and quotes"
          className="min-h-40 px-1 py-2 text-base [&_.cm-editor]:min-h-40 [&_.cm-scroller]:overflow-auto"
        />
      </div>
      {editable && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-border-subtle px-2 py-1.5 text-xs text-muted-foreground">
          {/* Deliberately NOT an aria-live region: it changes on every
              keystroke, and a counter that announces itself hundreds of
              times while you write is worse than one you can read on
              demand. */}
          <p>
            {words === 1 ? "1 word" : `${words.toLocaleString()} words`}
            {minutes > 0 &&
              ` · ${minutes} min read${words < 150 ? " · aim for 150+ words" : ""}`}
          </p>
          {pasteNotice && (
            <p role="status" className="text-amber-700 dark:text-amber-400">
              {pasteNotice}
            </p>
          )}
        </div>
      )}
    </div>
  );
});
