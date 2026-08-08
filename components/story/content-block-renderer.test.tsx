import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ContentBlockRenderer } from "@/components/story/content-block-renderer";
import type { StoryContentBlock } from "@/lib/validation/story";

// Regression coverage: this renderer is what actually shows on the preview
// and public story pages -- it's a separate component from the Plate
// editor, so a block type the editor can produce (e.g. "table") is only
// really supported once this renderer also has a case for it.
describe("ContentBlockRenderer", () => {
  it("renders a table block as a real <table>, including empty cells", () => {
    const blocks: StoryContentBlock[] = [
      {
        type: "table",
        rows: [
          [[{ text: "Item" }], [{ text: "Price" }]],
          [[{ text: "Coffee", marks: ["bold"] }], []],
        ],
      },
    ];

    render(<ContentBlockRenderer blocks={blocks} />);

    const table = screen.getByRole("table");
    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(2);
    expect(screen.getByText("Item")).toBeInTheDocument();
    expect(screen.getByText("Price")).toBeInTheDocument();
    expect(screen.getByText("Coffee").tagName).toBe("STRONG");
    // 4 cells total, including the one empty cell.
    expect(table.querySelectorAll("td")).toHaveLength(4);
  });

  it("renders an image block resolved against the media map, with decorative/alt handling", () => {
    const blocks: StoryContentBlock[] = [
      { type: "image", mediaId: "with-alt" },
      { type: "image", mediaId: "decorative" },
    ];

    render(
      <ContentBlockRenderer
        blocks={blocks}
        media={{
          "with-alt": {
            url: "https://example.com/a.jpg",
            altText: "A sunset",
            decorative: false,
          },
          decorative: {
            url: "https://example.com/b.jpg",
            altText: "ignored for decorative images",
            decorative: true,
          },
        }}
      />,
    );

    const images = screen.getAllByRole("img", { hidden: true });
    expect(images).toHaveLength(1); // the decorative one has alt="", so it isn't exposed as role=img
    expect(screen.getByAltText("A sunset")).toBeInTheDocument();
  });

  it("renders nothing for an image block whose mediaId isn't in the media map (e.g. detached after save)", () => {
    const blocks: StoryContentBlock[] = [
      { type: "image", mediaId: "gone" },
      { type: "paragraph", text: [{ text: "still here" }] },
    ];

    render(<ContentBlockRenderer blocks={blocks} media={{}} />);

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("still here")).toBeInTheDocument();
  });
});
