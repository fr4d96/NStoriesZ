"use client";

/**
 * The "When did you travel?" control on the story authoring form (both the
 * contributor's own edit page and the editorial edit page -- they render the
 * same StoryEditForm).
 *
 * WHY THIS KEEPS THE NATIVE `<input type="date">`.
 *
 * The obvious "modern" move here is a hand-rolled calendar popover. It would
 * be a regression, twice over:
 *
 *  - On a phone -- the primary viewport for this product (Engineering Rule
 *    18) -- `<input type="date">` opens the OS date picker: a full-height,
 *    thumb-reachable, localised, screen-reader-native control that no custom
 *    grid in a 375px-wide page can beat. Replacing it trades a first-class
 *    control for a worse one on the viewport that matters most.
 *  - A custom grid has to re-implement roving focus, Home/End, PageUp/
 *    PageDown, Escape-and-restore-focus, and `aria-selected` correctly, or it
 *    is worse than what it replaced for keyboard and screen-reader users
 *    (Engineering Rule 19). Native already ships all of that, correctly, in
 *    every browser, for free -- and with no date library added (Rule 20).
 *
 * So the input stays native and the DESIGN work goes where it actually was
 * missing: the mode switch, the field housing, the states, and a readback of
 * what the two dates add up to. "Plain" was never the `<input>` -- it was the
 * absence of any treatment around it.
 *
 * WHAT CHANGED, then:
 *
 *  - The two bare radios (browser-default blue dots, and with no shared
 *    `name` they were not even one radio group) become a segmented control
 *    with a sliding accent thumb. They are still real `<input type="radio">`
 *    elements sharing a `name`, so native arrow-key group traversal, the
 *    "1 of 2" announcement, and form semantics all still come from the
 *    platform -- only the paint is ours.
 *  - Each date sits in a labelled well on `--surface-muted` (the Recess Rule
 *    -- inputs are recesses, not raised panels), with a mono micro-label
 *    above it (the Mono-Means-Record Rule) and hover/focus states that move
 *    on the shared `--nf-*` interaction tokens.
 *  - Once both dates are filled the control reads the range back as a record
 *    line -- formatted dates and an inclusive day count. That is the one
 *    authored moment: the field resolves from two empty boxes into a
 *    statement about the trip.
 *
 * DATA CONTRACT. This component is fully controlled and holds no value state
 * of its own. `startDate`/`endDate` are the input's own `YYYY-MM-DD` strings
 * and `year` the raw string from a `type="number"` field, handed straight
 * back through the callbacks unmodified -- byte-identical to what the two
 * bare inputs produced before (Engineering Rule 9: calendar dates, never
 * timestamps). Nothing here parses, reformats, or normalises a value on its
 * way to the caller; the formatting below is display-only.
 */

import { useId } from "react";
import { ArrowRightIcon } from "@/components/icons";
import { TRIP_DATE_ORDER_MESSAGE } from "@/lib/validation/story";

export type TripDateMode = "range" | "year";

const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const MS_PER_DAY = 86_400_000;

/**
 * Fixed locale, not the visitor's. A locale-dependent format would render
 * differently on the server than in the browser and trip React's hydration
 * check; en-GB's day-month-year also matches how both New Zealand (the
 * destination) and Malaysia (the initial market) write a date.
 */
const tripDateFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/**
 * `YYYY-MM-DD` -> UTC epoch ms, or null if it is not a real calendar date.
 * UTC throughout: these are calendar dates, and parsing them in the viewer's
 * local zone is what makes a date shift by a day either side of midnight.
 * Round-tripping the parts back out is what rejects a well-shaped
 * impossibility like `2025-02-30`, which `Date.UTC` would happily roll over.
 */
export function parseCalendarDate(value: string): number | null {
  if (!CALENDAR_DATE_PATTERN.test(value)) return null;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const ms = Date.UTC(year, month - 1, day);
  const back = new Date(ms);
  if (
    back.getUTCFullYear() !== year ||
    back.getUTCMonth() !== month - 1 ||
    back.getUTCDate() !== day
  ) {
    return null;
  }
  return ms;
}

/** `"2025-03-14"` -> `"14 Mar 2025"`; null for anything unparseable. */
export function formatCalendarDate(value: string): string | null {
  const ms = parseCalendarDate(value);
  return ms === null ? null : tripDateFormat.format(ms);
}

/**
 * Inclusive length of the trip in days -- a trip that starts and ends on the
 * same day is 1 day, not 0. Null unless both ends parse AND are in order, so
 * an inverted range shows the schema's own message instead of a negative
 * count.
 */
export function tripDurationDays(start: string, end: string): number | null {
  const from = parseCalendarDate(start);
  const to = parseCalendarDate(end);
  if (from === null || to === null || to < from) return null;
  return Math.round((to - from) / MS_PER_DAY) + 1;
}

export type TripDateFieldProps = {
  mode: TripDateMode;
  startDate: string;
  endDate: string;
  year: string;
  onModeChange: (mode: TripDateMode) => void;
  onStartDateChange: (value: string) => void;
  onEndDateChange: (value: string) => void;
  onYearChange: (value: string) => void;
};

