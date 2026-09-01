"use client";

import { useEffect, useRef, useState } from "react";
import type { RevisionMediaItem } from "@/lib/story/contributor-queries";
import type { MutationQueue } from "@/lib/story/mutation-queue";
import {
  looksLikeHeicUpload,
  MAX_HEIC_UPLOAD_BYTES,
  MAX_IMAGES_PER_REVISION,
  MAX_UPLOAD_BYTES,
  UPLOAD_ACCEPT_ATTRIBUTE,
} from "@/lib/story/image-validation";
import { getErrorMessage } from "@/lib/errors";
import { DEFAULT_EMBED_WIDTH } from "@/lib/story/markdown-media";
import { useToast } from "@/components/ui/toast";
import { Spinner } from "@/components/ui/spinner";
import { createClient as createBrowserSupabaseClient } from "@/lib/supabase/client";
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
import {
  beginMediaUploadAction,
  finalizeMediaUploadAction,
  transcodeHeicUploadAction,
} from "@/app/(contributor)/stories/[id]/edit/upload-actions";

/** Types a browser can render directly in an <img>, for the in-flight tile. */
const BROWSER_RENDERABLE_TYPES = ["image/jpeg", "image/png", "image/webp"];

/**
 * Client-side pre-check only (the server re-sniffs the real magic bytes).
 */
function isAcceptedFile(file: File): boolean {
  if (BROWSER_RENDERABLE_TYPES.includes(file.type)) return true;
  return looksLikeHeicUpload(file.type, file.name);
}

/**
 * Uploads `file` directly to Supabase Storage using the browser's own
 * session — never through this app's server at all. This is the fix for
 * the platform limit that made HEIC uploads fail unpredictably: Vercel's
 * Node.js Functions synchronously invoke via AWS Lambda underneath, whose
 * request payload is base64-encoded for binary bodies, working out to an
 * effective ~4.5 MiB ceiling on the raw bytes a Function can receive —
 * root-caused live by a 24MP iPhone HEIC (4.1 MB) failing with a 413
 * carrying a non-JSON body (proof the platform rejected it before this
 * app's own code, which always answers with JSON, ever ran) while a 12MP
 * HEIC from the same phone succeeded every time.
 *
 * Authorized by exactly the same storage RLS policy
 * (_can_write_reserved_media_path) that already scoped writes to the
 * caller's own auth.uid() — not "must come from our server" — so this
 * changes where the bytes travel, not the authorization model.
 */
async function uploadDirectlyToStorage(
  reservedPath: string,
  file: File,
  contentType: string,
  accessToken: string,
): Promise<void> {
  const encodedPath = reservedPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/story-images-private/${encodedPath}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      "Content-Type": contentType,
      "x-upsert": "false",
    },
    body: file,
  });
  if (response.ok) return;

  // Supabase Storage answers its own errors as JSON
  // ({statusCode, error, message}), unlike the Vercel-platform-level
  // failure this function exists to route around.
  const raw = await response.text().catch(() => "");
  let message: string | undefined;
  try {
    message = (JSON.parse(raw) as { message?: string }).message;
  } catch {
    // Not JSON — fall through to a status-derived message below.
  }
  if (message) throw new Error(message);
  if (response.status === 413) {
    throw new Error("That photo is too large to upload.");
  }
  throw new Error(`Upload failed (error ${response.status}).`);
}

