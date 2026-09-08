import { describe, expect, it } from "vitest";
import {
  RESERVED_USERNAMES,
  USERNAME_PATTERN,
  usernameSchema,
} from "./username";

describe("usernameSchema", () => {
  it("accepts a well-formed username", () => {
    expect(usernameSchema.safeParse("casey-nz_24").success).toBe(true);
  });

  it("normalises case and surrounding whitespace", () => {
    const result = usernameSchema.safeParse("  Casey-NZ  ");
    expect(result.success && result.data).toBe("casey-nz");
  });

  it("rejects a username that is too short or too long", () => {
    expect(usernameSchema.safeParse("ab").success).toBe(false);
    expect(usernameSchema.safeParse("a".repeat(31)).success).toBe(false);
  });

  it("rejects a username that does not start with a letter or number", () => {
    expect(usernameSchema.safeParse("-casey").success).toBe(false);
    expect(usernameSchema.safeParse("_casey").success).toBe(false);
  });

  it("rejects characters outside the allowed set, including '@'", () => {
    expect(usernameSchema.safeParse("casey nz").success).toBe(false);
    expect(usernameSchema.safeParse("casey.nz").success).toBe(false);
    expect(usernameSchema.safeParse("casey@nz").success).toBe(false);
  });

  it("rejects every reserved username", () => {
    for (const reserved of RESERVED_USERNAMES) {
      expect(usernameSchema.safeParse(reserved).success).toBe(false);
    }
  });

  it("rejects a reserved username typed in mixed case", () => {
    // The normalisation runs before the refine, so "Admin" cannot slip past
    // the reserved list the way a naive check would let it.
    expect(usernameSchema.safeParse("Admin").success).toBe(false);
    expect(usernameSchema.safeParse("  MODERATOR  ").success).toBe(false);
  });

  it("keeps every reserved name inside the allowed pattern", () => {
    // A reserved word that the pattern already rejects would be dead weight
    // in both this list and the matching DB CHECK.
    for (const reserved of RESERVED_USERNAMES) {
      expect(USERNAME_PATTERN.test(reserved)).toBe(true);
    }
  });
});
