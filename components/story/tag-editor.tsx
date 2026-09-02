"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { RevisionTagSelection } from "@/lib/story/contributor-queries";
import type { ActiveTag } from "@/lib/story/active-lookups";
import { MAX_TAGS_PER_REVISION, TAG_MAX_LENGTH } from "@/lib/validation/story";
import { CloseIcon } from "@/components/icons";

/**
 * Tags are the platform's only story taxonomy (work types were retired
 * 2026-08-16), and a contributor may add as many as they like rather than
 * ticking a fixed list plus one "Other" box.
 *
 * Two ways in, deliberately kept apart (changed 2026-09-02, on a contributor
 * report that the old <datalist> "keeps showing a dropdown while I type"):
 *
 * - The TEXT BOX is for typing. It never opens, filters, or suggests
 *   anything -- type a label and press Enter (or comma, or "Add") and it
 *   becomes a removable chip. autoComplete="off" also stops the browser's
 *   own form-history popup, which was the other thing appearing over the
 *   field mid-sentence.
 * - The DROPDOWN BUTTON beside it is for browsing. Click it and the curated
 *   `tags` rows are listed to pick from; that list is never a ceiling on
 *   what can be entered.
 *
 * Everything enforced here is a fast, friendly mirror only:
 * set_revision_tags() independently resolves a typed label that names an
 * existing tag into a reference to that row, deduplicates case-insensitively,
 * and caps a revision at MAX_TAGS_PER_REVISION. The RPC is the boundary
 * (Engineering Rules 2/3); this component is the courtesy.
 */
