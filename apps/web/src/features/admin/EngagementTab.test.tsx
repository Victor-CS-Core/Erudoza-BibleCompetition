import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import type { EngagementRow } from "../../api/types";
import { EngagementTab } from "./EngagementTab";

vi.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ me: { userId: "coach", organizationId: "org", kind: "Adult", role: "Admin" } }) }));
vi.mock("../../api/client", () => ({ api: { engagement: vi.fn() } }));

beforeEach(() => { vi.clearAllMocks(); });

const rows: EngagementRow[] = [
  { studentId: "s1", name: "Ava", streak: 5, xpThisWeek: 420, practiceDaysThisWeek: 5, level: 3, levelName: "Reader", honorsEarned: 2, lastActiveAtUtc: new Date(Date.now() - 3600_000).toISOString() },
  { studentId: "s2", name: "Ben", streak: 0, xpThisWeek: 0, practiceDaysThisWeek: 0, level: 1, levelName: "Seedling", honorsEarned: 0, lastActiveAtUtc: null },
  { studentId: "s3", name: "Cleo", streak: 12, xpThisWeek: 900, practiceDaysThisWeek: 7, level: 5, levelName: "Scribe", honorsEarned: 5, lastActiveAtUtc: new Date(Date.now() - 86400_000 * 3).toISOString() },
];

function mount() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><EngagementTab /></QueryClientProvider>);
}

it("renders one row per student with streak, XP, level and last-active", async () => {
  vi.mocked(api.engagement).mockResolvedValue(rows);
  mount();
  expect(await screen.findByTestId("engagement-table")).toBeInTheDocument();
  expect(screen.getByText("Ava")).toBeInTheDocument();
  expect(screen.getByText("12 days")).toBeInTheDocument();
  expect(screen.getByText("Scribe")).toBeInTheDocument();
  expect(screen.getByText("No practice this week")).toBeInTheDocument();
  expect(screen.getByText("3 days ago")).toBeInTheDocument();
  expect(api.engagement).toHaveBeenCalledWith("org");
});

it("sorts by column when the heading is clicked", async () => {
  vi.mocked(api.engagement).mockResolvedValue(rows);
  mount();
  await screen.findByTestId("engagement-table");
  const nameCells = () => screen.getAllByRole("row").slice(1).map(r => (r as HTMLTableRowElement).cells[0]?.textContent ?? "");
  // Default: practice days ascending — Ben (0) first.
  expect(nameCells()[0]).toContain("Ben");
  // Sort by XP: numeric columns default to descending — Cleo first.
  fireEvent.click(screen.getByRole("button", { name: "Sort by XP this week" }));
  expect(nameCells()[0]).toContain("Cleo");
  // Sort by name ascending: Ava first.
  fireEvent.click(screen.getByRole("button", { name: "Sort by Student" }));
  expect(nameCells()[0]).toContain("Ava");
});

it("shows a retry notice when the engagement feed fails", async () => {
  vi.mocked(api.engagement).mockRejectedValue(new Error("nope"));
  mount();
  expect(await screen.findByText("Engagement could not load.")).toBeInTheDocument();
});
