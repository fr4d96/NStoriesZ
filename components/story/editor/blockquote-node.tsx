"use client";

import { type PlateElementProps, PlateElement } from "platejs/react";

export function BlockquoteElement(props: PlateElementProps) {
  return (
    <PlateElement
      as="blockquote"
      className="my-1 border-l-2 border-black/20 pl-6 italic dark:border-white/20"
      {...props}
    />
  );
}
