import { describe, it, expect } from "vitest";
import {
  firstRegionLabel,
  stringList,
  regionNames,
  destinationNames,
} from "@/lib/story/card-fields";

describe("firstRegionLabel", () => {
  it("combines destination and region when both are present", () => {
    expect(
      firstRegionLabel([
        { region_name: "Otago", destination_name: "Queenstown" },
      ]),
    ).toBe("Queenstown, Otago");
  });

  it("falls back to just the region name when there's no destination", () => {
    expect(firstRegionLabel([{ region_name: "Otago" }])).toBe("Otago");
  });

  it("returns null for malformed input", () => {
    expect(firstRegionLabel(null)).toBeNull();
    expect(firstRegionLabel("not-an-array")).toBeNull();
    expect(firstRegionLabel([])).toBeNull();
    expect(firstRegionLabel([{}])).toBeNull();
  });
});

describe("stringList", () => {
  it("filters out non-string entries", () => {
    expect(stringList(["a", 1, null, "b"])).toEqual(["a", "b"]);
  });

  it("returns an empty array for malformed input", () => {
    expect(stringList(null)).toEqual([]);
    expect(stringList({ not: "an array" })).toEqual([]);
  });
});

describe("regionNames", () => {
  it("returns every region name a story is tagged with", () => {
    expect(
      regionNames([{ region_name: "Otago" }, { region_name: "Wellington" }]),
    ).toEqual(["Otago", "Wellington"]);
  });

  it("skips malformed entries", () => {
    expect(regionNames([{}, { region_name: "Otago" }, null])).toEqual([
      "Otago",
    ]);
  });

  it("returns an empty array for malformed input", () => {
    expect(regionNames("not-an-array")).toEqual([]);
  });
});

describe("destinationNames", () => {
  it("returns every destination name a story is tagged with", () => {
    expect(
      destinationNames([
        { region_name: "Otago", destination_name: "Queenstown" },
        { region_name: "Otago", destination_name: "Wanaka" },
      ]),
    ).toEqual(["Queenstown", "Wanaka"]);
  });

  it("skips locations that name only a region", () => {
    expect(
      destinationNames([
        { region_name: "Otago" },
        { region_name: "Otago", destination_name: "Queenstown" },
        { region_name: "Nelson", destination_name: null },
      ]),
    ).toEqual(["Queenstown"]);
  });

  it("returns an empty array for malformed input", () => {
    expect(destinationNames(null)).toEqual([]);
    expect(destinationNames("not-an-array")).toEqual([]);
  });
});
