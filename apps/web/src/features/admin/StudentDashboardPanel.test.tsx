import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import type { Student, StudentDashboard } from "../../api/types";
import { StudentDashboardPanel } from "./StudentDashboardPanel";

vi.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ me: { userId: "coach", organizationId: "org", kind: "Adult", role: "Admin" } }) }));
vi.mock("../../api/client", () => ({ api: { studentDashboard: vi.fn() } }));

beforeEach(() => { vi.clearAllMocks(); });

if (typeof HTMLDialogElement !== "undefined" && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
}

const student: Student = { userId: "student-1", userName: "jdoe", displayName: "Jane Doe", email: null, isActive: true };

const dashboard: StudentDashboard = {
  student: { userId: "student-1", displayName: "Jane Doe", userName: "jdoe", isActive: true },
  season: { id: "season-1", name: "2026 Season", status: "Active" },
  effort: {
    weeklyTarget: 5, completedDays: 3, weekStartLocalDate: "2026-09-14", timeZone: "UTC",
    days: Array.from({ length: 7 }, (_, i) => ({ localDate: `2026-09-${14 + i}`, credited: i < 3, isToday: i === 1 })),
    streakDays: 3, sessionsLast7Days: 4, lastActivityAtUtc: "2026-09-15T10:00:00Z",
  },
  progress: {
    eligibleCount: 10, seenCount: 6, strongCount: 3, masteredCount: 1, reviewDueCount: 2, attemptCount: 40,
    chapters: [{ bookKey: "JHN", chapter: 3, eligibleCount: 10, seenCount: 6, strongCount: 3, masteredCount: 1 }],
  },
  mastery: {
    badges: [{ key: "steady-study", ruleVersion: "training-v1", title: "Steady Study", completed: 1, target: 1, earnedAtUtc: "2026-09-10T00:00:00Z", scopeLabel: "Assigned scope", evidenceSessionId: null }],
    levelCounts: [{ level: "Mastered", count: 1 }, { level: "Strong", count: 2 }, { level: "Unseen", count: 4 }],
  },
  assignments: [{ id: "a1", studentUserId: "student-1", type: "PrimarySpecialist", bookKey: "JHN", startChapter: 3, startVerse: 16, endChapter: 3, endVerse: 18, difficulty: "Standard" }],
  recentActivity: [{ sessionId: "s1", mode: "Practice", format: "Memory", createdAtUtc: "2026-09-15T10:00:00Z", completedAtUtc: "2026-09-15T10:20:00Z", attempted: 8, correct: 6, fullTargetReached: true }],
};

function mount() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><StudentDashboardPanel student={student} onClose={() => {}} /></QueryClientProvider>);
}

it("renders every dashboard section with the student's data", async () => {
  vi.mocked(api.studentDashboard).mockResolvedValue(dashboard);
  mount();
  expect(await screen.findByTestId("student-dashboard-effort")).toBeInTheDocument();
  expect(screen.getByText((_, el) => el?.textContent === "2026 Season · 3 of 5 study days")).toBeInTheDocument();
  expect(screen.getByTestId("student-dashboard-progress")).toBeInTheDocument();
  expect(screen.getByText("6 / 10")).toBeInTheDocument();
  expect(screen.getByTestId("student-dashboard-mastery")).toBeInTheDocument();
  expect(screen.getByText("First Steps")).toBeInTheDocument();
  expect(screen.getByTestId("student-dashboard-assignments")).toBeInTheDocument();
  expect(screen.getByText("JHN 3:16–18")).toBeInTheDocument();
  expect(screen.getByTestId("student-dashboard-activity")).toBeInTheDocument();
  expect(screen.getByText("6 / 8 correct")).toBeInTheDocument();
  expect(api.studentDashboard).toHaveBeenCalledWith("org", "student-1", expect.any(AbortSignal));
});

it("shows a retry notice when the dashboard fails to load", async () => {
  vi.mocked(api.studentDashboard).mockRejectedValue(new Error("nope"));
  mount();
  expect(await screen.findByText(/could not load/)).toBeInTheDocument();
});

it("closes when the close button is activated", async () => {
  vi.mocked(api.studentDashboard).mockResolvedValue(dashboard);
  const onClose = vi.fn();
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><StudentDashboardPanel student={student} onClose={onClose} /></QueryClientProvider>);
  await screen.findByTestId("student-dashboard-effort");
  fireEvent.click(screen.getByRole("button", { name: "Close Jane Doe dashboard" }));
  expect(onClose).toHaveBeenCalledTimes(1);
});
