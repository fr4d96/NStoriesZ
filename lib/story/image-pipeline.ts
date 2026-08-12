import "server-only";
import { createHash } from "node:crypto";
import sharp, { type Sharp, type Metadata, type OutputInfo } from "sharp";
import { createAdminClient } from "@/lib/supabase/admin";
import { env, getAdminEnv } from "@/lib/env.server";
import {
  rawStorageDownload,
  rawStorageUpload,
} from "@/lib/story/raw-storage-http";
import {
  extensionForMimeType,
  MAX_INPUT_PIXELS,
  MAX_PROCESSED_BYTES,
  MAX_PROCESSED_DIMENSION,
  sniffImageMimeType,
  type AllowedImageMimeType,
} from "@/lib/story/image-validation";

/**
 * The ONE module allowed to import lib/supabase/admin.ts (enforced by the
 * `no-restricted-imports` ESLint rule in eslint.config.mjs, plus
 * `server-only`'s build-time guarantee). Every exported function here
 * operates on server-derived ids/paths that were already authorized by a
 * caller using the regular (RLS-respecting) client — this module never
 * re-derives or trusts a caller-supplied identity itself.
 *
 * Three operations, each independently idempotent/retryable:
 *   - processStoryMedia: decode + strip + resize the original upload,
 *     stage the result privately. Never touches the public bucket.
 *   - copyStoryMediaToPublic: copy an already-processed derivative to the
 *     public bucket for one publication attempt. Only ever called after a
 *     moderator has begun a publication attempt.
 *   - mintMediaPreviewSignedUrl: look up a media item's private staging
 *     path and mint a short-lived signed URL. The CALLER is responsible for
 *     having already authorized the request (authorize_story_media_preview,
 *     via the caller's own regular client) before invoking this.
 */

const PRIVATE_BUCKET = "story-images-private";
const PUBLIC_BUCKET = "story-images-public";
const SIGNED_URL_EXPIRY_SECONDS = 120;

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// Both storage transfers below go over raw `node:https`
// (lib/story/raw-storage-http.ts), not the supabase-js client's
// storage.download()/storage.upload() -- see that module's doc comment for
// why: two earlier fixes (Blob body, then pinning `fetch` to undici's
// directly) both still corrupted binary bytes intermittently in production,
// confirmed live by re-downloading the actually-stored object via plain
// `curl`. This is the third, maximally direct fix -- no fetch/undici
// abstraction left for anything to patch.
function adminStorageAuth() {
  const key = getAdminEnv().SUPABASE_SERVICE_ROLE_KEY;
  return { apikey: key, bearerToken: key };
}

async function downloadObject(bucket: string, path: string): Promise<Buffer> {
  try {
    return await rawStorageDownload(
      env.NEXT_PUBLIC_SUPABASE_URL,
      adminStorageAuth(),
      bucket,
      path,
    );
  } catch (err) {
    throw new Error(
      `Failed to download ${bucket}/${path}: ${err instanceof Error ? err.message : "unknown error"}`,
    );
  }
}

async function uploadObject(
  bucket: string,
  path: string,
  bytes: Buffer,
  contentType: string,
): Promise<void> {
  try {
    await rawStorageUpload(
      env.NEXT_PUBLIC_SUPABASE_URL,
      adminStorageAuth(),
      bucket,
      path,
      bytes,
      contentType,
      true,
    );
  } catch (err) {
    throw new Error(
      `Failed to upload ${bucket}/${path}: ${err instanceof Error ? err.message : "unknown error"}`,
    );
  }
}

/**
 * Decodes, validates, strips metadata from, and resizes an original upload,
 * then stages the result in the private bucket at a content-addressed path.
 * Never writes to the public bucket. Records the result (or a specific
 * failure) via the corresponding service-role-only RPC. Safe to call more
 * than once for the same media — a repeat call re-derives the same
 * deterministic output and is a no-op-safe retry from the DB's perspective
 * (record_processed_story_media rejects only if already `processed` or
 * later, per its own idempotency rule).
 */
