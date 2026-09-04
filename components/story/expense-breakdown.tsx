"use client";

import { useId, useMemo, useState } from "react";
import type { ActiveExpenseCategory } from "@/lib/story/active-lookups";
import { EXPENSE_NOTE_MAX_LENGTH } from "@/lib/validation/story";
import { formatNzdCents } from "@/lib/story/expense-per-month";
import { CloseIcon } from "@/components/icons";

/**
 * One row of the optional expense breakdown, as the FORM holds it: amounts
 * are the raw strings the contributor is typing, not numbers. Parsing to
 * cents happens in one place in story-edit-form.tsx (the same
 * `Math.round(Number(x) * 100)` the headline total already uses), so the
 * two can never drift apart.
 *
 * `name` travels with the row rather than being looked up from
 * `categories` every time, because a category can be retired (`active =
 * false`) while stories still reference it -- it would be missing from the
 * options list and the row would render nameless.
 */
export type ExpenseDraftRow = {
  categoryId: string;
  name: string;
  slug: string;
  amountDollars: string;
  note: string;
};

/**
 * The slug whose row gets a free-text note field. The categories are
 * deliberately CURATED -- there is no "type your own category", unlike
 * tags -- because an expense only earns its keep if it can be added up
 * across stories, and "car" / "van stuff" / "vehicle" are three
 * unmergeable buckets for one thing. "Other" plus a short note is the
 * pressure valve that keeps the rest of the vocabulary clean.
 */
const NOTE_CATEGORY_SLUG = "other";

/**
 * Draft rows -> the payload set_revision_expenses() takes. Lives here, next
 * to the row shape it consumes, and is the ONLY place the form converts an
 * expense row for saving.
 *
 * Three rules, all of which the RPC independently re-applies (Engineering
 * Rules 2/3 -- this is the courtesy, that is the boundary):
 *
 *  - An EMPTY amount drops the row. `Number("")` is 0, not NaN, so without
 *    this an untouched row would be stored as a confident "$0.00". "I
 *    didn't record it" and "it cost nothing" are different claims, and a
 *    fake zero corrupts every future average across stories.
 *  - A part-typed or nonsense amount ("-", "1e", "abc") drops the row
 *    rather than saving garbage; the next keystroke that makes it a number
 *    brings it straight back.
 *  - A negative is clamped to 0, matching the RPC, so a stray minus sign
 *    cannot make an autosave start erroring mid-typing.
 *
 * The dollars->cents conversion is deliberately the identical
 * `Math.round(Number(x) * 100)` the headline total already uses in
 * story-edit-form.tsx -- one expression, so the two numbers on the same
 * screen can never round differently.
 */
