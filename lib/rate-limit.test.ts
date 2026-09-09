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
  checkSignUpRateLimit,
  recordSignUpAttempt,
  SIGN_UP_IP_LIMIT,
  SIGN_UP_EMAIL_LIMIT,
  SIGN_UP_WINDOW_SECONDS,
  checkPdfImportRateLimit,
  recordPdfImportAttempt,
  tooManyRequestsResponse,
  PDF_PREVIEW_LIMIT,
  PDF_ATTACH_LIMIT,
  PDF_IMPORT_WINDOW_SECONDS,
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
    expect(mockRpc.mock.calls[0][0]).toBe("record_rate_limit_attempt");
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
      "record_rate_limit_attempt",
      "record_rate_limit_attempt",
    ]);
    expect(mockRpc.mock.calls.map((c) => c[1].p_scope).sort()).toEqual([
      "reset_email",
      "reset_ip",
    ]);
  });
});

describe("signup limits", () => {
  it("uses its own buckets", async () => {
    mockRpc.mockResolvedValue(allow);
    await checkSignUpRateLimit("a@b.com");

    expect(mockRpc.mock.calls.map((c) => c[1].p_scope)).toEqual([
      "signup_ip",
      "signup_email",
    ]);
  });

  it("uses its own limits and window", async () => {
    mockRpc.mockResolvedValue(allow);
    await checkSignUpRateLimit("a@b.com");

    expect(mockRpc.mock.calls[0][1]).toMatchObject({
      p_limit: SIGN_UP_IP_LIMIT,
      p_window_seconds: SIGN_UP_WINDOW_SECONDS,
    });
    expect(mockRpc.mock.calls[1][1]).toMatchObject({
      p_limit: SIGN_UP_EMAIL_LIMIT,
      p_window_seconds: SIGN_UP_WINDOW_SECONDS,
    });
  });

  it("gives one address three different keys across the three forms", async () => {
    // The hash is salted with the scope name, so no auth form can spend
    // another's allowance for the same person -- signing up must never be
    // able to lock someone out of signing in.
    mockRpc.mockResolvedValue(allow);

    await checkSignInRateLimit("a@b.com");
    const signIn = mockRpc.mock.calls[1][1].p_key_hash;
    mockRpc.mockClear();

    await checkPasswordResetRateLimit("a@b.com");
    const reset = mockRpc.mock.calls[1][1].p_key_hash;
    mockRpc.mockClear();

    await checkSignUpRateLimit("a@b.com");
    const signUp = mockRpc.mock.calls[1][1].p_key_hash;

    expect(new Set([signIn, reset, signUp]).size).toBe(3);
  });

  it("blocks on the email bucket and reports a retry time", async () => {
    mockRpc.mockResolvedValueOnce(allow).mockResolvedValueOnce(deny(2400));
    await expect(checkSignUpRateLimit("a@b.com")).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 2400,
    });
  });

  it("checks the IP bucket first and short-circuits", async () => {
    mockRpc.mockResolvedValueOnce(deny(900));
    await checkSignUpRateLimit("a@b.com");
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });

  it("sends no raw address to the database", async () => {
    mockRpc.mockResolvedValue(allow);
    await checkSignUpRateLimit("someone@example.com");
    expect(JSON.stringify(mockRpc.mock.calls)).not.toContain(
      "someone@example.com",
    );
  });

  it("fails OPEN on a returned error", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "nope" } });
    await expect(checkSignUpRateLimit("a@b.com")).resolves.toEqual({
      allowed: true,
    });
  });

  it("records against both signup buckets", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await recordSignUpAttempt("a@b.com");

    expect(mockRpc.mock.calls.map((c) => c[1].p_scope).sort()).toEqual([
      "signup_email",
      "signup_ip",
    ]);
  });
});

describe("rateLimitedMessage labels", () => {
  it("defaults to sign-in wording", () => {
    expect(rateLimitedMessage(300)).toContain("sign-in");
  });

  it("says sign-up when asked", () => {
    expect(rateLimitedMessage(300, "sign-up")).toBe(
      "Too many sign-up attempts. Try again in about 5 minutes.",
    );
  });
});

describe("PDF import limits", () => {
  it("keys on the user id, with no IP bucket at all", async () => {
    // Every PDF route is authenticated, so the caller is already established
    // server-side. A user id is unspoofable and has none of the shared-NAT
    // problem the auth limits must tolerate, so there is nothing for an IP
    // bucket to add here.
    mockRpc.mockResolvedValue(allow);
    await checkPdfImportRateLimit("preview", "user-123");

    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc.mock.calls[0][1]).toMatchObject({
      p_scope: "pdf_preview_user",
      p_limit: PDF_PREVIEW_LIMIT,
      p_window_seconds: PDF_IMPORT_WINDOW_SECONDS,
    });
  });

  it("gives preview and attach separate budgets", async () => {
    // Preview is exploratory and repeated; attach is the committed action.
    // A shared budget would let heavy previewing block the very import the
    // previewing was for.
    mockRpc.mockResolvedValue(allow);

    await checkPdfImportRateLimit("preview", "user-123");
    const previewCall = mockRpc.mock.calls[0][1];
    mockRpc.mockClear();

    await checkPdfImportRateLimit("attach", "user-123");
    const attachCall = mockRpc.mock.calls[0][1];

    expect(previewCall.p_scope).toBe("pdf_preview_user");
    expect(attachCall.p_scope).toBe("pdf_attach_user");
    expect(attachCall.p_key_hash).not.toBe(previewCall.p_key_hash);
    expect(attachCall.p_limit).toBe(PDF_ATTACH_LIMIT);
  });

  it("never sends a raw user id to the database", async () => {
    mockRpc.mockResolvedValue(allow);
    await checkPdfImportRateLimit("preview", "user-123");

    expect(JSON.stringify(mockRpc.mock.calls)).not.toContain("user-123");
    expect(mockRpc.mock.calls[0][1].p_key_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("blocks and reports a retry time", async () => {
    mockRpc.mockResolvedValue(deny(1200));
    await expect(
      checkPdfImportRateLimit("attach", "user-123"),
    ).resolves.toEqual({ allowed: false, retryAfterSeconds: 1200 });
  });

  it("fails OPEN on a returned error", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "nope" } });
    await expect(
      checkPdfImportRateLimit("preview", "user-123"),
    ).resolves.toEqual({ allowed: true });
  });

  it("records against the surface's own scope", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await recordPdfImportAttempt("attach", "user-123");

    expect(mockRpc.mock.calls[0][0]).toBe("record_rate_limit_attempt");
    expect(mockRpc.mock.calls[0][1]).toMatchObject({
      p_scope: "pdf_attach_user",
    });
  });
});

describe("tooManyRequestsResponse", () => {
  it("is a 429 carrying Retry-After in seconds", async () => {
    // A Route Handler answers fetch(), not a form, so HTTP status is the
    // right channel -- unlike the auth actions, which return form state.
    const res = tooManyRequestsResponse(1800);

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("1800");
    await expect(res.json()).resolves.toEqual({
      error: "Too many PDF imports. Try again in about 30 minutes.",
    });
  });

  it("never rounds down to zero minutes", async () => {
    const res = tooManyRequestsResponse(5);
    await expect(res.json()).resolves.toEqual({
      error: "Too many PDF imports. Try again in about 1 minute.",
    });
  });
});
