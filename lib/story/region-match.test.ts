import { describe, it, expect } from "vitest";
import { matchRegion } from "@/lib/story/region-match";

describe("matchRegion", () => {
  it("returns null when there are no stories", () => {
    expect(matchRegion([], [{ workType: "Viticulture" }])).toBeNull();
  });

  it("returns null when nothing matches the given signals", () => {
    const stories = [
      {
        regions: [{ region_name: "Otago" }],
        work_types: ["Hospitality"],
        tags: [],
      },
    ];
    expect(matchRegion(stories, [{ workType: "Construction" }])).toBeNull();
  });

  it("picks the region with the most matching stories", () => {
    const stories = [
      {
        regions: [{ region_name: "Otago" }],
        work_types: ["Viticulture"],
        tags: [],
      },
      {
        regions: [{ region_name: "Otago" }],
        work_types: ["Viticulture"],
        tags: [],
      },
      {
        regions: [{ region_name: "Wellington" }],
        work_types: ["Viticulture"],
        tags: [],
      },
    ];
    const result = matchRegion(stories, [{ workType: "Viticulture" }]);
    expect(result?.regionName).toBe("Otago");
    expect(result?.storyCount).toBe(2);
  });

  it("scores tag and work-type signals together", () => {
    const stories = [
      {
        regions: [{ region_name: "Bay of Plenty" }],
        work_types: ["Horticulture"],
        tags: ["Fruit picking", "Seasonal work"],
      },
      {
        regions: [{ region_name: "Canterbury" }],
        work_types: ["Horticulture"],
        tags: [],
      },
    ];
    const result = matchRegion(stories, [
      { workType: "Horticulture" },
      { tag: "Fruit picking" },
    ]);
    expect(result?.regionName).toBe("Bay of Plenty");
  });

  it("reports the region's most common work type", () => {
    const stories = [
      {
        regions: [{ region_name: "Otago" }],
        work_types: ["Viticulture"],
        tags: [],
      },
      {
        regions: [{ region_name: "Otago" }],
        work_types: ["Viticulture"],
        tags: [],
      },
      {
        regions: [{ region_name: "Otago" }],
        work_types: ["Tourism"],
        tags: [],
      },
    ];
    const result = matchRegion(stories, [
      { workType: "Viticulture" },
      { workType: "Tourism" },
    ]);
    expect(result?.topWorkType).toBe("Viticulture");
  });

  it("ignores stories with no region", () => {
    const stories = [{ regions: [], work_types: ["Viticulture"], tags: [] }];
    expect(matchRegion(stories, [{ workType: "Viticulture" }])).toBeNull();
  });

  it("ignores malformed regions/work_types/tags without throwing", () => {
    const stories = [
      { regions: "not-an-array", work_types: null, tags: { nope: true } },
    ];
    expect(() =>
      matchRegion(stories, [{ workType: "Viticulture" }]),
    ).not.toThrow();
  });
});
