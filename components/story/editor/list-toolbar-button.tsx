"use client";

import { ListStyleType, someList, toggleList } from "@platejs/list";
import { List, ListOrdered } from "lucide-react";
import { useEditorRef, useEditorSelector } from "platejs/react";

import { ToolbarButton } from "./toolbar";

// A plain toggle, not Plate's registry split-button-with-style-picker --
// storyContentBlockSchema's list block only ever stores "ordered" |
// "unordered" (see lib/validation/story.ts), so a submenu offering
// Circle/Square/LowerAlpha/UpperRoman etc. would let a contributor pick a
// style that silently reverts to plain disc/decimal on reload (the
// serializer's isOrderedListStyle() only recognizes "decimal" as ordered,
// everything else collapses to unordered) -- confusing, not unsafe, but
// avoidable by not offering it in the first place.
export function BulletedListToolbarButton() {
  const editor = useEditorRef();
  const pressed = useEditorSelector(
    (editor) => someList(editor, [ListStyleType.Disc]),
    [],
  );

  return (
    <ToolbarButton
      pressed={pressed}
      onClick={() => toggleList(editor, { listStyleType: ListStyleType.Disc })}
      tooltip="Bulleted list"
    >
      <List />
    </ToolbarButton>
  );
}

export function NumberedListToolbarButton() {
  const editor = useEditorRef();
  const pressed = useEditorSelector(
    (editor) => someList(editor, [ListStyleType.Decimal]),
    [],
  );

  return (
    <ToolbarButton
      pressed={pressed}
      onClick={() =>
        toggleList(editor, { listStyleType: ListStyleType.Decimal })
      }
      tooltip="Numbered list"
    >
      <ListOrdered />
    </ToolbarButton>
  );
}
