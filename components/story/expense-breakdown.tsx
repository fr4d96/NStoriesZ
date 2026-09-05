"use client";

import { useId, useMemo, useState } from "react";
import type { ActiveExpenseCategory } from "@/lib/story/active-lookups";
import { EXPENSE_NOTE_MAX_LENGTH } from "@/lib/validation/story";
import { formatNzdCents } from "@/lib/story/expense-per-month";
import { CloseIcon } from "@/components/icons";

/**
 * One row of the optional expense breakdown, as the FORM holds it: amounts
 * are the raw strings the contributor is typing, not numbers. Parsing to
 * cents happens through expenseRowsToPayload() below, using the same
 * `Math.round(Number(x) * 100)` the headline total uses, so the two numbers
 * on screen can never round differently.
 *
 * A row is EITHER a curated category (categoryId set) OR one the contributor
 * named themselves (categoryId null) -- the same either/or shape
 * story_revision_tags has used since 20260812110000, and the database
 * enforces it with a CHECK.
 *
 * `name` travels with the row rather than being looked up from `categories`
 * each render, because a curated category can be retired (`active = false`)
 * while stories still reference it: it would be missing from the options
 * list and the row would render nameless.
 */
export type ExpenseDraftRow = {
  /** Null for a row whose category the contributor typed themselves. */
  categoryId: string | null;
  /** The curated category's name, or the typed one. Always displayable. */
  name: string;
  slug: string | null;
  amountDollars: string;
  note: string;
};

/**
 * Five rows, hard cap.
 *
 * A breakdown is a summary, not a ledger -- past a handful of lines it stops
 * being scannable, and the donut beside it caps at six slices for the same
 * reason. Capping also bounds how much contributor-typed vocabulary can
 * accumulate now that categories are no longer a closed set.
 *
 * set_revision_expenses() re-applies this server-side, truncating rather
 * than raising (an autosave should not start erroring because a client sent
 * one row too many) -- so this constant is the courtesy, not the boundary.
 */
export const MAX_EXPENSE_ROWS = 5;

/** How long a contributor-typed category name may be. Matches the CHECK. */
export const EXPENSE_LABEL_MAX_LENGTH = 60;

/**
 * The curated category whose row gets a free-text note in place of a fixed
 * description. Contributor-typed rows get one too -- see the row markup.
 */
const NOTE_CATEGORY_SLUG = "other";

/** A row the contributor named themselves. */
function isCustomRow(row: ExpenseDraftRow): boolean {
  return row.categoryId === null;
}

/**
 * Draft rows -> the payload set_revision_expenses() takes. The ONLY place
 * the form converts an expense row for saving.
 *
 * Every rule here is re-applied independently by the RPC (Engineering Rules
 * 2/3 -- this is the courtesy, that is the boundary):
 *
 *  - An EMPTY amount drops the row. `Number("")` is 0, not NaN, so without
 *    this an untouched row would be stored as a confident "$0.00". "I
 *    didn't record it" and "it cost nothing" are different claims, and a
 *    fake zero corrupts every future average across stories.
 *  - A part-typed or nonsense amount ("-", "1e", "abc") drops the row rather
 *    than saving garbage; the next keystroke that makes it a number brings
 *    it straight back.
 *  - A negative is clamped to 0, so a stray minus sign cannot make an
 *    autosave start erroring mid-typing.
 *  - A custom row with no label yet is dropped: it has nothing to store, and
 *    the database CHECK would reject (null, null) anyway.
 *  - At most MAX_EXPENSE_ROWS rows.
 */
