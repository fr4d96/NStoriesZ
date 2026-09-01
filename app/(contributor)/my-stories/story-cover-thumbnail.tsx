"use client";

import { useEffect, useState } from "react";
import { mintPreviewUrlAction } from "@/app/(contributor)/stories/[id]/media-actions";
import { Spinner } from "@/components/ui/spinner";
import { StoryCoverFallback } from "@/components/story/story-cover-fallback";

// mintMediaPreviewSignedUrl (lib/story/image-pipeline.ts) mints URLs that
// last 120s server-side. Cache resolved URLs for less than that so a
// remounted thumbnail (e.g. switching MyStoriesView between grid and list,
// which swaps in a whole new <ul> subtree) can reuse the still-valid URL
// instead of re-running the authorize+mint round trip and re-showing the
// loading spinner for an image the contributor already saw. In-flight
// mints are also deduped so two thumbnails for the same mediaId mounted at
// once never issue duplicate requests.
const PREVIEW_URL_TTL_MS = 90_000;
const resolvedPreviewUrls = new Map<
  string,
  { url: string; mintedAt: number }
>();
const pendingPreviewUrls = new Map<string, Promise<string | null>>();

function getCachedPreviewUrl(mediaId: string): string | null {
  const entry = resolvedPreviewUrls.get(mediaId);
  if (!entry) return null;
  if (Date.now() - entry.mintedAt > PREVIEW_URL_TTL_MS) {
    resolvedPreviewUrls.delete(mediaId);
    return null;
  }
  return entry.url;
}

function fetchPreviewUrl(mediaId: string): Promise<string | null> {
  const pending = pendingPreviewUrls.get(mediaId);
  if (pending) return pending;
  const promise = mintPreviewUrlAction(mediaId)
    .then((result) => {
      if ("url" in result) {
        resolvedPreviewUrls.set(mediaId, {
          url: result.url,
          mintedAt: Date.now(),
        });
        return result.url;
      }
      return null;
    })
    .finally(() => {
      pendingPreviewUrls.delete(mediaId);
    });
  pendingPreviewUrls.set(mediaId, promise);
  return promise;
}

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
  const [url, setUrl] = useState<string | null>(() =>
    mediaId ? getCachedPreviewUrl(mediaId) : null,
  );
  const [prevMediaId, setPrevMediaId] = useState(mediaId);
  const [hasRetried, setHasRetried] = useState(false);

  // Adjust state during render (not in an effect) when mediaId changes --
  // see https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes.
  if (mediaId !== prevMediaId) {
    setPrevMediaId(mediaId);
    setUrl(mediaId ? getCachedPreviewUrl(mediaId) : null);
    setHasRetried(false);
  }

  useEffect(() => {
    if (!mediaId || getCachedPreviewUrl(mediaId)) return;
    let cancelled = false;
    fetchPreviewUrl(mediaId).then((resolvedUrl) => {
      if (!cancelled && resolvedUrl) setUrl(resolvedUrl);
    });
    return () => {
      cancelled = true;
    };
  }, [mediaId]);

  if (!mediaId) {
    return (
      <div className="relative h-full w-full bg-surface-muted">
        <StoryCoverFallback sizes="(min-width: 640px) 33vw, 50vw" />
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
    <img
      src={url}
      alt={altText ?? ""}
      className="h-full w-full object-cover"
      onError={() => {
        // The cached URL can occasionally have expired server-side
        // (PREVIEW_URL_TTL_MS is a conservative estimate, not a guarantee)
        // -- retry once with a freshly minted URL before giving up.
        if (!mediaId || hasRetried) return;
        setHasRetried(true);
        resolvedPreviewUrls.delete(mediaId);
        pendingPreviewUrls.delete(mediaId);
        setUrl(null);
        fetchPreviewUrl(mediaId).then((resolvedUrl) => {
          if (resolvedUrl) setUrl(resolvedUrl);
        });
      }}
    />
  );
}
