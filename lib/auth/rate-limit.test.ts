import { describe, it, expect, vi, beforeEach } from "vitest";

// server-only's package code throws unconditionally outside Next's own
// bundler, so it has to be stubbed to import the module here at all -- same
// approach lib/log.test.ts already uses and documents.
vi.mock("server-only", () => ({}));

const mockRpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: (...a: unknown[]) => mockRpc(...a) }),
}));

const mockHeaders = vi.fn();
vi.mock("next/headers", () => ({
  headers: async () => mockHeaders(),
}));

const {
  checkSignInRateLimit,
  recordSignInFailure,
  rateLimitedMessage,
  checkPasswordResetRateLimit,
  recordPasswordResetRequest,
  PASSWORD_RESET_IP_LIMIT,
  PASSWORD_RESET_EMAIL_LIMIT,
  PASSWORD_RESET_WINDOW_SECONDS,
  SIGN_IN_IP_LIMIT,
  SIGN_IN_IDENTIFIER_LIMIT,
  SIGN_IN_WINDOW_SECONDS,
} = await import("./rate-limit");

function headerMap(entries: Record<string, string>) {
  return { get: (name: string) => entries[name] ?? null };
}

/** supabase.rpc() resolves to { data, error }, so mocks answer in that shape. */
const allow = {
  data: [{ allowed: true, retry_after_seconds: 0 }],
  error: null,
};
const deny = (secs: number) => ({
  data: [{ allowed: false, retry_after_seconds: secs }],
  error: null,
});

beforeEach(() => {
  mockRpc.mockReset();
  mockHeaders.mockReset();
  mockHeaders.mockResolvedValue(headerMap({ "x-real-ip": "203.0.113.9" }));
});

describe("checkSignInRateLimit", () => {
  it("allows when both buckets are under their limit", async () => {
    mockRpc.mockResolvedValue(allow);
    await expect(checkSignInRateLimit("a@b.com")).resolves.toEqual({
      allowed: true,
    });
  });

  it("checks the IP bucket first and short-circuits", async () => {
    // Why it matters: the IP check is what stops one source walking a list
    // and burning many accounts' allowances. If the identifier bucket were
    // consulted first, a blocked source would still be reaching past it.
    mockRpc.mockResolvedValueOnce(deny(300));

    const verdict = await checkSignInRateLimit("a@b.com");

    expect(verdict).toEqual({ allowed: false, retryAfterSeconds: 300 });
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc.mock.calls[0][1]).toMatchObject({ p_scope: "ip" });
  });

  it("blocks on the identifier bucket even when the IP is fine", async () => {
    mockRpc.mockResolvedValueOnce(allow).mockResolvedValueOnce(deny(42));

    await expect(checkSignInRateLimit("a@b.com")).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 42,
    });
    expect(mockRpc.mock.calls[1][1]).toMatchObject({ p_scope: "identifier" });
  });

  it("passes the documented limits and window through", async () => {
    mockRpc.mockResolvedValue(allow);
    await checkSignInRateLimit("a@b.com");

    expect(mockRpc.mock.calls[0][1]).toMatchObject({
      p_limit: SIGN_IN_IP_LIMIT,
      p_window_seconds: SIGN_IN_WINDOW_SECONDS,
    });
    expect(mockRpc.mock.calls[1][1]).toMatchObject({
      p_limit: SIGN_IN_IDENTIFIER_LIMIT,
      p_window_seconds: SIGN_IN_WINDOW_SECONDS,
    });
  });

  it("never sends a raw identifier or IP to the database", async () => {
    mockRpc.mockResolvedValue(allow);
    await checkSignInRateLimit("someone@example.com");

    const sent = JSON.stringify(mockRpc.mock.calls);
    expect(sent).not.toContain("someone@example.com");
    expect(sent).not.toContain("203.0.113.9");
    for (const call of mockRpc.mock.calls) {
      expect(call[1].p_key_hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("buckets an identifier case- and whitespace-insensitively", async () => {
    mockRpc.mockResolvedValue(allow);
    await checkSignInRateLimit("  Foo@Example.com ");
    const first = mockRpc.mock.calls[1][1].p_key_hash;

    mockRpc.mockClear();
    await checkSignInRateLimit("foo@example.com");
    expect(mockRpc.mock.calls[1][1].p_key_hash).toBe(first);
  });

  it("skips the IP bucket when no proxy header is present", async () => {
    // Local development sets neither header. Bucketing every developer
    // under one shared "unknown" key would throttle nobody's attacker.
    mockHeaders.mockResolvedValue(headerMap({}));
    mockRpc.mockResolvedValue(allow);

    await checkSignInRateLimit("a@b.com");

    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc.mock.calls[0][1]).toMatchObject({ p_scope: "identifier" });
  });

  it("falls back to the first x-forwarded-for entry", async () => {
    mockHeaders.mockResolvedValue(
      headerMap({ "x-forwarded-for": "198.51.100.7, 10.0.0.1" }),
    );
    mockRpc.mockResolvedValue(allow);

    await checkSignInRateLimit("a@b.com");
    expect(mockRpc.mock.calls[0][1]).toMatchObject({ p_scope: "ip" });
  });

  it("fails OPEN when the call throws", async () => {
    // A limiter whose storage hiccups must not lock the whole platform out.
    mockRpc.mockRejectedValue(new Error("relation does not exist"));
    await expect(checkSignInRateLimit("a@b.com")).resolves.toEqual({
      allowed: true,
    });
  });

  it("fails OPEN when the RPC RETURNS an error rather than throwing", async () => {
    // The distinction is the whole point: supabase.rpc() hands errors back
    // in the result instead of throwing, so an `error` that is never
    // inspected would silently read as "allowed" by accident rather than by
    // decision. This pins it as a decision.
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "permission denied" },
    });
    await expect(checkSignInRateLimit("a@b.com")).resolves.toEqual({
      allowed: true,
    });
  });

  it("fails OPEN when the RPC returns no row", async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    await expect(checkSignInRateLimit("a@b.com")).resolves.toEqual({
      allowed: true,
    });
  });
});

