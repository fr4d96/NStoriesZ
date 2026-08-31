"use client";

/**
 * One labelled row of filter chips over a single axis. Lifted verbatim from
 * components/home/story-index.tsx so the landing-page catalogue index and the
 * contributor's My Stories page share exactly one chip control.
 *
 * The caller owns the axis values and the active selection; this component is
 * pure presentation. `ALL` is the conventional "no filter on this axis"
 * sentinel and is exported so callers compare against the same string.
 */
export const ALL = "All";

export function FilterRow({
  label,
  options,
  active,
  onChange,
}: {
  label: string;
  options: string[];
  active: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
      <span
        aria-hidden="true"
        className="font-mono text-xs tracking-[0.18em] text-foreground/45 sm:w-14 sm:shrink-0"
      >
        {label.toUpperCase()}
      </span>
      {/* Edge-to-edge horizontal scroll on phones so a long axis stays one
          line and the cut-off chip reads as "there is more"; wraps normally
          from sm up. */}
      <div
        role="group"
        aria-label={`Filter stories by ${label.toLowerCase()}`}
        className="nf-scroll-x -mx-4 flex snap-x gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0"
      >
        {options.map((option) => {
          const isActive = option === active;
          return (
            <button
              key={option}
              type="button"
              aria-pressed={isActive}
              onClick={() => onChange(option)}
              className={`shrink-0 snap-start rounded-full border px-3.5 py-1.5 text-sm font-medium whitespace-nowrap transition-colors ${
                isActive
                  ? "border-accent bg-accent text-accent-foreground"
                  : "border-border-subtle text-foreground/80 hover:border-accent/60 hover:text-foreground"
              }`}
            >
              {option}
            </button>
          );
        })}
      </div>
    </div>
  );
}
