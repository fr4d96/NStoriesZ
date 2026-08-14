import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { DestinationQuiz } from "@/components/home/destination-quiz";

const DESTINATION_NAMES = [
  "Auckland",
  "Wellington",
  "Canterbury",
  "Bay of Plenty",
  "Queenstown Lakes",
  "Central Otago",
];

function answerAll(labels: RegExp[]) {
  labels.forEach((label) => {
    fireEvent.click(screen.getByRole("button", { name: label }));
  });
}

describe("DestinationQuiz", () => {
  it("renders the first question with its emoji-labelled answers", () => {
    render(<DestinationQuiz />);
    expect(
      screen.getByText("Where would you feel most at home?"),
    ).toBeInTheDocument();
    const answers = screen.getAllByTestId("quiz-answer");
    expect(answers).toHaveLength(5);
    expect(
      screen.getByRole("button", { name: /A lively city/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("1 / 5")).toBeInTheDocument();
  });

  it("walks through all 5 questions and shows a hardcoded destination result", () => {
    render(<DestinationQuiz />);
    answerAll([
      /A lively city/,
      /Hospitality or café work/,
      /Meeting people/,
      /Busy and social/,
      /Summer/,
    ]);

    const heading = screen.getByRole("heading", { level: 3 });
    expect(DESTINATION_NAMES).toContain(heading.textContent);
    expect(screen.getByText("Best season")).toBeInTheDocument();
    expect(screen.getByText("Work")).toBeInTheDocument();
    expect(screen.getByText("Practical note")).toBeInTheDocument();
  });

  it("picks Canterbury when every answer points there", () => {
    render(<DestinationQuiz />);
    answerAll([
      /Open countryside/,
      /Farm work/,
      /Saving money/,
      /Independent and flexible/,
      /Spring/,
    ]);

    expect(
      screen.getByRole("heading", { level: 3, name: "Canterbury" }),
    ).toBeInTheDocument();
  });

  it("picks Queenstown Lakes when every answer points there", () => {
    render(<DestinationQuiz />);
    answerAll([
      /Mountains and alpine scenery/,
      /Ski-field work/,
      /Time outdoors/,
      /Active and physical/,
      /Winter/,
    ]);

    expect(
      screen.getByRole("heading", { level: 3, name: "Queenstown Lakes" }),
    ).toBeInTheDocument();
  });

  it("navigates back to the previous question", () => {
    render(<DestinationQuiz />);
    fireEvent.click(screen.getByRole("button", { name: /A lively city/ }));
    expect(screen.getByText("2 / 5")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "← Back" }));
    expect(screen.getByText("1 / 5")).toBeInTheDocument();
  });

  it("links the result's 'Explore stories' CTA to the in-page index anchor", () => {
    // The landing page's separate "discover" filter-grid section was folded
    // into the catalogue index (#index), which is now the page's only browse
    // surface -- see app/(public)/page.tsx.
    render(<DestinationQuiz />);
    answerAll([
      /Open countryside/,
      /Farm work/,
      /Saving money/,
      /Independent and flexible/,
      /Spring/,
    ]);

    expect(
      screen.getByRole("link", { name: "Explore stories" }),
    ).toHaveAttribute("href", "#index");
  });

  it("restarts the quiz from the result screen", () => {
    render(<DestinationQuiz />);
    answerAll([
      /Open countryside/,
      /Farm work/,
      /Saving money/,
      /Independent and flexible/,
      /Spring/,
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("1 / 5")).toBeInTheDocument();
    expect(
      screen.getByText("Where would you feel most at home?"),
    ).toBeInTheDocument();
  });
});
