"use client";

import type { PlateElementProps } from "platejs/react";

import { PlateElement } from "platejs/react";

import { cn } from "@/lib/utils";

/**
 * Deliberately NOT Plate's registry table-node.tsx: that component (and
 * table-toolbar-button.tsx's Cell submenu) bring drag-reordering, column
 * resize, and multi-cell merge/split -- each of which needs data
 * (colSpan/rowSpan, per-column widths, per-cell background/border) that
 * storyContentSchema's table block (lib/validation/story.ts) has no field
 * for. Wiring that up as-is would either mean loosening the schema well
 * beyond "table blocks" (this session's actual scope, chosen over "every
 * Plate feature" in AskUserQuestion) or shipping controls that visibly work
 * in the editor and then silently vanish on save/reload -- worse than not
 * having them. This is a plain grid: insert/delete row/column only (see
 * table-toolbar-button.tsx), no per-cell layout state.
 */
export function TableElement(props: PlateElementProps) {
  return (
    <PlateElement {...props} as="div" className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <tbody>{props.children}</tbody>
      </table>
    </PlateElement>
  );
}

export function TableRowElement(props: PlateElementProps) {
  return <PlateElement {...props} as="tr" />;
}

export function TableCellElement(props: PlateElementProps) {
  return (
    <PlateElement
      {...props}
      as="td"
      className={cn(
        "min-w-24 border border-border bg-background p-2 align-top",
      )}
    />
  );
}
