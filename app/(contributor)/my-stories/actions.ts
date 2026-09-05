"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import {
  deleteDraftStory,
  requestStoryTakedown,
  cancelStoryTakedownRequest,
} from "@/lib/story/mutations";
import { listMyStories } from "@/lib/story/contributor-queries";
import {
  requestTakedownSchema,
  cancelTakedownSchema,
} from "@/lib/validation/story";
import { logAppEvent } from "@/lib/log";
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

export type WithdrawStoryResult = { ok: true } | { ok: false; error: string };

/**
 * revoke_publication_consent() raises plain, developer-facing exceptions
 * with no dedicated SQLSTATE (unlike submit_revision_with_consent()'s
 * WHV01/WHV03 — see lib/story/rpc-errors.ts), and several of them embed the
 * raw story UUID. Matched on message text here, deliberately narrowly, and
 * translated into something a contributor can act on; anything unrecognised
 * falls through to the generic message rather than leaking a Postgres string
 * into the UI. If those messages ever gain real SQLSTATEs, switch to those —
 * this is the weaker of the two mechanisms and is only used because the
 * stronger one does not exist for this function.
 */
function withdrawalErrorMessage(error: unknown): string {
  const raw = getErrorMessage(error, "");
  if (/already been revoked/i.test(raw)) {
    return "This story has already been taken down.";
  }
  if (/stale version/i.test(raw)) {
    return "This story changed while this page was open. Refresh and try again.";
  }
  if (/only the story owner/i.test(raw)) {
    return "You can only take down your own story.";
  }
  if (/already awaiting review/i.test(raw)) {
    return "You've already asked for this story to come down — it's waiting on the team.";
  }
  if (/already been decided/i.test(raw)) {
    return "That request has already been reviewed.";
  }
  if (/only a published story/i.test(raw)) {
    return "Only a published story can be taken down.";
  }
  if (/no such story/i.test(raw)) {
    return "That story no longer exists.";
  }
  return "Could not take this story down. Please try again.";
}

/**
 * Backs "Take down" on a PUBLISHED story in My Stories — which, as of
 * migration 20260903100000, ASKS rather than acts. The story stays publicly
 * visible until a moderator decides.
 *
 * That window is a deliberate product decision and a real cost: a story its
 * own author has asked to remove stays up meanwhile. The contributor-facing
 * copy says so rather than implying the story is already gone, and the
 * moderation queue orders oldest-first for the same reason.
 *
 * The old direct path is gone at the database level too, not merely hidden:
 * revoke_publication_consent() is admin-only now, so a hand-crafted
 * PostgREST call cannot skip the approval step (Engineering Rules 2/3).
 *
 * Ownership and publication state are re-derived here from list_my_stories()
 * — an owner-scoped RPC that only ever returns the caller's own stories —
 * never read from the client. `expectedVersion` is the one value that
 * legitimately comes from the client: it is an optimistic-concurrency token,
 * and re-deriving it server-side would defeat the check rather than harden
 * it.
 */
export async function requestStoryTakedownAction(
  storyId: string,
  expectedVersion: number,
  note?: string,
): Promise<WithdrawStoryResult> {
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "You must be signed in." };
  }

  const parsed = requestTakedownSchema.safeParse({
    storyId,
    expectedVersion,
    note,
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid request.",
    };
  }

  let story;
  try {
    const stories = await listMyStories();
    story = stories.find((row) => row.id === parsed.data.storyId);
  } catch (error) {
    return {
      ok: false,
      error: getErrorMessage(error, "Could not load this story."),
    };
  }

  // Not found means "not yours" as far as this RPC is concerned — the same
  // answer either way, so there is nothing here to probe for.
  if (!story) {
    return { ok: false, error: "You can only take down your own story." };
  }
  if (story.lifecycle_status !== "published") {
    return { ok: false, error: "Only a published story can be taken down." };
  }

  try {
    await requestStoryTakedown(
      parsed.data.storyId,
      parsed.data.expectedVersion,
      parsed.data.note || null,
    );
  } catch (error) {
    return { ok: false, error: withdrawalErrorMessage(error) };
  }

  // Deliberately NO public-cache invalidation here: nothing about the public
  // page changed. The story is still published, and pretending otherwise
  // would be the one thing this flow must not do.
  revalidatePath("/my-stories");
  logAppEvent({
    event: "story.takedown.requested",
    target: parsed.data.storyId,
    outcome: "success",
  });
  return { ok: true };
}

/** The contributor changes their mind before anyone has acted. */
export async function cancelStoryTakedownAction(
  requestId: string,
): Promise<WithdrawStoryResult> {
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "You must be signed in." };
  }

  const parsed = cancelTakedownSchema.safeParse({ requestId });
  if (!parsed.success) {
    return { ok: false, error: "Invalid request." };
  }

  try {
    // Ownership is checked inside the RPC against the request's own story —
    // there is no owner-scoped list to re-derive a request id from, so the
    // database is the only boundary here, which is exactly what it is for.
    await cancelStoryTakedownRequest(parsed.data.requestId);
  } catch (error) {
    return { ok: false, error: withdrawalErrorMessage(error) };
  }

  revalidatePath("/my-stories");
  logAppEvent({
    event: "story.takedown.cancelled",
    target: parsed.data.requestId,
    outcome: "success",
  });
  return { ok: true };
}
