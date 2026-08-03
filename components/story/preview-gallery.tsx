"use client";

import { useEffect, useState } from "react";
import type { RevisionMediaItem } from "@/lib/story/contributor-queries";
import { mintPreviewUrlAction } from "@/app/(contributor)/stories/[id]/media-actions";

/**
 * Mints a short-lived signed URL per image, client-side, only after the
 * corresponding Server Action has independently re-checked
 * authorize_story_media_preview() — see media-actions.ts. Nothing here
 * ever receives a raw storage path; the props are exactly what
 * get_story_preview() returns (media_id + presentation fields only).
 */
export function PreviewGallery({ media }: { media: RevisionMediaItem[] }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const item of media) {
        if (
          item.processingState === "pending_upload" ||
          item.processingState === "uploaded" ||
          item.processingState === "processing"
        ) {
          continue; // not ready to preview yet
        }
        const result = await mintPreviewUrlAction(item.mediaId);
        if (cancelled) return;
        if ("url" in result) {
          setUrls((prev) => ({ ...prev, [item.mediaId]: result.url }));
        } else {
          setErrors((prev) => ({ ...prev, [item.mediaId]: result.error }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [media]);

  if (media.length === 0) return null;

  const sorted = [...media].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {sorted.map((item) => (
        <li key={item.mediaId} className="space-y-1">
          <div className="aspect-square overflow-hidden rounded-md bg-black/5 dark:bg-white/5">
            {urls[item.mediaId] ? (
              // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
              <img
                src={urls[item.mediaId]}
                alt={item.altText ?? ""}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center p-2 text-center text-xs text-black/50 dark:text-white/50">
                {errors[item.mediaId] ?? "Preparing image…"}
              </div>
            )}
          </div>
          {item.caption && (
            <p className="text-xs text-black/60 dark:text-white/60">
              {item.caption}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
