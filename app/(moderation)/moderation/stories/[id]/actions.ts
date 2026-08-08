"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUserRole, resolveStaffAccess } from "@/lib/auth/roles";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import {
  moderateDecisionSchema,
  approveStorySchema,
  archiveStorySchema,
} from "@/lib/validation/moderation";
import {
  moderateRevision,
  beginStoryPublicationAttempt,
  finalizeStoryPublication,
  archiveStory,
  getStoryForModerator,
  parseModeratorMedia,
} from "@/lib/story/moderation";
import { copyStoryMediaToPublic } from "@/lib/story/image-pipeline";
import { runApproveOrchestration } from "@/lib/story/publish-orchestration";
import { invalidateStoryPublicCache } from "@/lib/story/public-cache";
import { logStaffAction } from "@/lib/log";
import { getErrorMessage } from "@/lib/errors";

/**
 * Stage 3 hardening: invalidateStoryPublicCache() calls Next's
 * revalidatePath() several times in a row. A successful approve/archive has
 * ALREADY committed in the database by the time this runs -- if
 * revalidatePath() itself ever throws (e.g. called somewhere Next
 * disallows it, a bad path shape, or any other framework-level hiccup),
 * letting that propagate out of the Server Action would surface as an
 * unhandled error to the moderator even though the underlying
 * approve/archive fully succeeded. Swallowed here (logged, never silently
 * dropped) so a cache-invalidation hiccup can never make a successful
 * publish/archive look like a failure; the public pages still
 * self-correct within their own `revalidate = 60` window either way (see
 * lib/story/public-cache.ts's own header comment).
 */
function invalidatePublicCacheSafely(slug: string, action: string) {
  try {
    invalidateStoryPublicCache(slug);
  } catch (error) {
    logStaffAction({
      actor: null,
      action: `${action}.cache_invalidation`,
      target: slug,
      outcome: "error",
      detail: getErrorMessage(error, "unknown error"),
    });
  }
}

export type ModerationActionState = { error?: string; success?: string };

/**
 * Every action in this file independently re-checks moderator/admin here --
 * Server Actions are reachable regardless of which page rendered them, so
 * the (moderation) route group's layout guard alone is never sufficient
 * (same hard constraint app/(editor)/editorial/[id]/editorial-actions.ts
 * already documents). The underlying RPCs re-check server-side too; this is
 * defense in depth, not a substitute.
 */
async function requireModeratorOrAdmin(): Promise<string | null> {
  const role = await getCurrentUserRole();
  const access = resolveStaffAccess(role, ["moderator", "admin"]);
  return access.ok
    ? null
    : "Only a moderator or admin can perform this action.";
}

/**
 * Approve = beginStoryPublicationAttempt() -> copy every not-already-
 * promoted media item -> finalizeStoryPublication(). The looping/partial-
 * failure decision itself lives in lib/story/publish-orchestration.ts
 * (unit-tested there); this action's job is only to gather real,
 * server-derived inputs (never trusting the client for which media needs
 * copying or the story's slug) and wire in the real side-effecting
 * dependencies. invalidateStoryPublicCache() is called ONLY after the
 * orchestration reports success.
 */
