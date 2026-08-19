"use server";

import { getCurrentUser } from "@/lib/auth/get-current-user";
import { deleteDraftStory } from "@/lib/story/mutations";
import { getErrorMessage } from "@/lib/errors";

export type DeleteDraftStoryResult =
  { ok: true } | { ok: false; error: string };

/**
 * Backs the "Delete" action on a still-draft story in My Stories
 * (my-stories-view.tsx). delete_draft_story() (the RPC this calls through
 * lib/story/mutations.ts) is the real safety boundary — only a story that
 * has never left plain-draft status can actually be deleted; a story with
 * prior review history fails with a specific, user-facing Postgres message
 * rather than silently doing nothing.
 */
export async function deleteDraftStoryAction(
  storyId: string,
  expectedVersion: number,
): Promise<DeleteDraftStoryResult> {
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "You must be signed in." };
  }

  try {
    await deleteDraftStory(storyId, expectedVersion);
  } catch (error) {
    return {
      ok: false,
      error: getErrorMessage(error, "Could not delete this story."),
    };
  }

  return { ok: true };
}