export function expenseRowsToPayload(rows: ExpenseDraftRow[]): Array<{
  categoryId: string | null;
  customLabel: string | null;
  amountNzdCents: number;
  note: string | null;
}> {
  const payload: Array<{
    categoryId: string | null;
    customLabel: string | null;
    amountNzdCents: number;
    note: string | null;
  }> = [];
  for (const row of rows) {
    if (payload.length >= MAX_EXPENSE_ROWS) break;
    if (row.amountDollars.trim() === "") continue;
    const cents = Math.round(Number(row.amountDollars) * 100);
    if (!Number.isFinite(cents)) continue;

    const label = row.name.trim();
    if (isCustomRow(row) && label === "") continue;

    const note = row.note.trim();
    payload.push({
      categoryId: row.categoryId,
      customLabel: isCustomRow(row)
        ? label.slice(0, EXPENSE_LABEL_MAX_LENGTH)
        : null,
      amountNzdCents: Math.max(0, cents),
      note: note === "" ? null : note.slice(0, EXPENSE_NOTE_MAX_LENGTH),
    });
  }
  return payload;
}

/**
 * The breakdown's sum, as a DOLLAR STRING ready to drop straight into the
 * headline "Total expenses (NZD)" input.
 *
 * Goes through expenseRowsToPayload() rather than summing the raw strings,
 * so the auto-filled total counts exactly the rows that will actually be
 * saved -- a half-typed amount, or a custom row with no name yet,
 * contributes nothing here for the same reason it stores nothing there.
 *
 * Returns "" for an empty breakdown, which is the input's own empty value:
 * clearing the last row clears the total rather than parking a $0 on the
 * story.
 */
export function breakdownTotalDollars(rows: ExpenseDraftRow[]): string {
  const payload = expenseRowsToPayload(rows);
  if (payload.length === 0) return "";
  const cents = payload.reduce((sum, row) => sum + row.amountNzdCents, 0);
  // Cents -> dollars without a trailing ".00", since the input is a number
  // field the contributor may keep typing in.
  return String(cents / 100);
}

/**
 * Optional expense breakdown, sitting under the headline "Total expenses
 * (NZD)" input. That input stays the number the story is filed under; this
 * answers the follow-up question ("on what?").
 *
 * Categories are SUGGESTIONS, not a ceiling: a contributor can pick a
 * curated one or type their own. The curated list still earns its keep --
 * everyone who picks "Flights" aggregates together, and only the typed tail
 * is unmergeable across stories.
 *
 * Every row reads the same way whichever kind it is: a title, then a
 * sub-title under it. For a curated row those are the category's name and
 * its fixed description; for a typed one they are both the contributor's own
 * words. Same shape, so the list does not visibly sort itself into
 * first-class and second-class rows.
 *
 * At most MAX_EXPENSE_ROWS rows, and NOT scrollable -- five rows fit, so
 * there is nothing to scroll and no clipped content to hunt for.
 */