export async function approveStoryAction(
  _prevState: ModerationActionState,
  formData: FormData,
): Promise<ModerationActionState> {
  const authError = await requireModeratorOrAdmin();
  if (authError) return { error: authError };

  const parsed = approveStorySchema.safeParse({
    revisionId: formData.get("revisionId"),
    storyId: formData.get("storyId"),
    userFacingReason: formData.get("userFacingReason") ?? "",
    editorNote: formData.get("editorNote") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  let detail;
  try {
    const rows = await getStoryForModerator(parsed.data.revisionId);
    detail = rows[0];
  } catch (error) {
    return {
      error: getErrorMessage(error, "Could not load this revision."),
    };
  }
  if (!detail || detail.story_id !== parsed.data.storyId) {
    return { error: "This revision no longer matches the requested story." };
  }

  const media = parseModeratorMedia(detail.media);

  const result = await runApproveOrchestration(
    {
      revisionId: parsed.data.revisionId,
      media,
      userFacingReason: parsed.data.userFacingReason || undefined,
      editorNote: parsed.data.editorNote || undefined,
    },
    {
      beginAttempt: beginStoryPublicationAttempt,
      copyMedia: copyStoryMediaToPublic,
      finalize: finalizeStoryPublication,
    },
  );

  const actorId = (await getCurrentUser())?.id ?? null;

  if (!result.ok) {
    const stageLabel =
      result.stage === "begin"
        ? "starting the publication attempt"
        : result.stage === "copy_media"
          ? `copying media ${result.mediaId ?? "(unknown)"} to public storage`
          : "finalizing publication";
    const recoveryNote = result.approvalAttemptId
      ? " The publication attempt was left active/recoverable — retry approval, or resolve it via reject/changes-requested."
      : "";
    logStaffAction({
      actor: actorId,
      action: "moderation.approve",
      target: parsed.data.revisionId,
      outcome: "error",
      detail: result.stage,
    });
    return {
      error: `Approval failed while ${stageLabel}: ${result.error}.${recoveryNote}`,
    };
  }

  invalidatePublicCacheSafely(detail.slug, "moderation.approve");
  logStaffAction({
    actor: actorId,
    action: "moderation.approve",
    target: parsed.data.revisionId,
    outcome: "success",
  });
  revalidatePath(`/moderation/stories/${parsed.data.revisionId}`);
  revalidatePath("/moderation/stories");
  return { success: "Story approved and published." };
}

export async function moderateDecisionAction(
  _prevState: ModerationActionState,
  formData: FormData,
): Promise<ModerationActionState> {
  const authError = await requireModeratorOrAdmin();
  if (authError) return { error: authError };

  const parsed = moderateDecisionSchema.safeParse({
    revisionId: formData.get("revisionId"),
    expectedVersion: Number(formData.get("expectedVersion")),
    decision: formData.get("decision"),
    userFacingReason: formData.get("userFacingReason"),
    editorNote: formData.get("editorNote") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const actorId = (await getCurrentUser())?.id ?? null;

  try {
    await moderateRevision({
      revisionId: parsed.data.revisionId,
      expectedVersion: parsed.data.expectedVersion,
      decision: parsed.data.decision,
      userFacingReason: parsed.data.userFacingReason,
      editorNote: parsed.data.editorNote || undefined,
    });
  } catch (error) {
    logStaffAction({
      actor: actorId,
      action: `moderation.${parsed.data.decision}`,
      target: parsed.data.revisionId,
      outcome: "error",
    });
    return {
      error: getErrorMessage(error, "Could not record this decision."),
    };
  }

  logStaffAction({
    actor: actorId,
    action: `moderation.${parsed.data.decision}`,
    target: parsed.data.revisionId,
    outcome: "success",
  });
  revalidatePath(`/moderation/stories/${parsed.data.revisionId}`);
  revalidatePath("/moderation/stories");
  return {
    success:
      parsed.data.decision === "reject"
        ? "Revision rejected."
        : "Changes requested.",
  };
}

/**
 * Archive/unpublish. Re-derives the story's slug server-side via
 * getStoryForModerator(revisionId) rather than trusting a client-supplied
 * slug (Engineering Rule 2) -- get_story_for_moderator() is the only
 * moderator-accessible source of a story's slug as of Stage 2 (see
 * supabase/migrations/20260805110000_moderator_story_detail_slug_version.sql,
 * NOT yet pushed).
 */
export async function archiveStoryAction(
  _prevState: ModerationActionState,
  formData: FormData,
): Promise<ModerationActionState> {
  const authError = await requireModeratorOrAdmin();
  if (authError) return { error: authError };

  const parsed = archiveStorySchema.safeParse({
    storyId: formData.get("storyId"),
    revisionId: formData.get("revisionId"),
    expectedVersion: Number(formData.get("expectedVersion")),
    reason: formData.get("reason"),
    note: formData.get("note") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  let slug: string | null = null;
  try {
    const rows = await getStoryForModerator(parsed.data.revisionId);
    const detail = rows[0];
    if (detail && detail.story_id === parsed.data.storyId) {
      slug = detail.slug;
    }
  } catch {
    // Fall through -- archiving can still proceed even if this particular
    // revision lookup fails (e.g. archiving a long-published story with no
    // in-flight revision at all); cache invalidation is best-effort below.
  }

  const actorId = (await getCurrentUser())?.id ?? null;

  try {
    await archiveStory({
      storyId: parsed.data.storyId,
      expectedVersion: parsed.data.expectedVersion,
      reason: parsed.data.reason,
      note: parsed.data.note || undefined,
    });
  } catch (error) {
    logStaffAction({
      actor: actorId,
      action: "moderation.archive",
      target: parsed.data.storyId,
      outcome: "error",
    });
    return {
      error: getErrorMessage(error, "Could not archive this story."),
    };
  }

  if (slug) invalidatePublicCacheSafely(slug, "moderation.archive");
  logStaffAction({
    actor: actorId,
    action: "moderation.archive",
    target: parsed.data.storyId,
    outcome: "success",
  });
  revalidatePath(`/moderation/stories/${parsed.data.revisionId}`);
  revalidatePath("/moderation/stories");
  return { success: "Story archived." };
}
