/**
 * Builds a public URL for an image already promoted to the world-readable
 * `story-images-public` bucket (Engineering Rules 13-14 — only processed,
 * approved derivatives ever land there). No signed URL needed, unlike the
 * private-bucket preview flow (lib/story/image-pipeline.ts#mintMediaPreviewSignedUrl).
 *
 * References NEXT_PUBLIC_SUPABASE_URL directly (not lib/env.server.ts,
 * which is server-only) so this helper is safely importable from both
 * Server and Client Components.
 */
const BUCKET = "story-images-public";

// Matches the content-addressed shape image-pipeline.ts actually writes
// ({story_id}/{media_id}/processed-{sha256}.<ext>) without hard-coding it:
// relative, no traversal, no scheme, no leading slash.
const SAFE_RELATIVE_PATH = /^[a-zA-Z0-9][a-zA-Z0-9/_.-]*$/;

export function getPublicImageUrl(
  path: string | null | undefined,
): string | null {
  if (!path) return null;
  if (path.includes("..") || path.startsWith("/") || path.includes("://")) {
    return null;
  }
  if (!SAFE_RELATIVE_PATH.test(path)) return null;

  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!baseUrl) return null;

  return `${baseUrl}/storage/v1/object/public/${BUCKET}/${path}`;
}
