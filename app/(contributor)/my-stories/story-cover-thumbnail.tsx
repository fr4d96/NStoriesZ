"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { mintPreviewUrlAction } from "@/app/(contributor)/stories/[id]/media-actions";
import { Spinner } from "@/components/ui/spinner";

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
      <div className="relative h-full w-full bg-surface-muted">
        <Image
          src="/kakinotes-icon.png"
          alt=""
          fill
          sizes="(min-width: 640px) 33vw, 50vw"
          className="object-cover"
        />
      </div>
    );
  }

  if (!url) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-surface-muted text-foreground/40">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed URL, not an optimizable static asset
    <img src={url} alt={altText ?? ""} className="h-full w-full object-cover" />
  );
}
