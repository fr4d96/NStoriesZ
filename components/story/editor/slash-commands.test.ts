import { describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { CompletionContext } from "@codemirror/autocomplete";

import {
  createSlashCommandSource,
  filterSlashCommands,
  matchSlashTrigger,
  slashCommands,
} from "./slash-commands";

// Headless, same style as markdown-editor.test.ts: the completion source and
// its apply() functions are driven against a real EditorView, no React.
function viewWithDoc(doc: string, pos: number) {
  return new EditorView({
    state: EditorState.create({ doc, selection: { anchor: pos } }),
  });
}

function completeAt(
  view: EditorView,
  pos: number,
  onRequestImages?: () => void,
) {
  const source = createSlashCommandSource({ onRequestImages });
  return source(new CompletionContext(view.state, pos, false));
}

describe("matchSlashTrigger", () => {
  it("matches a slash that starts the line's content", () => {
    expect(matchSlashTrigger("/")).toEqual({ indent: "", query: "" });
    expect(matchSlashTrigger("/head")).toEqual({ indent: "", query: "head" });
    expect(matchSlashTrigger("   /list")).toEqual({
      indent: "   ",
      query: "list",
    });
  });

  it("ignores a slash in the middle of a sentence", () => {
    // The whole point of anchoring to the line start: writing "24/7", a
    // date, or a URL must never pop a menu open mid-sentence.
    expect(matchSlashTrigger("open 24/7")).toBeNull();
    expect(matchSlashTrigger("see https://example.com/page")).toBeNull();
    expect(matchSlashTrigger("## /heading")).toBeNull();
  });
});

describe("filterSlashCommands", () => {
  const commands = slashCommands();

  it("returns everything for a bare slash", () => {
    expect(filterSlashCommands(commands, "")).toHaveLength(commands.length);
  });

  it("matches on key, on label and on alias", () => {
    expect(filterSlashCommands(commands, "head").map((c) => c.key)).toEqual([
      "heading",
    ]);
    expect(filterSlashCommands(commands, "check").map((c) => c.key)).toEqual([
      "todo",
    ]);
    expect(filterSlashCommands(commands, "bullet").map((c) => c.key)).toEqual([
      "list",
    ]);
  });

  it("returns nothing for a word that matches no command", () => {
    expect(filterSlashCommands(commands, "video")).toEqual([]);
  });
});

describe("createSlashCommandSource", () => {
  it("offers completions from the position of the slash", () => {
    const view = viewWithDoc("/", 1);
    const result = completeAt(view, 1);
    expect(result).not.toBeNull();
    expect(result?.from).toBe(0);
    expect(result?.options.length).toBeGreaterThan(0);
  });

  it("returns null mid-sentence", () => {
    const view = viewWithDoc("open 24/7", 9);
    expect(completeAt(view, 9)).toBeNull();
  });

  it("returns null when nothing matches, rather than an empty popup", () => {
    const view = viewWithDoc("/zzzz", 5);
    expect(completeAt(view, 5)).toBeNull();
  });

  it("only offers Photo when the editor can reach the Images panel", () => {
    const view = viewWithDoc("/photo", 6);
    expect(completeAt(view, 6)).toBeNull();
    const withPanel = completeAt(view, 6, () => {});
    expect(withPanel?.options.map((o) => o.label)).toEqual(["Photo"]);
  });

  it("labels every option with a human name, not the typed key", () => {
    const view = viewWithDoc("/", 1);
    const labels = completeAt(view, 1)?.options.map((o) => o.label);
    expect(labels).toContain("Heading");
    expect(labels).toContain("Bulleted list");
    expect(labels?.every((label) => !label.startsWith("/"))).toBe(true);
  });
});

describe("slash command apply()", () => {
  // Returns the resulting STATE, not the view: several of these commands
  // dispatch with `scrollIntoView: true`, which schedules a CodeMirror
  // measure that jsdom cannot service (Range#getClientRects is missing).
  // Destroying the view cancels that pending measure; leaking the view
  // instead surfaces as an unhandled error and a non-zero vitest exit.
  function applyByKey(doc: string, pos: number, key: string) {
    const view = viewWithDoc(doc, pos);
    const trigger = matchSlashTrigger(
      view.state.sliceDoc(view.state.doc.lineAt(pos).from, pos),
    );
    const command = slashCommands().find((c) => c.key === key);
    const from =
      view.state.doc.lineAt(pos).from + (trigger?.indent.length ?? 0);
    command?.apply(view, from, pos);
    const state = view.state;
    view.destroy();
    return state;
  }

  it("replaces the typed trigger with a heading marker", () => {
    const state = applyByKey("/head", 5, "heading");
    expect(state.doc.toString()).toBe("## ");
    expect(state.selection.main.head).toBe(3);
  });

  it("replaces the trigger with each list marker", () => {
    expect(applyByKey("/list", 5, "list").doc.toString()).toBe("- ");
    expect(applyByKey("/num", 4, "numbered").doc.toString()).toBe("1. ");
    expect(applyByKey("/todo", 5, "todo").doc.toString()).toBe("- [ ] ");
    expect(applyByKey("/quote", 6, "quote").doc.toString()).toBe("> ");
  });

  it("inserts a link skeleton with the placeholder text selected", () => {
    const state = applyByKey("/link", 5, "link");
    expect(state.doc.toString()).toBe("[link text](https://)");
    const { from, to } = state.selection.main;
    expect(state.sliceDoc(from, to)).toBe("link text");
  });

  it("clears the trigger before inserting a table", () => {
    const doc = applyByKey("/table", 6, "table").doc.toString();
    expect(doc).not.toContain("/table");
    expect(doc).toContain("| Column 1 | Column 2 |");
  });

  it("leaves the document untouched when Photo just points at the panel", () => {
    const onRequestImages = vi.fn();
    const view = viewWithDoc("/photo", 6);
    const command = slashCommands({ onRequestImages }).find(
      (c) => c.key === "photo",
    );
    command?.apply(view, 0, 6);
    expect(view.state.doc.toString()).toBe("");
    expect(onRequestImages).toHaveBeenCalledTimes(1);
    view.destroy();
  });

  it("keeps preceding text on the line when the slash is indented", () => {
    expect(applyByKey("Story\n  /list", 13, "list").doc.toString()).toBe(
      "Story\n  - ",
    );
  });
});
