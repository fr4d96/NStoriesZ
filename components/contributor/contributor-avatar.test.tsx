import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ContributorAvatar } from "./contributor-avatar";

/** The rendered circle -- the component's only element. */
function avatar(container: HTMLElement): HTMLElement {
  const el = container.querySelector("span");
  if (!el) throw new Error("ContributorAvatar rendered no element");
  return el;
}

describe("ContributorAvatar", () => {
  it("shows the chosen emoji when there is one", () => {
    const { container } = render(
      <ContributorAvatar emoji="🛶" displayName="KakiKu" />,
    );

    expect(avatar(container)).toHaveTextContent("🛶");
  });

  it("prefers the emoji over the initial letter", () => {
    const { container } = render(
      <ContributorAvatar emoji="🥝" displayName="KakiKu" />,
    );

    expect(avatar(container).textContent).toBe("🥝");
  });

  it("falls back to the uppercased first letter when no emoji is set", () => {
    const { container } = render(
      <ContributorAvatar emoji={null} displayName="Kai Rahman" />,
    );

    expect(avatar(container)).toHaveTextContent("K");
  });

  // An empty string is what a form posts for "no avatar chosen", and it has
  // to behave like null rather than rendering an empty circle.
  it("treats an empty emoji string as unset", () => {
    const { container } = render(
      <ContributorAvatar emoji="" displayName="mei" />,
    );

    expect(avatar(container)).toHaveTextContent("M");
  });

  it("ignores leading whitespace in the name", () => {
    const { container } = render(
      <ContributorAvatar emoji={null} displayName="   Ana" />,
    );

    expect(avatar(container)).toHaveTextContent("A");
  });

  it.each(["   ", ""])(
    "falls back to '?' for the name %o with no emoji",
    (displayName) => {
      const { container } = render(
        <ContributorAvatar emoji={null} displayName={displayName} />,
      );

      expect(avatar(container)).toHaveTextContent("?");
    },
  );

  // Regression test: charAt(0) returns one UTF-16 code unit, so a name
  // starting outside the BMP yielded half a surrogate pair and rendered as
  // the replacement glyph.
  it("takes the first whole code point of the name, not the first code unit", () => {
    const { container } = render(
      <ContributorAvatar emoji={null} displayName="🦘 Kiri" />,
    );

    const text = avatar(container).textContent ?? "";
    expect(text).toBe("🦘");
    expect(Array.from(text)).toHaveLength(1);
  });

  // The letter and the emoji are both derived from identity that every call
  // site also renders as text beside them, so neither is announced.
  it.each([
    ["with an emoji", "🛶"],
    ["with a letter", null],
  ])("is hidden from assistive technology %s", (_label, emoji) => {
    const { container } = render(
      <ContributorAvatar emoji={emoji} displayName="KakiKu" />,
    );

    expect(avatar(container)).toHaveAttribute("aria-hidden", "true");
  });

  it("never shrinks inside a flex container", () => {
    const { container } = render(
      <ContributorAvatar emoji={null} displayName="KakiKu" />,
    );

    expect(avatar(container)).toHaveClass("shrink-0");
  });

  it("applies the caller's size classes over the default", () => {
    const { container } = render(
      <ContributorAvatar
        emoji={null}
        displayName="KakiKu"
        className="h-8 w-8 text-xs"
      />,
    );

    const el = avatar(container);
    expect(el).toHaveClass("h-8", "w-8", "text-xs");
    expect(el).not.toHaveClass("h-10");
  });
});