/** Shared shell for one native input, so both modes house their field identically. */
function FieldWell({
  htmlFor,
  label,
  hiddenLabel,
  children,
}: {
  htmlFor: string;
  label: string;
  hiddenLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div className="group flex-1 rounded-xl border border-border-subtle bg-surface-muted px-3 py-2.5 transition-colors duration-[var(--nf-fast)] ease-[var(--nf-ease-out)] hover:border-accent/55 has-[:focus-visible]:border-accent">
      <label
        htmlFor={htmlFor}
        className="block font-mono text-[0.625rem] tracking-[0.18em] text-muted-foreground uppercase transition-colors duration-[var(--nf-fast)] ease-[var(--nf-ease-out)] group-has-[:focus-visible]:text-accent"
      >
        {label}
        {/* Keeps the visible word as a prefix of the accessible name (WCAG
            "Label in Name") while still giving "To" a meaning of its own out
            of context -- an aria-label would have replaced the visible text
            rather than extending it. */}
        <span className="sr-only"> {hiddenLabel}</span>
      </label>
      {children}
    </div>
  );
}

export function TripDateField({
  mode,
  startDate,
  endDate,
  year,
  onModeChange,
  onStartDateChange,
  onEndDateChange,
  onYearChange,
}: TripDateFieldProps) {
  const id = useId();
  const modeName = `${id}-trip-date-mode`;
  const startId = `${id}-trip-start`;
  const endId = `${id}-trip-end`;
  const yearId = `${id}-trip-year`;

  const startLabel = formatCalendarDate(startDate);
  const endLabel = formatCalendarDate(endDate);
  const days = tripDurationDays(startDate, endDate);
  // Both ends are real dates but the wrong way round. Display echo only --
  // revisionInputSchema's refine() is what actually blocks the save.
  const inverted = startLabel !== null && endLabel !== null && days === null;

  const segments: Array<{ value: TripDateMode; label: string }> = [
    { value: "range", label: "Specific dates" },
    { value: "year", label: "Just the year" },
  ];

  return (
    <fieldset>
      <legend className="text-sm font-medium">When did you travel?</legend>

      <div
        role="radiogroup"
        aria-label="How precisely do you remember your travel dates?"
        className="relative mt-2 grid w-full max-w-sm grid-cols-2 rounded-full border border-border-subtle bg-surface-muted p-1"
      >
        {/* The moving part. Sized to exactly one half of the track's inner
            width so `translate-x-full` lands it on the second segment, and
            transform-only so nothing reflows as it travels. The global
            prefers-reduced-motion block at the end of globals.css zeroes the
            duration, leaving the thumb correctly placed but still. */}
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-full bg-accent shadow-sm transition-transform duration-[var(--nf-medium)] ease-[var(--nf-ease-out)] ${
            mode === "year" ? "translate-x-full" : "translate-x-0"
          }`}
        />
        {segments.map((segment) => {
          const active = mode === segment.value;
          return (
            <label
              key={segment.value}
              className={`nf-segment relative z-10 flex min-h-11 cursor-pointer items-center justify-center rounded-full px-3 text-center text-sm font-semibold transition-colors duration-[var(--nf-medium)] ease-[var(--nf-ease-out)] ${
                active
                  ? "text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {/* A real radio, visually hidden: the platform's own arrow-key
                  traversal, roving tabstop and "radio, 1 of 2" announcement
                  are worth far more than anything a div with role="radio"
                  could re-implement. Only the paint above is ours. */}
              <input
                type="radio"
                name={modeName}
                value={segment.value}
                checked={active}
                onChange={() => onModeChange(segment.value)}
                className="sr-only"
              />
              {segment.label}
            </label>
          );
        })}
      </div>

      {mode === "range" ? (
        <div className="mt-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <FieldWell
              htmlFor={startId}
              label="From"
              hiddenLabel="trip start date"
            >
              <input
                id={startId}
                type="date"
                value={startDate}
                onChange={(e) => onStartDateChange(e.target.value)}
                className="mt-1 w-full bg-transparent font-mono text-sm tabular-nums outline-offset-2"
              />
            </FieldWell>
            <FieldWell htmlFor={endId} label="To" hiddenLabel="trip end date">
              <input
                id={endId}
                type="date"
                value={endDate}
                onChange={(e) => onEndDateChange(e.target.value)}
                className="mt-1 w-full bg-transparent font-mono text-sm tabular-nums outline-offset-2"
              />
            </FieldWell>
          </div>

          {/* The readback. Rendered only when it can say something true: no
              placeholder dash for a half-filled range (the Real Fields
              Rule), and no day count for an inverted one. */}
          {inverted ? (
            <p className="mt-2 text-xs text-destructive">
              {TRIP_DATE_ORDER_MESSAGE}
            </p>
          ) : startLabel && endLabel && days !== null ? (
            <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs text-muted-foreground tabular-nums">
              <span>{startLabel}</span>
              <ArrowRightIcon className="h-3.5 w-3.5 shrink-0 text-accent" />
              <span>{endLabel}</span>
              <span aria-hidden="true" className="text-border-subtle">
                /
              </span>
              <span className="text-foreground">
                {days === 1 ? "1 day" : `${days} days`}
              </span>
            </p>
          ) : null}
        </div>
      ) : (
        <div className="mt-3">
          <div className="max-w-40">
            <FieldWell htmlFor={yearId} label="Year" hiddenLabel="trip year">
              <input
                id={yearId}
                type="number"
                value={year}
                min={2000}
                max={2100}
                inputMode="numeric"
                placeholder="2025"
                onChange={(e) => onYearChange(e.target.value)}
                className="mt-1 w-full bg-transparent font-mono text-base tabular-nums outline-offset-2"
              />
            </FieldWell>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Use this if you remember the year but not the exact dates.
          </p>
        </div>
      )}
    </fieldset>
  );
}
