import { describe, expect, it, vi, beforeEach } from "vitest";

const mockRedirect = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`);
});
vi.mock("next/navigation", () => ({
  redirect: (path: string) => mockRedirect(path),
}));

const mockSignUp = vi.fn();
const mockSignInWithPassword = vi.fn();
const mockSignOut = vi.fn();
const mockResetPasswordForEmail = vi.fn();
const mockGetUser = vi.fn();
const mockUpdateUser = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      signUp: (...args: unknown[]) => mockSignUp(...args),
      signInWithPassword: (...args: unknown[]) =>
        mockSignInWithPassword(...args),
      signOut: (...args: unknown[]) => mockSignOut(...args),
      resetPasswordForEmail: (...args: unknown[]) =>
        mockResetPasswordForEmail(...args),
      getUser: (...args: unknown[]) => mockGetUser(...args),
      updateUser: (...args: unknown[]) => mockUpdateUser(...args),
    },
  }),
}));

// lib/auth/username-login.ts is the one module allowed to use the
// service-role client, so it is mocked at the import boundary here exactly
// like the Supabase client itself — these tests are about signInAction's
// own routing and error rules, never about a live privileged lookup.
const mockResolveEmailForUsername = vi.fn();
vi.mock("@/lib/auth/username-login", () => ({
  resolveEmailForUsername: (username: string) =>
    mockResolveEmailForUsername(username),
}));

// lib/auth/rate-limit.ts imports server-only and next/headers, neither of
// which loads outside Next's bundler, so it is mocked at the import boundary
// like username-login.ts above. Its own limits, hashing and fail-open rules
// are covered in lib/auth/rate-limit.test.ts; what matters HERE is only
// which of signInAction's paths call it.
const mockCheckSignInRateLimit = vi.fn();
const mockRecordSignInFailure = vi.fn();
const mockCheckPasswordResetRateLimit = vi.fn();
const mockRecordPasswordResetRequest = vi.fn();
const mockCheckSignUpRateLimit = vi.fn();
const mockRecordSignUpAttempt = vi.fn();
vi.mock("@/lib/auth/rate-limit", () => ({
  checkSignInRateLimit: (identifier: string) =>
    mockCheckSignInRateLimit(identifier),
  recordSignInFailure: (identifier: string) =>
    mockRecordSignInFailure(identifier),
  rateLimitedMessage: (seconds: number) => `RATE_LIMITED:${seconds}`,
  checkPasswordResetRateLimit: (email: string) =>
    mockCheckPasswordResetRateLimit(email),
  recordPasswordResetRequest: (email: string) =>
    mockRecordPasswordResetRequest(email),
  checkSignUpRateLimit: (email: string) => mockCheckSignUpRateLimit(email),
  recordSignUpAttempt: (email: string) => mockRecordSignUpAttempt(email),
}));

const mockGetCurrentUserRole = vi.fn();
vi.mock("@/lib/auth/roles", () => ({
  getCurrentUserRole: () => mockGetCurrentUserRole(),
}));

// The real resolveSignInLandingPath() is server-only (it reads the caller's
// own contributors row); its own decision is unit-tested purely in
// lib/auth/post-login-redirect.test.ts. Here it is mocked so these tests
// stay about signInAction's own routing rules.
const mockHasContributorIdentity = vi.fn();
vi.mock("@/lib/auth/contributor-identity", async () => {
  const { landingPathAfterSignIn } =
    await import("@/lib/auth/post-login-redirect");
  return {
    resolveSignInLandingPath: async (role: "user" | null) =>
      landingPathAfterSignIn(role, await mockHasContributorIdentity()),
  };
});

import {
  signUpAction,
  signInAction,
  signOutAction,
  forgotPasswordAction,
  resetPasswordAction,
} from "./actions";

function formData(entries: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    fd.set(key, value);
  }
  return fd;
}

beforeEach(() => {
  mockRedirect.mockClear();
  mockSignUp.mockReset().mockResolvedValue({ error: null });
  mockSignInWithPassword.mockReset().mockResolvedValue({ error: null });
  mockSignOut.mockReset().mockResolvedValue({ error: null });
  mockResetPasswordForEmail.mockReset().mockResolvedValue({ error: null });
  mockGetUser.mockReset();
  mockUpdateUser.mockReset();
  mockResolveEmailForUsername.mockReset().mockResolvedValue(null);
  mockCheckSignInRateLimit.mockReset().mockResolvedValue({ allowed: true });
  mockRecordSignInFailure.mockReset().mockResolvedValue(undefined);
  mockCheckPasswordResetRateLimit
    .mockReset()
    .mockResolvedValue({ allowed: true });
  mockRecordPasswordResetRequest.mockReset().mockResolvedValue(undefined);
  mockCheckSignUpRateLimit.mockReset().mockResolvedValue({ allowed: true });
  mockRecordSignUpAttempt.mockReset().mockResolvedValue(undefined);
  mockGetCurrentUserRole.mockReset().mockResolvedValue(null);
  mockHasContributorIdentity.mockReset().mockResolvedValue(true);
});

describe("signUpAction", () => {
  it("rejects an invalid email before calling Supabase", async () => {
    const result = await signUpAction(
      {},
      formData({ email: "not-an-email", password: "password123" }),
    );

    expect(result.error).toBeTruthy();
    expect(mockSignUp).not.toHaveBeenCalled();
  });

  it("passes the chosen display name through as user metadata, and returns a check-your-email success state", async () => {
    const result = await signUpAction(
      {},
      formData({
        email: "a@example.com",
        password: "password123",
        displayName: "Casey C.",
      }),
    );

    expect(mockSignUp).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "a@example.com",
        options: expect.objectContaining({
          data: { display_name: "Casey C." },
        }),
      }),
    );
    expect(result.success).toMatch(/check your email/i);
  });

  it("passes through Supabase's own (already-generic) error message", async () => {
    mockSignUp.mockResolvedValue({
      error: { message: "Something went wrong" },
    });

    const result = await signUpAction(
      {},
      formData({ email: "a@example.com", password: "password123" }),
    );

    expect(result.error).toBe("Something went wrong");
  });
});

describe("signUpAction rate limiting", () => {
  const form = (email = "new@example.com") => {
    const data = new FormData();
    data.set("email", email);
    data.set("password", "hunter22");
    return data;
  };

  it("creates the account and counts the request when under the limit", async () => {
    await signUpAction({}, form());

    expect(mockSignUp).toHaveBeenCalled();
    expect(mockRecordSignUpAttempt).toHaveBeenCalledWith("new@example.com");
  });

  it("counts a SUCCESSFUL signup", async () => {
    // The harm here -- a confirmation email sent, an auth.users row and
    // everything handle_new_user creates behind it -- is what a successful
    // call produces. Counting only failures would count nothing that matters.
    mockSignUp.mockResolvedValue({ error: null });
    await signUpAction({}, form());
    expect(mockRecordSignUpAttempt).toHaveBeenCalledTimes(1);
  });

  it("creates nothing when throttled", async () => {
    mockCheckSignUpRateLimit.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 2400,
    });

    await signUpAction({}, form());

    expect(mockSignUp).not.toHaveBeenCalled();
    expect(mockRecordSignUpAttempt).not.toHaveBeenCalled();
  });

  it("TELLS the user it is throttled, rather than a false success", async () => {
    // The opposite of forgotPasswordAction, deliberately. Staying silent is
    // only honest when someone already has what they asked for; a throttled
    // signup would leave them with no account AND no email, waiting on a
    // "check your inbox" message that was untrue.
    mockCheckSignUpRateLimit.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 2400,
    });

    const state = await signUpAction({}, form());

    expect(state.error).toBe("RATE_LIMITED:2400");
    expect(state.success).toBeUndefined();
  });

  it("does not count input that failed validation", async () => {
    // Nothing is sent and nothing is created for an unparseable payload, so
    // there is nothing to throttle.
    await signUpAction({}, form("not-an-email"));

    expect(mockRecordSignUpAttempt).not.toHaveBeenCalled();
    expect(mockSignUp).not.toHaveBeenCalled();
  });
});

describe("signInAction", () => {
  it("redirects to a validated safe path on success", async () => {
    await expect(
      signInAction(
        {},
        formData({
          identifier: "a@example.com",
          password: "password123",
          next: "/my-stories",
        }),
      ),
    ).rejects.toThrow("REDIRECT:/my-stories");
  });

  it("never redirects to an attacker-supplied absolute URL", async () => {
    await expect(
      signInAction(
        {},
        formData({
          identifier: "a@example.com",
          password: "password123",
          next: "https://evil.example.com",
        }),
      ),
    ).rejects.toThrow("REDIRECT:/account");
  });

  it("returns a generic error and never reveals whether the email exists", async () => {
    mockSignInWithPassword.mockResolvedValue({
      error: { message: "User not found" },
    });

    const result = await signInAction(
      {},
      formData({ identifier: "a@example.com", password: "wrong" }),
    );

    expect(result.error).toBe("Incorrect email/username or password.");
  });

  it("with no explicit next, sends an ordinary user to My Stories", async () => {
    mockGetCurrentUserRole.mockResolvedValue("user");

    await expect(
      signInAction(
        {},
        formData({ identifier: "a@example.com", password: "password123" }),
      ),
    ).rejects.toThrow("REDIRECT:/my-stories");
  });

  it("with no explicit next, sends a brand new account to set up its contributor identity", async () => {
    mockGetCurrentUserRole.mockResolvedValue("user");
    mockHasContributorIdentity.mockResolvedValue(false);

    await expect(
      signInAction(
        {},
        formData({ identifier: "a@example.com", password: "password123" }),
      ),
    ).rejects.toThrow("REDIRECT:/account#contributor-identity");
  });

  it("with no explicit next, sends a moderator to their own dashboard, not /account", async () => {
    mockGetCurrentUserRole.mockResolvedValue("moderator");

    await expect(
      signInAction(
        {},
        formData({ identifier: "a@example.com", password: "password123" }),
      ),
    ).rejects.toThrow("REDIRECT:/moderation");
  });

  it("with no explicit next, sends an admin to /admin, not /moderation", async () => {
    mockGetCurrentUserRole.mockResolvedValue("admin");

    await expect(
      signInAction(
        {},
        formData({ identifier: "a@example.com", password: "password123" }),
      ),
    ).rejects.toThrow("REDIRECT:/admin");
  });

  it("with no explicit next, sends an editor to /editorial", async () => {
    mockGetCurrentUserRole.mockResolvedValue("editor");

    await expect(
      signInAction(
        {},
        formData({ identifier: "a@example.com", password: "password123" }),
      ),
    ).rejects.toThrow("REDIRECT:/editorial");
  });

  it("an explicit next still wins over the role-based default", async () => {
    mockGetCurrentUserRole.mockResolvedValue("moderator");

    await expect(
      signInAction(
        {},
        formData({
          identifier: "a@example.com",
          password: "password123",
          next: "/my-stories",
        }),
      ),
    ).rejects.toThrow("REDIRECT:/my-stories");
    expect(mockGetCurrentUserRole).not.toHaveBeenCalled();
  });
  it("resolves a username to its email and signs in with that", async () => {
    mockResolveEmailForUsername.mockResolvedValue("casey@example.com");

    await expect(
      signInAction(
        {},
        formData({ identifier: "casey-nz", password: "password123" }),
      ),
    ).rejects.toThrow("REDIRECT:/my-stories");

    expect(mockResolveEmailForUsername).toHaveBeenCalledWith("casey-nz");
    expect(mockSignInWithPassword).toHaveBeenCalledWith({
      email: "casey@example.com",
      password: "password123",
    });
  });

  it("lower-cases a username before looking it up", async () => {
    mockResolveEmailForUsername.mockResolvedValue("casey@example.com");

    await expect(
      signInAction(
        {},
        formData({ identifier: "  Casey-NZ  ", password: "password123" }),
      ),
    ).rejects.toThrow("REDIRECT:/my-stories");

    expect(mockResolveEmailForUsername).toHaveBeenCalledWith("casey-nz");
  });

  it("never looks a username up when the identifier is an email", async () => {
    await expect(
      signInAction(
        {},
        formData({ identifier: "a@example.com", password: "password123" }),
      ),
    ).rejects.toThrow("REDIRECT:/my-stories");

    expect(mockResolveEmailForUsername).not.toHaveBeenCalled();
  });

  it("gives an unknown username the exact same error as a wrong password", async () => {
    mockResolveEmailForUsername.mockResolvedValue(null);

    const unknownUsername = await signInAction(
      {},
      formData({ identifier: "nobody-here", password: "password123" }),
    );

    mockSignInWithPassword.mockResolvedValue({
      error: { message: "Invalid login credentials" },
    });
    const wrongPassword = await signInAction(
      {},
      formData({ identifier: "a@example.com", password: "wrong" }),
    );

    expect(unknownUsername.error).toBe(wrongPassword.error);
    expect(unknownUsername.error).toBe("Incorrect email/username or password.");
  });

  it("never reaches Supabase when the identifier is neither an email nor a valid username", async () => {
    const result = await signInAction(
      {},
      formData({ identifier: "no", password: "password123" }),
    );

    expect(result.error).toBe("Incorrect email/username or password.");
    expect(mockResolveEmailForUsername).not.toHaveBeenCalled();
    expect(mockSignInWithPassword).not.toHaveBeenCalled();
  });

  it("treats a failed service-role lookup as a normal failed sign-in, not a crash", async () => {
    // resolveEmailForUsername swallows its own errors and returns null (a
    // missing SUPABASE_SERVICE_ROLE_KEY throws inside getAdminEnv()), so a
    // broken lookup must look identical to a wrong password here.
    mockResolveEmailForUsername.mockResolvedValue(null);

    const result = await signInAction(
      {},
      formData({ identifier: "casey-nz", password: "password123" }),
    );

    expect(result.error).toBe("Incorrect email/username or password.");
    expect(mockSignInWithPassword).not.toHaveBeenCalled();
  });
});

describe("signInAction rate limiting", () => {
  const form = (identifier = "casey@example.com") => {
    const data = new FormData();
    data.set("identifier", identifier);
    data.set("password", "hunter22");
    return data;
  };

  it("refuses a throttled attempt without touching Supabase", async () => {
    mockCheckSignInRateLimit.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 300,
    });

    const state = await signInAction({}, form());

    expect(state.error).toBe("RATE_LIMITED:300");
    expect(mockSignInWithPassword).not.toHaveBeenCalled();
  });

  it("checks the limit BEFORE the service-role username lookup", async () => {
    // A throttled request must not be able to make this server do
    // privileged work on its behalf.
    mockCheckSignInRateLimit.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 60,
    });

    await signInAction({}, form("caseyc"));

    expect(mockResolveEmailForUsername).not.toHaveBeenCalled();
  });

  it("counts a wrong password", async () => {
    mockSignInWithPassword.mockResolvedValue({ error: { message: "bad" } });

    await signInAction({}, form());

    expect(mockRecordSignInFailure).toHaveBeenCalledWith("casey@example.com");
  });

  it("counts an unknown username exactly like a wrong password", async () => {
    // THE POINT OF THIS TEST: if only real accounts ever accumulated
    // failures, then "this identifier never starts rate-limiting" would
    // confirm the account does not exist -- an existence oracle that
    // silently undoes the single generic error message the whole sign-in
    // path is built around.
    mockResolveEmailForUsername.mockResolvedValue(null);

    await signInAction({}, form("ghostuser"));

    expect(mockRecordSignInFailure).toHaveBeenCalledWith("ghostuser");
  });

  it("counts an identifier that is neither an email nor a valid username", async () => {
    await signInAction({}, form("not a valid anything!!"));

    expect(mockRecordSignInFailure).toHaveBeenCalledWith(
      "not a valid anything!!",
    );
    expect(mockSignInWithPassword).not.toHaveBeenCalled();
  });

  it("counts nothing on a successful sign-in", async () => {
    mockSignInWithPassword.mockResolvedValue({ error: null });
    mockGetCurrentUserRole.mockResolvedValue("user");
    mockHasContributorIdentity.mockResolvedValue(true);

    await expect(signInAction({}, form())).rejects.toThrow(/REDIRECT:/);

    expect(mockRecordSignInFailure).not.toHaveBeenCalled();
  });

  it("gives a throttled attempt a different message than a wrong password", async () => {
    // These two MUST differ: telling someone "wrong password" while
    // silently refusing to check it would leave them retyping a correct
    // password forever.
    mockSignInWithPassword.mockResolvedValue({ error: { message: "bad" } });
    const wrongPassword = await signInAction({}, form());

    mockCheckSignInRateLimit.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 300,
    });
    const throttled = await signInAction({}, form());

    expect(throttled.error).not.toBe(wrongPassword.error);
  });
});

describe("signOutAction", () => {
  it("signs out and redirects home", async () => {
    await expect(signOutAction()).rejects.toThrow("REDIRECT:/");
    expect(mockSignOut).toHaveBeenCalled();
  });
});

describe("forgotPasswordAction", () => {
  it("always returns the same generic message for a valid email", async () => {
    const result = await forgotPasswordAction(
      {},
      formData({ email: "a@example.com" }),
    );
    expect(result.success).toMatch(/if an account exists/i);
    expect(mockResetPasswordForEmail).toHaveBeenCalled();
  });

  it("returns the identical generic message for invalid input, without calling Supabase", async () => {
    const result = await forgotPasswordAction({}, formData({ email: "" }));
    expect(result.success).toMatch(/if an account exists/i);
    expect(mockResetPasswordForEmail).not.toHaveBeenCalled();
  });
});

describe("forgotPasswordAction rate limiting", () => {
  const form = (email = "casey@example.com") => {
    const data = new FormData();
    data.set("email", email);
    return data;
  };

  it("sends the email and counts the request when under the limit", async () => {
    const state = await forgotPasswordAction({}, form());

    expect(mockResetPasswordForEmail).toHaveBeenCalled();
    expect(mockRecordPasswordResetRequest).toHaveBeenCalledWith(
      "casey@example.com",
    );
    expect(state.success).toBeTruthy();
  });

  it("counts EVERY request, not only failures", async () => {
    // Flooding an inbox does not care whether the send succeeded, so there
    // is no failure to wait for -- a perfectly successful send still counts.
    await forgotPasswordAction({}, form());
    expect(mockRecordPasswordResetRequest).toHaveBeenCalledTimes(1);
  });

  it("sends NOTHING when throttled", async () => {
    mockCheckPasswordResetRateLimit.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 1800,
    });

    await forgotPasswordAction({}, form());

    expect(mockResetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("returns the IDENTICAL generic message when throttled", async () => {
    // THE POINT OF THIS TEST: this action's single fixed reply is what stops
    // it confirming whether an address is registered. A distinct "too many
    // requests" message would punch straight through that, letting someone
    // probe which addresses are having resets requested. Unlike signInAction
    // -- where a throttled user MUST be told, or they retype a correct
    // password forever -- silence is the correct answer here.
    const normal = await forgotPasswordAction({}, form());

    mockCheckPasswordResetRateLimit.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 1800,
    });
    const throttled = await forgotPasswordAction({}, form());

    expect(throttled).toEqual(normal);
  });

  it("does not count a request it refused to send", async () => {
    mockCheckPasswordResetRateLimit.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 1800,
    });

    await forgotPasswordAction({}, form());

    expect(mockRecordPasswordResetRequest).not.toHaveBeenCalled();
  });

  it("still says nothing, and sends nothing, for an unparseable address", async () => {
    const state = await forgotPasswordAction({}, form("not-an-email"));

    expect(mockResetPasswordForEmail).not.toHaveBeenCalled();
    expect(state.success).toBeTruthy();
  });
});

describe("resetPasswordAction", () => {
  it("rejects when there is no active recovery session", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    const result = await resetPasswordAction(
      {},
      formData({ password: "password123", confirmPassword: "password123" }),
    );

    expect(result.error).toMatch(/expired or already been used/i);
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it("updates the password and redirects when a session exists", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-1" } },
      error: null,
    });
    mockUpdateUser.mockResolvedValue({ error: null });

    await expect(
      resetPasswordAction(
        {},
        formData({
          password: "password123",
          confirmPassword: "password123",
        }),
      ),
    ).rejects.toThrow("REDIRECT:/account");
  });

  it("rejects mismatched passwords before touching Supabase", async () => {
    const result = await resetPasswordAction(
      {},
      formData({ password: "password123", confirmPassword: "different" }),
    );

    expect(result.error).toBeTruthy();
    expect(mockGetUser).not.toHaveBeenCalled();
  });
});