export async function processStoryMedia(mediaId: string): Promise<void> {
  const admin = createAdminClient();
  const { data: media, error: fetchError } = await admin
    .from("story_media")
    .select("story_id, private_storage_path, processing_state")
    .eq("id", mediaId)
    .single();
  if (fetchError || !media) {
    throw new Error(`No such media: ${mediaId}`);
  }

  try {
    const original = await downloadObject(
      PRIVATE_BUCKET,
      media.private_storage_path,
    );

    const sniffed = sniffImageMimeType(original);
    if (!sniffed) {
      await recordProcessingFailure(
        mediaId,
        "unrecognized_image_format",
        "Not a JPEG, PNG, or WebP file.",
      );
      return;
    }

    let image: Sharp;
    let metadata: Metadata;
    try {
      // `pages: -1` is required for sharp to report a real page count at
      // all — without it, `metadata.pages` is always undefined even for a
      // genuinely multi-frame source, which would silently let an animated
      // image through undetected. The actual transform pipeline below uses
      // a separate, ordinary (single-page) sharp instance.
      metadata = await sharp(original, {
        limitInputPixels: MAX_INPUT_PIXELS,
        pages: -1,
      }).metadata();
      image = sharp(original, { limitInputPixels: MAX_INPUT_PIXELS });
    } catch {
      await recordProcessingFailure(
        mediaId,
        "decode_failed",
        "The image could not be decoded.",
      );
      return;
    }

    if ((metadata.pages ?? 1) > 1) {
      await recordProcessingFailure(
        mediaId,
        "animated_not_supported",
        "Animated images are not supported.",
      );
      return;
    }
    if (!metadata.width || !metadata.height) {
      await recordProcessingFailure(
        mediaId,
        "decode_failed",
        "Could not determine image dimensions.",
      );
      return;
    }
    const sourceWidth = metadata.width;
    const sourceHeight = metadata.height;

    // .rotate() with no argument auto-orients from EXIF before the
    // metadata-stripping re-encode removes EXIF entirely — visual
    // orientation is preserved, the source metadata is gone. sharp does
    // not copy metadata into its output by default (no withMetadata()
    // call), so this re-encode is metadata-free.
    const processedMimeType: AllowedImageMimeType =
      sniffed === "image/png" ? "image/png" : "image/jpeg";
    let pipeline = image.rotate().resize({
      width: MAX_PROCESSED_DIMENSION,
      height: MAX_PROCESSED_DIMENSION,
      fit: "inside",
      withoutEnlargement: true,
    });
    pipeline =
      processedMimeType === "image/png"
        ? pipeline.png()
        : pipeline.jpeg({ quality: 85 });

    let processedBuffer: Buffer;
    let processedInfo: OutputInfo;
    try {
      const result = await pipeline.toBuffer({ resolveWithObject: true });
      processedBuffer = result.data;
      processedInfo = result.info;
    } catch {
      await recordProcessingFailure(
        mediaId,
        "reencode_failed",
        "The image could not be re-encoded.",
      );
      return;
    }

    if (processedBuffer.byteLength > MAX_PROCESSED_BYTES) {
      await recordProcessingFailure(
        mediaId,
        "processed_too_large",
        "The processed image exceeds the size limit.",
      );
      return;
    }

    const hash = sha256Hex(processedBuffer);
    const ext = extensionForMimeType(processedMimeType);
    const stagingPath = `${media.story_id}/${mediaId}/processed-${hash}.${ext}`;

    await uploadObject(
      PRIVATE_BUCKET,
      stagingPath,
      processedBuffer,
      processedMimeType,
    );
    await verifyUploadedBytes(
      PRIVATE_BUCKET,
      stagingPath,
      processedBuffer,
      hash,
    );

    const { error: recordError } = await admin.rpc(
      "record_processed_story_media",
      {
        p_media_id: mediaId,
        p_processed_private_storage_path: stagingPath,
        p_source_mime_type: sniffed,
        p_source_width: sourceWidth,
        p_source_height: sourceHeight,
        p_processed_mime_type: processedMimeType,
        p_processed_file_size_bytes: processedBuffer.byteLength,
        p_processed_width: processedInfo.width,
        p_processed_height: processedInfo.height,
        p_sha256: hash,
      },
    );
    if (recordError) {
      throw new Error(
        `record_processed_story_media failed: ${recordError.message}`,
      );
    }
  } catch (err) {
    await recordProcessingFailure(
      mediaId,
      "processing_error",
      err instanceof Error ? err.message : "Unknown processing error.",
    );
    throw err;
  }
}

async function recordProcessingFailure(
  mediaId: string,
  errorCode: string,
  reason: string,
): Promise<void> {
  const admin = createAdminClient();
  await admin.rpc("record_story_media_processing_failed", {
    p_media_id: mediaId,
    p_failure_reason: reason,
    p_error_code: errorCode,
  });
}

/**
 * Verifies the object actually stored at `path` has the expected byte
 * content, by hashing what's actually there — an upload call returning
 * success is not, by itself, treated as proof of correct bytes.
 */
