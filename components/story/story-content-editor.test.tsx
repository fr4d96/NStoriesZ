import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { createRef } from "react";
import {
  StoryContentEditor,
  type StoryContentEditorHandle,
} from "./story-content-editor";
import {
  markdownToStoryContent,
  storyContentText,
} from "@/lib/validation/story";

describe("StoryContentEditor", () => {
  it("renders a single live-editing surface (no Read/Write toggle) with its toolbar and a Markdown guide link", () => {
    render(
      <StoryContentEditor
        initialContent={markdownToStoryContent("Hello world")}
        onChange={() => {}}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Read" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Write" }),
    ).not.toBeInTheDocument();
    expect(screen.getByTitle("Bold (**text**)")).toBeVisible();
    expect(screen.getByText(/Hello world/)).toBeInTheDocument();

    const guideLink = screen.getByRole("link", {
      name: /Markdown syntax guide/,
    });
    expect(guideLink).toHaveAttribute(
      "href",
      "https://www.markdownguide.org/cheat-sheet/",
    );
    expect(guideLink).toHaveAttribute("target", "_blank");
    expect(guideLink).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renders the fully-rendered view (no toolbar, no raw syntax) when not editable", () => {
    render(
      <StoryContentEditor
        initialContent={markdownToStoryContent("Hello **world**")}
        onChange={() => {}}
        editable={false}
      />,
    );
    expect(screen.queryByTitle("Bold (**text**)")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Markdown syntax guide/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("world").tagName).toBe("STRONG");
    expect(screen.queryByText(/\*\*world\*\*/)).not.toBeInTheDocument();
  });

  it("replaceContent() imperatively swaps the document and fires onChange with the new blocks", () => {
    const handle = createRef<StoryContentEditorHandle>();
    const onChange = vi.fn();
    render(
      <StoryContentEditor
        ref={handle}
        initialContent={markdownToStoryContent("Old text")}
        onChange={onChange}
      />,
    );

    act(() => {
      handle.current?.replaceContent(markdownToStoryContent("New text"));
    });

    expect(screen.getByText(/New text/)).toBeInTheDocument();
    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls.at(-1)?.[0];
    expect(storyContentText(lastCall)).toBe("New text");
  });
});
