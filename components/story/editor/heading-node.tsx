"use client";

import type { PlateElementProps } from "platejs/react";

import { type VariantProps, cva } from "class-variance-authority";
import { PlateElement } from "platejs/react";

// Only h2/h3 variants are exported -- h1/h4/h5/h6 are deliberately absent
// from this file, not just unregistered in storyEditorPlugins(), matching
// this editor's "structurally incapable of producing content the schema
// would reject" design (see story-content-editor.tsx's header comment).
const headingVariants = cva("relative mb-1", {
  variants: {
    variant: {
      h2: "mt-[1.4em] pb-px font-semibold text-2xl tracking-tight",
      h3: "mt-[1em] pb-px font-semibold text-xl tracking-tight",
    },
  },
});

function HeadingElement({
  variant = "h2",
  ...props
}: PlateElementProps & VariantProps<typeof headingVariants>) {
  return (
    <PlateElement
      as={variant!}
      className={headingVariants({ variant })}
      {...props}
    />
  );
}

export function H2Element(props: PlateElementProps) {
  return <HeadingElement variant="h2" {...props} />;
}

export function H3Element(props: PlateElementProps) {
  return <HeadingElement variant="h3" {...props} />;
}
