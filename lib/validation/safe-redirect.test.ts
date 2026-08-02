import { describe, expect, it } from "vitest";
import { resolveSafeReturnTo } from "./safe-redirect";

describe("resolveSafeReturnTo", () => {
  it("accepts a plain root-relative path", () => {
    expect(resolveSafeReturnTo("/my-stories")).toBe("/my-stories");
  });

  it("accepts a root-relative path with query string", () => {
    expect(resolveSafeReturnTo("/stories/new?draft=1")).toBe(
      "/stories/new?draft=1",
    );
  });

  it("falls back when the candidate is missing", () => {
    expect(resolveSafeReturnTo(null)).toBe("/");
    expect(resolveSafeReturnTo(undefined, "/account")).toBe("/account");
  });

  it("rejects protocol-relative URLs (open redirect via //)", () => {
    expect(resolveSafeReturnTo("//evil.example.com")).toBe("/");
  });

  it("rejects backslash tricks browsers treat like //", () => {
    expect(resolveSafeReturnTo("/\\evil.example.com")).toBe("/");
  });

  it("rejects absolute URLs with a scheme", () => {
    expect(resolveSafeReturnTo("https://evil.example.com")).toBe("/");
    expect(resolveSafeReturnTo("javascript:alert(1)")).toBe("/");
  });

  it("rejects a path not starting with /", () => {
    expect(resolveSafeReturnTo("account")).toBe("/");
  });
});
