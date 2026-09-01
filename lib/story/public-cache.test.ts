import { describe, expect, it, vi, beforeEach } from "vitest";

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => revalidatePath(p),
}));
vi.mock("server-only", () => ({}));

import {
  invalidateStoryPublicCache,
  invalidateStoryListingsPublicCache,
  invalidateContributorPublicCache,
} from "./public-cache";

function paths() {
  return revalidatePath.mock.calls.map((call) => call[0] as string);
}

beforeEach(() => {
  revalidatePath.mockClear();
});

describe("invalidateStoryListingsPublicCache", () => {
  // Every public surface that can keep advertising a story whose visibility
  // just changed, minus the one path that needs a slug. Callable when the
  // slug cannot be re-derived server-side, which is the whole point of it
  // existing separately (Engineering Rule 12 -- archived content must not
  // linger in listings or the sitemap).
  it("purges the listing surfaces and the sitemap", () => {
    invalidateStoryListingsPublicCache();
    expect(paths()).toEqual(["/stories", "/", "/sitemap.xml"]);
  });

  it("never touches a slug-specific path", () => {
    invalidateStoryListingsPublicCache();
    expect(paths().some((p) => p.startsWith("/stories/"))).toBe(false);
  });
});

describe("invalidateStoryPublicCache", () => {
  it("purges the detail page as well as everything the listings variant does", () => {
    invalidateStoryPublicCache("a-year-in-otago");
    expect(paths()).toEqual([
      "/stories/a-year-in-otago",
      "/stories",
      "/",
      "/sitemap.xml",
    ]);
  });

  it("is a strict superset of the listings variant", () => {
    invalidateStoryPublicCache("a-year-in-otago");
    const full = paths();
    revalidatePath.mockClear();
    invalidateStoryListingsPublicCache();
    for (const path of paths()) {
      expect(full).toContain(path);
    }
  });
});

describe("invalidateContributorPublicCache", () => {
  it("purges the contributor detail page, the index and the sitemap", () => {
    invalidateContributorPublicCache("mei-ling");
    expect(paths()).toEqual([
      "/contributors/mei-ling",
      "/contributors",
      "/sitemap.xml",
    ]);
  });
});
