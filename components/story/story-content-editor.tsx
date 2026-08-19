"use client";

import { forwardRef, useImperativeHandle, useRef } from "react";

import {
  markdownToStoryContent,
  storyContentText,
  type StoryContentBlock,
} from "@/lib/validation/story";
import { ContentBlockRenderer } from "./content-block-renderer";
import {
  MarkdownEditor,
  type MarkdownEditorHandle,
} from "./editor/markdown-editor";

export type StoryContentEditorProps = {
  initialContent: StoryContentBlock[];
  onChange: (blocks: StoryContentBlock[]) => void;
  editable?: boolean;
  ariaLabel?: string;
};

/**
 * Imperative escape hatch from the "uncontrolled, initialContent loaded
 * once" design below, for exactly one caller: the editorial content-import
 * panel's "Use this content," which replaces the ENTIRE document wholesale
 * after a successful save -- a one-shot external replacement, not the
 * continuous re-sync-on-every-render this component deliberately avoids
 * (which would fight the user's cursor position during normal typing).
 */
export type StoryContentEditorHandle = {
  replaceContent: (blocks: StoryContentBlock[]) => void;
  /** Inserts an already-uploaded image's embed token at the cursor -- see
   * MarkdownEditorHandle.insertMedia's own comment. */
  insertMedia: (mediaId: string, width?: number) => void;
};

/**
 * Thin adapter between the canonical content_json shape (a single Markdown
 * block, see lib/validation/story.ts) and the plain-text-in/plain-text-out
 * CodeMirror component in ./editor/markdown-editor.tsx. There's no separate
 * Read/Write mode -- ./editor/markdown-live-decorations.ts already conceals
 * Markdown syntax everywhere except the line the cursor is on (Bear.app's
 * "live preview" behavior), so a single surface serves both reading and
 * editing. `editable={false}` (view-only contexts, no current caller) skips
 * CodeMirror entirely and renders the same fully-rendered output a reader
 * would see.
 */
export const StoryContentEditor = forwardRef<
  StoryContentEditorHandle,
  StoryContentEditorProps
>(function StoryContentEditor(
  { initialContent, onChange, editable = true, ariaLabel = "Story content" },
  ref,
) {
  const editorRef = useRef<MarkdownEditorHandle>(null);

  useImperativeHandle(
    ref,
    () => ({
      replaceContent: (blocks: StoryContentBlock[]) => {
        editorRef.current?.replaceValue(storyContentText(blocks));
      },
      insertMedia: (mediaId: string, width?: number) => {
        editorRef.current?.insertMedia(mediaId, width);
      },
    }),
    [],
  );

  if (!editable) {
    return (
      <div className="rounded-md border border-border-subtle px-3 py-2">
        <ContentBlockRenderer blocks={initialContent} />
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border-subtle">
      <MarkdownEditor
        ref={editorRef}
        initialValue={storyContentText(initialContent)}
        onChange={(text) => onChange(markdownToStoryContent(text))}
        editable={editable}
        ariaLabel={ariaLabel}
      />
    </div>
  );
});
