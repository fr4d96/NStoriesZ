import { describe, expect, it, vi, beforeEach } from "vitest";

// Follows app/(contributor)/actions.test.ts's established pattern: mock the
// side-effecting server dependencies at the module boundary and test the
// action's DECISION logic as a pure unit, rather than rendering a Server
// Action against a live Supabase instance.

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockGetCurrentUserRole = vi.fn();
// resolveStaffAccess is pulled from lib/auth/staff-guard (which lib/auth/roles
// only re-exports) so the REAL role-gate logic runs here -- only the Supabase
// role lookup is stubbed.
vi.mock("@/lib/auth/roles", async () => {
  const { resolveStaffAccess } = await vi.importActual<
    typeof import("@/lib/auth/staff-guard")
  >("@/lib/auth/staff-guard");
  return {
    resolveStaffAccess,
    getCurrentUserRole: () => mockGetCurrentUserRole(),
  };
});

const mockGetCurrentUser = vi.fn();
vi.mock("@/lib/auth/get-current-user", () => ({
  getCurrentUser: () => mockGetCurrentUser(),
}));

const mockGetStoryForModerator = vi.fn();
const mockArchiveStory = vi.fn();
vi.mock("@/lib/story/moderation", () => ({
  moderateRevision: vi.fn(),
  beginStoryPublicationAttempt: vi.fn(),
  finalizeStoryPublication: vi.fn(),
  archiveStory: (...args: unknown[]) => mockArchiveStory(...args),
  getStoryForModerator: (...args: unknown[]) =>
    mockGetStoryForModerator(...args),
  parseModeratorMedia: vi.fn(() => []),
}));

vi.mock("@/lib/story/image-pipeline", () => ({
  copyStoryMediaToPublic: vi.fn(),
}));
vi.mock("@/lib/story/publish-orchestration", () => ({
  runApproveOrchestration: vi.fn(),
}));

const mockInvalidateStoryPublicCache = vi.fn();
const mockInvalidateStoryListingsPublicCache = vi.fn();
vi.mock("@/lib/story/public-cache", () => ({
  invalidateStoryPublicCache: (...args: unknown[]) =>
    mockInvalidateStoryPublicCache(...args),
  invalidateStoryListingsPublicCache: (...args: unknown[]) =>
    mockInvalidateStoryListingsPublicCache(...args),
}));

const mockLogStaffAction = vi.fn();
vi.mock("@/lib/log", () => ({
  logStaffAction: (...args: unknown[]) => mockLogStaffAction(...args),
}));

import { archiveStoryAction } from "./actions";

const STORY_ID = "11111111-1111-4111-8111-111111111111";
const REVISION_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_STORY_ID = "33333333-3333-4333-8333-333333333333";
const MODERATOR_ID = "44444444-4444-4444-8444-444444444444";

function archiveFormData() {
  const fd = new FormData();
  fd.set("storyId", STORY_ID);
  fd.set("revisionId", REVISION_ID);
  fd.set("expectedVersion", "3");
  fd.set("reason", "Contributor asked for it to come down.");
  fd.set("note", "");
  return fd;
}

function loggedActions() {
  return mockLogStaffAction.mock.calls.map(
    (call) => (call[0] as { action: string }).action,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCurrentUserRole.mockResolvedValue("moderator");
  mockGetCurrentUser.mockResolvedValue({ id: MODERATOR_ID });
  mockArchiveStory.mockResolvedValue(undefined);
});

describe("archiveStoryAction cache invalidation", () => {
  it("purges the slug-specific detail page when the slug resolves", async () => {
    mockGetStoryForModerator.mockResolvedValue([
      { story_id: STORY_ID, slug: "a-year-in-otago" },
    ]);

    const result = await archiveStoryAction({}, archiveFormData());

    expect(result.success).toBe("Story archived.");
    expect(mockInvalidateStoryPublicCache).toHaveBeenCalledWith(
      "a-year-in-otago",
    );
    expect(mockInvalidateStoryListingsPublicCache).not.toHaveBeenCalled();
    expect(loggedActions()).not.toContain("moderation.archive.slug_lookup");
  });

  // The regression this whole branch exists for: archiving a long-published
  // story with no in-flight revision used to silently skip cache
  // invalidation entirely, leaving an archived story publicly listed for up
  // to 60s (and an hour in the sitemap) -- Engineering Rule 12.
  it("still purges the public listings when there is no in-flight revision", async () => {
    mockGetStoryForModerator.mockResolvedValue([]);

    const result = await archiveStoryAction({}, archiveFormData());

    expect(result.success).toBe("Story archived.");
    expect(mockInvalidateStoryPublicCache).not.toHaveBeenCalled();
    expect(mockInvalidateStoryListingsPublicCache).toHaveBeenCalledTimes(1);
  });

  it("still purges the public listings when the revision lookup throws", async () => {
    mockGetStoryForModerator.mockRejectedValue(new Error("permission denied"));

    const result = await archiveStoryAction({}, archiveFormData());

    expect(result.success).toBe("Story archived.");
    expect(mockInvalidateStoryListingsPublicCache).toHaveBeenCalledTimes(1);
  });

  it("still purges the public listings when the revision belongs to another story", async () => {
    mockGetStoryForModerator.mockResolvedValue([
      { story_id: OTHER_STORY_ID, slug: "someone-elses-story" },
    ]);

    await archiveStoryAction({}, archiveFormData());

    expect(mockInvalidateStoryPublicCache).not.toHaveBeenCalled();
    expect(mockInvalidateStoryListingsPublicCache).toHaveBeenCalledTimes(1);
  });

  it("logs the skipped slug lookup instead of swallowing it silently", async () => {
    mockGetStoryForModerator.mockRejectedValue(new Error("permission denied"));

    await archiveStoryAction({}, archiveFormData());

    expect(mockLogStaffAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: MODERATOR_ID,
        action: "moderation.archive.slug_lookup",
        target: STORY_ID,
        outcome: "error",
      }),
    );
  });

  it("does not report a failure when cache invalidation itself throws", async () => {
    mockGetStoryForModerator.mockResolvedValue([]);
    mockInvalidateStoryListingsPublicCache.mockImplementation(() => {
      throw new Error("revalidatePath called outside a request scope");
    });

    const result = await archiveStoryAction({}, archiveFormData());

    // The archive already committed in the database -- a cache hiccup must
    // never surface to the moderator as a failed archive.
    expect(result.success).toBe("Story archived.");
    expect(result.error).toBeUndefined();
    expect(loggedActions()).toContain("moderation.archive.cache_invalidation");
  });

  it("does not invalidate anything when the archive itself fails", async () => {
    mockGetStoryForModerator.mockResolvedValue([]);
    mockArchiveStory.mockRejectedValue(new Error("stale version"));

    const result = await archiveStoryAction({}, archiveFormData());

    expect(result.error).toBeTruthy();
    expect(mockInvalidateStoryPublicCache).not.toHaveBeenCalled();
    expect(mockInvalidateStoryListingsPublicCache).not.toHaveBeenCalled();
  });

  it("refuses a non-moderator before touching anything", async () => {
    mockGetCurrentUserRole.mockResolvedValue("contributor");

    const result = await archiveStoryAction({}, archiveFormData());

    expect(result.error).toBeTruthy();
    expect(mockArchiveStory).not.toHaveBeenCalled();
    expect(mockInvalidateStoryListingsPublicCache).not.toHaveBeenCalled();
  });
});
