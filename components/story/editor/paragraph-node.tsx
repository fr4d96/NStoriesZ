"use client";

import type { PlateElementProps } from "platejs/react";

import { PlateElement } from "platejs/react";

import { cn } from "@/lib/utils";
import type { PlateElement as PlateElementNode } from "@/lib/story/plate-serialize";

/**
 * Renders every "p"-type node, including flat list items (a list item is
 * just a paragraph carrying `indent`/`listStyleType` -- see
 * lib/story/plate-serialize.ts's header comment). No marker-rendering logic
 * needed here: ListPlugin supplies its own node-wrapper that groups
 * consecutive list-style paragraphs into a real <ul>/<ol> (with the native
 * marker) around this element's rendered output.
 *
 * That wrapper inserts the <ul> INSIDE whatever tag this component renders
 * as -- confirmed live via a real React hydration error ("<ul> cannot be a
 * descendant of <p>", since <p> only permits phrasing content): rendering
 * list items as <p> produced invalid `<p><ul>...</ul></p>` markup. A <div>
 * can validly contain a <ul>, so list items render as one; ordinary
 * paragraphs still render as a real <p>.
 */
export function ParagraphElement(props: PlateElementProps) {
  const element = props.element as unknown as PlateElementNode;
  const isListItem = !!(element.indent && element.listStyleType);
  return (
    <PlateElement
      {...props}
      as={isListItem ? "div" : "p"}
      className={cn("m-0 px-0 py-1")}
    />
  );
}
