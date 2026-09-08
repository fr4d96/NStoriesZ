import { describe, expect, it } from "vitest";
import { classifySignInIdentifier } from "./sign-in-identifier";

describe("classifySignInIdentifier", () => {
  it("classifies an email as an email, normalised and trimmed", () => {
    expect(classifySignInIdentifier("  Casey@Example.com  ")).toEqual({
      kind: "email",
      email: "Casey@Example.com",
    });
  });

  it("classifies a username as a username, lower-cased and trimmed", () => {
    expect(classifySignInIdentifier("  Casey-NZ  ")).toEqual({
      kind: "username",
      username: "casey-nz",
    });
  });

  it("accepts underscores, digits, and hyphens in a username", () => {
    expect(classifySignInIdentifier("casey_nz-24")).toEqual({
      kind: "username",
      username: "casey_nz-24",
    });
  });

  it("rejects an empty or whitespace-only identifier", () => {
    expect(classifySignInIdentifier("")).toBeNull();
    expect(classifySignInIdentifier("   ")).toBeNull();
  });

  it("rejects a malformed email rather than falling through to the username branch", () => {
    // The "@" commits the input to the email branch. Falling back to
    // username here would be a silent second chance at authentication with
    // an input the email parser already refused.
    expect(classifySignInIdentifier("not-an-email@")).toBeNull();
    expect(classifySignInIdentifier("@example.com")).toBeNull();
  });

  it("rejects usernames outside the 3-30 length window", () => {
    expect(classifySignInIdentifier("ab")).toBeNull();
    expect(classifySignInIdentifier("a".repeat(31))).toBeNull();
    expect(classifySignInIdentifier("abc")).not.toBeNull();
    expect(classifySignInIdentifier("a".repeat(30))).not.toBeNull();
  });

  it("rejects a username that starts with a hyphen or underscore", () => {
    expect(classifySignInIdentifier("-casey")).toBeNull();
    expect(classifySignInIdentifier("_casey")).toBeNull();
  });

  it("rejects characters the DB CHECK would reject anyway", () => {
    expect(classifySignInIdentifier("casey nz")).toBeNull();
    expect(classifySignInIdentifier("casey.nz")).toBeNull();
    expect(classifySignInIdentifier("casey/../admin")).toBeNull();
  });

  it("never classifies the same input two different ways", () => {
    // The two shapes are disjoint by construction: a username may not
    // contain "@" and an email must. This is what makes the branch a
    // decision rather than a guess.
    for (const value of [
      "casey@example.com",
      "casey-nz",
      "casey@",
      "casey",
      "",
    ]) {
      const result = classifySignInIdentifier(value);
      if (result?.kind === "username") {
        expect(value).not.toContain("@");
      }
      if (result?.kind === "email") {
        expect(value).toContain("@");
      }
    }
  });
});
