import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TagEditor } from "./tag-editor";
import { MAX_TAGS_PER_REVISION } from "@/lib/validation/story";
import type { RevisionTagSelection } from "@/lib/story/contributor-queries";

const suggestions = [
  { id: "t1", name: "Van life", slug: "van-life" },
  { id: "t2", name: "Fruit picking", slug: "fruit-picking" },
];

function setup(selected: RevisionTagSelection[] = []) {
  const onChange = vi.fn();
  render(
    <TagEditor
      selected={selected}
      suggestions={suggestions}
      onChange={onChange}
    />,
  );
  return { onChange, input: screen.getByLabelText(/add a tag/i) };
}

describe("TagEditor", () => {
  it("adds a freely typed tag on Enter, with no lookup row behind it", async () => {
    const user = userEvent.setup();
    const { onChange, input } = setup();

    await user.type(input, "Ferry to Picton{Enter}");

    expect(onChange).toHaveBeenCalledWith([
      { id: null, name: "Ferry to Picton" },
    ]);
  });

  it("keeps accepting tags right up to the cap", async () => {
    const user = userEvent.setup();
    const nearCap: RevisionTagSelection[] = Array.from(
      { length: MAX_TAGS_PER_REVISION - 1 },
      (_, i) => ({ id: null, name: `Tag ${i}` }),
    );
    const { onChange, input } = setup(nearCap);

    expect(input).not.toBeDisabled();
    await user.type(input, "One more{Enter}");

    expect(onChange).toHaveBeenCalledWith([
      ...nearCap,
      { id: null, name: "One more" },
    ]);
  });

  it("stops accepting input at the cap rather than silently dropping tags", () => {
    const selected: RevisionTagSelection[] = Array.from(
      { length: MAX_TAGS_PER_REVISION },
      (_, i) => ({ id: null, name: `Tag ${i}` }),
    );
    const { input } = setup(selected);
    expect(input).toBeDisabled();
  });

  it("folds a typed label naming an existing tag into a reference to it, case-insensitively", async () => {
    const user = userEvent.setup();
    const { onChange, input } = setup();

    await user.type(input, "van LIFE{Enter}");

    expect(onChange).toHaveBeenCalledWith([{ id: "t1", name: "Van life" }]);
  });

  it("refuses a duplicate of an already-selected tag, whatever its casing", async () => {
    const user = userEvent.setup();
    const { onChange, input } = setup([{ id: "t1", name: "Van life" }]);

    await user.type(input, "VAN LIFE{Enter}");

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent(/already on/i);
  });

  it("removes a tag through its own labelled control", async () => {
    const user = userEvent.setup();
    const { onChange } = setup([
      { id: "t1", name: "Van life" },
      { id: null, name: "Ferry to Picton" },
    ]);

    await user.click(
      screen.getByRole("button", { name: "Remove tag Van life" }),
    );

    expect(onChange).toHaveBeenCalledWith([
      { id: null, name: "Ferry to Picton" },
    ]);
  });

  it("never offers an already-selected tag as a suggestion", () => {
    setup([{ id: "t1", name: "Van life" }]);
    const options = Array.from(
      document.querySelectorAll("datalist option"),
    ).map((o) => o.getAttribute("value"));
    expect(options).toEqual(["Fruit picking"]);
  });
});
