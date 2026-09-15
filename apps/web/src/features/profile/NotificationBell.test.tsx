import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { NotificationBell } from "./NotificationBell";

vi.mock("../../api/client", () => ({ api: { notifications: vi.fn(), markNotificationsRead: vi.fn() } }));

beforeEach(() => { vi.clearAllMocks(); });

function mount() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><NotificationBell /></QueryClientProvider>);
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
