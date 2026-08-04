import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FilterBar } from "./filter-bar";

const regions = [{ id: "r1", name: "Hawke's Bay" }];
const destinations = [{ id: "d1", name: "Hastings", regionId: "r1" }];
const workTypes = [{ id: "w1", name: "Fruit picking" }];
const tags = [{ id: "t1", name: "Rural" }];
const travelStyles = ["budget", "comfort"];

describe("FilterBar", () => {
  it("renders every filter field with its options", () => {
    render(
      <FilterBar
        regions={regions}
        destinations={destinations}
        workTypes={workTypes}
        tags={tags}
        travelStyles={travelStyles}
        current={{}}
      />,
    );

    expect(screen.getByLabelText(/search/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/region/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/destination/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/work type/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^tag$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/trip year/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/travel style/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/reported cost/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/cost availability/i)).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Hawke's Bay" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Fruit picking" }),
    ).toBeInTheDocument();
  });

  it("submits as a native GET form to /stories, never client-side fetch", () => {
    render(
      <FilterBar
        regions={regions}
        destinations={destinations}
        workTypes={workTypes}
        tags={tags}
        travelStyles={travelStyles}
        current={{}}
      />,
    );

    const form = screen
      .getByRole("button", { name: /apply filters/i })
      .closest("form");
    expect(form).toHaveAttribute("method", "get");
    expect(form).toHaveAttribute("action", "/stories");
  });

  it("the clear control links back to /stories with no filters carried over", () => {
    render(
      <FilterBar
        regions={regions}
        destinations={destinations}
        workTypes={workTypes}
        tags={tags}
        travelStyles={travelStyles}
        current={{ region: "r1", q: "apples" }}
      />,
    );

    expect(screen.getByRole("link", { name: /clear/i })).toHaveAttribute(
      "href",
      "/stories",
    );
  });
});
