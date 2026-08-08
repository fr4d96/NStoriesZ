"use client";

import * as React from "react";

import type { PlateElementProps } from "platejs/react";

import { PlateElement, useFocused, useSelected } from "platejs/react";
import { ImageOff, Loader2 } from "lucide-react";

import { mintPreviewUrlAction } from "@/app/(contributor)/stories/[id]/media-actions";
import { cn } from "@/lib/utils";

/**
 * Void element (see ImagePlugin's `node: { isVoid: true }` registration in
 * story-content-editor.tsx) -- the image is the whole node, there's no
 * editable text inside it.
 *
 * Resolves its own signed preview URL the same way
 * components/story/image-upload-manager.tsx's gallery thumbnails do
 * (mintPreviewUrlAction -- a 120s-lived signed URL from the private
 * bucket; this editor only ever shows a DRAFT, never approved/public
 * media). Each inline image instance mints its own URL independently
 * rather than sharing a cache with the gallery panel below -- a minor
 * duplicate-fetch tradeoff, not a correctness issue (two independent
 * signed URLs for the same file both just work).
 *
 * Renders with an empty alt (a plain content-authoring thumbnail, not the
 * published output) -- the real alt text lives on the story_revision_media
 * row this mediaId points at, and is what components/story/
 * content-block-renderer.tsx actually uses for readers.
 */
export function ImageElement(props: PlateElementProps) {
  const mediaId =
    typeof (props.element as { mediaId?: unknown }).mediaId === "string"
      ? ((props.element as { mediaId?: string }).mediaId as string)
      : "";
  const selected = useSelected();
  const focused = useFocused();
  const [url, setUrl] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    if (!mediaId) return;
    let cancelled = false;
    void mintPreviewUrlAction(mediaId).then((result) => {
      if (cancelled) return;
      if ("url" in result) setUrl(result.url);
      else setFailed(true);
    });
    return () => {
      cancelled = true;
    };
    // mediaId is fixed once an image node is inserted (there is no "swap
    // the image" operation), so there's no stale url/failed state from a
    // previous mediaId to reset here -- unlike the effect this mirrors in
    // image-upload-manager.tsx, which mints for a whole changing list.
  }, [mediaId]);

  const unresolvable = !mediaId || failed;

  return (
    <PlateElement {...props} className="my-2">
      <div contentEditable={false} className="select-none">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed URL naming an internal storage path, not a stable remote image worth Next/Image's remote-pattern config
          <img
            src={url}
            alt=""
            className={cn(
              "max-h-96 rounded-md border border-border object-contain",
              selected && focused && "ring-2 ring-ring",
            )}
          />
        ) : unresolvable ? (
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted p-4 text-sm text-muted-foreground">
            <ImageOff className="size-4" />
            Image unavailable
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted p-4 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading image…
          </div>
        )}
      </div>
      {props.children}
    </PlateElement>
  );
}
