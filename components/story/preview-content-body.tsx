"use client";

import { useEffect, useState } from "react";
import {
  imageBlockMediaIds,
  type StoryContentBlock,
} from "@/lib/validation/story";
import type { PreviewableMediaItem } from "@/lib/story/contributor-queries";
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
  media: PreviewableMediaItem[];
}) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  // Ids whose mint failed -- excluded from the render loop below so a
  // permanently-broken embed doesn't spin forever; it renders nothing,
  // matching ContentBlockMediaMap's existing "no entry at all" behavior for
  // a detached image.
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());

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
        } else {
          setFailed((prev) => new Set(prev).add(mediaId));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [blocks]);

  // Derived on every render from `blocks`/`urls`/`failed`, rather than
  // tracked as its own state -- a mediaId is "loading" for exactly as long
  // as it's embedded and neither resolved nor failed, so there is nothing
  // here that needs its own synchronized copy.
  const mediaIds = imageBlockMediaIds(blocks);
  const mediaById = new Map(media.map((m) => [m.mediaId, m]));
  const contentMedia: ContentBlockMediaMap = {};
  for (const mediaId of mediaIds) {
    const url = urls[mediaId];
    if (url) {
      const item = mediaById.get(mediaId);
      contentMedia[mediaId] = {
        url,
        altText: item?.altText ?? null,
        decorative: item?.decorative ?? false,
      };
    } else if (!failed.has(mediaId)) {
      contentMedia[mediaId] = "loading";
    }
  }

  return <ContentBlockRenderer blocks={blocks} media={contentMedia} />;
}
