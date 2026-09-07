import { describe, expect, it } from "vitest";
import {
  canExportStory,
  contentDispositionAttachment,
  exportStatusLabel,
  travelStyleLabel,
  tripLabel,
} from "@/lib/story/story-export";

describe("canExportStory", () => {
  it("refuses a plain, never-submitted draft", () => {
    // The only state with nothing finished to take a copy of. The
    // contributor has the editor open on it anyway.
    expect(canExportStory("draft", "draft")).toBe(false);
  });

  it("allows a story that is with a moderator", () => {
    expect(canExportStory("pending_review", "submitted")).toBe(true);
  });

  it("allows a published story", () => {
    expect(canExportStory("published", "approved")).toBe(true);
  });

  it("allows a published story that is being edited again", () => {
    // Looks like a draft (get_story_preview() resolves to the in-flight
    // revision) but the story itself has been submitted and published.
    // exportStatusLabel() has a name for exactly this state, so refusing
    // here would make that name unreachable.
    expect(canExportStory("published", "draft")).toBe(true);
    expect(exportStatusLabel("published", "draft")).toBe(
      "Unpublished draft update",
    );
  });

  it("allows a private story, whose revision stays a draft forever", () => {
    // Staying `draft` is the mechanism that keeps a private story out of
    // moderation and its images out of public delivery -- not a sign it is
    // unfinished. It is a completed story its author chose to keep, which
    // makes keeping a copy of it the strongest case there is.
    expect(canExportStory("private", "draft")).toBe(true);
    expect(exportStatusLabel("private", "draft")).toBe("Private");
  });

  it("allows the states a moderator or the contributor closed", () => {
    expect(canExportStory("changes_requested", "changes_requested")).toBe(true);
    expect(canExportStory("rejected", "rejected")).toBe(true);
    expect(canExportStory("archived", "approved")).toBe(true);
  });

  it("allows an editor-prepared story awaiting the contributor's approval", () => {
    // Not submitted by the contributor yet, but it is a finished thing an
    // editor is asking them to read carefully -- exactly when having a copy
    // helps.
    expect(canExportStory("awaiting_contributor_approval", "draft")).toBe(true);
  });
});

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

  it("calls a private story Private, not Draft", () => {
    // A private story's revision stays 'draft' forever — that is what keeps
    // it out of the moderation queue and its images out of public delivery.
    // Without this case the PDF would say "Draft", which reads as unfinished
    // work waiting to be submitted rather than a deliberate choice, in the
    // one place there is no app around the label to correct it.
    expect(exportStatusLabel("private", "draft")).toBe("Private");
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
