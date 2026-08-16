"use client";

import * as React from "react";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { markdown as markdownLang } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";

import {
  MAX_IMAGES_PER_REVISION,
  MAX_UPLOAD_BYTES,
} from "@/lib/story/image-validation";
import { getErrorMessage } from "@/lib/errors";
import { mediaEmbedToken } from "@/lib/story/markdown-media";
import { useToast } from "@/components/ui/toast";
import { createMarkdownLiveExtensions } from "./markdown-live-decorations";

export type ImageUploadContext = {
  storyId: string;
  revisionId: string;
  versionRef: React.MutableRefObject<number>;
  onVersionBumped: () => void;
};

export type MarkdownEditorHandle = {
  replaceValue: (text: string) => void;
};

export type MarkdownEditorProps = {
  initialValue: string;
  onChange: (text: string) => void;
  editable?: boolean;
  ariaLabel?: string;
  /** See ImageUploadContext -- the "Image" toolbar button only shows up if this is passed. */
  imageUpload?: ImageUploadContext;
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

export function insertMediaToken(view: EditorView, mediaId: string) {
  const pos = view.state.selection.main.to;
  const needsLeadingNewline =
    pos > 0 && view.state.sliceDoc(pos - 1, pos) !== "\n";
  const insert = `${needsLeadingNewline ? "\n" : ""}${mediaEmbedToken(mediaId)}\n`;
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
      className="flex h-8 min-w-8 items-center justify-center rounded px-1.5 text-sm font-medium hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/10"
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
      className="flex h-8 w-8 items-center justify-center rounded-full border border-current text-xs font-semibold italic hover:bg-black/5 dark:hover:bg-white/10"
    >
      i
    </a>
  );
}

const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

function ImageButton({
  storyId,
  revisionId,
  versionRef,
  onVersionBumped,
  getView,
}: ImageUploadContext & { getView: () => EditorView | null }) {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const { showToast } = useToast();

  async function handleFile(file: File) {
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setError("Use JPEG, PNG, or WebP.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError("File is too large (max 15 MB).");
      return;
    }

    setError(null);
    setUploading(true);
    // Only feedback for this button before now was the toolbar icon
    // switching to "…" -- easy to miss, and gave no signal at all once the
    // upload finished (the inserted image widget itself starts as a
    // spinner too, see markdown-live-decorations.ts, so nothing visibly
    // changed at the moment of completion either). The toast is the
    // unmissable signal for both ends of the same operation
    // image-upload-manager.tsx already gives its own (separate) upload
    // surface.
    showToast(`Uploading ${file.name}…`);
    const formData = new FormData();
    formData.set("file", file);
    formData.set("revisionId", revisionId);
    formData.set("expectedVersion", String(versionRef.current));

    try {
      const response = await fetch(`/stories/${storyId}/edit/upload`, {
        method: "POST",
        body: formData,
      });
      const body = (await response.json()) as {
        mediaId?: string;
        error?: string;
      };
      if (!response.ok || !body.mediaId) {
        throw new Error(
          body.error ??
            `Upload failed (max ${MAX_IMAGES_PER_REVISION} images per story).`,
        );
      }
      versionRef.current += 1;
      onVersionBumped();
      const view = getView();
      if (view) insertMediaToken(view, body.mediaId);
      showToast(`${file.name} uploaded.`);
    } catch (err) {
      const message = getErrorMessage(err, "Upload failed.");
      setError(message);
      showToast(`${file.name} failed to upload.`, "error");
    } finally {
      setUploading(false);
    }
  }

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES.join(",")}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void handleFile(file);
        }}
      />
      <ToolbarButton
        title={error ?? "Insert image"}
        disabled={uploading}
        onClick={() => fileInputRef.current?.click()}
        label={uploading ? "…" : "🖼"}
      />
    </>
  );
}

function EditorToolbar({
  getView,
  imageUpload,
}: {
  getView: () => EditorView | null;
  imageUpload?: ImageUploadContext;
}) {
  const run = (fn: (view: EditorView) => void) => () => {
    const view = getView();
    if (view) fn(view);
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-0.5 border-b border-black/10 px-1.5 py-1 dark:border-white/10">
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
        <div className="mx-1 h-5 w-px bg-black/10 dark:bg-white/10" />
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
        <div className="mx-1 h-5 w-px bg-black/10 dark:bg-white/10" />
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
        {imageUpload && <ImageButton {...imageUpload} getView={getView} />}
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
  {
    initialValue,
    onChange,
    editable = true,
    ariaLabel = "Story content",
    imageUpload,
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
      {editable && (
        <EditorToolbar getView={getView} imageUpload={imageUpload} />
      )}
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
