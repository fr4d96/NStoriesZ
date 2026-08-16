/**
 * Kakinotes icon set.
 *
 * Custom line icons (no icon library dependency — see docs/design-brief.md
 * "Technical constraints"). Consistent 24x24 grid, 1.6 stroke, rounded caps,
 * `currentColor` throughout so callers set color via text/className like any
 * other inline element (e.g. `text-fern`, `text-accent`).
 */
import type { SVGProps } from "react";

export type IconProps = SVGProps<SVGSVGElement>;

function base(props: IconProps) {
  return {
    xmlns: "http://www.w3.org/2000/svg",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    ...props,
  };
}

/** An open, ruled journal page — stories/journal entries. */
export function JournalIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 5.5C4 4.67 4.67 4 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5v-13Z" />
      <path d="M20 5.5c0-.83-.67-1.5-1.5-1.5H13v16h5.5c.83 0 1.5-.67 1.5-1.5v-13Z" />
      <path d="M14.5 8.5h3M14.5 11.5h3M14.5 14.5h2" />
    </svg>
  );
}

/** Region / destination marker. */
export function MapPinIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 21s-6.75-6.13-6.75-11.25a6.75 6.75 0 0 1 13.5 0C18.75 14.87 12 21 12 21Z" />
      <circle cx="12" cy="9.75" r="2.25" />
    </svg>
  );
}

/** Work type / employment classification. */
export function WorkTypeIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3.5" y="8" width="17" height="11" rx="1.75" />
      <path d="M8.5 8V6.25A1.75 1.75 0 0 1 10.25 4.5h3.5A1.75 1.75 0 0 1 15.5 6.25V8" />
      <path d="M3.5 13h17" />
    </svg>
  );
}

/** Trip year / travel dates. */
export function TripYearIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3.5" y="5" width="17" height="15" rx="1.75" />
      <path d="M3.5 9.5h17" />
      <path d="M8 3v3.5M16 3v3.5" />
      <path d="M7.5 13h2.25M7.5 16.25h2.25M11.5 13h2.25M11.5 16.25h2.25" />
    </svg>
  );
}

/** Contributor / pseudonym attribution. */
export function ContributorIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="8.25" r="3.25" />
      <path d="M5.5 19.5c0-3.45 2.9-6.25 6.5-6.25s6.5 2.8 6.5 6.25" />
    </svg>
  );
}

/** Blockquote — one of the story content block types. */
export function QuoteBlockIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M7.5 6.75c-2.07 0-3.75 1.68-3.75 3.75 0 1.87 1.37 3.42 3.16 3.7-.32 1.28-1.19 2.25-2.41 2.8" />
      <path d="M16.5 6.75c-2.07 0-3.75 1.68-3.75 3.75 0 1.87 1.37 3.42 3.16 3.7-.32 1.28-1.19 2.25-2.41 2.8" />
    </svg>
  );
}

/** List block. */
export function ListBlockIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="5" cy="6.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="5" cy="17.5" r="1" fill="currentColor" stroke="none" />
      <path d="M9 6.5h10.5M9 12h10.5M9 17.5h10.5" />
    </svg>
  );
}

/** Heading block. */
export function HeadingBlockIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M5 5v14M13 5v14M5 12h8" />
      <path d="M17 10.5c.5-1 1.5-1.5 2.5-1 .9.44 1.1 1.53.4 2.3L17 15.5h3.5" />
    </svg>
  );
}

/** Ordered image gallery. */
export function GalleryIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3.5" y="5.5" width="13" height="13" rx="1.75" />
      <circle cx="8" cy="10" r="1.35" />
      <path d="M4.5 17 9 12.75l2.5 2.25 2.5-2.5 2.5 2.5" />
      <path d="M19.5 8.5v9a1.75 1.75 0 0 1-1.75 1.75h-9" />
    </svg>
  );
}

/** Filter panel control. */
export function FilterIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 6h16M7 12h10M10 18h4" />
      <circle cx="9" cy="6" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="18" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** "Find a story like yours" search. */
export function StorySearchIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="10.5" cy="10.5" r="6.25" />
      <path d="M15.3 15.3 20 20" />
      <path d="M8 10.5c0-1.4 1.12-2.5 2.5-2.5" />
    </svg>
  );
}

/**
 * "Personal experience, not advice" label — an open speech bubble with a
 * small mark, deliberately not a checkmark/badge/star shape (Rule 17 asks
 * for a clear disclosure, not an endorsement signal).
 */
export function PersonalExperienceIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4.5 6.75A2.25 2.25 0 0 1 6.75 4.5h10.5a2.25 2.25 0 0 1 2.25 2.25v7.5a2.25 2.25 0 0 1-2.25 2.25H10l-4 3.25v-3.25H6.75a2.25 2.25 0 0 1-2.25-2.25v-7.5Z" />
      <path d="M8.5 9.75h7M8.5 12.75h4.5" />
    </svg>
  );
}

/** Related stories module — a small stack of cards. */
export function RelatedStoriesIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="6" y="8.5" width="14" height="10" rx="1.75" />
      <path d="M4 15V6.75A1.75 1.75 0 0 1 5.75 5H15" />
    </svg>
  );
}

/** Consent given / verified — editorial & moderation workflows. */
export function ConsentCheckIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3.75 19 6.5v5.25c0 4.4-2.98 7.66-7 8.75-4.02-1.09-7-4.35-7-8.75V6.5L12 3.75Z" />
      <path d="M9 12.25l2 2 4-4.25" />
    </svg>
  );
}

/** Editorial preparation — import/attribution cleanup. */
export function EditorialPencilIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M15.5 4.5 19.5 8.5 8.75 19.25 4 20l.75-4.75L15.5 4.5Z" />
      <path d="M13.5 6.5l4 4" />
    </svg>
  );
}

/** Moderation queue — pending review. */
export function ModerationQueueIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="8.25" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

/** Read a story / continue reading CTA. */
export function ArrowRightIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4.5 12h15" />
      <path d="M13.5 6l6 6-6 6" />
    </svg>
  );
}

/** Success confirmation — the toast system's "done" state. */
export function CheckCircleIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="8.25" />
      <path d="M8.5 12.25l2.5 2.5 4.5-5" />
    </svg>
  );
}

/** Error/warning confirmation — the toast system's "failed" state. */
export function AlertCircleIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="8.25" />
      <path d="M12 7.75v5" />
      <path d="M12 16.25h.01" />
    </svg>
  );
}

/** Dismiss — closes a toast or other transient panel. */
export function CloseIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </svg>
  );
}
