"use server";

import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { createClient } from "@/lib/supabase/server";
import { mintMediaPreviewSignedUrl } from "@/lib/story/image-pipeline";
import {
  getStoryPreview,
  type RevisionMediaItem,
} from "@/lib/story/contributor-queries";
import { getErrorMessage } from "@/lib/errors";

/**
 * Re-reads the current attached-media list (via get_story_preview — the
 * same private, path-free RPC the preview page uses) so the image manager
 * can pick up the real server-recorded processingState after an upload
 * request has finished processing synchronously (there is no background
 * worker in this phase — see the upload Route Handler).
 */
export async function refreshMediaAction(
  storyId: string,
): Promise<{ media: RevisionMediaItem[] } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "You must be signed in." };
  const parsed = z.uuid().safeParse(storyId);
  if (!parsed.success) return { error: "Invalid story." };

  try {
    const preview = await getStoryPreview(parsed.data);
    return { media: preview?.media ?? [] };
  } catch (error) {
    return {
      error: getErrorMessage(error, "Could not refresh media."),
    };
  }
}

/**
 * Shared by both the edit page's image manager (thumbnails for already-
 * processed uploads) and the preview page. Two-step, both required:
 *  1. authorize_story_media_preview() via the CALLER'S OWN regular
 *     (RLS-respecting) client — this is the actual authorization check
 *     (owner/linked contributor/assigned editor/admin, or a moderator
 *     scoped to a revision they're genuinely reviewing).
 *  2. Only after that succeeds, mintMediaPreviewSignedUrl() from
 *     lib/story/image-pipeline.ts (the one module allowed to hold the
 *     admin client) looks up the private path and mints a short-lived
 *     signed URL. The private storage path itself is never sent to the
 *     browser — only the final bearer URL.
 */
export async function mintPreviewUrlAction(
  mediaId: string,
): Promise<{ url: string } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "You must be signed in." };

  const parsed = z.uuid().safeParse(mediaId);
  if (!parsed.success) return { error: "Invalid media." };

  const supabase = await createClient();
  const { error: authError } = await supabase.rpc(
    "authorize_story_media_preview",
    { p_media_id: parsed.data },
  );
  if (authError) {
    return { error: "Not authorized to preview this image." };
  }

  try {
    const url = await mintMediaPreviewSignedUrl(parsed.data);
    return { url };
  } catch (error) {
    return {
      error: getErrorMessage(error, "Could not load image."),
    };
  }
}
