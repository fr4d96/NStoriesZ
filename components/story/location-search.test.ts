import { describe, expect, it } from "vitest";
import { matchLocation } from "./location-search";

const regions = [
  {
    id: "r-northland",
    name: "Northland",
    slug: "northland",
    islandOrGrouping: "North Island",
  },
  {
    id: "r-otago",
    name: "Otago",
    slug: "otago",
    islandOrGrouping: "South Island",
  },
];
const destinations = [
  {
    id: "d-queenstown",
    name: "Queenstown",
    slug: "queenstown",
    regionId: "r-otago",
  },
];

describe("matchLocation", () => {
  it("uses the destinations row when the place is one we seeded", () => {
    const match = matchLocation(
      { town: "Queenstown", state: "Otago" },
      regions,
      destinations,
      "Queenstown",
    );
    expect(match).toEqual({
      regionId: "r-otago",
      destinationId: "d-queenstown",
      // A real lookup row is the better record; the two are mutually
      // exclusive in the database.
      customDestinationLabel: null,
    });
  });

  it("keeps the place name when the map found it but we did not seed it", () => {
    // The case behind 10 of the 13 location rows recorded before this: the
    // region matched, the town did not, and the town name was thrown away.
    const match = matchLocation(
      { town: "Kaikohe", state: "Northland" },
      regions,
      destinations,
      "Kaikohe",
    );
    expect(match).toEqual({
      regionId: "r-northland",
      destinationId: null,
      customDestinationLabel: "Kaikohe",
    });
  });

  it("prefers the name that was clicked over a broader locality field", () => {
    // Real Nominatim behaviour: picking "Kaikohe" returns an address whose
    // most specific locality is the wider community, which is accurate and
    // not what anyone typed.
    const match = matchLocation(
      { suburb: "Kaikohe-Hokianga Community", state: "Northland" },
      regions,
      destinations,
      "Kaikohe",
    );
    expect(match?.customDestinationLabel).toBe("Kaikohe");
  });

  it("falls back to the address locality when no clicked name is given", () => {
    const match = matchLocation(
      { village: "Hikurangi", state: "Northland" },
      regions,
      destinations,
    );
    expect(match?.customDestinationLabel).toBe("Hikurangi");
  });

  it("returns null when even the region cannot be matched", () => {
    // Region is a closed set of 16; something outside New Zealand has no
    // home here, and the editor asks the contributor to pick manually.
    expect(
      matchLocation(
        { town: "Sydney", state: "New South Wales" },
        regions,
        destinations,
      ),
    ).toBeNull();
  });

  it("matches a region with no locality at all", () => {
    const match = matchLocation({ state: "Otago" }, regions, destinations);
    expect(match).toEqual({
      regionId: "r-otago",
      destinationId: null,
      // Region-only is valid and always has been.
      customDestinationLabel: null,
    });
  });
});