export function ExpenseBreakdown({
  categories,
  rows,
  totalExpenseDollars,
  onChange,
}: {
  categories: ActiveExpenseCategory[];
  rows: ExpenseDraftRow[];
  /** The headline total, as typed. Used only for the advisory line. */
  totalExpenseDollars: string;
  onChange: (next: ExpenseDraftRow[]) => void;
}) {
  // Open on arrival if there is already something to see -- a contributor
  // returning to their draft should not have to find their own budget.
  const [open, setOpen] = useState(rows.length > 0);
  const [customLabel, setCustomLabel] = useState("");
  const panelId = useId();
  const addId = useId();
  const customId = useId();

  const describedCategories = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories],
  );

  const unusedCategories = categories.filter(
    (c) => !rows.some((r) => r.categoryId === c.id),
  );

  const atCap = rows.length >= MAX_EXPENSE_ROWS;

  function addCuratedRow(categoryId: string) {
    const category = describedCategories.get(categoryId);
    if (!category || atCap) return;
    onChange([
      ...rows,
      {
        categoryId: category.id,
        name: category.name,
        slug: category.slug,
        amountDollars: "",
        note: "",
      },
    ]);
  }

  function addCustomRow() {
    const label = customLabel.trim();
    if (label === "" || atCap) return;
    // Case-insensitive, so "Van" cannot be added beside "van" -- the RPC
    // dedupes the same way, and a duplicate would silently vanish on save.
    const clash = rows.some(
      (r) => r.name.trim().toLowerCase() === label.toLowerCase(),
    );
    if (clash) return;
    onChange([
      ...rows,
      {
        categoryId: null,
        name: label.slice(0, EXPENSE_LABEL_MAX_LENGTH),
        slug: null,
        amountDollars: "",
        note: "",
      },
    ]);
    setCustomLabel("");
  }

  function updateRow(index: number, patch: Partial<ExpenseDraftRow>) {
    onChange(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function removeRow(index: number) {
    onChange(rows.filter((_, i) => i !== index));
  }

  // Only rows with a real amount count. Number("") is 0, not NaN, so an
  // untouched row would otherwise silently join the sum at zero.
  const subtotalCents = rows.reduce((sum, row) => {
    if (row.amountDollars.trim() === "") return sum;
    const value = Number(row.amountDollars);
    if (!Number.isFinite(value) || value < 0) return sum;
    return sum + Math.round(value * 100);
  }, 0);

  const totalCents =
    totalExpenseDollars.trim() === "" ||
    !Number.isFinite(Number(totalExpenseDollars))
      ? null
      : Math.round(Number(totalExpenseDollars) * 100);

  const exceedsTotal = totalCents !== null && subtotalCents > totalCents;

  return (
    <div className="mt-4 rounded-md border border-border-subtle">
      <button
        type="button"
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm font-medium hover:bg-surface-muted"
      >
        <span>
          Break it down by category
          <span className="ml-2 font-normal text-muted-foreground">
            Optional
          </span>
        </span>
        <ChevronDownIcon open={open} />
      </button>

      {open && (
        <div id={panelId} className="border-t border-border-subtle p-3">
          <p className="text-xs text-muted-foreground">
            Only add what you actually recorded. Leaving something out is fine —
            it doesn&apos;t have to add up to your total. Up to{" "}
            {MAX_EXPENSE_ROWS}.
          </p>

          {/* No fixed height and no overflow container: the list cannot
              exceed MAX_EXPENSE_ROWS, so there is never anything clipped to
              scroll to. */}
          {rows.length > 0 && (
            <ul className="mt-3 space-y-3">
              {rows.map((row, index) => {
                const category = row.categoryId
                  ? describedCategories.get(row.categoryId)
                  : undefined;
                const custom = isCustomRow(row);
                const wantsNote = custom || row.slug === NOTE_CATEGORY_SLUG;
                return (
                  <li key={row.categoryId ?? `custom-${index}`}>
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="min-w-0 flex-1">
                        {custom ? (
                          <>
                            {/* The contributor's own title, in the same slot
                                a curated category's name occupies. */}
                            <label
                              htmlFor={`${panelId}-label-${index}`}
                              className="sr-only"
                            >
                              Category name
                            </label>
                            <input
                              id={`${panelId}-label-${index}`}
                              type="text"
                              value={row.name}
                              maxLength={EXPENSE_LABEL_MAX_LENGTH}
                              placeholder="What did you spend on?"
                              onChange={(e) =>
                                updateRow(index, { name: e.target.value })
                              }
                              className="block w-full border-b border-dashed border-border-subtle bg-transparent py-0.5 text-sm font-medium placeholder:font-normal placeholder:text-muted-foreground/70 focus:border-solid focus:border-accent focus:outline-none"
                            />
                          </>
                        ) : (
                          <label
                            htmlFor={`${panelId}-amount-${index}`}
                            className="block text-sm font-medium"
                          >
                            {row.name}
                          </label>
                        )}

                        {wantsNote ? (
                          <>
                            <label
                              htmlFor={`${panelId}-note-${index}`}
                              className="sr-only"
                            >
                              A short note about this cost
                            </label>
                            <input
                              id={`${panelId}-note-${index}`}
                              type="text"
                              value={row.note}
                              maxLength={EXPENSE_NOTE_MAX_LENGTH}
                              placeholder="Add a short note (optional)"
                              onChange={(e) =>
                                updateRow(index, { note: e.target.value })
                              }
                              className="mt-0.5 w-full border-b border-dashed border-border-subtle bg-transparent py-0.5 text-xs text-muted-foreground placeholder:text-muted-foreground/70 focus:border-solid focus:border-accent focus:outline-none"
                            />
                          </>
                        ) : (
                          category?.description && (
                            <p className="text-xs text-muted-foreground">
                              {category.description}
                            </p>
                          )
                        )}
                      </div>
                      <input
                        id={`${panelId}-amount-${index}`}
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="0.01"
                        value={row.amountDollars}
                        placeholder="NZD"
                        aria-label={
                          custom
                            ? `Amount for ${row.name.trim() || "this category"}`
                            : undefined
                        }
                        onChange={(e) =>
                          updateRow(index, { amountDollars: e.target.value })
                        }
                        className="w-28 rounded-md border border-border-subtle px-3 py-2 text-sm dark:bg-transparent"
                      />
                      <button
                        type="button"
                        onClick={() => removeRow(index)}
                        aria-label={`Remove ${row.name.trim() || "this category"} from the breakdown`}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border-subtle hover:bg-surface-muted"
                      >
                        <CloseIcon className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {atCap ? (
            <p className="mt-3 text-xs text-muted-foreground">
              That&apos;s {MAX_EXPENSE_ROWS} categories — the most a breakdown
              holds. Remove one to add something else.
            </p>
          ) : (
            <div className="mt-3 space-y-3">
              {unusedCategories.length > 0 && (
                <div>
                  <label htmlFor={addId} className="block text-sm font-medium">
                    Add a category
                  </label>
                  <select
                    id={addId}
                    value=""
                    onChange={(e) => {
                      if (e.target.value) addCuratedRow(e.target.value);
                    }}
                    className="mt-1 w-full rounded-md border border-border-subtle px-3 py-2 text-sm dark:bg-transparent"
                  >
                    <option value="">Choose a category…</option>
                    {unusedCategories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Typing your own. Deliberately its own labelled control
                  rather than an "Other…" entry hidden at the bottom of the
                  select: naming your own cost is a first-class way to use
                  this, not a fallback for when the list fails you. */}
              <div>
                <label htmlFor={customId} className="block text-sm font-medium">
                  Or name your own
                </label>
                <div className="mt-1 flex gap-2">
                  <input
                    id={customId}
                    type="text"
                    value={customLabel}
                    maxLength={EXPENSE_LABEL_MAX_LENGTH}
                    placeholder="e.g. Phone plan"
                    onChange={(e) => setCustomLabel(e.target.value)}
                    onKeyDown={(e) => {
                      // Enter adds the row instead of submitting the form
                      // around it -- this control sits inside the story
                      // editor, and a stray submit would be a much bigger
                      // surprise than a new row.
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addCustomRow();
                      }
                    }}
                    className="min-w-0 flex-1 rounded-md border border-border-subtle px-3 py-2 text-sm dark:bg-transparent"
                  />
                  <button
                    type="button"
                    onClick={addCustomRow}
                    disabled={customLabel.trim() === ""}
                    className="shrink-0 rounded-md border border-border-subtle px-3 py-2 text-sm font-medium hover:bg-surface-muted disabled:opacity-50"
                  >
                    Add
                  </button>
                </div>
              </div>
            </div>
          )}

          {rows.length > 0 && (
            <p className="mt-3 text-sm text-muted-foreground">
              Breakdown so far: {formatNzdCents(subtotalCents)}
              {exceedsTotal && (
                // Advisory, never blocking -- see this component's header.
                <span role="status" className="block text-xs">
                  That&apos;s more than the total above. Both are saved as you
                  typed them; check whichever one is wrong.
                </span>
              )}
            </p>
          )}
        </div>
      )}
    </div>
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
      className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
