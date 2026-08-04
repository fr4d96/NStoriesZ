"use client";

import { useEffect, useRef, useState } from "react";
import type { RevisionMediaItem } from "@/lib/story/contributor-queries";
import type { MutationQueue } from "@/lib/story/mutation-queue";
import {
  MAX_IMAGES_PER_REVISION,
  MAX_UPLOAD_BYTES,
} from "@/lib/story/image-validation";
import {
  reorderMediaAction,
  setCoverAction,
  detachMediaAction,
  updateMediaCaptionAction,
} from "@/app/(contributor)/stories/[id]/edit/actions";
import {
  mintPreviewUrlAction,
  refreshMediaAction,
} from "@/app/(contributor)/stories/[id]/media-actions";

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

type UploadingItem = {
  key: string;
  fileName: string;
  progress: "uploading" | "processing" | "error";
  error?: string;
};

export type ImageUploadManagerProps = {
  storyId: string;
  revisionId: string;
  initialMedia: RevisionMediaItem[];
  versionRef: React.MutableRefObject<number>;
  queue: MutationQueue;
  onVersionBumped: () => void;
};

const PROCESSING_LABELS: Record<string, string> = {
  pending_upload: "Uploading…",
  uploaded: "Preparing…",
  processing: "Processing…",
  processed: "Ready",
  failed: "Failed to process — try a different file",
  promotion_pending: "Ready",
  promoted: "Ready",
};

