// @vitest-environment node
//
// server-only throws outside Next's own bundler, same as
// lib/story/image-pipeline.test.ts -- mocked to a no-op for the same reason.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// lib/supabase/public.ts validates NEXT_PUBLIC_* env at import time and
// throws without it. coverOf() is a pure function that never touches a
// client, so stub the module rather than hand the test a fake environment.
vi.mock("@/lib/supabase/public", () => ({
  createPublicClient: () => {
    throw new Error("not used by these tests");
  },
}));

const { coverOf } = await import("@/lib/story/public-queries");

/** Media rows in the order get_published_story_media() returns them: sort_order. */
function media(...flags: boolean[]) {
  return flags.map((is_cover, i) => ({ id: `m${i}`, is_cover }));
}

describe("coverOf", () => {
  it("returns the explicitly chosen photo", () => {
    expect(coverOf(media(false, true, false))?.id).toBe("m1");
  });

  it("falls back to the first photo when nobody chose one", () => {
    // The case that was 39 of 42 revisions before
    // 20260908064045_cover_falls_back_to_first_photo.sql: photos attached,
    // is_cover false on every one of them, and therefore no cover at all --
    // no card image and no og:image on a shared link.
    expect(coverOf(media(false, false, false))?.id).toBe("m0");
  });

  it("prefers the explicit choice even when it is not the first photo", () => {
    // The regression that matters: a contributor who DID pick a cover must
    // not have it silently replaced by whichever photo sorts first.
    expect(coverOf(media(false, false, true))?.id).toBe("m2");
  });

  it("returns null only when there are no photos at all", () => {
    expect(coverOf([])).toBeNull();
  });

  it("is safe on a single photo either way", () => {
    expect(coverOf(media(false))?.id).toBe("m0");
    expect(coverOf(media(true))?.id).toBe("m0");
  });
});
