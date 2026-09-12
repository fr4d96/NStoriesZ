"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { BellIcon } from "@/components/icons";
import { controlToneClasses } from "@/components/ui-tone";
import { createClient } from "@/lib/supabase/client";
import {
  describeNotification,
  formatNotificationAge,
  formatUnreadBadge,
  type NotificationRow,
  type NotificationView,
} from "@/lib/notifications/notification-view";

/** How often the badge re-counts while the tab is visible. */
const REFRESH_INTERVAL_MS = 60_000;
const LIST_LIMIT = 20;

/**
 * The header bell: an unread badge, and a dropdown listing the caller's
 * inbox (supabase/migrations/20260911100000_notifications.sql). Rendered
 * beside UserAvatarMenu on every SIGNED-IN header (SiteHeader once its
 * client-side session check resolves, ContributorNav, StaffNav), so the
 * same bell is in the same place whether the person is reading, writing
 * or reviewing.
 *
 * Client-side data, like SiteHeader's own identity reads and for the same
 * reason: public pages never call the session server-side so they stay
 * cacheable, and a badge is exactly the kind of per-person detail that
 * must not be baked into a shared page. Every read is the caller's own
 * rows -- the three RPCs key on auth.uid() and nothing here is passed to
 * them but a limit and, when marking read, the ids of rows already shown.
 *
 * Refresh policy: the count is fetched on mount, again whenever the tab
 * becomes visible, and on a slow interval while it stays visible -- a
 * moderator who leaves the queue open in a tab still sees new
 * submissions arrive without reloading. The list itself is only fetched
 * when the dropdown opens; nobody needs twenty rows to draw a number.
 *
 * Marking read is optimistic: the row loses its dot and the badge drops
 * before the RPC returns, because the link is navigating away at the same
 * moment and a spinner nobody would see is not worth the state.
 */
export function NotificationBell({ inverted = false }: { inverted?: boolean }) {
  const [unreadCount, setUnreadCount] = useState(0);
  const [items, setItems] = useState<NotificationView[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  const menuId = useId();

  function supabase() {
    if (!supabaseRef.current) supabaseRef.current = createClient();
    return supabaseRef.current;
  }

  const refreshCount = useCallback(async () => {
    const { data, error } = await supabase().rpc(
      "count_my_unread_notifications",
    );
    if (!error && typeof data === "number") setUnreadCount(data);
  }, []);

  const loadList = useCallback(async () => {
    const { data, error } = await supabase().rpc("list_my_notifications", {
      p_limit: LIST_LIMIT,
    });
    // State is only ever set after the await -- the open-effect calls this
    // synchronously, and a setState before the first await would run inside
    // the effect body itself.
    const failed = !!error || !data;
    setLoadError(failed);
    if (failed) return;
    // The generated type marks read_at non-null (see NotificationRow); the
    // cast is the one place that mismatch is reconciled.
    setItems((data as NotificationRow[]).map(describeNotification));
    void refreshCount();
  }, [refreshCount]);

  useEffect(() => {
    let active = true;
    void refreshCount();

    function onVisibilityChange() {
      if (active && document.visibilityState === "visible") {
        void refreshCount();
      }
    }
    const interval = window.setInterval(() => {
      if (active && document.visibilityState === "visible") {
        void refreshCount();
      }
    }, REFRESH_INTERVAL_MS);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refreshCount]);

  useEffect(() => {
    if (!open) return;
    void loadList();

    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, loadList]);

  function markRead(ids: string[] | null) {
    setItems((current) =>
      current
        ? current.map((item) =>
            ids === null || ids.includes(item.id)
              ? { ...item, unread: false }
              : item,
          )
        : current,
    );
    setUnreadCount((count) =>
      ids === null ? 0 : Math.max(0, count - ids.length),
    );
    void supabase()
      .rpc("mark_my_notifications_read", { p_ids: ids ?? undefined })
      .then(() => refreshCount());
  }

  const badge = formatUnreadBadge(unreadCount);
  const label =
    unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications";

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={label}
        className={`relative flex h-10 w-10 items-center justify-center rounded-full border transition-transform hover:-translate-y-0.5 ${controlToneClasses(inverted)}`}
      >
        <BellIcon className="h-5 w-5" />
        {badge && (
          <span
            aria-hidden="true"
            className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[0.65rem] font-black text-accent-foreground ring-2 ring-surface"
          >
            {badge}
          </span>
        )}
      </button>

      {/*
        -right-12, not right-0: the bell sits one 40px avatar + 8px gap left
        of the header's edge in every header that renders it, and a panel
        hung off the bell's own right edge overflowed the LEFT of a 375px
        viewport by 9px. Anchoring to the avatar's edge keeps it inside
        the header's content box at every width.
      */}
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Notifications"
          className="absolute -right-12 top-12 z-50 max-h-[calc(100vh-5rem)] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-border-subtle bg-surface p-1.5 text-foreground shadow-xl"
        >
          <div className="flex items-center justify-between px-3 pt-1.5 pb-1">
            <p className="font-mono text-[0.625rem] tracking-[0.14em] text-muted-foreground uppercase">
              Notifications
            </p>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() => markRead(null)}
                className="text-xs font-semibold text-muted-foreground hover:text-foreground hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>

          {loadError ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">
              Couldn&apos;t load notifications.{" "}
              <button
                type="button"
                onClick={() => void loadList()}
                className="font-semibold underline"
              >
                Try again
              </button>
            </p>
          ) : items === null ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">Loading…</p>
          ) : items.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">
              You&apos;re all caught up.
            </p>
          ) : (
            <ul className="flex flex-col">
              {items.map((item) => (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    role="menuitem"
                    onClick={() => {
                      if (item.unread) markRead([item.id]);
                      setOpen(false);
                    }}
                    className="flex items-start gap-3 rounded-lg px-3 py-2 hover:bg-surface-muted"
                  >
                    <span
                      aria-hidden="true"
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${item.unread ? "bg-accent" : "bg-transparent"}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block text-sm ${item.unread ? "font-bold" : "font-medium"}`}
                      >
                        {item.heading}
                        {item.unread && (
                          <span className="sr-only"> (unread)</span>
                        )}
                      </span>
                      <span className="block truncate text-sm text-muted-foreground">
                        &ldquo;{item.title}&rdquo;
                      </span>
                      {item.reason && (
                        <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
                          {item.reason}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 pt-0.5 text-xs text-muted-foreground">
                      {formatNotificationAge(item.createdAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