type UploadingItem = {
  key: string;
  fileName: string;
  progress: "uploading" | "processing" | "error";
  error?: string;
  /** Local object URL for the file being uploaded, so the tile can show the
   * actual image (dimmed, with a centered spinner over it) instead of a
   * blank placeholder while the real upload/processing is in flight.
   * Revoked once the item leaves `uploading` (see handleFiles/removeUploading).
   * null for a HEIC file: most browsers cannot render one in an <img>, so a
   * plain muted tile beats a broken-image icon. */
  previewUrl: string | null;
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
  /**
   * Places an uploaded image into the story text at the editor's cursor,
   * via the "Add to story" button below -- the only way an image reaches
   * the story text now that the editor toolbar's own upload-and-insert
   * button has been removed (uploading happens here, exclusively). `width`
   * is this tile's own on-screen pixel width at the moment of the click
   * (see the button's onClick below) -- passed through so the inserted
   * image starts out the same size as its thumbnail here, not a separate
   * guessed default. Omitted in any context with no open editor to insert
   * into.
   */
  onInsertIntoEditor?: (mediaId: string, width: number) => void;
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

type MediaTextPatch = Partial<
  Pick<RevisionMediaItem, "altText" | "caption" | "decorative">
>;

/**
 * Distinguishes one photo from another in an accessible name, so a screen
 * reader hears "Details, photo 3" or "Describe, vines at dusk" rather than
 * a dozen identical "Details" buttons.
 */
function itemName(item: RevisionMediaItem, index: number): string {
  const described = item.altText?.trim() || item.caption?.trim();
  return described ? `“${described}”` : `photo ${index + 1}`;
}

/** Status pip on a tile -- "Cover", "In story", "Needs description". */
function TileBadge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "warning";
}) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] leading-tight font-medium backdrop-blur-sm ${
        tone === "warning"
          ? "bg-amber-500/90 text-black"
          : "bg-black/70 text-white"
      }`}
    >
      {children}
    </span>
  );
}

/**
 * A secondary action inside the detail panel. A real button with a border,
 * not the underlined text link the old tiles used: five underlined links
 * wrapping across two lines gave "Add to story" and "Remove" identical
 * weight, which is exactly backwards for one safe action and one
 * destructive one.
 */
function TileAction({
  children,
  onClick,
  tone = "neutral",
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  tone?: "neutral" | "destructive";
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`rounded-md border px-2.5 py-1.5 text-xs font-medium ${
        tone === "destructive"
          ? "border-destructive/40 text-destructive"
          : "border-border-subtle"
      }`}
    >
      {children}
    </button>
  );
}

export function ImageUploadManager({
  storyId,
  revisionId,
  initialMedia,
  versionRef,
  queue,
  onVersionBumped,
  inlineMediaIds,
  onMediaDetached,
  onInsertIntoEditor,
}: ImageUploadManagerProps) {
  const [media, setMedia] = useState<RevisionMediaItem[]>(
    [...initialMedia].sort((a, b) => a.sortOrder - b.sortOrder),
  );
  // Uploaded but not yet placed in the story text.
  const visibleMedia = media.filter((m) => !inlineMediaIds.has(m.mediaId));
  // Already placed in the story text. These used to be hidden from this
  // panel entirely, which meant alt text and captions became UNEDITABLE the
  // moment an image was put where it belonged -- the natural order (place
  // the photo, then describe it) was impossible, and it was the reason
  // stories arrived at moderation with the `images_missing_alt_text`
  // warning. They now get their own group below: describe and cover/remove,
  // but no "Add to story" (already there) and no reorder (their order is
  // the order they appear in the text).
  const placedMedia = media.filter((m) => inlineMediaIds.has(m.mediaId));
  const [uploading, setUploading] = useState<UploadingItem[]>([]);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [isDragging, setIsDragging] = useState(false);
  // Which photo's detail panel is expanded. One at a time, deliberately:
  // the old panel put a checkbox and two text inputs on EVERY tile, so a
  // dozen photos meant three dozen form controls competing for attention
  // and no tile you could actually look at. Every media library worth
  // copying (WordPress attachment details, Substack's edit-image panel,
  // Google Photos' info pane) shows a quiet grid and opens details for the
  // one item you asked about.
  const [openMediaId, setOpenMediaId] = useState<string | null>(null);
  // Media ids whose signed thumbnail URL already failed once and was
  // re-minted. Guards the onError retry below against a loop when the image
  // is genuinely broken rather than merely expired.
  const retriedThumbnailsRef = useRef<Set<string>>(new Set());
  // Drives the summary line -- alt text is what the moderation queue's
  // `images_missing_alt_text` warning fires on, so it is worth counting
  // where the contributor can still act on it.
  const needsAltTextCount = media.filter(
    (m) => !m.decorative && !m.altText?.trim(),
  ).length;
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

  /**
   * A thumbnail's signed URL stopped working. These URLs are minted with a
   * 120-second expiry (lib/story/image-pipeline.ts) and the minting effect
   * above deliberately skips any media id already in `thumbnails`, so a URL
   * is never refreshed once obtained. That is invisible while the <img>
   * stays mounted -- the browser keeps showing an image it already decoded
   * -- and becomes visible the moment anything remounts the element, which
   * is exactly what opening a photo's detail panel used to do: a fresh
   * <img> re-requests the dead URL and renders nothing.
   *
   * The remount is fixed separately (the tile and the detail panel now
   * share one element tree, so the <img> survives the toggle). This is the
   * belt-and-braces half: any expiry, from any cause, recovers by minting a
   * new URL once. Same shape as the retry in
   * app/(contributor)/my-stories/story-cover-thumbnail.tsx.
   */
  function retryThumbnail(mediaId: string) {
    if (retriedThumbnailsRef.current.has(mediaId)) return;
    retriedThumbnailsRef.current.add(mediaId);
    void mintPreviewUrlAction(mediaId).then((result) => {
      if ("url" in result) {
        setThumbnails((prev) => ({ ...prev, [mediaId]: result.url }));
        // Allow one more retry after a SUCCESSFUL re-mint: the new URL has
        // its own 120s life and can expire again in a long session.
        retriedThumbnailsRef.current.delete(mediaId);
      }
    });
  }

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
      const previewUrl = BROWSER_RENDERABLE_TYPES.includes(file.type)
        ? URL.createObjectURL(file)
        : null;
      if (previewUrl) previewUrlsRef.current.add(previewUrl);
      // Fast client-side pre-checks — UX feedback only. Every real safety
      // decision (true format, dimensions, decode success) happens
      // server-side in lib/story/image-pipeline.ts; nothing here is trusted.
      if (!isAcceptedFile(file)) {
        setUploading((prev) => [
          ...prev,
          {
            key,
            fileName: file.name,
            progress: "error",
            error: "Use JPEG, PNG, WebP, or HEIC.",
            previewUrl,
          },
        ]);
        continue;
      }
      const sizeLimit = looksLikeHeicUpload(file.type, file.name)
        ? MAX_HEIC_UPLOAD_BYTES
        : MAX_UPLOAD_BYTES;
      if (file.size > sizeLimit) {
        setUploading((prev) => [
          ...prev,
          {
            key,
            fileName: file.name,
            progress: "error",
            error: `File is too large (max ${Math.floor(sizeLimit / (1024 * 1024))} MB).`,
            previewUrl,
          },
        ]);
        continue;
      }

      setUploading((prev) => [
        ...prev,
        { key, fileName: file.name, progress: "uploading", previewUrl },
      ]);

      const isHeic = looksLikeHeicUpload(file.type, file.name);
      const sourceMimeType = isHeic
        ? ("image/heic" as const)
        : (file.type as "image/jpeg" | "image/png" | "image/webp");

      try {
        const begun = await beginMediaUploadAction(revisionId, sourceMimeType);
        if ("error" in begun) throw new Error(begun.error);
        const { mediaId, reservedPath } = begun;

        setUploading((prev) =>
          prev.map((u) =>
            u.key === key ? { ...u, progress: "processing" } : u,
          ),
        );

        const {
          data: { session },
        } = await createBrowserSupabaseClient().auth.getSession();
        if (!session) throw new Error("You must be signed in.");

        await uploadDirectlyToStorage(
          reservedPath,
          file,
          sourceMimeType,
          session.access_token,
        );

        if (isHeic) {
          const transcoded = await transcodeHeicUploadAction(mediaId);
          if ("error" in transcoded) throw new Error(transcoded.error);
        }

        const finalized = await finalizeMediaUploadAction(
          mediaId,
          versionRef.current,
        );
        if ("error" in finalized) throw new Error(finalized.error);

        // finalize_story_media_upload bumped the authoring version by
        // exactly one on success (see the migration's own guarantee).
        versionRef.current += 1;
        onVersionBumped();
        if (previewUrl) {
          URL.revokeObjectURL(previewUrl);
          previewUrlsRef.current.delete(previewUrl);
        }
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
            Up to {MAX_IMAGES_PER_REVISION} images, JPEG/PNG/WebP/HEIC (iPhone
            photos), 15 MB each.
          </span>
        </label>
        <input
          ref={fileInputRef}
          id="story-image-upload"
          type="file"
          accept={UPLOAD_ACCEPT_ATTRIBUTE}
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
              {/* A third the size of the finished-thumbnail tiles below --
                  this is a transient status preview, not the actual gallery
                  item, so it doesn't need to fill the same grid cell. */}
              <div
                className={`relative aspect-square w-1/3 overflow-hidden rounded-md border-2 ${
                  u.progress === "error"
                    ? "border-destructive"
                    : "border-border-subtle"
                }`}
              >
                {u.previewUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element -- a local object URL for the file being uploaded, not an optimizable static asset */
                  <img
                    src={u.previewUrl}
                    alt=""
                    className={`h-full w-full object-cover ${u.progress === "error" ? "opacity-40" : "opacity-90"}`}
                  />
                ) : (
                  /* HEIC: no browser-renderable local preview, so the tile
                     stays a plain muted square until the processed
                     (JPEG) thumbnail arrives from the server. */
                  <div className="h-full w-full bg-surface-muted" />
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

      {media.length > 0 && (
        <div>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="text-sm font-medium">
              {media.length === 1 ? "1 photo" : `${media.length} photos`}
              {placedMedia.length > 0 && (
                <span className="font-normal text-muted-foreground">
                  {" "}
                  · {placedMedia.length} in your story
                </span>
              )}
            </p>
            {needsAltTextCount > 0 && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                {needsAltTextCount === 1
                  ? "1 photo still needs a description"
                  : `${needsAltTextCount} photos still need a description`}
              </p>
            )}
          </div>

          <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {media.map((item, index) => {
              // Prompt 7: same-story duplicate-image warning -- compares
              // sha256 hashes of already-processed derivatives (never a
              // storage path).
              const duplicateCount = item.sha256
                ? media.filter((m) => m.sha256 === item.sha256).length
                : 1;
              const isDuplicate = duplicateCount > 1;
              const isPlaced = inlineMediaIds.has(item.mediaId);
              const isOpen = openMediaId === item.mediaId;
              const needsAltText = !item.decorative && !item.altText?.trim();
              const detailsId = `media-details-${item.mediaId}`;

              const thumb = (
                <div className="js-image-thumb relative aspect-square overflow-hidden rounded-md border border-border-subtle bg-surface-muted">
                  {thumbnails[item.mediaId] ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed URL, not an optimizable static asset
                    <img
                      src={thumbnails[item.mediaId]}
                      alt={item.altText ?? ""}
                      className="h-full w-full object-cover"
                      onError={() => retryThumbnail(item.mediaId)}
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

                  {/* Status reads off the tile itself, the way a media
                      library does it -- no field, no sentence, just the
                      three facts that change what you would do next. */}
                  <div className="pointer-events-none absolute inset-x-1 top-1 flex flex-wrap gap-1">
                    {item.isCover && <TileBadge>Cover</TileBadge>}
                    {isPlaced && <TileBadge>In story</TileBadge>}
                    {needsAltText && (
                      <TileBadge tone="warning">Needs description</TileBadge>
                    )}
                    {isDuplicate && (
                      <TileBadge tone="warning">Duplicate</TileBadge>
                    )}
                  </div>
                </div>
              );

              // ONE element tree for both states, laid out differently by
              // class. Rendering an `if (isOpen) return <li>…` branch beside
              // a separate closed-state <li> looked equivalent but was not:
              // React reconciles by position, so the two branches' <img>
              // elements are different nodes, and toggling details unmounted
              // the image and mounted a fresh one. A fresh <img> actually
              // re-requests its src -- and these are 120-second signed URLs,
              // so any tile older than two minutes came back blank. Keeping
              // the thumbnail at a stable position in the tree means the
              // browser never re-requests it at all.
              return (
                <li
                  key={item.mediaId}
                  className={
                    isOpen
                      ? "col-span-2 flex flex-col gap-4 rounded-lg border border-accent/50 bg-surface-muted/40 p-3 sm:col-span-3 sm:flex-row"
                      : "flex flex-col gap-1.5"
                  }
                >
                  <div className={isOpen ? "w-full shrink-0 sm:w-40" : ""}>
                    {thumb}
                  </div>

                  {isOpen ? (
                    <div id={detailsId} className="min-w-0 flex-1 space-y-3">
                      <div>
                        <label
                          htmlFor={`alt-${item.mediaId}`}
                          className="block text-xs font-medium"
                        >
                          Describe this photo
                          {!item.decorative && (
                            <span className="text-destructive">
                              <span aria-hidden="true"> *</span>
                              <span className="sr-only"> required</span>
                            </span>
                          )}
                        </label>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          For readers who can&rsquo;t see it. One plain sentence
                          about what is in the photo.
                        </p>
                        <input
                          id={`alt-${item.mediaId}`}
                          type="text"
                          value={item.altText ?? ""}
                          disabled={item.decorative}
                          onChange={(e) =>
                            updateCaption(item.mediaId, {
                              altText: e.target.value,
                            })
                          }
                          placeholder="Vines in rows under a grey sky"
                          className="mt-1.5 w-full rounded-md border border-border-subtle px-2 py-1.5 text-sm disabled:opacity-50 dark:bg-transparent"
                        />
                        <label className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={item.decorative}
                            onChange={(e) =>
                              updateCaption(item.mediaId, {
                                decorative: e.target.checked,
                              })
                            }
                          />
                          It&rsquo;s decorative — no description needed
                        </label>
                      </div>

                      <div>
                        <label
                          htmlFor={`caption-${item.mediaId}`}
                          className="block text-xs font-medium"
                        >
                          Caption{" "}
                          <span className="font-normal text-muted-foreground">
                            (optional, shown under the photo)
                          </span>
                        </label>
                        <input
                          id={`caption-${item.mediaId}`}
                          type="text"
                          value={item.caption ?? ""}
                          onChange={(e) =>
                            updateCaption(item.mediaId, {
                              caption: e.target.value,
                            })
                          }
                          className="mt-1 w-full rounded-md border border-border-subtle px-2 py-1.5 text-sm dark:bg-transparent"
                        />
                      </div>

                      <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle pt-3">
                        {!item.isCover && (
                          <TileAction onClick={() => setCover(item.mediaId)}>
                            Set as cover
                          </TileAction>
                        )}
                        {index > 0 && (
                          <TileAction
                            onClick={() =>
                              reorder(item.mediaId, media[index - 1].mediaId)
                            }
                            label={`Move ${itemName(item, index)} earlier`}
                          >
                            ↑ Earlier
                          </TileAction>
                        )}
                        {index < media.length - 1 && (
                          <TileAction
                            onClick={() =>
                              reorder(item.mediaId, media[index + 1].mediaId)
                            }
                            label={`Move ${itemName(item, index)} later`}
                          >
                            ↓ Later
                          </TileAction>
                        )}
                        <TileAction
                          tone="destructive"
                          onClick={() => detach(item.mediaId)}
                        >
                          Delete photo
                        </TileAction>
                        <button
                          type="button"
                          onClick={() => setOpenMediaId(null)}
                          className="ml-auto rounded-md border border-border-subtle px-3 py-1.5 text-xs font-medium"
                        >
                          Done
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      {onInsertIntoEditor && !isPlaced && (
                        <button
                          type="button"
                          onClick={(e) => {
                            // Reads this tile's own current on-screen width
                            // (the grid is responsive -- 2 or 3 columns
                            // depending on viewport) rather than a hardcoded
                            // number, so "same size as the Images section"
                            // stays true at whatever width it's actually
                            // showing right now.
                            const el = e.currentTarget
                              .closest("li")
                              ?.querySelector<HTMLElement>(".js-image-thumb");
                            const width = el
                              ? Math.round(el.getBoundingClientRect().width)
                              : DEFAULT_EMBED_WIDTH;
                            onInsertIntoEditor(item.mediaId, width);
                          }}
                          className="min-w-0 flex-1 truncate rounded-md bg-accent px-2 py-1.5 text-xs font-semibold text-accent-foreground"
                        >
                          Add to story
                        </button>
                      )}
                      {/* No "already placed" text: the tile's own "In story"
                          badge says it, and a second copy of the same fact
                          truncated to "Placed in your…" next to Details in a
                          2-column phone grid. */}
                      <button
                        type="button"
                        onClick={() => setOpenMediaId(item.mediaId)}
                        aria-expanded={false}
                        aria-controls={detailsId}
                        // aria-label, NOT visible text plus an sr-only span:
                        // the accessible-name algorithm trims each element's
                        // text before joining them with no separator, so
                        // "Describe" + <span> photo 1</span> is announced as
                        // "Describephoto 1". Confirmed against
                        // dom-accessibility-api, which is what both this
                        // project's tests and real screen readers implement.
                        aria-label={`${needsAltText ? "Describe" : "Details"} ${itemName(item, index)}`}
                        className={`shrink-0 rounded-md border px-2 py-1.5 text-xs font-medium ${
                          isPlaced ? "w-full" : ""
                        } ${
                          needsAltText
                            ? "border-amber-500/70 text-amber-700 dark:text-amber-400"
                            : "border-border-subtle"
                        }`}
                      >
                        {needsAltText ? "Describe" : "Details"}
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