describe("recordSignInFailure", () => {
  it("counts against both buckets", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await recordSignInFailure("a@b.com");

    const scopes = mockRpc.mock.calls.map((c) => c[1].p_scope).sort();
    expect(scopes).toEqual(["identifier", "ip"]);
    expect(mockRpc.mock.calls[0][0]).toBe("record_auth_attempt");
  });

  it("still counts the identifier when the IP is unknown", async () => {
    mockHeaders.mockResolvedValue(headerMap({}));
    mockRpc.mockResolvedValue({ data: null, error: null });

    await recordSignInFailure("a@b.com");

    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc.mock.calls[0][1]).toMatchObject({ p_scope: "identifier" });
  });

  it("swallows a write failure rather than blocking a sign-in", async () => {
    mockRpc.mockRejectedValue(new Error("nope"));
    await expect(recordSignInFailure("a@b.com")).resolves.toBeUndefined();
  });
});

describe("rateLimitedMessage", () => {
  it("rounds up to whole minutes and never says zero", () => {
    expect(rateLimitedMessage(1)).toBe(
      "Too many sign-in attempts. Try again in about 1 minute.",
    );
    expect(rateLimitedMessage(61)).toBe(
      "Too many sign-in attempts. Try again in about 2 minutes.",
    );
  });

  it("says nothing about which bucket tripped or whether the account exists", () => {
    const message = rateLimitedMessage(300);
    expect(message).not.toMatch(/ip|address|account|username|email/i);
  });
});

describe("password reset limits", () => {
  it("uses its own buckets, never sign-in's", async () => {
    // Sharing them would let a reset request eat a sign-in allowance, so
    // one form could lock the other.
    mockRpc.mockResolvedValue(allow);
    await checkPasswordResetRateLimit("a@b.com");

    const scopes = mockRpc.mock.calls.map((c) => c[1].p_scope);
    expect(scopes).toEqual(["reset_ip", "reset_email"]);
  });

  it("uses the longer window and its own limits", async () => {
    mockRpc.mockResolvedValue(allow);
    await checkPasswordResetRateLimit("a@b.com");

    expect(mockRpc.mock.calls[0][1]).toMatchObject({
      p_limit: PASSWORD_RESET_IP_LIMIT,
      p_window_seconds: PASSWORD_RESET_WINDOW_SECONDS,
    });
    expect(mockRpc.mock.calls[1][1]).toMatchObject({
      p_limit: PASSWORD_RESET_EMAIL_LIMIT,
      p_window_seconds: PASSWORD_RESET_WINDOW_SECONDS,
    });
  });

  it("keys the reset bucket differently than the sign-in bucket for the same address", async () => {
    // The hash is salted with the scope name, so one address cannot have
    // its sign-in allowance spent by reset traffic even accidentally.
    mockRpc.mockResolvedValue(allow);
    await checkSignInRateLimit("a@b.com");
    const signInKey = mockRpc.mock.calls[1][1].p_key_hash;

    mockRpc.mockClear();
    await checkPasswordResetRateLimit("a@b.com");
    expect(mockRpc.mock.calls[1][1].p_key_hash).not.toBe(signInKey);
  });

  it("blocks on the email bucket", async () => {
    mockRpc.mockResolvedValueOnce(allow).mockResolvedValueOnce(deny(1800));
    await expect(checkPasswordResetRateLimit("a@b.com")).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 1800,
    });
  });

  it("checks the IP bucket first and short-circuits", async () => {
    mockRpc.mockResolvedValueOnce(deny(600));
    const verdict = await checkPasswordResetRateLimit("a@b.com");

    expect(verdict).toEqual({ allowed: false, retryAfterSeconds: 600 });
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });

  it("sends no raw email address to the database", async () => {
    mockRpc.mockResolvedValue(allow);
    await checkPasswordResetRateLimit("someone@example.com");

    expect(JSON.stringify(mockRpc.mock.calls)).not.toContain(
      "someone@example.com",
    );
  });

  it("fails OPEN on a returned error", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "nope" } });
    await expect(checkPasswordResetRateLimit("a@b.com")).resolves.toEqual({
      allowed: true,
    });
  });

  it("records against both reset buckets", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await recordPasswordResetRequest("a@b.com");

    expect(mockRpc.mock.calls.map((c) => c[0])).toEqual([
      "record_auth_attempt",
      "record_auth_attempt",
    ]);
    expect(mockRpc.mock.calls.map((c) => c[1].p_scope).sort()).toEqual([
      "reset_email",
      "reset_ip",
    ]);
  });
});
