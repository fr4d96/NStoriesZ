import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AttributionChip } from "./attribution-chip";

/** The avatar circle: the chip's first span, rendered by ContributorAvatar. */
function avatar(container: HTMLElement): HTMLElement {
  const el = container.querySelector("span");
  if (!el) throw new Error("AttributionChip rendered no avatar");
  return el;
}

describe("AttributionChip", () => {
  it("renders the contributor's avatar emoji when the reader returned one", () => {
    const { container } = render(
      <AttributionChip name="KakiKu" avatarEmoji="🛶" />,
    );

    expect(avatar(container)).toHaveTextContent("🛶");
  });

  // The whole point of the change: the same contributor showed 🛶 on their
  // profile page and "K" on their own story cards, on the same screen.
  it("shows the same emoji the contributor's profile shows", () => {
    const { container } = render(
      <AttributionChip name="KakiKu" avatarEmoji="🛶" />,
    );

    expect(avatar(container).textContent).toBe("🛶");
    expect(avatar(container).textContent).not.toBe("K");
  });

  it("falls back to the initial letter when there is no emoji", () => {
    const { container } = render(
      <AttributionChip name="Kai Rahman" avatarEmoji={null} />,
    );

    expect(avatar(container)).toHaveTextContent("K");
  });

  // Callers that predate the emoji (and any that simply don't have one to
  // hand) must keep working rather than rendering an empty circle.
  it("falls back to the initial letter when avatarEmoji is omitted entirely", () => {
    const { container } = render(<AttributionChip name="Kai Rahman" />);

    expect(avatar(container)).toHaveTextContent("K");
  });

  // 20260910120000 returns null for a story published anonymously, so the
  // chip never has an emoji to render beside "Anonymous". This asserts the
  // rendered result of that contract, not the SQL.
  it("renders a plain letter for an anonymous story", () => {
    const { container } = render(
      <AttributionChip name="Anonymous" avatarEmoji={null} />,
    );

    expect(avatar(container)).toHaveTextContent("A");
  });

  it("still renders the name, destination and trip year alongside", () => {
    render(
      <AttributionChip
        name="KakiKu"
        avatarEmoji="🛶"
        destination="Bay of Plenty"
        tripYear={2024}
      />,
    );

    expect(screen.getByText("KakiKu")).toBeInTheDocument();
    expect(screen.getByText("Bay of Plenty")).toBeInTheDocument();
    expect(screen.getByText("2024")).toBeInTheDocument();
  });

  it("links to the contributor when a slug is given, and not otherwise", () => {
    const { rerender } = render(
      <AttributionChip name="KakiKu" contributorSlug="kakitest" />,
    );
    expect(screen.getByRole("link", { name: "KakiKu" })).toHaveAttribute(
      "href",
      "/contributors/kakitest",
    );

    rerender(<AttributionChip name="KakiKu" />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
