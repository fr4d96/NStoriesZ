/**
 * The plain-text transforms the editor's toolbar, keyboard shortcuts and
 * slash-command menu all drive.
 *
 * Every operation manipulates raw Markdown syntax at the cursor/selection --
 * there is no document tree to keep in sync, unlike the Plate editor this
 * replaced. See markdown-live-decorations.ts for how that syntax then
 * renders live.
 *
 * Split out of markdown-editor.tsx so slash-commands.ts can use the same
 * transforms without importing a React client component (which would be a
 * module cycle). markdown-editor.tsx re-exports all four names, so the
 * original import path still works.
 */
import { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";

import { mediaEmbedToken } from "@/lib/story/markdown-media";

export function wrapSelection(
  view: EditorView,
  before: string,
  after: string,
  placeholder: string,
) {
  view.dispatch(
    view.state.changeByRange((range) => {
      const selectedText = range.empty
        ? placeholder
        : view.state.sliceDoc(range.from, range.to);
      return {
        changes: {
          from: range.from,
          to: range.to,
          insert: `${before}${selectedText}${after}`,
        },
        range: EditorSelection.range(
          range.from + before.length,
          range.from + before.length + selectedText.length,
        ),
      };
    }),
  );
  view.focus();
}

function selectedLineNumbers(view: EditorView): number[] {
  const nums = new Set<number>();
  for (const range of view.state.selection.ranges) {
    const startLine = view.state.doc.lineAt(range.from).number;
    const endLine = view.state.doc.lineAt(range.to).number;
    for (let n = startLine; n <= endLine; n++) nums.add(n);
  }
  return [...nums].sort((a, b) => a - b);
}

export function toggleLinePrefix(view: EditorView, prefix: string) {
  const lines = selectedLineNumbers(view).map((n) => view.state.doc.line(n));
  const allHavePrefix = lines.every((line) => line.text.startsWith(prefix));
  const changes = lines.map((line) =>
    allHavePrefix
      ? { from: line.from, to: line.from + prefix.length }
      : line.text.startsWith(prefix)
        ? { from: line.from, to: line.from }
        : { from: line.from, insert: prefix },
  );
  view.dispatch(view.state.update({ changes }));
  view.focus();
}

export function insertTable(view: EditorView) {
  const pos = view.state.selection.main.to;
  const needsLeadingNewline =
    pos > 0 && view.state.sliceDoc(pos - 1, pos) !== "\n";
  const table = `${needsLeadingNewline ? "\n" : ""}\n| Column 1 | Column 2 |\n| --- | --- |\n|  |  |\n`;
  view.dispatch({
    changes: { from: pos, insert: table },
    selection: { anchor: pos + table.length },
  });
  view.focus();
}

export function insertMediaToken(
  view: EditorView,
  mediaId: string,
  width?: number,
) {
  const pos = view.state.selection.main.to;
  const needsLeadingNewline =
    pos > 0 && view.state.sliceDoc(pos - 1, pos) !== "\n";
  const insert = `${needsLeadingNewline ? "\n" : ""}${mediaEmbedToken(mediaId, width)}\n`;
  view.dispatch({
    changes: { from: pos, insert },
    selection: { anchor: pos + insert.length },
  });
  view.focus();
}
