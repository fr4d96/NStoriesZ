import type { ModeratorMediaItem } from "@/lib/story/moderation";

/**
 * Pure(-ish) orchestration for the approve flow: begin a publication
 * attempt -> copy every not-already-promoted media item -> finalize.
 * Factored out of the Server Action (app/(moderation)/moderation/stories/[id]/actions.ts)
 * so the partial-failure behavior is unit-testable without a real Supabase
 * client or real storage -- every side-effecting operation is injected via
 * `deps`, matching this module's only job: decide WHAT to call and WHEN to
 * stop, not perform the calls itself.
 *
 * Partial-failure contract (this is the one place that decides it):
 *   - begin fails -> no attempt exists, nothing to clean up, return early.
 *   - ANY media copy fails -> STOP immediately, do NOT call finalize. The
 *     attempt is left in its `active` state (finalize_story_publication()'s
 *     own re-entrant design: a later retry of this whole orchestration, or
 *     an explicit reject/changes_requested via moderate_revision(), can
 *     still resolve it cleanly -- moderate_revision() abandons an active
 *     attempt and reverts any promotion_pending media back to processed).
 *     The failure is returned with the attempt id and the specific media
 *     id that failed, never silently swallowed.
 *   - finalize fails -> also returned with the attempt id (still active,
 *     media already copied/verified) so a retry can call finalize again
 *     without re-copying anything (every already-`promoted`/verified media
 *     item is skipped on a retry, since the `toCopy` filter only re-runs
 *     against the CURRENT processingState).
 *   - Cache invalidation is the caller's job, only after `{ ok: true }`.
 */
export type ApproveOrchestrationDeps = {
  beginAttempt: (revisionId: string) => Promise<string>;
  copyMedia: (mediaId: string, approvalAttemptId: string) => Promise<void>;
  finalize: (params: {
    revisionId: string;
    approvalAttemptId: string;
    userFacingReason?: string;
    editorNote?: string;
  }) => Promise<void>;
};

export type ApproveOrchestrationResult =
  | { ok: true; approvalAttemptId: string }
  | {
      ok: false;
      stage: "begin" | "copy_media" | "finalize";
      error: string;
      mediaId?: string;
      approvalAttemptId?: string;
    };

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Unknown error";
}

export async function runApproveOrchestration(
  params: {
    revisionId: string;
    media: ModeratorMediaItem[];
    userFacingReason?: string;
    editorNote?: string;
  },
  deps: ApproveOrchestrationDeps,
): Promise<ApproveOrchestrationResult> {
  let approvalAttemptId: string;
  try {
    approvalAttemptId = await deps.beginAttempt(params.revisionId);
  } catch (err) {
    return { ok: false, stage: "begin", error: errorMessage(err) };
  }

  const toCopy = params.media.filter(
    (item) => item.processingState !== "promoted",
  );

  for (const item of toCopy) {
    try {
      await deps.copyMedia(item.mediaId, approvalAttemptId);
    } catch (err) {
      // Do NOT call finalize -- leave the attempt active/recoverable.
      return {
        ok: false,
        stage: "copy_media",
        error: errorMessage(err),
        mediaId: item.mediaId,
        approvalAttemptId,
      };
    }
  }

  try {
    await deps.finalize({
      revisionId: params.revisionId,
      approvalAttemptId,
      userFacingReason: params.userFacingReason,
      editorNote: params.editorNote,
    });
  } catch (err) {
    return {
      ok: false,
      stage: "finalize",
      error: errorMessage(err),
      approvalAttemptId,
    };
  }

  return { ok: true, approvalAttemptId };
}
