"use client";

import { useEffect, useState } from "react";
import {
  imageBlockMediaIds,
  type StoryContentBlock,
} from "@/lib/validation/story";
import type { RevisionMediaItem } from "@/lib/story/contributor-queries";
import { mintPreviewUrlAction } from "@/app/(contributor)/stories/[id]/media-actions";
import {
  ContentBlockRenderer,
  type ContentBlockMediaMap,
} from "@/components/story/content-block-renderer";

/**
 * Mints a short-lived signed URL per inline-image block, client-side --
 * same pattern and same reason as components/story/preview-gallery.tsx:
 * nothing server-rendered here ever receives a raw private-bucket storage
 * path (Rule 12/13); mintPreviewUrlAction independently re-checks
 * authorize_story_media_preview() before minting. `media` (already fetched
 * for PreviewGallery) supplies altText/decorative -- mintPreviewUrlAction
 * itself only returns a URL.
 */
export function PreviewContentBody({
  blocks,
  media,
}: {
  blocks: StoryContentBlock[];
  media: RevisionMediaItem[];
}) {
  const [urls, setUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    const mediaIds = imageBlockMediaIds(blocks);
    if (mediaIds.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const mediaId of mediaIds) {
        const result = await mintPreviewUrlAction(mediaId);
        if (cancelled) return;
        if ("url" in result) {
          setUrls((prev) => ({ ...prev, [mediaId]: result.url }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [blocks]);

  const mediaById = new Map(media.map((m) => [m.mediaId, m]));
  const contentMedia: ContentBlockMediaMap = {};
  for (const [mediaId, url] of Object.entries(urls)) {
    const item = mediaById.get(mediaId);
    contentMedia[mediaId] = {
      url,
      altText: item?.altText ?? null,
      decorative: item?.decorative ?? false,
    };
  }

  return <ContentBlockRenderer blocks={blocks} media={contentMedia} />;
}
