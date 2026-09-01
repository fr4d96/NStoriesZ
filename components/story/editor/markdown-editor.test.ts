import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  wrapSelection,
  toggleLinePrefix,
  insertTable,
  insertMediaToken,
} from "./markdown-editor";

// Headless: the toolbar drives plain-text transforms against a real
// EditorView, no React rendering needed -- same "closed-loop, no DOM"
// approach the previous Plate editor's own test file used.
function viewWithDoc(doc: string, selFrom: number, selTo = selFrom) {
  return new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor: selFrom, head: selTo },
    }),
  });
}

describe("wrapSelection", () => {
  it("wraps a selection with delimiters and keeps it selected", () => {
    const view = viewWithDoc("hello world", 0, 5);
    wrapSelection(view, "**", "**", "bold text");
    expect(view.state.doc.toString()).toBe("**hello** world");
    expect(
      view.state.sliceDoc(
        view.state.selection.main.from,
        view.state.selection.main.to,
      ),
    ).toBe("hello");
  });

  it("inserts a placeholder when there is no selection", () => {
    const view = viewWithDoc("", 0);
    wrapSelection(view, "*", "*", "italic text");
    expect(view.state.doc.toString()).toBe("*italic text*");
  });
});

describe("toggleLinePrefix", () => {
  it("adds the prefix to every selected line", () => {
    const view = viewWithDoc("one\ntwo", 0, 7);
    toggleLinePrefix(view, "- ");
    expect(view.state.doc.toString()).toBe("- one\n- two");
  });

  it("removes the prefix when every selected line already has it", () => {
    const view = viewWithDoc("- one\n- two", 0, 11);
    toggleLinePrefix(view, "- ");
    expect(view.state.doc.toString()).toBe("one\ntwo");
  });
});

describe("insertTable", () => {
  it("inserts a GFM table skeleton", () => {
    const view = viewWithDoc("", 0);
    insertTable(view);
    expect(view.state.doc.toString()).toContain("| Column 1 | Column 2 |");
    expect(view.state.doc.toString()).toContain("| --- | --- |");
  });
});

describe("insertMediaToken", () => {
  // A BLANK line either side, not a single newline. Consecutive non-blank
  // lines are ONE Markdown paragraph, so photos separated by single
  // newlines render as inline siblings and the published page packs as many
  // onto a row as fit -- while the editor drew one per row. Own paragraph
  // means "stacked" means the same thing in both places.
  it("inserts the ![[mediaId]] embed token as its own paragraph", () => {
    const view = viewWithDoc("Some text", 9);
    insertMediaToken(view, "11111111-1111-4111-8111-111111111111");
    expect(view.state.doc.toString()).toBe(
      "Some text\n\n![[11111111-1111-4111-8111-111111111111]]\n\n",
    );
  });

  it("stores a given width as the ![[mediaId|width]] embed token", () => {
    const view = viewWithDoc("Some text", 9);
    insertMediaToken(view, "11111111-1111-4111-8111-111111111111", 320);
    expect(view.state.doc.toString()).toBe(
      "Some text\n\n![[11111111-1111-4111-8111-111111111111|320]]\n\n",
    );
  });

  it("does not stack blank lines when one is already there", () => {
    const view = viewWithDoc("Some text\n\n", 11);
    insertMediaToken(view, "11111111-1111-4111-8111-111111111111");
    expect(view.state.doc.toString()).toBe(
      "Some text\n\n![[11111111-1111-4111-8111-111111111111]]\n\n",
    );
  });
});
