import { describe, expect, it } from "vitest";
import {
  contentDispositionAttachment,
  exportStatusLabel,
  travelStyleLabel,
  tripLabel,
} from "@/lib/story/story-export";

describe("exportStatusLabel", () => {
  it("calls an approved revision on a published story Published", () => {
    expect(exportStatusLabel("published", "approved")).toBe("Published");
  });

  it("never calls a draft update to a published story Published", () => {
    // get_story_preview() resolves to the DRAFT when one exists, so this is
    // the copy a contributor gets while an edit is in flight. Labelling it
    // "Published" would misrepresent what is actually live — the whole point
    // of Engineering Rule 11.
    expect(exportStatusLabel("published", "draft")).toBe(
      "Unpublished draft update",
    );
    expect(exportStatusLabel("published", "submitted")).toBe(
      "Update in review",
    );
  });

  it("labels a first-time story by its own revision state", () => {
    expect(exportStatusLabel("draft", "draft")).toBe("Draft");
    expect(exportStatusLabel("pending_review", "submitted")).toBe("In review");
    expect(exportStatusLabel("changes_requested", "changes_requested")).toBe(
      "Changes requested",
    );
    expect(exportStatusLabel("rejected", "rejected")).toBe("Not published");
  });

  it("falls back to Unpublished for a status it does not know", () => {
    // Adding to the story_revision_status enum must not silently produce a
    // PDF claiming to be published.
    expect(exportStatusLabel("published", "some_future_status")).toBe(
      "Unpublished",
    );
  });
});

describe("tripLabel", () => {
  it("prefers the date range", () => {
    expect(tripLabel("2025-03-01", "2026-02-28", 2025)).toBe(
      "2025-03-01 – 2026-02-28",
    );
  });

  it("falls back to the year, then to nothing", () => {
    expect(tripLabel(null, null, 2025)).toBe("2025");
    expect(tripLabel("2025-03-01", null, null)).toBeNull();
    expect(tripLabel(null, null, null)).toBeNull();
  });
});

describe("travelStyleLabel", () => {
  it("humanises the stored camelCase value", () => {
    expect(travelStyleLabel("midRange")).toBe("Mid range");
    expect(travelStyleLabel("budget")).toBe("Budget");
    expect(travelStyleLabel(null)).toBeNull();
  });
});

describe("contentDispositionAttachment", () => {
  it("emits an ASCII filename and a UTF-8 filename*", () => {
    expect(
      contentDispositionAttachment("a-year-2026-09-07.pdf", "Whangārei.pdf"),
    ).toBe(
      `attachment; filename="a-year-2026-09-07.pdf"; filename*=UTF-8''Whang%C4%81rei.pdf`,
    );
  });
});
