"use client";

import * as React from "react";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { markdown as markdownLang } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";

import {
  mediaEmbedToken,
  DEFAULT_EMBED_WIDTH,
} from "@/lib/story/markdown-media";
import { createMarkdownLiveExtensions } from "./markdown-live-decorations";

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
};

// --- Plain-text transforms the toolbar drives -----------------------------
// Every operation manipulates raw Markdown syntax at the cursor/selection --
// there is no document tree to keep in sync, unlike the previous Plate
// editor's toolbar. See markdown-live-decorations.ts for how that syntax
// then renders live.

// Exported for headless unit tests (see markdown-editor.test.ts) -- the
// same pattern lib/story/plate-serialize.test.ts used to use for the
// previous editor: drive the real transform functions against a headless
// EditorView, no React rendering needed.
export function wrapSelection(
  view: EditorView,
  before: string,
  after: string,
  placeholder: string,
) {
  view.dispatch(
    view.state.changeByRange((range) => {
      const selectedText = range.empty
        ? placeholder
        : view.state.sliceDoc(range.from, range.to);
      return {
        changes: {
          from: range.from,
          to: range.to,
          insert: `${before}${selectedText}${after}`,
        },
        range: EditorSelection.range(
          range.from + before.length,
          range.from + before.length + selectedText.length,
        ),
      };
    }),
  );
  view.focus();
}

function selectedLineNumbers(view: EditorView): number[] {
  const nums = new Set<number>();
  for (const range of view.state.selection.ranges) {
    const startLine = view.state.doc.lineAt(range.from).number;
    const endLine = view.state.doc.lineAt(range.to).number;
    for (let n = startLine; n <= endLine; n++) nums.add(n);
  }
  return [...nums].sort((a, b) => a - b);
}

export function toggleLinePrefix(view: EditorView, prefix: string) {
  const lines = selectedLineNumbers(view).map((n) => view.state.doc.line(n));
  const allHavePrefix = lines.every((line) => line.text.startsWith(prefix));
  const changes = lines.map((line) =>
    allHavePrefix
      ? { from: line.from, to: line.from + prefix.length }
      : line.text.startsWith(prefix)
        ? { from: line.from, to: line.from }
        : { from: line.from, insert: prefix },
  );
  view.dispatch(view.state.update({ changes }));
  view.focus();
}

export function insertTable(view: EditorView) {
  const pos = view.state.selection.main.to;
  const needsLeadingNewline =
    pos > 0 && view.state.sliceDoc(pos - 1, pos) !== "\n";
  const table = `${needsLeadingNewline ? "\n" : ""}\n| Column 1 | Column 2 |\n| --- | --- |\n|  |  |\n`;
  view.dispatch({
    changes: { from: pos, insert: table },
    selection: { anchor: pos + table.length },
  });
  view.focus();
}

export function insertMediaToken(
  view: EditorView,
  mediaId: string,
  width?: number,
) {
  const pos = view.state.selection.main.to;
  const needsLeadingNewline =
    pos > 0 && view.state.sliceDoc(pos - 1, pos) !== "\n";
  const insert = `${needsLeadingNewline ? "\n" : ""}${mediaEmbedToken(mediaId, width)}\n`;
  view.dispatch({
    changes: { from: pos, insert },
    selection: { anchor: pos + insert.length },
  });
  view.focus();
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

function EditorToolbar({ getView }: { getView: () => EditorView | null }) {
  const run = (fn: (view: EditorView) => void) => () => {
    const view = getView();
    if (view) fn(view);
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-0.5 border-b border-border-subtle px-1.5 py-1">
      <div className="flex flex-wrap items-center gap-0.5">
        <ToolbarButton
          title="Heading"
          label="H"
          onClick={run((v) => toggleLinePrefix(v, "## "))}
        />
        <ToolbarButton
          title="Bold (**text**)"
          label={<strong>B</strong>}
          onClick={run((v) => wrapSelection(v, "**", "**", "bold text"))}
        />
        <ToolbarButton
          title="Italic (*text*)"
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
          title="Link"
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
      </div>
      <MarkdownGuideLink />
    </div>
  );
}

// --- Editor ------------------------------------------------------------

export const MarkdownEditor = React.forwardRef<
  MarkdownEditorHandle,
  MarkdownEditorProps
>(function MarkdownEditor(
  { initialValue, onChange, editable = true, ariaLabel = "Story content" },
  ref,
) {
  // Uncontrolled, like the Plate editor this replaces: `value` is only ever
  // read from this lazy initializer, never resynced from a changing prop --
  // resyncing on every parent re-render would fight the user's cursor
  // position (mutation queue debouncing means the parent re-renders often).
  const [initial] = React.useState(initialValue);
  const cmRef = React.useRef<ReactCodeMirrorRef>(null);
  const getView = React.useCallback(() => cmRef.current?.view ?? null, []);

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

  const extensions = React.useMemo(
    () => [
      markdownLang(),
      EditorView.lineWrapping,
      ...createMarkdownLiveExtensions(),
    ],
    [],
  );

  return (
    <div>
      {editable && <EditorToolbar getView={getView} />}
      <div aria-label={ariaLabel} role="textbox" aria-multiline="true">
        <CodeMirror
          ref={cmRef}
          value={initial}
          onChange={onChange}
          editable={editable}
          extensions={extensions}
          basicSetup={{
            lineNumbers: false,
            foldGutter: false,
            highlightActiveLine: false,
          }}
          theme="none"
          placeholder="Tell your story…"
          className="min-h-40 px-1 py-2 text-base [&_.cm-editor]:min-h-40 [&_.cm-scroller]:overflow-auto"
        />
      </div>
    </div>
  );
});
