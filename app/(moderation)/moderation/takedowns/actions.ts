"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUserRole } from "@/lib/auth/roles";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { decideStoryTakedown } from "@/lib/story/moderation";
import {
  invalidateStoryPublicCache,
  invalidateStoryListingsPublicCache,
} from "@/lib/story/public-cache";
import { decideTakedownSchema } from "@/lib/validation/story";
import { logAppEvent } from "@/lib/log";
import { getErrorMessage } from "@/lib/errors";

export type DecideTakedownResult = { ok: true } | { ok: false; error: string };

/**
 * Approve or decline a contributor's takedown request.
 *
 * The role is re-derived here from the session, never taken from the client
 * — and `decide_story_takedown()` re-checks it independently, which is the
 * boundary that actually holds (Engineering Rules 2/3). This layer exists to
 * fail fast with a readable message, not to be the gate.
 *
 * Cache invalidation runs only on APPROVAL, and only after the RPC has
 * committed: a decline changes nothing a reader can see, so invalidating
 * there would be busywork that quietly implies otherwise. `slug` is passed
 * in from the queue row rather than re-queried — the story is archived by
 * the time this returns, so re-reading it to find its slug would be racing
 * the very change just made.
 */
export async function decideTakedownAction(
  requestId: string,
  approve: boolean,
  slug: string | null,
  note?: string,
): Promise<DecideTakedownResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in." };

  const role = await getCurrentUserRole();
  if (role !== "moderator" && role !== "admin") {
    return { ok: false, error: "Only a moderator can decide this." };
  }

  const parsed = decideTakedownSchema.safeParse({ requestId, approve, note });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid request.",
    };
  }

  try {
    await decideStoryTakedown({
      requestId: parsed.data.requestId,
      approve: parsed.data.approve,
      note: parsed.data.note || undefined,
    });
  } catch (error) {
    const raw = getErrorMessage(error, "");
    if (/already been decided/i.test(raw)) {
      return { ok: false, error: "Someone already decided this request." };
    }
    if (/already been revoked/i.test(raw)) {
      return { ok: false, error: "That story is already off the site." };
    }
    return { ok: false, error: "Could not save that decision. Try again." };
  }

  if (parsed.data.approve) {
    if (slug) invalidateStoryPublicCache(slug);
    invalidateStoryListingsPublicCache();
  }
  revalidatePath("/moderation/takedowns");
  logAppEvent({
    event: parsed.data.approve
      ? "story.takedown.approved"
      : "story.takedown.declined",
    target: parsed.data.requestId,
    outcome: "success",
  });
  return { ok: true };
}