export function TagEditor({
  selected,
  suggestions,
  onChange,
}: {
  selected: RevisionTagSelection[];
  suggestions: ActiveTag[];
  onChange: (next: RevisionTagSelection[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [browseOpen, setBrowseOpen] = useState(false);
  const inputId = useId();
  const listId = useId();
  const noticeId = useId();
  const browseRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  const atCap = selected.length >= MAX_TAGS_PER_REVISION;

  function addTag(rawLabel: string) {
    const label = rawLabel.trim().replace(/\s+/g, " ");
    if (!label) return;
    if (label.length > TAG_MAX_LENGTH) {
      setNotice(`Tags can be at most ${TAG_MAX_LENGTH} characters.`);
      return;
    }
    if (atCap) {
      setNotice(`You can add up to ${MAX_TAGS_PER_REVISION} tags to a story.`);
      return;
    }
    const folded = label.toLocaleLowerCase();
    if (selected.some((tag) => tag.name.toLocaleLowerCase() === folded)) {
      setNotice(`"${label}" is already on this story.`);
      setDraft("");
      return;
    }
    // Reuse over duplication: a label naming a curated tag is stored as a
    // reference to that row, so "Van life" and "van life" can't become two
    // different tags in the catalogue.
    const match = suggestions.find(
      (tag) => tag.name.toLocaleLowerCase() === folded,
    );
    setNotice(null);
    setDraft("");
    onChange([
      ...selected,
      match ? { id: match.id, name: match.name } : { id: null, name: label },
    ]);
  }

  function removeTag(index: number) {
    setNotice(null);
    onChange(selected.filter((_, i) => i !== index));
  }

  const unusedSuggestions = suggestions.filter(
    (tag) =>
      !selected.some(
        (chosen) =>
          chosen.name.toLocaleLowerCase() === tag.name.toLocaleLowerCase(),
      ),
  );

  // Close the browse list on a click anywhere outside it, the same way any
  // popover has to -- pointerdown rather than click, so the list is already
  // gone by the time the click lands on whatever was underneath it.
  useEffect(() => {
    if (!browseOpen) return;
    function onPointerDown(event: PointerEvent) {
      const container = browseRef.current;
      if (container && !container.contains(event.target as Node)) {
        setBrowseOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [browseOpen]);

  // Derived, not stored: the list has nothing to show once the last
  // suggestion has been taken or the cap is reached, so it simply stops
  // rendering rather than sitting open and empty (and rather than a
  // setState-in-effect that would fight the render it reacts to).
  const showBrowseList = browseOpen && !atCap && unusedSuggestions.length > 0;

  return (
    <fieldset>
      <legend className="text-sm font-medium">
        Tags
        {/* Same required-field marker as story-edit-form.tsx's Title/Story/
            Locations -- kept local rather than shared, since it's three
            lines and this component has no other dependency on that file.
            Enforced on the preview page's submit gate, not here. */}
        <span className="text-destructive">
          <span aria-hidden="true"> *</span>
          <span className="sr-only"> required</span>
        </span>
      </legend>
      <p className="mt-1 text-xs text-muted-foreground">
        What was this trip about — the work, the places, the practicalities.
        Type your own, or pick from the list. Up to {MAX_TAGS_PER_REVISION}.
      </p>

      {selected.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {selected.map((tag, index) => (
            <li key={`${tag.id ?? "custom"}-${tag.name}`}>
              <span className="inline-flex items-center gap-1 rounded-full bg-tag-background py-1 pl-3 pr-1 text-sm text-tag-foreground">
                {tag.name}
                <button
                  type="button"
                  onClick={() => removeTag(index)}
                  aria-label={`Remove tag ${tag.name}`}
                  className="inline-flex h-6 w-6 items-center justify-center rounded-full hover:bg-surface-muted"
                >
                  <CloseIcon className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label htmlFor={inputId} className="sr-only">
          Add a tag
        </label>
        <input
          id={inputId}
          type="text"
          // No list=, and autoComplete/autoCorrect off: typing in this box
          // must never pop anything open over what is being typed.
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          value={draft}
          disabled={atCap}
          maxLength={TAG_MAX_LENGTH}
          placeholder={atCap ? "Tag limit reached" : "Add a tag…"}
          aria-describedby={notice ? noticeId : undefined}
          onChange={(e) => {
            const value = e.target.value;
            // Comma is a separator, not a character in a tag label.
            if (value.endsWith(",")) {
              addTag(value.slice(0, -1));
              return;
            }
            setDraft(value);
            if (notice) setNotice(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              // This control lives inside a page-level form-ish layout with
              // no submit button, but stopping the default keeps Enter from
              // ever submitting anything.
              e.preventDefault();
              addTag(draft);
            } else if (e.key === "Backspace" && draft === "") {
              if (selected.length > 0) removeTag(selected.length - 1);
            }
          }}
          className="min-w-0 flex-1 rounded-md border border-border-subtle px-3 py-2 text-sm disabled:opacity-60 sm:flex-none sm:w-64 dark:bg-transparent"
        />

        <div className="relative" ref={browseRef}>
          <button
            type="button"
            ref={toggleRef}
            onClick={() => {
              setNotice(null);
              setBrowseOpen((open) => !open);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape" && showBrowseList) setBrowseOpen(false);
            }}
            disabled={atCap || unusedSuggestions.length === 0}
            aria-expanded={showBrowseList}
            aria-controls={listId}
            aria-haspopup="listbox"
            title={
              unusedSuggestions.length === 0
                ? "No suggested tags left to add"
                : "Choose from suggested tags"
            }
            className="inline-flex items-center gap-1.5 rounded-md border border-border-subtle px-3 py-2 text-sm font-medium disabled:opacity-50 hover:bg-surface-muted"
          >
            Choose tags
            <ChevronDownIcon open={showBrowseList} />
          </button>

          {showBrowseList && (
            <ul
              id={listId}
              role="listbox"
              aria-label="Suggested tags"
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setBrowseOpen(false);
                  toggleRef.current?.focus();
                }
              }}
              // Right-anchored: this button sits near the right edge of a
              // phone-width column, and a left-anchored panel ran off it.
              className="absolute right-0 z-20 mt-1 max-h-60 w-56 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-md border border-border-subtle bg-surface p-1 shadow-lg"
            >
              {unusedSuggestions.map((tag) => (
                <li key={tag.id} role="option" aria-selected={false}>
                  <button
                    type="button"
                    onClick={() => addTag(tag.name)}
                    className="w-full rounded px-3 py-2 text-left text-sm hover:bg-surface-muted"
                  >
                    {tag.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <button
          type="button"
          onClick={() => addTag(draft)}
          disabled={atCap || draft.trim() === ""}
          className="rounded-md border border-border-subtle px-3 py-2 text-sm font-medium disabled:opacity-50 hover:bg-surface-muted"
        >
          Add
        </button>
      </div>

      {notice && (
        <p
          id={noticeId}
          role="status"
          className="mt-1 text-xs text-muted-foreground"
        >
          {notice}
        </p>
      )}
    </fieldset>
  );
}

function ChevronDownIcon({ open }: { open: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