export function expenseRowsToPayload(
  rows: ExpenseDraftRow[],
): Array<{ categoryId: string; amountNzdCents: number; note: string | null }> {
  const payload: Array<{
    categoryId: string;
    amountNzdCents: number;
    note: string | null;
  }> = [];
  for (const row of rows) {
    if (row.amountDollars.trim() === "") continue;
    const cents = Math.round(Number(row.amountDollars) * 100);
    if (!Number.isFinite(cents)) continue;
    const note = row.note.trim();
    payload.push({
      categoryId: row.categoryId,
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
 * saved -- a half-typed or empty amount contributes nothing here for the
 * same reason it stores nothing there.
 *
 * Returns "" for an empty breakdown, which is the input's own empty value:
 * clearing the last row clears the total rather than parking a $0 on the
 * story ("I didn't record it" is not "it cost nothing" -- the rule this
 * whole component is built around).
 */
export function breakdownTotalDollars(rows: ExpenseDraftRow[]): string {
  const payload = expenseRowsToPayload(rows);
  if (payload.length === 0) return "";
  const cents = payload.reduce((sum, row) => sum + row.amountNzdCents, 0);
  // Cents -> dollars without a trailing ".00", since the input is a
  // number field the contributor may keep typing in.
  return String(cents / 100);
}

/**
 * Optional per-category breakdown, sitting under the headline "Total
 * expenses (NZD)" input in the Trip step. That input stays the number the
 * story is filed under; this answers the follow-up question ("on what?").
 *
 * The two are INDEPENDENT on purpose, in the database as well as here: a
 * partial breakdown ("I know what my flights and my van cost, not my
 * groceries") is the normal case, so nothing forces the categories to add
 * up to the total. Where the categories exceed the stated total, the line
 * below says so plainly and leaves it alone -- it is a real thing a
 * contributor might mean, and moderators get the same observation as an
 * advisory finding (lib/story/content-quality-checks.ts).
 *
 * An empty amount box means "I didn't record this", NOT "$0" -- the row is
 * dropped before saving rather than stored as a zero, both here and again
 * inside set_revision_expenses(). A fake zero would quietly drag down
 * every future average across stories.
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
  const panelId = useId();
  const addId = useId();

  const describedCategories = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories],
  );

  const unusedCategories = categories.filter(
    (c) => !rows.some((r) => r.categoryId === c.id),
  );

  function addRow(categoryId: string) {
    const category = describedCategories.get(categoryId);
    if (!category) return;
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
            Only add what you actually recorded. Leaving a category out is fine
            — it doesn&apos;t have to add up to your total.
          </p>

          {/* Fixed height, scrolled internally, so the panel is the same
              size at one category as at eleven. Worth the constraint here
              specifically because the donut sits BESIDE this list from `lg`
              up: without it, every added row grew the column and shifted
              the figure down the page mid-edit.

              `tabIndex={0}` is not decorative -- a scroll container that
              only responds to the mouse strands keyboard users at whatever
              is clipped (WCAG 2.1.1), and a focusable region needs a name,
              hence the label. `overscroll-contain` keeps a wheel gesture
              that reaches the end of this list from carrying on and
              scrolling the whole editor underneath it. */}
          {rows.length > 0 && (
            <ul
              tabIndex={0}
              role="group"
              aria-label="Expense categories you have added"
              className="mt-3 h-56 space-y-3 overflow-y-auto overscroll-contain pr-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {rows.map((row, index) => {
                const category = describedCategories.get(row.categoryId);
                return (
                  <li key={row.categoryId}>
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="min-w-0 flex-1">
                        <label
                          htmlFor={`${panelId}-amount-${index}`}
                          className="block text-sm font-medium"
                        >
                          {row.name}
                        </label>
                        {/* "Other" is the one category whose sub-title the
                            contributor writes, so it takes the SAME slot as
                            every other category's description rather than a
                            separate full-width field below the row -- which
                            is what made this one row a different shape from
                            the rest. Styled as the sub-title it replaces
                            (same size, same muted ink), with a dashed
                            underline so it still reads as something you can
                            type in; a borderless input in a list of static
                            text has no affordance at all. */}
                        {row.slug === NOTE_CATEGORY_SLUG ? (
                          <>
                            <label
                              htmlFor={`${panelId}-note-${index}`}
                              className="sr-only"
                            >
                              What was this other cost?
                            </label>
                            <input
                              id={`${panelId}-note-${index}`}
                              type="text"
                              value={row.note}
                              maxLength={EXPENSE_NOTE_MAX_LENGTH}
                              placeholder="What was it?"
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
                        onChange={(e) =>
                          updateRow(index, { amountDollars: e.target.value })
                        }
                        className="w-28 rounded-md border border-border-subtle px-3 py-2 text-sm dark:bg-transparent"
                      />
                      <button
                        type="button"
                        onClick={() => removeRow(index)}
                        aria-label={`Remove ${row.name} from the breakdown`}
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

          {unusedCategories.length > 0 && (
            <div className="mt-3">
              <label htmlFor={addId} className="block text-sm font-medium">
                Add a category
              </label>
              <select
                id={addId}
                // Always snaps back to the placeholder: this select is an
                // "add" control, not a stored value, so it must never look
                // like it is holding a selection.
                value=""
                onChange={(e) => {
                  if (e.target.value) addRow(e.target.value);
                }}
                className="mt-1 w-full rounded-md border border-border-subtle px-3 py-2 text-sm sm:w-64 dark:bg-transparent"
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
