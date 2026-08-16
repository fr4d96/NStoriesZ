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

describe("signInAction", () => {
  it("redirects to a validated safe path on success", async () => {
    await expect(
      signInAction(
        {},
        formData({
          email: "a@example.com",
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
          email: "a@example.com",
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
      formData({ email: "a@example.com", password: "wrong" }),
    );

    expect(result.error).toBe("Incorrect email or password.");
  });

  it("with no explicit next, sends an ordinary user to My Stories", async () => {
    mockGetCurrentUserRole.mockResolvedValue("user");

    await expect(
      signInAction(
        {},
        formData({ email: "a@example.com", password: "password123" }),
      ),
    ).rejects.toThrow("REDIRECT:/my-stories");
  });

  it("with no explicit next, sends a brand new account to set up its contributor identity", async () => {
    mockGetCurrentUserRole.mockResolvedValue("user");
    mockHasContributorIdentity.mockResolvedValue(false);

    await expect(
      signInAction(
        {},
        formData({ email: "a@example.com", password: "password123" }),
      ),
    ).rejects.toThrow("REDIRECT:/account#contributor-identity");
  });

  it("with no explicit next, sends a moderator to their own dashboard, not /account", async () => {
    mockGetCurrentUserRole.mockResolvedValue("moderator");

    await expect(
      signInAction(
        {},
        formData({ email: "a@example.com", password: "password123" }),
      ),
    ).rejects.toThrow("REDIRECT:/moderation");
  });

  it("with no explicit next, sends an editor to /editorial", async () => {
    mockGetCurrentUserRole.mockResolvedValue("editor");

    await expect(
      signInAction(
        {},
        formData({ email: "a@example.com", password: "password123" }),
      ),
    ).rejects.toThrow("REDIRECT:/editorial");
  });

  it("an explicit next still wins over the role-based default", async () => {
    mockGetCurrentUserRole.mockResolvedValue("moderator");

    await expect(
      signInAction(
        {},
        formData({
          email: "a@example.com",
          password: "password123",
          next: "/my-stories",
        }),
      ),
    ).rejects.toThrow("REDIRECT:/my-stories");
    expect(mockGetCurrentUserRole).not.toHaveBeenCalled();
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
