import { describe, expect, it } from "vitest";
import {
  signUpSchema,
  signInSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from "./auth";

describe("signUpSchema", () => {
  it("accepts a valid email/password with no display name", () => {
    const result = signUpSchema.safeParse({
      email: "person@example.com",
      password: "password123",
      displayName: "",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid email", () => {
    const result = signUpSchema.safeParse({
      email: "not-an-email",
      password: "password123",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a too-short password", () => {
    const result = signUpSchema.safeParse({
      email: "person@example.com",
      password: "abc",
    });
    expect(result.success).toBe(false);
  });
});

describe("signInSchema", () => {
  it("requires a non-empty password but does not enforce a minimum length", () => {
    expect(
      signInSchema.safeParse({ identifier: "a@example.com", password: "" })
        .success,
    ).toBe(false);
    expect(
      signInSchema.safeParse({ identifier: "a@example.com", password: "x" })
        .success,
    ).toBe(true);
  });

  it("accepts a username as the identifier, not just an email", () => {
    expect(
      signInSchema.safeParse({ identifier: "casey-nz", password: "x" }).success,
    ).toBe(true);
  });

  it("deliberately does not enforce any identifier shape beyond non-empty", () => {
    // Shape is decided later by classifySignInIdentifier(), so the login box
    // never answers "is this a valid username?" ahead of a credential check.
    expect(
      signInSchema.safeParse({ identifier: "!!!", password: "x" }).success,
    ).toBe(true);
    expect(
      signInSchema.safeParse({ identifier: "   ", password: "x" }).success,
    ).toBe(false);
  });
});

describe("forgotPasswordSchema", () => {
  it("requires a valid email", () => {
    expect(forgotPasswordSchema.safeParse({ email: "" }).success).toBe(false);
    expect(
      forgotPasswordSchema.safeParse({ email: "a@example.com" }).success,
    ).toBe(true);
  });
});

describe("resetPasswordSchema", () => {
  it("rejects mismatched passwords", () => {
    const result = resetPasswordSchema.safeParse({
      password: "password123",
      confirmPassword: "password456",
    });
    expect(result.success).toBe(false);
  });

  it("accepts matching passwords", () => {
    const result = resetPasswordSchema.safeParse({
      password: "password123",
      confirmPassword: "password123",
    });
    expect(result.success).toBe(true);
  });
});
