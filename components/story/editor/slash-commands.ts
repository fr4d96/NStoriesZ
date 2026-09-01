/**
 * The `/` command menu: type a slash on an otherwise-empty line and pick a
 * block from a searchable list, the way Notion and Ghost's Koenig editor do
 * (see docs/editor-competitive-research.md).
 *
 * Built on `@codemirror/autocomplete` rather than a hand-rolled popup, on
 * purpose. Engineering Rule 19 requires anything added here to be fully
 * keyboard-operable and screen-reader-labelled, and CodeMirror's completion
 * tooltip already renders `role="listbox"` with `role="option"` children,
 * maintains `aria-selected` and drives `aria-activedescendant` /
 * `aria-autocomplete` / `aria-controls` on the editor itself -- the
 * WAI-ARIA combobox behaviour, with Arrow keys, Enter, Escape and
 * Ctrl-Space already bound. A bespoke menu would have had to reproduce all
 * of that, and that is exactly the kind of thing bespoke menus get wrong.
 *
 * The menu only ever offers blocks the Markdown content schema can already
 * express (Engineering Rule 6). It is not an extension point for new block
 * types.
 */
import { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
import type {
  Completion,
  CompletionContext,
  CompletionResult,
} from "@codemirror/autocomplete";

import { insertTable } from "./markdown-commands";

export type SlashCommandOptions = {
  /**
   * Called by the "Photo" entry. Images are never uploaded from inside the
   * editor -- image-upload-manager.tsx owns the whole reservation /
   * direct-to-storage / embed-token flow -- so this entry's only job is to
   * take the contributor to that panel instead of leaving them hunting for
   * it.
   */
  onRequestImages?: () => void;
};

export type SlashCommand = {
  /** Typed after the slash to filter, and the accessible option name. */
  key: string;
  label: string;
  detail: string;
  /** Extra words that should also match this command. */
  aliases?: string[];
  apply: (view: EditorView, from: number, to: number) => void;
};

/** Replaces the typed `/query` with `insert`, then puts the cursor after it. */
function replaceWith(
  view: EditorView,
  from: number,
  to: number,
  insert: string,
) {
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length },
    scrollIntoView: true,
  });
  view.focus();
}

/** Removes the typed `/query` and leaves the cursor where it was. */
function clearTrigger(view: EditorView, from: number, to: number) {
  view.dispatch({
    changes: { from, to, insert: "" },
    selection: { anchor: from },
  });
}

const LINK_PLACEHOLDER = "link text";

export function slashCommands(
  options: SlashCommandOptions = {},
): SlashCommand[] {
  const commands: SlashCommand[] = [
    {
      key: "heading",
      label: "Heading",
      detail: "A section title",
      aliases: ["h2", "title", "section"],
      apply: (view, from, to) => replaceWith(view, from, to, "## "),
    },
    {
      key: "subheading",
      label: "Smaller heading",
      detail: "A sub-section title",
      aliases: ["h3", "subtitle"],
      apply: (view, from, to) => replaceWith(view, from, to, "### "),
    },
    {
      key: "list",
      label: "Bulleted list",
      detail: "A list of points",
      aliases: ["bullet", "ul", "point"],
      apply: (view, from, to) => replaceWith(view, from, to, "- "),
    },
    {
      key: "numbered",
      label: "Numbered list",
      detail: "A list of steps, in order",
      aliases: ["ol", "ordered", "steps"],
      apply: (view, from, to) => replaceWith(view, from, to, "1. "),
    },
    {
      key: "todo",
      label: "Checklist",
      detail: "Tick-box items",
      aliases: ["task", "checkbox", "check"],
      apply: (view, from, to) => replaceWith(view, from, to, "- [ ] "),
    },
    {
      key: "quote",
      label: "Quote",
      detail: "Set a passage apart",
      aliases: ["blockquote"],
      apply: (view, from, to) => replaceWith(view, from, to, "> "),
    },
    {
      key: "link",
      label: "Link",
      detail: "Link some words to a page",
      aliases: ["url", "href"],
      apply: (view, from, to) => {
        const insert = `[${LINK_PLACEHOLDER}](https://)`;
        view.dispatch({
          changes: { from, to, insert },
          // Selects "link text" so the next keystroke replaces it.
          selection: EditorSelection.range(
            from + 1,
            from + 1 + LINK_PLACEHOLDER.length,
          ),
          scrollIntoView: true,
        });
        view.focus();
      },
    },
    {
      key: "table",
      label: "Table",
      detail: "A small grid of rows and columns",
      aliases: ["grid"],
      apply: (view, from, to) => {
        clearTrigger(view, from, to);
        insertTable(view);
      },
    },
  ];

  if (options.onRequestImages) {
    const onRequestImages = options.onRequestImages;
    commands.push({
      key: "photo",
      label: "Photo",
      detail: "Go to the Images panel to upload and place a photo",
      aliases: ["image", "picture", "img"],
      apply: (view, from, to) => {
        clearTrigger(view, from, to);
        onRequestImages();
      },
    });
  }

  return commands;
}

