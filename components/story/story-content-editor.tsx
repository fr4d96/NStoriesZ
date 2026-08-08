"use client";

import {
  Plate,
  ParagraphPlugin,
  createPlatePlugin,
  useEditorRef,
  useEditorSelector,
  usePlateEditor,
} from "platejs/react";
import {
  BoldPlugin,
  ItalicPlugin,
  H2Plugin,
  H3Plugin,
  BlockquotePlugin,
} from "@platejs/basic-nodes/react";
import { ListPlugin } from "@platejs/list/react";
import { LinkPlugin } from "@platejs/link/react";
import {
  TablePlugin,
  TableRowPlugin,
  TableCellPlugin,
} from "@platejs/table/react";
import { setValue, type Value } from "platejs";
import { forwardRef, useImperativeHandle, useMemo, useState } from "react";
import { Bold, Heading2, Heading3, Italic, Quote } from "lucide-react";

import type { StoryContentBlock } from "@/lib/validation/story";
import {
  blocksToPlateValue,
  plateValueToBlocks,
} from "@/lib/story/plate-serialize";
import { Editor, EditorContainer } from "@/components/ui/editor";
import { TooltipProvider } from "@/components/ui/tooltip";
import { FixedToolbar } from "./editor/fixed-toolbar";
import { ToolbarButton, ToolbarGroup } from "./editor/toolbar";
import { MarkToolbarButton } from "./editor/mark-toolbar-button";
import {
  UndoToolbarButton,
  RedoToolbarButton,
} from "./editor/history-toolbar-button";
import {
  BulletedListToolbarButton,
  NumberedListToolbarButton,
} from "./editor/list-toolbar-button";
import { LinkToolbarButton } from "./editor/link-toolbar-button";
import { LinkFloatingToolbar } from "./editor/link-toolbar";
import { TableToolbarButton } from "./editor/table-toolbar-button";
import {
  ImageToolbarButton,
  type ImageUploadContext,
} from "./editor/image-toolbar-button";
import { ParagraphElement } from "./editor/paragraph-node";
import { H2Element, H3Element } from "./editor/heading-node";
import { BlockquoteElement } from "./editor/blockquote-node";
import { LinkElement } from "./editor/link-node";
import { ImageElement } from "./editor/image-node";
import {
  TableElement,
  TableRowElement,
  TableCellElement,
} from "./editor/table-node";

type Editor = ReturnType<typeof useEditorRef>;

/**
 * Plugin-specific transforms (e.g. `toggleTf(editor, "h2")`) are injected at
 * runtime by each plugin (confirmed empirically -- see the PR that added
 * this file), but `useEditorRef()`'s generic return type has no way to know
 * about a caller's specific plugin set, so TypeScript doesn't see them. This
 * narrow, explicit cast is the escape hatch, kept to this one helper rather
 * than casting `editor.tf` ad hoc at every call site.
 */
function toggleTf(editor: Editor, key: "h2" | "h3" | "blockquote") {
  (editor.tf as unknown as Record<string, { toggle: () => void }>)[
    key
  ].toggle();
}

function matchType(type: string) {
  return (node: unknown) =>
    !!node &&
    typeof node === "object" &&
    (node as { type?: unknown }).type === type;
}

/**
 * A void element (see lib/story/plate-serialize.ts's PlateImageNode
 * comment) referencing an already-uploaded, already rights-confirmed
 * story_revision_media row by mediaId -- not a raw image URL. There is no
 * separate upload path this plugin opens: ImageToolbarButton uploads
 * through the exact same route/bucket the gallery
 * (components/story/image-upload-manager.tsx) uses.
 */
const ImagePlugin = createPlatePlugin({
  key: "image",
  node: { isElement: true, isVoid: true },
}).withComponent(ImageElement);

/**
 * The single allowed plugin configuration for story bodies -- every
 * node/mark NOT in the canonical block/run/mark schema
 * (lib/validation/story.ts) is simply never registered here, so the editor
 * is structurally incapable of producing content the schema would reject
 * (no underline/strike/code/codeBlock/horizontalRule -- Plate doesn't even
 * load those plugins). See story-content-editor.test.tsx's closed-loop
 * test, which round-trips every allowed command through
 * lib/story/plate-serialize.ts and confirms the disallowed ones simply
 * don't exist on this configuration.
 *
 * Node/toolbar components under ./editor/ are adapted from Plate's own
 * registry (platejs.org/r/*.json -- the components their prebuilt "Editor"
 * ships), not hand-rolled from scratch, per explicit request to use Plate's
 * real editor rather than a bare-bones one. Kept out, deliberately: (1)
 * anything the registry bundles for node/mark types this schema doesn't
 * allow (h1/h4-h6/hr/underline/strike/code/highlight/kbd/subscript/
 * superscript -- see basic-blocks-kit.json/basic-marks-kit.json upstream,
 * which bundle those together with what we do want); (2) the registry's
 * full table-node.tsx, which brings drag-reorder/column-resize/multi-cell
 * merge -- table-node.tsx (this dir) explains why; (3) the list toolbar's
 * style-variant dropdown (Circle/Square/Alpha/Roman), since
 * storyContentSchema's list block only stores ordered/unordered -- see
 * list-toolbar-button.tsx.
 *
 * TableCellHeaderPlugin ("th") is deliberately NOT registered, for the same
 * reason: nothing in this toolbar ever asks for a header row, so the editor
 * is structurally incapable of producing a header cell -- there's nothing
 * in lib/story/plate-serialize.ts or storyContentBlockSchema to represent
 * one.
 *
 * ImagePlugin is always registered (so existing image blocks render), but
 * the "Image" toolbar button that inserts new ones only appears when the
 * caller passes imageUpload (see StoryContentEditor's props) -- an image
 * block referencing a mediaId with no attached story_revision_media row
 * would fail save_revision_draft's server-side check either way (see the
 * migration that added it), but there's no reason to show an upload
 * control in a context that has nowhere to upload to.
 */
