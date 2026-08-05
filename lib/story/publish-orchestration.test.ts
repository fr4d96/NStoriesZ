import { describe, expect, it, vi } from "vitest";
import { runApproveOrchestration } from "./publish-orchestration";
import type { ModeratorMediaItem } from "./moderation";

function media(
  overrides: Partial<ModeratorMediaItem> & { mediaId: string },
): ModeratorMediaItem {
  return {
    sortOrder: 0,
    isCover: false,
    altText: null,
    caption: null,
    decorative: false,
    processingState: "processed",
    ...overrides,
  };
}

describe("runApproveOrchestration", () => {
  it("skips already-promoted media and finalizes on full success", async () => {
    const beginAttempt = vi.fn().mockResolvedValue("attempt-1");
    const copyMedia = vi.fn().mockResolvedValue(undefined);
    const finalize = vi.fn().mockResolvedValue(undefined);

    const result = await runApproveOrchestration(
      {
        revisionId: "rev-1",
        media: [
          media({ mediaId: "m-promoted", processingState: "promoted" }),
          media({ mediaId: "m-processed", processingState: "processed" }),
        ],
      },
      { beginAttempt, copyMedia, finalize },
    );

    expect(result).toEqual({ ok: true, approvalAttemptId: "attempt-1" });
    expect(copyMedia).toHaveBeenCalledTimes(1);
    expect(copyMedia).toHaveBeenCalledWith("m-processed", "attempt-1");
    expect(finalize).toHaveBeenCalledWith({
      revisionId: "rev-1",
      approvalAttemptId: "attempt-1",
      userFacingReason: undefined,
      editorNote: undefined,
    });
  });

  it("never calls copyMedia or finalize when begin fails", async () => {
    const beginAttempt = vi
      .fn()
      .mockRejectedValue(new Error("already has an active attempt"));
    const copyMedia = vi.fn();
    const finalize = vi.fn();

    const result = await runApproveOrchestration(
      { revisionId: "rev-1", media: [] },
      { beginAttempt, copyMedia, finalize },
    );

    expect(result).toEqual({
      ok: false,
      stage: "begin",
      error: "already has an active attempt",
    });
    expect(copyMedia).not.toHaveBeenCalled();
    expect(finalize).not.toHaveBeenCalled();
  });

  it("stops at the first media-copy failure, leaves the attempt active, and never calls finalize", async () => {
    const beginAttempt = vi.fn().mockResolvedValue("attempt-2");
    const copyMedia = vi
      .fn()
      .mockResolvedValueOnce(undefined) // m-1 succeeds
      .mockRejectedValueOnce(new Error("byte verification failed")); // m-2 fails
    const finalize = vi.fn();

    const result = await runApproveOrchestration(
      {
        revisionId: "rev-1",
        media: [
          media({ mediaId: "m-1", processingState: "processed" }),
          media({ mediaId: "m-2", processingState: "processed" }),
          media({ mediaId: "m-3", processingState: "processed" }),
        ],
      },
      { beginAttempt, copyMedia, finalize },
    );

    expect(result).toEqual({
      ok: false,
      stage: "copy_media",
      error: "byte verification failed",
      mediaId: "m-2",
      approvalAttemptId: "attempt-2",
    });
    // m-3 is never attempted once m-2 fails.
    expect(copyMedia).toHaveBeenCalledTimes(2);
    expect(finalize).not.toHaveBeenCalled();
  });

  it("reports a finalize failure with the attempt id still surfaced, for a safe retry", async () => {
    const beginAttempt = vi.fn().mockResolvedValue("attempt-3");
    const copyMedia = vi.fn().mockResolvedValue(undefined);
    const finalize = vi
      .fn()
      .mockRejectedValue(new Error("no currently-valid consent grant"));

    const result = await runApproveOrchestration(
      {
        revisionId: "rev-1",
        media: [media({ mediaId: "m-1", processingState: "processed" })],
      },
      { beginAttempt, copyMedia, finalize },
    );

    expect(result).toEqual({
      ok: false,
      stage: "finalize",
      error: "no currently-valid consent grant",
      approvalAttemptId: "attempt-3",
    });
  });

  it("retries a promotion_pending item (does not treat it as already done)", async () => {
    const beginAttempt = vi.fn().mockResolvedValue("attempt-4");
    const copyMedia = vi.fn().mockResolvedValue(undefined);
    const finalize = vi.fn().mockResolvedValue(undefined);

    const result = await runApproveOrchestration(
      {
        revisionId: "rev-1",
        media: [
          media({ mediaId: "m-1", processingState: "promotion_pending" }),
        ],
      },
      { beginAttempt, copyMedia, finalize },
    );

    expect(copyMedia).toHaveBeenCalledWith("m-1", "attempt-4");
    expect(result.ok).toBe(true);
  });
});
