"use server";

import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import {
  authorizeHeicTranscode,
  beginStoryMediaUpload,
  cancelPendingStoryMediaUpload,
  finalizeStoryMediaUpload,
  recordHeicTranscodedOriginal,
} from "@/lib/story/mutations";
import {
  processStoryMedia,
  transcodeStagedHeicUpload,
} from "@/lib/story/image-pipeline";
import { HeicTranscodeError } from "@/lib/story/heic";
import { getErrorMessage } from "@/lib/errors";

/**
 * Replaces app/(contributor)/stories/[id]/edit/upload/route.ts, which
 * relayed the raw upload bytes through this server on their way to Storage.
 * That relay was the exact hop with the ~4.5 MiB effective ceiling: Vercel
 * Node.js Functions synchronously invoke via AWS Lambda underneath, whose
 * request payload is base64-encoded for binary bodies, and Lambda's own 6 MB
 * synchronous-invocation cap works out to roughly that many raw bytes
 * surviving the round trip. Root-caused live: a 24MP iPhone HEIC (4.1 MB)
 * was rejected with a 413 carrying a non-JSON body — proof the platform
 * rejected the request before this app's own code (which always returns
 * JSON) ever ran — while a 12MP HEIC from the same phone succeeded
 * consistently.
 *
 * The fix moves the raw bytes off this path entirely: the browser now
 * uploads directly to Supabase Storage using its own session
 * (components/story/image-upload-manager.tsx), authorized by the exact
 * same RLS policy (_can_write_reserved_media_path) that already scoped
 * writes to auth.uid() — not "must come from our server" — so nothing
 * about the authorization MODEL changed, only where the bytes travel.
 * Every Server Action below is bytes-free: UUIDs and small strings only.
 *
 * Three actions, called in sequence by the client:
 *   1. beginMediaUploadAction — reserve a slot + path (unchanged RPC).
 *   2. transcodeHeicUploadAction — HEIC only. The browser has already
 *      staged the raw HEIC directly into the private bucket; this
 *      authorizes, downloads it (an ordinary OUTBOUND request, never
 *      subject to the inbound-body limit), transcodes via the completely
 *      unchanged lib/story/heic.ts, and rewrites the reservation onto the
 *      resulting original.jpg.
 *   3. finalizeMediaUploadAction — unchanged finalize_story_media_upload
 *      (already verified uploads via storage.objects directly, never the
 *      caller's claim), then processStoryMedia with no bytes passed in —
 *      its existing fallback path downloads from storage itself.
 */

const uuidSchema = z.uuid();

export async function beginMediaUploadAction(
  revisionId: string,
  sourceMimeType: "image/jpeg" | "image/png" | "image/webp" | "image/heic",
): Promise<{ mediaId: string; reservedPath: string } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "You must be signed in." };

  const parsedRevisionId = uuidSchema.safeParse(revisionId);
  if (!parsedRevisionId.success) return { error: "Invalid revision." };

  try {
    const reserved = await beginStoryMediaUpload(
      parsedRevisionId.data,
      sourceMimeType,
    );
    return { mediaId: reserved.media_id, reservedPath: reserved.reserved_path };
  } catch (error) {
    return {
      error: getErrorMessage(error, "Could not reserve an upload slot."),
    };
  }
}

export async function transcodeHeicUploadAction(
  mediaId: string,
): Promise<{ ok: true } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "You must be signed in." };

  const parsedMediaId = uuidSchema.safeParse(mediaId);
  if (!parsedMediaId.success) return { error: "Invalid media." };

  try {
    const { story_id, staging_path } = await authorizeHeicTranscode(
      parsedMediaId.data,
    );
    const { jpgPath } = await transcodeStagedHeicUpload(
      parsedMediaId.data,
      story_id,
      staging_path,
    );
    await recordHeicTranscodedOriginal(parsedMediaId.data, jpgPath);
    return { ok: true };
  } catch (error) {
    if (error instanceof HeicTranscodeError) {
      return { error: error.message };
    }
    return {
      error: getErrorMessage(
        error,
        "Could not convert this HEIC photo. Please try again.",
      ),
    };
  }
}

export async function finalizeMediaUploadAction(
  mediaId: string,
  expectedVersion: number,
): Promise<{ mediaId: string } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "You must be signed in." };

  const parsedMediaId = uuidSchema.safeParse(mediaId);
  if (!parsedMediaId.success) return { error: "Invalid media." };
  if (!Number.isInteger(expectedVersion)) {
    return { error: "Invalid expectedVersion." };
  }

  try {
    await finalizeStoryMediaUpload(parsedMediaId.data, expectedVersion);
  } catch (error) {
    // Abandoned reservations are swept by
    // scripts/cleanup-abandoned-media-uploads.mjs — no inline storage
    // cleanup needed here, matching that script's existing role.
    await cancelPendingStoryMediaUpload(parsedMediaId.data).catch(() => {});
    return {
      error: getErrorMessage(error, "Could not finalize the upload."),
    };
  }

  // Processing failures are recorded to the DB by processStoryMedia itself
  // (record_story_media_processing_failed) — this action still succeeds
  // from the client's point of view (the image is attached, just not
  // usable until processed); the client polls processingState via the
  // preview/edit media list rather than this response.
  try {
    await processStoryMedia(parsedMediaId.data);
  } catch {
    // Already recorded server-side; nothing further to do here.
  }

  return { mediaId: parsedMediaId.data };
}