/**
 * Matches only a slash that starts the line's content -- `/` on an empty
 * line, or after nothing but indentation. That is what Ghost does ("type a
 * slash on an empty line"), and it is what keeps the menu from ambushing
 * someone typing "24/7", a date, or a URL mid-sentence.
 */
const TRIGGER_RE = /^([ \t]*)\/([\p{L}\p{N}]*)$/u;

export function matchSlashTrigger(
  lineText: string,
): { indent: string; query: string } | null {
  const match = TRIGGER_RE.exec(lineText);
  if (!match) return null;
  return { indent: match[1], query: match[2].toLowerCase() };
}

export function filterSlashCommands(
  commands: SlashCommand[],
  query: string,
): SlashCommand[] {
  if (query.length === 0) return commands;
  return commands.filter(
    (command) =>
      command.key.startsWith(query) ||
      command.label.toLowerCase().startsWith(query) ||
      (command.aliases ?? []).some((alias) => alias.startsWith(query)),
  );
}

/**
 * Narrower than CodeMirror's own `CompletionSource` (which also allows a
 * Promise) because this one never does async work -- everything it needs is
 * already in the document. Declaring that lets callers, and the tests, use
 * the result without unwrapping a union.
 */
export type SyncCompletionSource = (
  context: CompletionContext,
) => CompletionResult | null;

export function createSlashCommandSource(
  options: SlashCommandOptions = {},
): SyncCompletionSource {
  const commands = slashCommands(options);

  return (context: CompletionContext): CompletionResult | null => {
    const line = context.state.doc.lineAt(context.pos);
    const before = context.state.sliceDoc(line.from, context.pos);
    const trigger = matchSlashTrigger(before);
    if (!trigger) return null;

    const matches = filterSlashCommands(commands, trigger.query);
    if (matches.length === 0) return null;

    const from = line.from + trigger.indent.length;
    const options_: Completion[] = matches.map((command) => ({
      // `label` is what a screen reader announces for the option and what
      // CodeMirror shows; filtering is done above, so it can be the plain
      // human name rather than "/heading".
      label: command.label,
      detail: command.detail,
      apply: (
        view: EditorView,
        _completion: Completion,
        a: number,
        b: number,
      ) => command.apply(view, a, b),
    }));

    return {
      from,
      to: context.pos,
      options: options_,
      // Already filtered above (by key, label and aliases) -- letting
      // CodeMirror filter again on `label` alone would drop "/img" for
      // "Photo".
      filter: false,
    };
  };
}

/**
 * The popup's own styling.
 *
 * Required, not cosmetic: CodeMirror's built-in completion theme is split
 * into `&light` / `&dark` variants chosen by the `EditorView.darkTheme`
 * facet, and this editor deliberately sets `theme="none"` so it can inherit
 * the page's colours instead (see markdown-live-decorations.ts). That leaves
 * `darkTheme` false, so the `&light` rules apply — a white popup — while the
 * option text inherits the editor's own `currentColor`, which is near-white
 * in the app's dark mode. Verified in a browser before writing this: white
 * on white, every option after the selected one invisible.
 *
 * Painting both the background and the text from the app's own tokens fixes
 * it in both themes at once, and keeps the menu looking like the rest of the
 * product rather than like a code editor.
 */
export const slashMenuTheme = EditorView.baseTheme({
  ".cm-tooltip.cm-tooltip-autocomplete": {
    border: "1px solid var(--border-subtle)",
    borderRadius: "8px",
    backgroundColor: "var(--surface)",
    color: "var(--foreground)",
    boxShadow: "0 8px 24px rgb(0 0 0 / 0.18)",
    overflow: "hidden",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul": {
    fontFamily: "inherit",
    fontSize: "0.9rem",
    maxHeight: "15em",
    minWidth: "14em",
    maxWidth: "min(22em, 80vw)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li": {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: "0.75em",
    padding: "0.45em 0.7em",
    lineHeight: "1.35",
    color: "var(--foreground)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--accent)",
    color: "var(--accent-foreground)",
  },
  // The one-line explanation next to each command. CodeMirror italicises
  // and dims it by default; keep the dimming, drop the italics.
  ".cm-tooltip.cm-tooltip-autocomplete .cm-completionDetail": {
    fontStyle: "normal",
    fontSize: "0.85em",
    opacity: "0.7",
    textAlign: "right",
    whiteSpace: "normal",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected] .cm-completionDetail":
    {
      opacity: "0.85",
    },
});