export function ImageUploadManager({
  storyId,
  revisionId,
  initialMedia,
  versionRef,
  queue,
  onVersionBumped,
}: ImageUploadManagerProps) {
  const [media, setMedia] = useState<RevisionMediaItem[]>(
    [...initialMedia].sort((a, b) => a.sortOrder - b.sortOrder),
  );
  const [uploading, setUploading] = useState<UploadingItem[]>([]);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Mint (or re-mint) a signed thumbnail URL for every processed image not
  // already showing one. Signed URLs expire after 120 seconds
  // (lib/story/image-pipeline.ts) — a short authoring session doesn't need
  // more than this; a longer-lived session could go stale, a known
  // limitation for this sub-phase (see docs/implementation-status.md).
  useEffect(() => {
    const missing = media.filter(
      (m) =>
        (m.processingState === "processed" ||
          m.processingState === "promotion_pending" ||
          m.processingState === "promoted") &&
        !thumbnails[m.mediaId],
    );
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const item of missing) {
        const result = await mintPreviewUrlAction(item.mediaId);
        if (cancelled) return;
        if ("url" in result) {
          setThumbnails((prev) => ({ ...prev, [item.mediaId]: result.url }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- thumbnails is intentionally read-not-depended-on to avoid an infinite mint loop
  }, [media]);

  async function refresh() {
    const result = await refreshMediaAction(storyId);
    if ("media" in result) {
      setMedia([...result.media].sort((a, b) => a.sortOrder - b.sortOrder));
    }
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const remainingSlots =
      MAX_IMAGES_PER_REVISION - media.length - uploading.length;
    const toUpload = Array.from(files).slice(0, Math.max(0, remainingSlots));

    for (const file of toUpload) {
      const key = `${file.name}-${file.size}-${Date.now()}`;
      // Fast client-side pre-checks — UX feedback only. Every real safety
      // decision (true format, dimensions, decode success) happens
      // server-side in lib/story/image-pipeline.ts; nothing here is trusted.
      if (!ACCEPTED_TYPES.includes(file.type)) {
        setUploading((prev) => [
          ...prev,
          {
            key,
            fileName: file.name,
            progress: "error",
            error: "Use JPEG, PNG, or WebP.",
          },
        ]);
        continue;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        setUploading((prev) => [
          ...prev,
          {
            key,
            fileName: file.name,
            progress: "error",
            error: "File is too large (max 15 MB).",
          },
        ]);
        continue;
      }

      setUploading((prev) => [
        ...prev,
        { key, fileName: file.name, progress: "uploading" },
      ]);

      const formData = new FormData();
      formData.set("file", file);
      formData.set("revisionId", revisionId);
      formData.set("expectedVersion", String(versionRef.current));

      try {
        setUploading((prev) =>
          prev.map((u) =>
            u.key === key ? { ...u, progress: "processing" } : u,
          ),
        );
        const response = await fetch(`/stories/${storyId}/edit/upload`, {
          method: "POST",
          body: formData,
        });
        const body = (await response.json()) as {
          mediaId?: string;
          error?: string;
        };
        if (!response.ok || !body.mediaId) {
          throw new Error(body.error ?? "Upload failed.");
        }
        // finalize_story_media_upload bumped the authoring version by
        // exactly one on success (see the migration's own guarantee).
        versionRef.current += 1;
        onVersionBumped();
        setUploading((prev) => prev.filter((u) => u.key !== key));
        await refresh();
      } catch (error) {
        setUploading((prev) =>
          prev.map((u) =>
            u.key === key
              ? {
                  ...u,
                  progress: "error",
                  error:
                    error instanceof Error ? error.message : "Upload failed.",
                }
              : u,
          ),
        );
      }
    }
  }

  function reorder(fromIndex: number, toIndex: number) {
    const next = [...media];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    setMedia(next);
    queue.enqueue("media-reorder", async () => {
      const result = await reorderMediaAction(
        revisionId,
        versionRef.current,
        next.map((m) => m.mediaId),
      );
      if (result.ok) {
        versionRef.current += 1;
        onVersionBumped();
      } else {
        throw new Error(result.error);
      }
    });
  }

  function setCover(mediaId: string) {
    setMedia((prev) =>
      prev.map((m) => ({ ...m, isCover: m.mediaId === mediaId })),
    );
    queue.enqueue("media-cover", async () => {
      const result = await setCoverAction(
        revisionId,
        versionRef.current,
        mediaId,
      );
      if (result.ok) {
        versionRef.current += 1;
        onVersionBumped();
      } else {
        throw new Error(result.error);
      }
    });
  }

  function detach(mediaId: string) {
    setMedia((prev) => prev.filter((m) => m.mediaId !== mediaId));
    queue.enqueue(`media-detach:${mediaId}`, async () => {
      const result = await detachMediaAction(
        revisionId,
        versionRef.current,
        mediaId,
      );
      if (result.ok) {
        versionRef.current += 1;
        onVersionBumped();
      } else {
        throw new Error(result.error);
      }
    });
  }

  function updateCaption(
    mediaId: string,
    patch: Partial<
      Pick<RevisionMediaItem, "altText" | "caption" | "decorative">
    >,
  ) {
    setMedia((prev) =>
      prev.map((m) => (m.mediaId === mediaId ? { ...m, ...patch } : m)),
    );
    queue.enqueue(`media-caption:${mediaId}`, async () => {
      const item = media.find((m) => m.mediaId === mediaId);
      const merged = { ...item, ...patch };
      const result = await updateMediaCaptionAction({
        revisionId,
        mediaId,
        expectedVersion: versionRef.current,
        altText: merged.altText ?? null,
        caption: merged.caption ?? null,
        decorative: merged.decorative ?? false,
      });
      if (result.ok) {
        versionRef.current += 1;
        onVersionBumped();
      } else {
        throw new Error(result.error);
      }
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <label
          htmlFor="story-image-upload"
          className="inline-flex cursor-pointer items-center rounded-md border border-black/15 px-3 py-2 text-sm font-medium hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"
        >
          Add images
        </label>
        <input
          ref={fileInputRef}
          id="story-image-upload"
          type="file"
          accept={ACCEPTED_TYPES.join(",")}
          multiple
          className="sr-only"
          onChange={(e) => {
            void handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <p className="mt-1 text-sm text-black/60 dark:text-white/60">
          Up to {MAX_IMAGES_PER_REVISION} images, JPEG/PNG/WebP, 15 MB each.
        </p>
      </div>

      {uploading.length > 0 && (
        <ul className="space-y-1 text-sm">
          {uploading.map((u) => (
            <li
              key={u.key}
              className={
                u.progress === "error"
                  ? "text-red-600 dark:text-red-400"
                  : "text-black/70 dark:text-white/70"
              }
            >
              {u.fileName} —{" "}
              {u.progress === "error"
                ? u.error
                : u.progress === "uploading"
                  ? "Uploading…"
                  : "Processing…"}
            </li>
          ))}
        </ul>
      )}

      {media.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {media.map((item, index) => (
            <li
              key={item.mediaId}
              className="space-y-2 rounded-md border border-black/10 p-2 dark:border-white/10"
            >
              <div className="relative aspect-square overflow-hidden rounded bg-black/5 dark:bg-white/5">
                {thumbnails[item.mediaId] ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed URL, not an optimizable static asset
                  <img
                    src={thumbnails[item.mediaId]}
                    alt={item.altText ?? ""}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-black/50 dark:text-white/50">
                    {PROCESSING_LABELS[item.processingState] ??
                      item.processingState}
                  </div>
                )}
                {item.isCover && (
                  <span className="absolute left-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-xs text-white">
                    Cover
                  </span>
                )}
              </div>

              <label className="flex items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  checked={item.decorative}
                  onChange={(e) =>
                    updateCaption(item.mediaId, {
                      decorative: e.target.checked,
                    })
                  }
                />
                Decorative (no alt text needed)
              </label>

              {!item.decorative && (
                <input
                  type="text"
                  value={item.altText ?? ""}
                  onChange={(e) =>
                    updateCaption(item.mediaId, { altText: e.target.value })
                  }
                  placeholder="Alt text (required)"
                  className="w-full rounded border border-black/15 px-2 py-1 text-xs dark:border-white/15 dark:bg-transparent"
                />
              )}

              <input
                type="text"
                value={item.caption ?? ""}
                onChange={(e) =>
                  updateCaption(item.mediaId, { caption: e.target.value })
                }
                placeholder="Caption (optional)"
                className="w-full rounded border border-black/15 px-2 py-1 text-xs dark:border-white/15 dark:bg-transparent"
              />

              <div className="flex flex-wrap gap-2 text-xs">
                {!item.isCover && (
                  <button
                    type="button"
                    onClick={() => setCover(item.mediaId)}
                    className="underline underline-offset-2"
                  >
                    Set as cover
                  </button>
                )}
                {index > 0 && (
                  <button
                    type="button"
                    onClick={() => reorder(index, index - 1)}
                    className="underline underline-offset-2"
                  >
                    Move up
                  </button>
                )}
                {index < media.length - 1 && (
                  <button
                    type="button"
                    onClick={() => reorder(index, index + 1)}
                    className="underline underline-offset-2"
                  >
                    Move down
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => detach(item.mediaId)}
                  className="text-red-600 underline underline-offset-2 dark:text-red-400"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
