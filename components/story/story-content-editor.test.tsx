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
    expect(screen.getByTitle("Bold (Ctrl/Cmd+B)")).toBeVisible();
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
    expect(screen.queryByTitle("Bold (Ctrl/Cmd+B)")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Markdown syntax guide/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("world").tagName).toBe("STRONG");
    expect(screen.queryByText(/\*\*world\*\*/)).not.toBeInTheDocument();
  });

  it("shows a live word count and reading time under the editor", () => {
    render(
      <StoryContentEditor
        initialContent={markdownToStoryContent("## Arrival\n\nOne two three")}
        onChange={() => {}}
      />,
    );
    // Markdown syntax is not counted: "Arrival One two three" is four words.
    expect(screen.getByText(/4 words/)).toBeInTheDocument();
    expect(screen.getByText(/1 min read/)).toBeInTheDocument();
  });

  it("offers a Photo route to the Images panel only when the page provides one", () => {
    const { rerender } = render(
      <StoryContentEditor
        initialContent={markdownToStoryContent("Hi")}
        onChange={() => {}}
      />,
    );
    expect(screen.queryByTitle(/Add a photo/)).not.toBeInTheDocument();

    rerender(
      <StoryContentEditor
        initialContent={markdownToStoryContent("Hi")}
        onChange={() => {}}
        onRequestImages={() => {}}
      />,
    );
    expect(screen.getByTitle(/Add a photo/)).toBeVisible();
  });

  describe("rich paste", () => {
    function pasteInto(container: HTMLElement, data: Record<string, string>) {
      const content = container.querySelector(".cm-content");
      if (!content) throw new Error("editor content not found");
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", {
        value: { getData: (type: string) => data[type] ?? "" },
      });
      act(() => {
        content.dispatchEvent(event);
      });
      return event;
    }

    it("converts pasted HTML into Markdown instead of dropping the formatting", () => {
      const onChange = vi.fn();
      const { container } = render(
        <StoryContentEditor
          initialContent={markdownToStoryContent("Start. ")}
          onChange={onChange}
        />,
      );

      pasteInto(container, {
        "text/html": "<h2>Otago</h2><p>I picked <strong>cherries</strong>.</p>",
        "text/plain": "Otago\nI picked cherries.",
      });

      const text = storyContentText(onChange.mock.calls.at(-1)?.[0]);
      expect(text).toContain("## Otago");
      expect(text).toContain("I picked **cherries**.");
    });

    it("leaves a plain-text paste to CodeMirror, unescaped and unconverted", () => {
      const onChange = vi.fn();
      const { container } = render(
        <StoryContentEditor
          initialContent={markdownToStoryContent("")}
          onChange={onChange}
        />,
      );

      pasteInto(container, { "text/plain": "**already markdown**" });

      const text = storyContentText(onChange.mock.calls.at(-1)?.[0]);
      expect(text).toBe("**already markdown**");
    });
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
