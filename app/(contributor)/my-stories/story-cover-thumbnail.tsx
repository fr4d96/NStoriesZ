"use client";

import { useEffect, useState } from "react";
import { mintPreviewUrlAction } from "@/app/(contributor)/stories/[id]/media-actions";

/**
 * Lazily mints a short-lived signed preview URL for a story's cover image,
 * same two-step authorize-then-mint pattern as ImageUploadManager's
 * thumbnails (see mintPreviewUrlAction's own comment) -- the private
 * storage path is never sent to the browser directly.
 */
export function StoryCoverThumbnail({
  mediaId,
  altText,
}: {
  mediaId: string | null;
  altText: string | null;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!mediaId) return;
    let cancelled = false;
    (async () => {
      const result = await mintPreviewUrlAction(mediaId);
      if (!cancelled && "url" in result) {
        setUrl(result.url);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mediaId]);

  if (!mediaId) {
    return (
      <div
        aria-hidden="true"
        className="flex h-full w-full items-center justify-center bg-surface-muted text-foreground/30"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          className="h-8 w-8"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="M21 15l-5-5L5 21" />
        </svg>
      </div>
    );
  }

  if (!url) {
    return (
      <div
        aria-hidden="true"
        className="h-full w-full animate-pulse bg-surface-muted"
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed URL, not an optimizable static asset
    <img
      src={url}
      alt={altText ?? ""}
      className="h-full w-full object-cover"
    />
  );
}