export function storyEditorPlugins() {
  return [
    ParagraphPlugin.withComponent(ParagraphElement),
    H2Plugin.withComponent(H2Element),
    H3Plugin.withComponent(H3Element),
    BlockquotePlugin.withComponent(BlockquoteElement),
    BoldPlugin,
    ItalicPlugin,
    ListPlugin,
    LinkPlugin.configure({
      render: {
        node: LinkElement,
        afterEditable: () => <LinkFloatingToolbar />,
      },
    }),
    TablePlugin.withComponent(TableElement),
    TableRowPlugin.withComponent(TableRowElement),
    TableCellPlugin.withComponent(TableCellElement),
    ImagePlugin,
  ];
}

// --- Public component ----------------------------------------------------

export type StoryContentEditorProps = {
  initialContent: StoryContentBlock[];
  onChange: (blocks: StoryContentBlock[]) => void;
  editable?: boolean;
  ariaLabel?: string;
  /**
   * Enables the "Image" toolbar button. Omit in any context with nowhere
   * to upload to (there is currently only one real caller,
   * story-edit-form.tsx, which always has this) -- existing image blocks
   * still render either way, since ImagePlugin is always registered.
   */
  imageUpload?: ImageUploadContext;
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
};

/**
 * Reactive: useEditorSelector (unlike a plain useEditorRef() + direct
 * editor.api.* read) actually subscribes the component to re-render when
 * the selector's derived value changes -- confirmed live this was a real
 * bug, not a hypothetical one: without this, the toolbar's active/pressed
 * indicators never updated after the first render even though the
 * underlying formatting was applied correctly.
 */
function useIsBlockActive(type: string) {
  return useEditorSelector(
    (editor) => !!editor.api.above({ match: matchType(type) }),
    [type],
  );
}

function EditorToolbar({ imageUpload }: { imageUpload?: ImageUploadContext }) {
  const editor = useEditorRef();
  const isH2 = useIsBlockActive("h2");
  const isH3 = useIsBlockActive("h3");
  const isBlockquote = useIsBlockActive("blockquote");

  return (
    <FixedToolbar>
      <ToolbarGroup>
        <UndoToolbarButton />
        <RedoToolbarButton />
      </ToolbarGroup>

      <ToolbarGroup>
        <MarkToolbarButton nodeType="bold" tooltip="Bold (⌘+B)">
          <Bold />
        </MarkToolbarButton>
        <MarkToolbarButton nodeType="italic" tooltip="Italic (⌘+I)">
          <Italic />
        </MarkToolbarButton>
      </ToolbarGroup>

      <ToolbarGroup>
        <ToolbarButton
          pressed={isH2}
          onClick={() => toggleTf(editor, "h2")}
          tooltip="Heading 2"
        >
          <Heading2 />
        </ToolbarButton>
        <ToolbarButton
          pressed={isH3}
          onClick={() => toggleTf(editor, "h3")}
          tooltip="Heading 3"
        >
          <Heading3 />
        </ToolbarButton>
        <ToolbarButton
          pressed={isBlockquote}
          onClick={() => toggleTf(editor, "blockquote")}
          tooltip="Quote"
        >
          <Quote />
        </ToolbarButton>
      </ToolbarGroup>

      <ToolbarGroup>
        <BulletedListToolbarButton />
        <NumberedListToolbarButton />
      </ToolbarGroup>

      <ToolbarGroup>
        <LinkToolbarButton />
        <TableToolbarButton />
        {imageUpload && <ImageToolbarButton {...imageUpload} />}
      </ToolbarGroup>
    </FixedToolbar>
  );
}

export const StoryContentEditor = forwardRef<
  StoryContentEditorHandle,
  StoryContentEditorProps
>(function StoryContentEditor(
  {
    initialContent,
    onChange,
    editable = true,
    ariaLabel = "Story content",
    imageUpload,
  },
  ref,
) {
  const plugins = useMemo(() => storyEditorPlugins(), []);

  // Only the very first initialContent is ever loaded into the editor --
  // this is an uncontrolled editor by design (same reasoning as the
  // previous Tiptap implementation); re-syncing on every parent re-render
  // would fight the user's cursor position. The mutation queue's
  // coalescing (lib/story/mutation-queue.ts) is what keeps saves from
  // racing, not a controlled-value prop. A lazy useState initializer (not
  // a ref read during render) is what React's rules require for a value
  // computed once and never re-derived.
  const [initialValue] = useState(() => blocksToPlateValue(initialContent));

  const editor = usePlateEditor({
    plugins,
    value: initialValue,
  });

  useImperativeHandle(
    ref,
    () => ({
      replaceContent: (blocks: StoryContentBlock[]) => {
        setValue(editor, blocksToPlateValue(blocks) as Value);
      },
    }),
    [editor],
  );

  return (
    <TooltipProvider>
      <div className="rounded-md border border-border">
        <Plate
          editor={editor}
          onChange={({ value }) => onChange(plateValueToBlocks(value as never))}
        >
          {editable && <EditorToolbar imageUpload={imageUpload} />}
          <EditorContainer className="min-h-40">
            <Editor
              readOnly={!editable}
              aria-label={ariaLabel}
              variant="none"
              className="min-h-40 px-3 py-2 text-base"
            />
          </EditorContainer>
        </Plate>
      </div>
    </TooltipProvider>
  );
});
