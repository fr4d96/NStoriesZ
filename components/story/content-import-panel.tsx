"use client";

import { useState } from "react";
import type { StoryContentBlock } from "@/lib/validation/story";
import type { ImportReport } from "@/lib/story/content-import";
import { ContentBlockRenderer } from "@/components/story/content-block-renderer";
import { importStoryContentAction } from "@/app/(editor)/editorial/import-actions";

const ERROR_MESSAGES: Record<string, string> = {
  input_too_large:
    "That's too much text to import at once — try a smaller section.",
  too_many_nodes:
    "This HTML is too complex to import — try a smaller/simpler section.",
  too_deeply_nested:
    "This HTML is nested too deeply to import — try a smaller/simpler section.",
  empty_content: "No usable content was found in that text.",
  invalid_content:
    "The converted content didn't pass validation — try a smaller/simpler section.",
  unauthorized: "You're not authorized to import content.",
  invalid_input: "Invalid input.",
};

export type ContentImportPanelProps = {
  /**
   * Performs the actual destructive replace on the story-edit-form's
   * "fields" mutation slot. Only resolves `{ ok: true }` after a
   * successful save -- the panel only clears its own preview state on
   * success, so a failed apply can be retried without re-pasting.
   */
  onApply: (
    blocks: StoryContentBlock[],
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  disabled?: boolean;
};

export function ContentImportPanel({
  onApply,
  disabled,
}: ContentImportPanelProps) {
  const [format, setFormat] = useState<"plain" | "html">("plain");
  const [rawInput, setRawInput] = useState("");
  const [converting, setConverting] = useState(false);
  const [applying, setApplying] = useState(false);
  const [preview, setPreview] = useState<{
    blocks: StoryContentBlock[];
    report: ImportReport;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);

  async function handlePreview() {
    setConverting(true);
    setError(null);
    setPreview(null);
    setApplyError(null);
    try {
      const result = await importStoryContentAction({
        format,
        content: rawInput,
      });
      if (result.ok) {
        setPreview({ blocks: result.blocks, report: result.report });
      } else {
        setError(
          ERROR_MESSAGES[result.error] ?? "Could not convert this content.",
        );
      }
    } catch {
      // The Server Action call itself failed at the network/framework
      // layer -- most notably, a request whose body exceeds Next's own
      // Server Action body-size ceiling (next.config.ts's
      // experimental.serverActions.bodySizeLimit) never reaches
      // importStoryContentAction()'s own MAX_IMPORT_INPUT_BYTES check at
      // all. Handled explicitly here so this is a clear, recoverable
      // message rather than a silent failure (setConverting(false) alone,
      // with no catch, would leave the user with no feedback at all).
      setError(
        "That request couldn't be sent — try pasting a smaller amount of text.",
      );
    } finally {
      setConverting(false);
    }
  }

  async function handleUseThisContent() {
    if (!preview) return;
    setApplying(true);
    setApplyError(null);
    try {
      const result = await onApply(preview.blocks);
      if (result.ok) {
        // Only clear on success -- a failure keeps the converted blocks
        // around so the editor can retry without re-pasting/re-parsing.
        setPreview(null);
        setRawInput("");
      } else {
        setApplyError(result.error);
      }
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="rounded-md border border-border-subtle p-4">
      <h2 className="text-sm font-semibold">Import content</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Paste plain text or rich HTML from the contributor&apos;s original
        submission. Preview the conversion before using it — this replaces the
        story body below.
      </p>

      <div className="mt-3 flex gap-4 text-sm">
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            checked={format === "plain"}
            onChange={() => setFormat("plain")}
          />
          Plain text
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            checked={format === "html"}
            onChange={() => setFormat("html")}
          />
          HTML
        </label>
      </div>

      <textarea
        value={rawInput}
        onChange={(e) => setRawInput(e.target.value)}
        rows={8}
        placeholder={
          format === "html" ? "<p>Pasted HTML…</p>" : "Pasted plain text…"
        }
        className="mt-2 w-full rounded-md border border-border-subtle px-3 py-2 font-mono text-xs dark:bg-transparent"
      />

      <button
        type="button"
        onClick={handlePreview}
        disabled={converting || rawInput.trim().length === 0 || disabled}
        className="mt-2 rounded-md border border-border-subtle px-3 py-1.5 text-sm font-medium disabled:opacity-60"
      >
        {converting ? "Converting…" : "Preview conversion"}
      </button>

      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {preview && (
        <div className="mt-4 space-y-3">
          <div className="rounded-md border border-border-subtle bg-black/[0.02] p-3 text-xs dark:bg-white/[0.03]">
            <p>{preview.report.blocksProduced} block(s) produced.</p>
            {preview.report.convertedTables > 0 && (
              <p>
                {preview.report.convertedTables} table(s) converted to plain
                text.
              </p>
            )}
            {preview.report.convertedCodeBlocks > 0 && (
              <p>
                {preview.report.convertedCodeBlocks} code block(s) converted to
                plain text.
              </p>
            )}
            {Object.keys(preview.report.droppedElements).length > 0 && (
              <p>
                Removed as unsafe:{" "}
                {Object.entries(preview.report.droppedElements)
                  .map(([tag, count]) => `${tag} (${count})`)
                  .join(", ")}
              </p>
            )}
            {Object.keys(preview.report.unsupportedElements).length > 0 && (
              <p>
                Not convertible (skipped):{" "}
                {Object.entries(preview.report.unsupportedElements)
                  .map(([tag, count]) => `${tag} (${count})`)
                  .join(", ")}
              </p>
            )}
            {preview.report.unsafeLinksRemovedCount > 0 && (
              <p>
                {preview.report.unsafeLinksRemovedCount} unsafe link(s) had
                their link removed (text kept).
              </p>
            )}
          </div>

          <div className="max-h-64 overflow-y-auto rounded-md border border-border-subtle p-3">
            <ContentBlockRenderer blocks={preview.blocks} />
          </div>

          <button
            type="button"
            onClick={handleUseThisContent}
            disabled={applying || disabled}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-accent-foreground disabled:opacity-60"
          >
            {applying ? "Applying…" : "Use this content"}
          </button>
          {applyError && (
            <p role="alert" className="text-sm text-destructive">
              {applyError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
