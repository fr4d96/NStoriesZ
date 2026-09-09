import { describe, it, expect } from "vitest";

import { rateLimitRows } from "./rate-limit-summary";
import * as limits from "@/lib/rate-limit-config";

describe("rateLimitRows", () => {
  it("reads the numbers the limiter actually enforces, never a retyped copy", () => {
    // THE POINT OF THIS TEST: a settings page that quietly lies about the
    // setting is worse than no page. If someone tunes a limit in
    // lib/rate-limit.ts and this table keeps showing the old number, this
    // fails rather than shipping a confident wrong answer.
    const byKey = Object.fromEntries(
      rateLimitRows().map((row) => [row.key, row]),
    );

    expect(byKey["sign-in-identifier"].limit).toBe(
      limits.SIGN_IN_IDENTIFIER_LIMIT,
    );
    expect(byKey["sign-in-ip"].limit).toBe(limits.SIGN_IN_IP_LIMIT);
    expect(byKey["reset-email"].limit).toBe(limits.PASSWORD_RESET_EMAIL_LIMIT);
    expect(byKey["reset-ip"].limit).toBe(limits.PASSWORD_RESET_IP_LIMIT);
    expect(byKey["sign-up-email"].limit).toBe(limits.SIGN_UP_EMAIL_LIMIT);
    expect(byKey["sign-up-ip"].limit).toBe(limits.SIGN_UP_IP_LIMIT);
    expect(byKey["pdf-preview"].limit).toBe(limits.PDF_PREVIEW_LIMIT);
    expect(byKey["pdf-attach"].limit).toBe(limits.PDF_ATTACH_LIMIT);
  });

  it("converts each window to whole minutes from the real seconds", () => {
    const byKey = Object.fromEntries(
      rateLimitRows().map((row) => [row.key, row]),
    );

    expect(byKey["sign-in-ip"].windowMinutes).toBe(
      limits.SIGN_IN_WINDOW_SECONDS / 60,
    );
    expect(byKey["reset-ip"].windowMinutes).toBe(
      limits.PASSWORD_RESET_WINDOW_SECONDS / 60,
    );
    expect(byKey["sign-up-ip"].windowMinutes).toBe(
      limits.SIGN_UP_WINDOW_SECONDS / 60,
    );
    expect(byKey["pdf-attach"].windowMinutes).toBe(
      limits.PDF_IMPORT_WINDOW_SECONDS / 60,
    );
  });

  it("covers every bucket the limiter has, so none is silently missing", () => {
    expect(
      rateLimitRows()
        .map((r) => r.key)
        .sort(),
    ).toEqual([
      "pdf-attach",
      "pdf-preview",
      "reset-email",
      "reset-ip",
      "sign-in-identifier",
      "sign-in-ip",
      "sign-up-email",
      "sign-up-ip",
    ]);
  });

  it("says which surfaces count failures and which count every request", () => {
    // Not decoration: sign-in counting only failures, while the rest count
    // every request, is the difference between "you got it wrong 8 times"
    // and "you asked 5 times". Showing one as the other would mislead.
    const byKey = Object.fromEntries(
      rateLimitRows().map((row) => [row.key, row]),
    );

    expect(byKey["sign-in-identifier"].counts).toBe("failed attempts");
    expect(byKey["sign-in-ip"].counts).toBe("failed attempts");
    for (const key of [
      "reset-email",
      "reset-ip",
      "sign-up-email",
      "sign-up-ip",
      "pdf-preview",
      "pdf-attach",
    ]) {
      expect(byKey[key].counts).toBe("every request");
    }
  });

  it("describes the three different refusals accurately", () => {
    const byKey = Object.fromEntries(
      rateLimitRows().map((row) => [row.key, row]),
    );

    // Password reset is the one that stays silent -- if this row ever
    // claimed otherwise it would be describing an oracle the code
    // deliberately does not have.
    expect(byKey["reset-email"].whenExceeded).toMatch(/sends nothing/i);
    expect(byKey["sign-in-identifier"].whenExceeded).toMatch(/says so/i);
    expect(byKey["sign-up-email"].whenExceeded).toMatch(/says so/i);
    expect(byKey["pdf-preview"].whenExceeded).toMatch(/429/);
  });
});