async function verifyUploadedBytes(
  bucket: string,
  path: string,
  expectedBytes: Buffer,
  expectedHash: string,
): Promise<void> {
  const stored = await downloadObject(bucket, path);
  const storedHash = sha256Hex(stored);
  if (
    storedHash !== expectedHash ||
    stored.byteLength !== expectedBytes.byteLength
  ) {
    throw new Error(
      `Byte verification failed for ${bucket}/${path}: stored content does not match expected hash`,
    );
  }
}

/**
 * Copies an already-processed media item's derivative into the public
 * bucket for one specific publication attempt, verifies the copy, and
 * records the result. Idempotent: retrying after a prior failure re-derives
 * the identical content-addressed target and either finds it already
 * correct or overwrites it with a freshly-verified copy — a content-
 * addressed path can never have two different byte sequences recorded
 * under it as "correct."
 */
export async function copyStoryMediaToPublic(
  mediaId: string,
  approvalAttemptId: string,
): Promise<void> {
  const admin = createAdminClient();

  const { data: begun, error: beginError } = await admin.rpc(
    "begin_story_media_copy_attempt",
    {
      p_media_id: mediaId,
      p_approval_attempt_id: approvalAttemptId,
    },
  );
  if (beginError || !begun || begun.length === 0) {
    throw new Error(
      `begin_story_media_copy_attempt failed: ${beginError?.message ?? "no data"}`,
    );
  }
  const { public_path: publicPath, content_hash: expectedHash } = begun[0];

  try {
    const { data: existing } = await admin.storage
      .from(PUBLIC_BUCKET)
      .list(publicPath.split("/").slice(0, -1).join("/"));
    const alreadyThere = existing?.some((obj) => publicPath.endsWith(obj.name));
    if (alreadyThere) {
      const stored = await downloadObject(PUBLIC_BUCKET, publicPath);
      if (sha256Hex(stored) === expectedHash) {
        await admin.rpc("record_story_media_copy_verified", {
          p_media_id: mediaId,
          p_approval_attempt_id: approvalAttemptId,
        });
        return;
      }
      // Existing object doesn't match the expected hash — never trust it
      // blindly; overwrite with a freshly-verified copy below.
    }

    const { data: media, error: fetchError } = await admin
      .from("story_media")
      .select("processed_private_storage_path, processed_mime_type")
      .eq("id", mediaId)
      .single();
    if (
      fetchError ||
      !media?.processed_private_storage_path ||
      !media.processed_mime_type
    ) {
      throw new Error(`Media ${mediaId} has no processed derivative to copy`);
    }

    const bytes = await downloadObject(
      PRIVATE_BUCKET,
      media.processed_private_storage_path,
    );
    await uploadObject(
      PUBLIC_BUCKET,
      publicPath,
      bytes,
      media.processed_mime_type,
    );
    await verifyUploadedBytes(PUBLIC_BUCKET, publicPath, bytes, expectedHash);

    const { error: verifiedError } = await admin.rpc(
      "record_story_media_copy_verified",
      {
        p_media_id: mediaId,
        p_approval_attempt_id: approvalAttemptId,
      },
    );
    if (verifiedError) {
      throw new Error(
        `record_story_media_copy_verified failed: ${verifiedError.message}`,
      );
    }
  } catch (err) {
    await admin.rpc("record_story_media_copy_failed", {
      p_media_id: mediaId,
      p_approval_attempt_id: approvalAttemptId,
      p_error_code:
        err instanceof Error ? err.message.slice(0, 200) : "unknown_error",
    });
    throw err;
  }
}

/**
 * Looks up a media item's private staging path (service-role only — never
 * exposed via PostgREST to any authenticated client) and mints a
 * short-lived signed URL. The caller must have already authorized this
 * request via authorize_story_media_preview() on their own regular client
 * — this function performs no authorization of its own.
 */
export async function mintMediaPreviewSignedUrl(
  mediaId: string,
): Promise<string> {
  const admin = createAdminClient();
  const { data: path, error: pathError } = await admin.rpc(
    "get_media_private_path_for_preview",
    {
      p_media_id: mediaId,
    },
  );
  if (pathError || !path) {
    throw new Error(`No processed derivative available for media ${mediaId}`);
  }

  const { data, error } = await admin.storage
    .from(PRIVATE_BUCKET)
    .createSignedUrl(path, SIGNED_URL_EXPIRY_SECONDS);
  if (error || !data) {
    throw new Error(
      `Failed to mint signed URL for media ${mediaId}: ${error?.message ?? "no data"}`,
    );
  }
  return data.signedUrl;
}
