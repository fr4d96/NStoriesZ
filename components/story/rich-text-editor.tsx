"use client";

import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useState } from "react";
import { isSafeHref, type StoryContentBlock } from "@/lib/validation/story";
import {
  blocksToTiptapDoc,
  tiptapDocToBlocks,
} from "@/lib/story/rich-text-serialize";

/**
 * The single allowed extension configuration for story bodies — every
 * node/mark NOT in the canonical block/run/mark schema
 * (lib/validation/story.ts) is explicitly turned off here, so the editor
 * is structurally incapable of producing content the schema would reject.
 * See rich-text-editor.test.tsx's closed-loop test, which exercises every
 * allowed command and asserts the disallowed ones (underline, strike,
 * code, code block, horizontal rule, hard break) simply don't exist on
 * this configuration.
 */
export function storyEditorExtensions() {
  return [
    StarterKit.configure({
      heading: { levels: [2, 3] },
      // Disallowed marks/nodes — no representation in storyContentSchema.
      underline: false,
      strike: false,
      code: false,
      codeBlock: false,
      horizontalRule: false,
      hardBreak: false,
      link: {
        openOnClick: false,
        autolink: false,
        // Belt-and-suspenders: even though every submit path re-validates
        // via storyContentSchema server-side, the editor itself refuses to
        // apply an unsafe href in the first place.
        validate: (href: string) => isSafeHref(href),
        HTMLAttributes: { rel: "noopener noreferrer" },
      },
    }),
  ];
}

export type RichTextEditorProps = {
  initialContent: StoryContentBlock[];
  onChange: (blocks: StoryContentBlock[]) => void;
  editable?: boolean;
  ariaLabel?: string;
};

function ToolbarButton({
  onClick,
  active,
  disabled,
  label,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()} // keep editor selection/focus
      onClick={onClick}
      className={`rounded px-2 py-1.5 text-sm font-medium transition-colors ${
        active
          ? "bg-black/10 text-black dark:bg-white/20 dark:text-white"
          : "text-black/70 hover:bg-black/5 dark:text-white/70 dark:hover:bg-white/10"
      } disabled:cursor-not-allowed disabled:opacity-40`}
    >
      {children}
    </button>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const addLink = () => {
    const previousHref = editor.getAttributes("link").href as
      string | undefined;
    // A minimal, accessible-enough prompt is acceptable here: this is a
    // plain-text URL entry with no formatting, and a full modal is out of
    // scope for Sub-phase 3.
    const href = window.prompt(
      "Link URL (https:// or a site-relative path)",
      previousHref ?? "https://",
    );
    if (href === null) return; // cancelled
    if (href === "") {
      editor.chain().focus().unsetLink().run();
      return;
    }
    if (!isSafeHref(href)) {
      window.alert(
        "That link isn't allowed. Use an http(s) URL or a site-relative path.",
      );
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
  };

  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className="flex flex-wrap items-center gap-1 border-b border-black/10 p-1.5 dark:border-white/10"
    >
      <ToolbarButton
        label="Bold"
        active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <span className="font-bold">B</span>
      </ToolbarButton>
      <ToolbarButton
        label="Italic"
        active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <span className="italic">I</span>
      </ToolbarButton>
      <ToolbarButton
        label="Heading 2"
        active={editor.isActive("heading", { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        H2
      </ToolbarButton>
      <ToolbarButton
        label="Heading 3"
        active={editor.isActive("heading", { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        H3
      </ToolbarButton>
      <ToolbarButton
        label="Bulleted list"
        active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        •
      </ToolbarButton>
      <ToolbarButton
        label="Numbered list"
        active={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        1.
      </ToolbarButton>
      <ToolbarButton
        label="Quote"
        active={editor.isActive("blockquote")}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        &ldquo;
      </ToolbarButton>
      <ToolbarButton
        label="Link"
        active={editor.isActive("link")}
        onClick={addLink}
      >
        Link
      </ToolbarButton>
      <ToolbarButton
        label="Undo"
        disabled={!editor.can().undo()}
        onClick={() => editor.chain().focus().undo().run()}
      >
        Undo
      </ToolbarButton>
      <ToolbarButton
        label="Redo"
        disabled={!editor.can().redo()}
        onClick={() => editor.chain().focus().redo().run()}
      >
        Redo
      </ToolbarButton>
    </div>
  );
}

export function RichTextEditor({
  initialContent,
  onChange,
  editable = true,
  ariaLabel = "Story content",
}: RichTextEditorProps) {
  // Only the very first initialContent is ever loaded into the editor —
  // this is an uncontrolled editor by design (Tiptap's own recommended
  // pattern); re-syncing on every parent re-render would fight the user's
  // cursor position. The mutation queue's coalescing (lib/story/mutation-
  // queue.ts) is what keeps saves from racing, not a controlled-value prop.
  // A lazy useState initializer (not a ref read during render) is what
  // React's rules require for a value computed once and never re-derived.
  const [initialDoc] = useState(() => blocksToTiptapDoc(initialContent));

  const editor = useEditor({
    extensions: storyEditorExtensions(),
    content: initialDoc,
    editable,
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      onChange(tiptapDocToBlocks(editor.getJSON() as never));
    },
  });

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  if (!editor) {
    return (
      <div className="rounded-md border border-black/10 p-3 text-sm text-black/50 dark:border-white/10 dark:text-white/50">
        Loading editor…
      </div>
    );
  }

  return (
    <div className="rounded-md border border-black/10 dark:border-white/10">
      {editable && <Toolbar editor={editor} />}
      <EditorContent
        editor={editor}
        aria-label={ariaLabel}
        className="prose prose-sm max-w-none px-3 py-2 focus:outline-none sm:prose-base [&_.ProseMirror]:min-h-40 [&_.ProseMirror]:outline-none"
      />
    </div>
  );
}
