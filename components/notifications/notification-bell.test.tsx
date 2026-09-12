import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { NotificationRow } from "@/lib/notifications/notification-view";

const { rpcMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: rpcMock }),
}));

import { NotificationBell } from "./notification-bell";

const rows: NotificationRow[] = [
  {
    id: "n-unread",
    kind: "story_submitted",
    story_id: "s1",
    revision_id: "r1",
    story_title: "Vineyard season in Marlborough",
    story_slug: "vineyard-season-abc",
    reason: null,
    read_at: null,
    created_at: new Date(Date.now() - 5 * 60_000).toISOString(),
  },
  {
    id: "n-read",
    kind: "story_published",
    story_id: "s2",
    revision_id: "r2",
    story_title: "Wwoofing near Nelson",
    story_slug: "wwoofing-nelson-def",
    reason: null,
    read_at: new Date().toISOString(),
    created_at: new Date(Date.now() - 3 * 3_600_000).toISOString(),
  },
  {
    id: "n-changes",
    kind: "story_changes_requested",
    story_id: "s3",
    revision_id: "r3",
    story_title: "Hostel work in Queenstown",
    story_slug: "hostel-queenstown-ghi",
    reason: "Could you add roughly what the hostel paid per week?",
    read_at: null,
    created_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  },
];

/**
 * Routes each RPC by name. `unread` is mutable so a test can watch the
 * badge follow the server's count after a mark-read round trip.
 */
function stubRpc(state: { unread: number; list: NotificationRow[] }) {
  rpcMock.mockImplementation((fn: string, args?: { p_ids?: string[] }) => {
    switch (fn) {
      case "count_my_unread_notifications":
        return Promise.resolve({ data: state.unread, error: null });
      case "list_my_notifications":
        return Promise.resolve({ data: state.list, error: null });
      case "mark_my_notifications_read": {
        const ids = args?.p_ids;
        state.list = state.list.map((row) =>
          !ids || ids.includes(row.id)
            ? { ...row, read_at: row.read_at ?? new Date().toISOString() }
            : row,
        );
        state.unread = state.list.filter((row) => row.read_at === null).length;
        return Promise.resolve({ data: 1, error: null });
      }
      default:
        return Promise.resolve({ data: null, error: { message: `no ${fn}` } });
    }
  });
}

beforeEach(() => {
  rpcMock.mockReset();
});

describe("NotificationBell", () => {
  it("shows the unread count in the badge and the accessible name", async () => {
    stubRpc({ unread: 3, list: rows });
    render(<NotificationBell />);
    const button = await screen.findByRole("button", {
      name: "Notifications, 3 unread",
    });
    expect(button).toHaveTextContent("3");
  });

  it("shows no badge and a plain name when nothing is unread", async () => {
    stubRpc({ unread: 0, list: [] });
    render(<NotificationBell />);
    const button = await screen.findByRole("button", { name: "Notifications" });
    expect(button).toHaveTextContent("");
    expect(rpcMock).toHaveBeenCalledWith("count_my_unread_notifications");
    // The list is not fetched until the dropdown opens.
    expect(rpcMock).not.toHaveBeenCalledWith(
      "list_my_notifications",
      expect.anything(),
    );
  });

  it("caps the badge at 9+", async () => {
    stubRpc({ unread: 42, list: rows });
    render(<NotificationBell />);
    const button = await screen.findByRole("button", {
      name: "Notifications, 42 unread",
    });
    expect(button).toHaveTextContent("9+");
  });

  it("opens to list each notification as a link to the right place", async () => {
    stubRpc({ unread: 1, list: rows });
    render(<NotificationBell />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Notifications/ }),
    );

    const review = await screen.findByRole("menuitem", {
      name: /New story to review/,
    });
    expect(review).toHaveAttribute("href", "/moderation/stories/r1");
    expect(review).toHaveTextContent("Vineyard season in Marlborough");
    expect(review).toHaveTextContent("(unread)");

    const live = screen.getByRole("menuitem", { name: /Your story is live/ });
    expect(live).toHaveAttribute("href", "/stories/wwoofing-nelson-def");
    expect(live).not.toHaveTextContent("(unread)");

    // A decision carries the moderator's reason into the panel itself.
    const changes = screen.getByRole("menuitem", {
      name: /Changes requested on your story/,
    });
    expect(changes).toHaveAttribute("href", "/my-stories");
    expect(changes).toHaveTextContent(
      "Could you add roughly what the hostel paid per week?",
    );
    // The other kinds render no reason line at all.
    expect(review).not.toHaveTextContent("Could you");
  });

  it("marks a notification read when its link is clicked", async () => {
    // Two unread rows in the fixture; clicking one leaves the other.
    const state = { unread: 2, list: rows };
    stubRpc(state);
    render(<NotificationBell />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Notifications/ }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /New story to review/ }),
    );

    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith("mark_my_notifications_read", {
        p_ids: ["n-unread"],
      }),
    );
    // Badge follows: optimistic drop, then confirmed by the re-count.
    await screen.findByRole("button", { name: "Notifications, 1 unread" });
    // The dropdown closes so the navigation is not hidden behind it.
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("'Mark all read' clears everything with one call and hides itself", async () => {
    const state = { unread: 2, list: rows };
    stubRpc(state);
    render(<NotificationBell />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Notifications/ }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Mark all read" }),
    );

    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith("mark_my_notifications_read", {
        p_ids: undefined,
      }),
    );
    await screen.findByRole("button", { name: "Notifications" });
    expect(
      screen.queryByRole("button", { name: "Mark all read" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /New story to review/ }),
    ).not.toHaveTextContent("(unread)");
  });

  it("shows an empty state, not a blank panel, when the inbox is empty", async () => {
    stubRpc({ unread: 0, list: [] });
    render(<NotificationBell />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Notifications" }),
    );
    expect(
      await screen.findByText("You're all caught up."),
    ).toBeInTheDocument();
  });

  it("offers a retry when the list fails to load", async () => {
    rpcMock.mockImplementation((fn: string) =>
      fn === "count_my_unread_notifications"
        ? Promise.resolve({ data: 1, error: null })
        : Promise.resolve({ data: null, error: { message: "boom" } }),
    );
    render(<NotificationBell />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Notifications/ }),
    );
    expect(
      await screen.findByText(/Couldn't load notifications/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    stubRpc({ unread: 0, list: [] });
    render(<NotificationBell />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Notifications" }),
    );
    expect(await screen.findByRole("menu")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
