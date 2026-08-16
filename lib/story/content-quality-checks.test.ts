import { describe, expect, it } from "vitest";
import {
  runContentQualityChecks,
  type QualityCheckInput,
} from "@/lib/story/content-quality-checks";
import { markdownToStoryContent } from "@/lib/validation/story";

const longBodyText = Array.from(
  { length: 20 },
  (_, i) =>
    `This is sentence number ${i} describing a real day picking fruit in Hawke's Bay with plenty of ordinary detail about the work and the town.`,
).join("\n\n");

const baseInput: QualityCheckInput = {
  title: "A real story",
  contentBlocks: markdownToStoryContent(longBodyText),
  tripStartDate: "2023-01-01",
  tripEndDate: "2023-03-01",
  tripYear: 2023,
  hasRegion: true,
  hasTag: true,
  media: [],
};

function withExtra(extra: string) {
  return markdownToStoryContent(`${longBodyText}\n\n${extra}`);
}

describe("runContentQualityChecks", () => {
  it("returns no findings for a well-formed story", () => {
    expect(runContentQualityChecks(baseInput)).toEqual([]);
  });

  it("flags a short body as missing trip context", () => {
    const findings = runContentQualityChecks({
      ...baseInput,
      contentBlocks: markdownToStoryContent("Short story."),
    });
    expect(findings.map((f) => f.code)).toContain("missing_trip_context");
  });

  it("flags unclear dates when no date/year is set", () => {
    const findings = runContentQualityChecks({
      ...baseInput,
      tripStartDate: null,
      tripEndDate: null,
      tripYear: null,
    });
    expect(findings.map((f) => f.code)).toContain("unclear_dates");
  });

  it("flags missing region and missing tags independently", () => {
    const findings = runContentQualityChecks({
      ...baseInput,
      hasRegion: false,
      hasTag: false,
    });
    const codes = findings.map((f) => f.code);
    expect(codes).toContain("missing_region");
    expect(codes).toContain("missing_tags");
  });

  it("flags an absolute visa/employment claim", () => {
    const findings = runContentQualityChecks({
      ...baseInput,
      contentBlocks: withExtra(
        "Don't worry, your visa is guaranteed if you just apply early.",
      ),
    });
    expect(findings.map((f) => f.code)).toContain(
      "unsupported_visa_or_employment_claim",
    );
  });

  it("flags a specific street address", () => {
    const findings = runContentQualityChecks({
      ...baseInput,
      contentBlocks: withExtra(
        "We stayed at 42 Wellington Road the whole season.",
      ),
    });
    expect(findings.map((f) => f.code)).toContain(
      "exact_address_or_live_location",
    );
  });

  it("flags a live-location statement", () => {
    const findings = runContentQualityChecks({
      ...baseInput,
      contentBlocks: withExtra("I currently live at a hostel downtown."),
    });
    expect(findings.map((f) => f.code)).toContain(
      "exact_address_or_live_location",
    );
  });

  it("flags a potentially identifying email address", () => {
    const findings = runContentQualityChecks({
      ...baseInput,
      contentBlocks: withExtra(
        "Message me at traveller123@example.com for tips.",
      ),
    });
    expect(findings.map((f) => f.code)).toContain(
      "potentially_identifying_detail",
    );
  });

  it("flags an employer accusation", () => {
    const findings = runContentQualityChecks({
      ...baseInput,
      contentBlocks: withExtra(
        "The orchard refused to pay us for our final week.",
      ),
    });
    expect(findings.map((f) => f.code)).toContain(
      "employer_accusation_or_allegation",
    );
  });

  it("flags excessive promotional links", () => {
    const findings = runContentQualityChecks({
      ...baseInput,
      contentBlocks: withExtra(
        "[one](https://a.example) [two](https://b.example) [three](https://c.example)",
      ),
    });
    expect(findings.map((f) => f.code)).toContain(
      "excessive_promotional_links",
    );
  });

  it("does not flag two or fewer links", () => {
    const findings = runContentQualityChecks({
      ...baseInput,
      contentBlocks: withExtra(
        "[one](https://a.example) [two](https://b.example)",
      ),
    });
    expect(findings.map((f) => f.code)).not.toContain(
      "excessive_promotional_links",
    );
  });

  it("flags images missing alt text (non-decorative only)", () => {
    const findings = runContentQualityChecks({
      ...baseInput,
      media: [
        { altText: null, decorative: false, imageRightsConfirmed: true },
        { altText: null, decorative: true, imageRightsConfirmed: true },
      ],
    });
    expect(findings.map((f) => f.code)).toContain("images_missing_alt_text");
  });

  it("flags images with unresolved rights confirmation", () => {
    const findings = runContentQualityChecks({
      ...baseInput,
      media: [
        { altText: "A photo", decorative: false, imageRightsConfirmed: false },
      ],
    });
    expect(findings.map((f) => f.code)).toContain(
      "images_with_unresolved_rights",
    );
  });
});
