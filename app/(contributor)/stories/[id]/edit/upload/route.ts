import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env.server";
import { rawStorageUpload } from "@/lib/story/raw-storage-http";
import {
  beginStoryMediaUpload,
  cancelPendingStoryMediaUpload,
  finalizeStoryMediaUpload,
} from "@/lib/story/mutations";
import { processStoryMedia } from "@/lib/story/image-pipeline";
import {
  MAX_UPLOAD_BYTES,
  sniffImageMimeType,
} from "@/lib/story/image-validation";
import { getErrorMessage } from "@/lib/errors";

// Node runtime (not Edge): sharp-based processing later in this same
// request needs Node APIs, and this handler itself needs to read a
// multipart body into a real Buffer to sniff magic bytes before trusting
// anything about the file. See docs/architecture.md "Upload reservation
// flow" for the full sequence this implements.
export const runtime = "nodejs";

/**
 * POST /stories/:id/edit/upload — multipart form fields:
 *   file            the image bytes
 *   expectedVersion the caller's last-known story.version (optimistic concurrency)
 *
 * Sequence: authenticate -> reject an oversized Content-Length early ->
 * buffer the body (still bounded by MAX_UPLOAD_BYTES) -> sniff real magic
 * bytes (never trust a client Content-Type) -> begin_story_media_upload
 * (reserves a slot + path) -> upload via the REGULAR server client (RLS-
 * enforced, never the admin client) to the reserved path ->
 * finalize_story_media_upload (verifies the object actually landed, joins
 * it to the revision, bumps the authoring version) -> processStoryMedia
 * (decode/strip/resize synchronously in this request — there is no
 * background worker in this phase, see docs/architecture.md).
 *
 * Ownership/edit-rights are never trusted from the client: every RPC here
 * re-derives them from the session via _authorize_revision_edit()
 * server-side (Engineering Rule 2/3), regardless of which revisionId the
 * URL names.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: "You must be signed in." },
      { status: 401 },
    );
  }

  const { id: storyId } = await params;

  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader);
    if (Number.isFinite(contentLength) && contentLength > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: "File is too large (max 15 MB)." },
        { status: 413 },
      );
    }
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid upload." }, { status: 400 });
  }

  const file = formData.get("file");
  const revisionId = formData.get("revisionId");
  const expectedVersionRaw = formData.get("expectedVersion");

  if (
    !(file instanceof File) ||
    typeof revisionId !== "string" ||
    typeof expectedVersionRaw !== "string"
  ) {
    return NextResponse.json(
      { error: "Missing file, revisionId, or expectedVersion." },
      { status: 400 },
    );
  }
  const expectedVersion = Number(expectedVersionRaw);
  if (!Number.isInteger(expectedVersion)) {
    return NextResponse.json(
      { error: "Invalid expectedVersion." },
      { status: 400 },
    );
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: "File is too large (max 15 MB)." },
      { status: 413 },
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const sniffed = sniffImageMimeType(bytes);
  if (!sniffed) {
    return NextResponse.json(
      { error: "Unsupported file type. Use JPEG, PNG, or WebP." },
      { status: 400 },
    );
  }

  let mediaId: string;
  let reservedPath: string;
  try {
    const reserved = await beginStoryMediaUpload(revisionId, sniffed);
    mediaId = reserved.media_id;
    reservedPath = reserved.reserved_path;
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Could not reserve an upload slot.") },
      { status: 400 },
    );
  }

  // Regular (RLS-respecting) server client — never the admin client. The
  // private bucket's own INSERT policy (_can_write_reserved_media_path)
  // independently enforces that this path is one this user actually
  // reserved via begin_story_media_upload above.
  const supabase = await createClient();

  // Uploaded over raw `node:https` (lib/story/raw-storage-http.ts), not
  // supabase-js's storage.upload() -- see that module's doc comment for
  // why: two earlier fixes (a Blob body, then pinning `fetch` to undici's
  // directly) both still corrupted binary bytes intermittently in
  // production. The user's own access token (not the admin client) is used
  // as the bearer token, so this is still exactly as RLS-scoped as the
  // supabase-js call it replaces -- _can_write_reserved_media_path still
  // enforces that reservedPath is one this user actually reserved.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json(
      { error: "You must be signed in." },
      { status: 401 },
    );
  }
  try {
    await rawStorageUpload(
      env.NEXT_PUBLIC_SUPABASE_URL,
      {
        apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
        bearerToken: session.access_token,
      },
      "story-images-private",
      reservedPath,
      bytes,
      sniffed,
      false,
    );
  } catch {
    await cancelPendingStoryMediaUpload(mediaId).catch(() => {});
    return NextResponse.json(
      { error: "Upload failed. Please try again." },
      { status: 502 },
    );
  }

  try {
    await finalizeStoryMediaUpload(mediaId, expectedVersion);
  } catch (error) {
    await cancelPendingStoryMediaUpload(mediaId).catch(() => {});
    await supabase.storage
      .from("story-images-private")
      .remove([reservedPath])
      .catch(() => {});
    return NextResponse.json(
      { error: getErrorMessage(error, "Could not finalize the upload.") },
      { status: 409 },
    );
  }

  // Processing failures are recorded to the DB by processStoryMedia itself
  // (record_story_media_processing_failed) — this request still succeeds
  // from the client's point of view (the image is attached, just not
  // usable until processed); the client polls processingState via the
  // preview/edit media list rather than this response.
  try {
    await processStoryMedia(mediaId);
  } catch {
    // Already recorded server-side; nothing further to do here.
  }

  return NextResponse.json({ mediaId, storyId });
}
