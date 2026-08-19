import { describe, expect, it, vi, beforeEach } from "vitest";

const mockGetCurrentUser = vi.fn();
vi.mock("@/lib/auth/get-current-user", () => ({
  getCurrentUser: () => mockGetCurrentUser(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// Records every call made through the chainable query-builder mock so tests
// can assert exactly which row was targeted / what was written, without a
// live database. This is what lets us verify ownership scoping (never a
// client-supplied id) as a pure unit test, per docs/architecture.md's
// established pattern of testing decision logic instead of rendering
// Server Components against a real Supabase instance.
const calls: { method: string; args: unknown[] }[] = [];
let updateResult: { error: unknown } = { error: null };
let insertResult: { error: unknown } = { error: null };

function chain() {
  const proxy: Record<string, unknown> = {
    update: (...args: unknown[]) => {
      calls.push({ method: "update", args });
      return proxy;
    },
    insert: (...args: unknown[]) => {
      calls.push({ method: "insert", args });
      return Promise.resolve(insertResult);
    },
    eq: (...args: unknown[]) => {
      calls.push({ method: "eq", args });
      return Promise.resolve(updateResult);
    },
  };
  return proxy;
}

const mockFrom = vi.fn(() => chain());
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: mockFrom }),
}));

import {
  updateProfileAction,
  createOwnContributorAction,
  updateOwnContributorAction,
} from "./actions";

const user = { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };
const attacker = { id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" };

function formData(entries: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    fd.set(key, value);
  }
  return fd;
}

beforeEach(() => {
  calls.length = 0;
  updateResult = { error: null };
  insertResult = { error: null };
  mockFrom.mockClear();
  mockGetCurrentUser.mockReset();
});

describe("updateProfileAction", () => {
  it("scopes the update to the authenticated user's own id, never a client-supplied one", async () => {
    mockGetCurrentUser.mockResolvedValue(user);

    await updateProfileAction(
      {},
      formData({
        displayName: "Casey",
        homeCountryCode: "MY",
        // Even if a tampered client tried to smuggle a different id in, the
        // action never reads an "id" field from the form at all.
        id: attacker.id,
      }),
    );

    const eqCall = calls.find((c) => c.method === "eq");
    expect(eqCall?.args).toEqual(["id", user.id]);
  });

  it("rejects when there is no authenticated user", async () => {
    mockGetCurrentUser.mockResolvedValue(null);

    const result = await updateProfileAction(
      {},
      formData({ displayName: "Casey", homeCountryCode: "MY" }),
    );

    expect(result.error).toBeTruthy();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("rejects invalid input before touching the database", async () => {
    mockGetCurrentUser.mockResolvedValue(user);

    const result = await updateProfileAction(
      {},
      formData({ displayName: "", homeCountryCode: "MY" }),
    );

    expect(result.error).toBeTruthy();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("requires a public slug before enabling the public profile toggle", async () => {
    mockGetCurrentUser.mockResolvedValue(user);

    const result = await updateProfileAction(
      {},
      formData({
        displayName: "Casey",
        homeCountryCode: "MY",
        publicProfileEnabled: "on",
        publicSlug: "",
      }),
    );

    expect(result.error).toMatch(/public profile url/i);
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe("createOwnContributorAction", () => {
  it("always sets linked_user_id and created_by from the session, never the form", async () => {
    mockGetCurrentUser.mockResolvedValue(user);

    await createOwnContributorAction(
      {},
      formData({
        displayName: "Casey C.",
        attributionType: "display_name",
        // A tampered client could try to claim someone else's identity by
        // supplying these — the action ignores both fields entirely.
        linkedUserId: attacker.id,
        createdBy: attacker.id,
      }),
    );

    const insertCall = calls.find((c) => c.method === "insert");
    const payload = insertCall?.args[0] as Record<string, unknown>;
    expect(payload.linked_user_id).toBe(user.id);
    expect(payload.created_by).toBe(user.id);
  });

  it("surfaces a friendly error when a contributor identity already exists", async () => {
    mockGetCurrentUser.mockResolvedValue(user);
    insertResult = { error: { code: "23505" } };

    const result = await createOwnContributorAction(
      {},
      formData({ displayName: "Casey C.", attributionType: "display_name" }),
    );

    expect(result.error).toMatch(/already have a contributor identity/i);
  });

  it("requires a public slug before listing in the directory", async () => {
    mockGetCurrentUser.mockResolvedValue(user);

    const result = await createOwnContributorAction(
      {},
      formData({
        displayName: "Casey C.",
        attributionType: "display_name",
        publicProfileEnabled: "on",
        publicSlug: "",
      }),
    );

    expect(result.error).toMatch(/contributor url/i);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("rejects a public, anonymous attribution", async () => {
    mockGetCurrentUser.mockResolvedValue(user);

    const result = await createOwnContributorAction(
      {},
      formData({
        displayName: "Casey C.",
        attributionType: "anonymous",
        publicProfileEnabled: "on",
        publicSlug: "casey",
      }),
    );

    expect(result.error).toMatch(/anonymous/i);
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe("updateOwnContributorAction", () => {
  it("scopes the update to the caller's own linked contributor record", async () => {
    mockGetCurrentUser.mockResolvedValue(user);

    await updateOwnContributorAction(
      {},
      formData({ displayName: "Casey C.", attributionType: "pseudonym" }),
    );

    const eqCall = calls.find((c) => c.method === "eq");
    expect(eqCall?.args).toEqual(["linked_user_id", user.id]);
  });
});
