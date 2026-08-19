"use client";

import { useEffect, useRef, useState } from "react";
import type { RevisionMediaItem } from "@/lib/story/contributor-queries";
import type { MutationQueue } from "@/lib/story/mutation-queue";
import {
  MAX_IMAGES_PER_REVISION,
  MAX_UPLOAD_BYTES,
} from "@/lib/story/image-validation";
import { getErrorMessage } from "@/lib/errors";
import { useToast } from "@/components/ui/toast";
import { Spinner } from "@/components/ui/spinner";
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
  /** Local object URL for the file being uploaded, so the tile can show the
   * actual image (dimmed, with a centered spinner over it) instead of a
   * blank placeholder while the real upload/processing is in flight.
   * Revoked once the item leaves `uploading` (see handleFiles/removeUploading). */
  previewUrl: string;
};

export type ImageUploadManagerProps = {
  storyId: string;
  revisionId: string;
  initialMedia: RevisionMediaItem[];
  versionRef: React.MutableRefObject<number>;
  queue: MutationQueue;
  onVersionBumped: () => void;
  /**
   * mediaIds already placed inline in the story text (an "image"
   * content_json block referencing them) -- excluded from this panel
   * entirely rather than shown-but-undeletable, so there's no separate
   * "can't remove, it's used in your text" error state to build: removing
   * an image from the text (in the editor) is what returns it here.
   */
  inlineMediaIds: ReadonlySet<string>;
  /**
   * Called when an image is removed, so the open editor can strip that
   * image's `![[mediaId]]` embed tokens from the story text to match.
   * detach_story_media() does the same strip authoritatively in the
   * database (see 20260815100000_detach_media_strips_embed_tokens.sql) --
   * this keeps the editor this panel is sitting next to in step, so the
   * next autosave doesn't try to re-save a reference the revision no
   * longer carries.
   */
  onMediaDetached?: (mediaId: string) => void;
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
  inlineMediaIds,
  onMediaDetached,
}: ImageUploadManagerProps) {
  const [media, setMedia] = useState<RevisionMediaItem[]>(
    [...initialMedia].sort((a, b) => a.sortOrder - b.sortOrder),
  );
  const visibleMedia = media.filter((m) => !inlineMediaIds.has(m.mediaId));
  const [uploading, setUploading] = useState<UploadingItem[]>([]);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { showToast } = useToast();

  // Revokes every local preview URL this component ever created (including
  // ones for errored items that never leave `uploading`, since those have
  // no other removal point) once the panel itself unmounts.
  const previewUrlsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const urls = previewUrlsRef.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, []);

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
      const previewUrl = URL.createObjectURL(file);
      previewUrlsRef.current.add(previewUrl);
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
            previewUrl,
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
            previewUrl,
          },
        ]);
        continue;
      }

      setUploading((prev) => [
        ...prev,
        { key, fileName: file.name, progress: "uploading", previewUrl },
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
        URL.revokeObjectURL(previewUrl);
        previewUrlsRef.current.delete(previewUrl);
        setUploading((prev) => prev.filter((u) => u.key !== key));
        await refresh();
        showToast(`${file.name} uploaded.`);
      } catch (error) {
        const message = getErrorMessage(error, "Upload failed.");
        setUploading((prev) =>
          prev.map((u) =>
            u.key === key
              ? {
                  ...u,
                  progress: "error",
                  error: message,
                }
              : u,
          ),
        );
        showToast(`${file.name} failed to upload.`, "error");
      }
    }
  }

  // Swaps two specific items' positions (rather than splicing a range),
  // because "Move up/down" now swaps a visible item with its nearest
  // *visible* neighbor -- images placed inline are excluded from this
  // panel (see ImageUploadManagerProps.inlineMediaIds) but still occupy a
  // position in `media`'s underlying order, and a naive index-shift would
  // reorder across them incorrectly.
  function reorder(mediaId: string, swapWithMediaId: string) {
    const next = [...media];
    const i = next.findIndex((m) => m.mediaId === mediaId);
    const j = next.findIndex((m) => m.mediaId === swapWithMediaId);
    if (i === -1 || j === -1) return;
    [next[i], next[j]] = [next[j], next[i]];
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
    onMediaDetached?.(mediaId);
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
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            setIsDragging(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            void handleFiles(e.dataTransfer.files);
          }}
          className={`flex w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 py-10 text-center transition-colors ${
            isDragging
              ? "border-accent bg-accent/5"
              : "border-border-subtle hover:bg-surface-muted"
          }`}
        >
          <span className="text-sm font-medium">
            Drag and drop images here, or click to browse
          </span>
          <span className="text-sm text-muted-foreground">
            Up to {MAX_IMAGES_PER_REVISION} images, JPEG/PNG/WebP, 15 MB each.
          </span>
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
      </div>

      {uploading.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {uploading.map((u) => (
            <li key={u.key} className="space-y-1">
              <div
                className={`relative aspect-square overflow-hidden rounded-md border-2 ${
                  u.progress === "error"
                    ? "border-destructive"
                    : "border-border-subtle"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL for the file being uploaded, not an optimizable static asset */}
                <img
                  src={u.previewUrl}
                  alt=""
                  className={`h-full w-full object-cover ${u.progress === "error" ? "opacity-40" : "opacity-60"}`}
                />
                {u.progress !== "error" && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/10">
                    <Spinner className="h-6 w-6 text-white" />
                  </div>
                )}
              </div>
              <p
                className={`truncate text-xs ${
                  u.progress === "error"
                    ? "text-destructive"
                    : "text-muted-foreground"
                }`}
                title={u.fileName}
              >
                {u.progress === "error"
                  ? u.error
                  : u.progress === "uploading"
                    ? "Uploading…"
                    : "Processing…"}
              </p>
            </li>
          ))}
        </ul>
      )}

      {inlineMediaIds.size > 0 && (
        <p className="text-sm text-muted-foreground">
          {inlineMediaIds.size === 1
            ? "1 image placed in your story text isn't shown here — remove it from the text to manage it below again."
            : `${inlineMediaIds.size} images placed in your story text aren't shown here — remove them from the text to manage them below again.`}
        </p>
      )}

      {visibleMedia.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {visibleMedia.map((item, index) => {
            // Prompt 7: same-story duplicate-image warning -- compares
            // sha256 hashes of already-processed derivatives (never a
            // storage path) already present in `media` (the full,
            // unfiltered list -- a duplicate placed inline still counts).
            const duplicateCount = item.sha256
              ? media.filter((m) => m.sha256 === item.sha256).length
              : 1;
            const isDuplicate = duplicateCount > 1;
            return (
              <li
                key={item.mediaId}
                className="space-y-2 rounded-md border border-border-subtle p-2"
              >
                <div className="relative aspect-square overflow-hidden rounded border border-border-subtle bg-surface-muted">
                  {thumbnails[item.mediaId] ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed URL, not an optimizable static asset
                    <img
                      src={thumbnails[item.mediaId]}
                      alt={item.altText ?? ""}
                      className="h-full w-full object-cover"
                    />
                  ) : item.processingState === "failed" ? (
                    <div className="flex h-full w-full items-center justify-center px-2 text-center text-xs text-muted-foreground">
                      {PROCESSING_LABELS[item.processingState]}
                    </div>
                  ) : (
                    <div
                      className="flex h-full w-full items-center justify-center text-muted-foreground"
                      aria-label={
                        PROCESSING_LABELS[item.processingState] ??
                        item.processingState
                      }
                    >
                      <Spinner className="h-6 w-6" />
                    </div>
                  )}
                  {item.isCover && (
                    <span className="absolute left-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-xs text-white">
                      Cover
                    </span>
                  )}
                </div>

                {isDuplicate && (
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    Possible duplicate — matches another image in this story.
                  </p>
                )}

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
                    className="w-full rounded border border-border-subtle px-2 py-1 text-xs dark:bg-transparent"
                  />
                )}

                <input
                  type="text"
                  value={item.caption ?? ""}
                  onChange={(e) =>
                    updateCaption(item.mediaId, { caption: e.target.value })
                  }
                  placeholder="Caption (optional)"
                  className="w-full rounded border border-border-subtle px-2 py-1 text-xs dark:bg-transparent"
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
                      onClick={() =>
                        reorder(item.mediaId, visibleMedia[index - 1].mediaId)
                      }
                      className="underline underline-offset-2"
                    >
                      Move up
                    </button>
                  )}
                  {index < visibleMedia.length - 1 && (
                    <button
                      type="button"
                      onClick={() =>
                        reorder(item.mediaId, visibleMedia[index + 1].mediaId)
                      }
                      className="underline underline-offset-2"
                    >
                      Move down
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => detach(item.mediaId)}
                    className="text-destructive underline underline-offset-2"
                  >
                    Remove
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
