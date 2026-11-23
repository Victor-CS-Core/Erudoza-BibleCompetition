import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { NotificationBell } from "./NotificationBell";

vi.mock("../../api/client", () => ({ api: { notifications: vi.fn(), markNotificationsRead: vi.fn(), markNotificationRead: vi.fn() } }));

beforeEach(() => { vi.clearAllMocks(); vi.mocked(api.markNotificationRead).mockResolvedValue({ unreadCount: 0 }); });

function mount() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><NotificationBell /></MemoryRouter></QueryClientProvider>);
}

const notification = (changes: object) => ({
  id: `notification-${Math.random()}`,
  seasonId: "season",
  seasonName: "Fall 2026",
  studentUserId: "student",
  actorUserId: "coach",
  actorDisplayName: "Coach Maya",
  action: "added" as const,
  citation: "John 3:16–18",
  summary: "Coach Maya added John 3:16–18",
  readAtUtc: null,
  createdAtUtc: new Date(Date.now() - 5 * 60_000).toISOString(),
  ...changes,
});

it("shows an unread badge and lists short descriptions in the panel", async () => {
  vi.mocked(api.notifications).mockResolvedValue({ notifications: [notification({}), notification({ id: "read", readAtUtc: "2026-09-15T10:00:00Z", summary: "Coach Maya removed Daniel 1" })], unreadCount: 1 });
  mount();
  const bell = await screen.findByRole("button", { name: "Notifications, 1 unread" });
  expect(bell).toHaveTextContent("1");
  fireEvent.click(bell);
  expect(await screen.findByText("Coach Maya added John 3:16–18")).toBeInTheDocument();
  expect(screen.getByText("Coach Maya removed Daniel 1")).toBeInTheDocument();
  expect(screen.getAllByText(/Fall 2026/)).toHaveLength(2);
});

it("marks all notifications read and clears the badge", async () => {
  vi.mocked(api.notifications).mockResolvedValue({ notifications: [notification({})], unreadCount: 1 });
  vi.mocked(api.markNotificationsRead).mockResolvedValue({ unreadCount: 0 });
  mount();
  fireEvent.click(await screen.findByRole("button", { name: /Notifications/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Mark all read" }));
  expect(vi.mocked(api.markNotificationsRead)).toHaveBeenCalled();
  expect(await screen.findByRole("button", { name: "Notifications" })).toBeInTheDocument();
});

it("explains an empty inbox", async () => {
  vi.mocked(api.notifications).mockResolvedValue({ notifications: [], unreadCount: 0 });
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Notifications" }));
  expect(await screen.findByText("You're all caught up.")).toBeInTheDocument();
});

function mountWithRouter() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><NotificationBell /></MemoryRouter></QueryClientProvider>);
}

it("links assigned and rescheduled team-practice notifications to their event card", async () => {
  vi.mocked(api.notifications).mockResolvedValue({ notifications: [
    notification({ id: "assigned", type: "team-practice", eventId: "event-1", action: "assigned" as const, summary: "Coach Maya assigned you to Head-to-head practice · Fall 2026 — join now" }),
    notification({ id: "rescheduled", type: "team-practice", eventId: "event-2", action: "rescheduled" as const, summary: "Coach Maya moved Head-to-head practice · Fall 2026 to Friday" }),
  ], unreadCount: 2 });
  mountWithRouter();
  fireEvent.click(await screen.findByRole("button", { name: /Notifications/ }));
  expect(await screen.findByRole("link", { name: /assigned you to/ })).toHaveAttribute("href", "/student/practice#event-event-1");
  expect(screen.getByRole("link", { name: /moved Head-to-head/ })).toHaveAttribute("href", "/student/practice#event-event-2");
});

it("links assignment notifications to the season's assigned passages and marks the item read on click", async () => {
  vi.mocked(api.notifications).mockResolvedValue({ notifications: [notification({ id: "assign-1" })], unreadCount: 1 });
  mountWithRouter();
  fireEvent.click(await screen.findByRole("button", { name: /Notifications/ }));
  const link = await screen.findByRole("link", { name: /added John/ });
  expect(link).toHaveAttribute("href", "/student?seasonId=season#assigned-passages");
  fireEvent.click(link);
  expect(vi.mocked(api.markNotificationRead)).toHaveBeenCalledWith("assign-1");
});

it("does not link removed or cancelled team-practice notifications — the event card no longer exists", async () => {
  vi.mocked(api.notifications).mockResolvedValue({ notifications: [
    notification({ id: "removed", type: "team-practice", eventId: "event-1", action: "removed" as const, summary: "Coach Maya removed you from Head-to-head practice · Fall 2026" }),
    notification({ id: "cancelled", type: "team-practice", eventId: "event-2", action: "cancelled" as const, summary: "Coach Maya cancelled Head-to-head practice · Fall 2026" }),
  ], unreadCount: 2 });
  mountWithRouter();
  fireEvent.click(await screen.findByRole("button", { name: /Notifications/ }));
  expect(await screen.findByText(/removed you from/)).toBeInTheDocument();
  expect(screen.getByText(/cancelled Head-to-head/)).toBeInTheDocument();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});
