import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { NotificationRow } from "@/lib/notifications/notification-view";

const { markReadMock } = vi.hoisted(() => ({ markReadMock: vi.fn() }));

// Same "use server" / server-only jsdom incompatibility every component
// test importing a Server Action works around (see site-header.test.tsx).
vi.mock("./actions", () => ({
  markNotificationsReadAction: markReadMock,
}));

import { NOTIFICATIONS_CHANGED_EVENT } from "@/lib/notifications/notifications-changed";
import { NotificationsList } from "./notifications-list";

const NOW = "2026-09-12T12:00:00Z";

const rows: NotificationRow[] = [
  {
    id: "n1",
    kind: "story_changes_requested",
    story_id: "s1",
    revision_id: "r1",
    story_title: "Hostel work in Queenstown",
    story_slug: "hostel-queenstown-ghi",
    reason: "Could you add roughly what the hostel paid per week?",
    read_at: null,
    created_at: "2026-09-12T11:48:00Z",
  },
  {
    id: "n2",
    kind: "story_published",
    story_id: "s2",
    revision_id: "r2",
    story_title: "Opotiki Trip",
    story_slug: "opotiki-trip-2f2754f0",
    reason: null,
    read_at: "2026-09-12T09:00:00Z",
    created_at: "2026-09-12T09:00:00Z",
  },
];

beforeEach(() => {
  markReadMock.mockReset();
});

describe("NotificationsList", () => {
  it("tells the reader what is waiting, and links each row to its own place", () => {
    render(<NotificationsList notifications={rows} now={NOW} />);

    expect(screen.getByText("1 unread of 2")).toBeInTheDocument();

    const changes = screen.getByRole("link", {
      name: /Changes requested on your story/,
    });
    expect(changes).toHaveAttribute("href", "/my-stories");
    expect(
      screen.getByText("Could you add roughly what the hostel paid per week?"),
    ).toBeInTheDocument();

    expect(
      screen.getByRole("link", { name: /Your story is live/ }),
    ).toHaveAttribute("href", "/stories/opotiki-trip-2f2754f0");
  });

  it("marks unread rows for assistive tech and gives only those a Mark read button", () => {
    render(<NotificationsList notifications={rows} now={NOW} />);

    expect(
      screen.getByRole("link", { name: /Changes requested on your story/ }),
    ).toHaveTextContent("(unread)");
    expect(
      screen.getByRole("link", { name: /Your story is live/ }),
    ).not.toHaveTextContent("(unread)");

    // One per-row button (the unread row) plus the global one.
    expect(screen.getAllByRole("button", { name: "Mark read" })).toHaveLength(
      1,
    );
    expect(
      screen.getByRole("button", { name: "Mark all as read" }),
    ).toBeInTheDocument();
  });

  it("carries the row's id in its own form, and nothing in the mark-all form", () => {
    const { container } = render(
      <NotificationsList notifications={rows} now={NOW} />,
    );
    const ids = Array.from(
      container.querySelectorAll<HTMLInputElement>(
        'input[name="notificationId"]',
      ),
    ).map((input) => input.value);
    // Exactly the unread row -- an empty mark-all form is what means "all".
    expect(ids).toEqual(["n1"]);
  });

  it("hides both mark-read affordances once everything is read", () => {
    const allRead = rows.map((row) => ({
      ...row,
      read_at: row.read_at ?? NOW,
    }));
    render(<NotificationsList notifications={allRead} now={NOW} />);

    expect(screen.getByText("2 notifications, all read")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Mark all as read" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Mark read" }),
    ).not.toBeInTheDocument();
  });

  it("renders relative ages from the server's clock, not the browser's", () => {
    render(<NotificationsList notifications={rows} now={NOW} />);
    expect(screen.getByText("12 min ago")).toBeInTheDocument();
    expect(screen.getByText("3 hours ago")).toBeInTheDocument();
  });

  it("shows a real empty state rather than a bare page", () => {
    render(<NotificationsList notifications={[]} now={NOW} />);
    expect(screen.getByText("Nothing here yet")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Go to My Stories" }),
    ).toHaveAttribute("href", "/my-stories");
    expect(
      screen.queryByRole("button", { name: "Mark all as read" }),
    ).not.toBeInTheDocument();
  });

  it("tells the header bell to re-count after a successful mark-read", async () => {
    const heard = vi.fn();
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, heard);
    // The action's real return shape: markedAt changes on every success,
    // which is what the list keys its event off.
    markReadMock.mockResolvedValue({ markedAt: "2026-09-12T12:00:01Z" });

    render(<NotificationsList notifications={rows} now={NOW} />);
    expect(heard).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Mark all as read" }));
    await waitFor(() => expect(heard).toHaveBeenCalledTimes(1));

    window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, heard);
  });

  it("stays quiet when the action fails", async () => {
    const heard = vi.fn();
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, heard);
    markReadMock.mockResolvedValue({
      error: "Could not update notifications.",
    });

    render(<NotificationsList notifications={rows} now={NOW} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark all as read" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not update notifications.",
    );
    expect(heard).not.toHaveBeenCalled();

    window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, heard);
  });

  it("uses the singular for one notification", () => {
    render(<NotificationsList notifications={[{ ...rows[1] }]} now={NOW} />);
    expect(screen.getByText("1 notification, all read")).toBeInTheDocument();
  });
});
