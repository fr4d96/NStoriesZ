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
  it("shows the uppercased first letter of the display name", () => {
    const { container } = render(<ContributorAvatar name="Kai Rahman" />);

    expect(avatar(container)).toHaveTextContent("K");
  });

  it("uppercases a lowercase name", () => {
    const { container } = render(<ContributorAvatar name="mei" />);

    expect(avatar(container)).toHaveTextContent("M");
  });

  it("ignores leading whitespace", () => {
    const { container } = render(<ContributorAvatar name="   Ana" />);

    expect(avatar(container)).toHaveTextContent("A");
  });

  it("falls back to '?' for a whitespace-only name", () => {
    const { container } = render(<ContributorAvatar name="   " />);

    expect(avatar(container)).toHaveTextContent("?");
  });

  it("falls back to '?' for an empty name", () => {
    const { container } = render(<ContributorAvatar name="" />);

    expect(avatar(container)).toHaveTextContent("?");
  });

  // Regression test for the bug carried by all three copy-pasted originals:
  // charAt(0) returns one UTF-16 code unit, so a name starting outside the
  // BMP yielded half a surrogate pair and rendered as the replacement glyph.
  it("takes the first whole code point, not the first UTF-16 code unit", () => {
    const { container } = render(<ContributorAvatar name="🦘 Kiri" />);

    const text = avatar(container).textContent ?? "";
    expect(text).toBe("🦘");
    expect(Array.from(text)).toHaveLength(1);
  });

  // The directory card had dropped this; the other two surfaces had it. The
  // letter is derived from a display name that every call site also renders
  // as text, so announcing it is duplication.
  it.each(["sm", "md", "lg"] as const)(
    "is hidden from assistive technology at size %s",
    (size) => {
      const { container } = render(
        <ContributorAvatar name="Kai Rahman" size={size} />,
      );

      expect(avatar(container)).toHaveAttribute("aria-hidden", "true");
    },
  );

  // Only the attribution chip had shrink-0, but every call site sits in a
  // flex container next to text that can be long.
  it("never shrinks inside a flex container", () => {
    const { container } = render(<ContributorAvatar name="Kai Rahman" />);

    expect(avatar(container)).toHaveClass("shrink-0");
  });

  it.each([
    ["sm", "h-8"],
    ["md", "h-10"],
    ["lg", "h-16"],
  ] as const)("renders size %s at %s", (size, expected) => {
    const { container } = render(
      <ContributorAvatar name="Kai Rahman" size={size} />,
    );

    expect(avatar(container)).toHaveClass(expected);
  });

  it("defaults to the medium size", () => {
    const { container } = render(<ContributorAvatar name="Kai Rahman" />);

    expect(avatar(container)).toHaveClass("h-10");
  });

  it("appends a caller's className", () => {
    const { container } = render(
      <ContributorAvatar name="Kai Rahman" className="ring-2" />,
    );

    expect(avatar(container)).toHaveClass("ring-2");
  });
});
