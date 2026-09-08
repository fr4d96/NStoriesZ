"use client";

import { useCallback, useRef, useSyncExternalStore } from "react";

export type AccountTab = {
  /** Also the panel's DOM id, so `/account#<id>` is a real deep link. */
  id: string;
  label: string;
  description: string;
  panel: React.ReactNode;
};

/**
 * Left-hand tab navigation for /account, following the ARIA authoring
 * practice for tabs: roving tabindex, arrow-key movement, Home/End, and
 * automatic activation (focus selects). Vertical beside the content on
 * desktop; a horizontally scrollable strip above it on mobile, because a
 * vertical rail would eat the top third of a phone screen (Rule 18).
 *
 * The hash is load-bearing, not cosmetic. `/account#contributor-identity`
 * is where lib/auth/post-login-redirect.ts sends every brand-new account on
 * its first sign-in, and the "Set it up" banner links to the same place. So
 * each panel carries its tab's id as its own DOM id, and the hash is the
 * single source of truth for which tab is open -- see subscribeToHash below.
 *
 * Every panel stays mounted, with the inactive ones `hidden` (which removes
 * them from the accessibility tree). That keeps unsaved edits and each
 * form's action state alive across a tab switch. It is only safe because
 * the three forms use distinct field ids -- ProfileForm's `displayName` vs
 * ContributorForm's `contributorDisplayName` -- so no duplicate id can
 * capture the wrong label, the defect described in components/auth/auth-modal.tsx.
 */
/**
 * The hash IS the state. Rather than mirroring `location.hash` into a
 * useState (which means a setState inside an effect, cascading renders, and
 * two sources of truth that can disagree), the tablist subscribes to the
 * hash as the external store it actually is. `history.replaceState` does not
 * fire `hashchange` on its own, so activate() dispatches one -- which means
 * a click, a keypress, a deep link, and an in-page anchor all travel the
 * exact same path. getServerSnapshot returns "" so the server renders the
 * first tab, and useSyncExternalStore re-renders after hydration if the real
 * hash names a different one.
 */
function subscribeToHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

function readHash() {
  return window.location.hash.replace(/^#/, "");
}

export function AccountTabs({ tabs }: { tabs: AccountTab[] }) {
  const hash = useSyncExternalStore(subscribeToHash, readHash, () => "");
  const tabRefs = useRef(new Map<string, HTMLButtonElement | null>());

  const fallbackId = tabs[0]?.id ?? "";
  const activeId = tabs.some((tab) => tab.id === hash) ? hash : fallbackId;

  const activate = useCallback((id: string, { focus = false } = {}) => {
    // replaceState, not pushState: switching a settings tab is not a
    // navigation the Back button should have to unwind. It also avoids the
    // scroll jump a plain `location.hash = ...` would cause. The explicit
    // event is what replaceState does not give us.
    window.history.replaceState(null, "", `#${id}`);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    if (focus) tabRefs.current.get(id)?.focus();
  }, []);

  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    const keys = [
      "ArrowDown",
      "ArrowRight",
      "ArrowUp",
      "ArrowLeft",
      "Home",
      "End",
    ];
    if (!keys.includes(event.key)) return;
    event.preventDefault();

    const index = tabs.findIndex((tab) => tab.id === activeId);
    // Both axes are accepted deliberately: the same tablist is vertical on
    // desktop and horizontal on mobile, and a keyboard user should not have
    // to know which one they are looking at.
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : event.key === "ArrowDown" || event.key === "ArrowRight"
            ? (index + 1) % tabs.length
            : (index - 1 + tabs.length) % tabs.length;

    activate(tabs[next].id, { focus: true });
  }

  return (
    <div className="mt-8 flex flex-col gap-8 md:flex-row md:gap-12">
      <div
        role="tablist"
        aria-label="Account settings"
        aria-orientation="vertical"
        className="-mx-4 flex shrink-0 gap-1 overflow-x-auto px-4 pb-1 md:mx-0 md:w-56 md:flex-col md:overflow-visible md:px-0 md:pb-0 md:self-start md:sticky md:top-24"
      >
        {tabs.map((tab) => {
          const selected = tab.id === activeId;
          return (
            <button
              key={tab.id}
              ref={(node) => {
                tabRefs.current.set(tab.id, node);
              }}
              id={`tab-${tab.id}`}
              role="tab"
              type="button"
              aria-selected={selected}
              aria-controls={tab.id}
              tabIndex={selected ? 0 : -1}
              onClick={() => activate(tab.id)}
              onKeyDown={onKeyDown}
              className={`whitespace-nowrap rounded-xl px-4 py-2.5 text-left text-sm font-medium transition-colors md:whitespace-normal ${
                selected
                  ? "bg-accent/15 text-accent"
                  : "text-foreground/65 hover:bg-surface-muted hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="min-w-0 flex-1">
        {tabs.map((tab) => (
          <section
            key={tab.id}
            id={tab.id}
            role="tabpanel"
            aria-labelledby={`tab-${tab.id}`}
            hidden={tab.id !== activeId}
            tabIndex={0}
            className="scroll-mt-24 focus-visible:outline-none"
          >
            <h2 className="text-xl font-semibold tracking-tight">
              {tab.label}
            </h2>
            <p className="mt-1 text-sm text-foreground/65">{tab.description}</p>
            {tab.panel}
          </section>
        ))}
      </div>
    </div>
  );
}
