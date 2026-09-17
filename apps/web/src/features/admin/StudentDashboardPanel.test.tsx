import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import type { Student, StudentDashboard } from "../../api/types";
import { StudentDashboardPanel } from "./StudentDashboardPanel";

vi.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ me: { userId: "coach", organizationId: "org", kind: "Adult", role: "Admin" } }) }));
vi.mock("../../api/client", () => ({ api: {
  studentDashboard: vi.fn(),
  studentSessionRecap: vi.fn(),
  studentSessionHistory: vi.fn(async () => ({ sessions: [], nextBefore: null })),
  studentExportCsvUrl: (org: string, student: string) => `/api/v1/organizations/${org}/students/${student}/export.csv`,
} }));

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
    streakDays: 3, streakState: "active", bestStreak: 5, streakHistory: [], sessionsLast7Days: 4, lastActivityAtUtc: "2026-09-15T10:00:00Z",
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
  social: { leaderboardOptIn: true, teamPracticeSessions: 4 },
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
  expect(within(screen.getByTestId("student-dashboard-mastery")).getByText("Mastered")).toBeInTheDocument();
  expect(screen.getByTestId("student-dashboard-assignments")).toBeInTheDocument();
  expect(screen.getByText("JHN 3:16–18")).toBeInTheDocument();
  expect(screen.getByTestId("student-dashboard-activity")).toBeInTheDocument();
  expect(screen.getByText("6 / 8 correct")).toBeInTheDocument();
  expect(api.studentDashboard).toHaveBeenCalledWith("org", "student-1", expect.any(AbortSignal));
});

it("shows streak state, best streak and the 90-day practice history", async () => {
  vi.mocked(api.studentDashboard).mockResolvedValue({
    ...dashboard,
    effort: {
      ...dashboard.effort,
      streakHistory: Array.from({ length: 90 }, (_, i) => ({ localDate: `2026-06-${String(20 + (i % 10)).padStart(2, "0")}`, credited: i % 3 === 0 })),
    },
  });
  mount();
  await screen.findByTestId("student-dashboard-effort");
  const effort = within(screen.getByTestId("student-dashboard-effort"));
  expect(effort.getByText("Streak state")).toBeInTheDocument();
  expect(effort.getByText("Active")).toBeInTheDocument();
  expect(effort.getByText("Best streak")).toBeInTheDocument();
  expect(effort.getByText("5 days")).toBeInTheDocument();
  expect(screen.getByRole("img", { name: /Practice history: 30 of the last 90 days credited/ })).toBeInTheDocument();
  expect(screen.getByText(/One missed day pauses the streak/)).toBeInTheDocument();
});

it("opens a session recap drill-down when a recent activity row is activated", async () => {
  vi.mocked(api.studentDashboard).mockResolvedValue(dashboard);
  vi.mocked(api.studentSessionRecap).mockResolvedValue({
    version: "training-v1", sessionId: "s1", seasonId: "season-1", mode: "Practice", completedAtUtc: "2026-09-15T10:20:00Z",
    attempted: 8, correct: 6, targetCardCount: 8, fullTargetReached: true, newlyCreditedDay: true,
    missionLocalDate: "2026-09-15", creditedLocalDate: "2026-09-15", weeklyGoalComplete: false, personalBest: null,
    xp: { earned: 80, total: 200, level: 2, levelName: "Seeker" }, levelUp: null,
    missionSteps: [], earnedBadges: [], passageChanges: [],
  });
  mount();
  await screen.findByTestId("student-dashboard-activity");
  fireEvent.click(screen.getByRole("button", { name: /View Practice session recap/ }));
  expect(await screen.findByTestId("student-session-recap-dialog")).toBeInTheDocument();
  expect(api.studentSessionRecap).toHaveBeenCalledWith("org", "student-1", "s1");
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

it("renders the paginated session history with per-session XP and a CSV download", async () => {
  vi.mocked(api.studentDashboard).mockResolvedValue(dashboard);
  vi.mocked(api.studentSessionHistory)
    .mockResolvedValueOnce({
      sessions: [{ sessionId: "s2", mode: "Review", format: "Pbe", completedAtUtc: "2026-09-17T10:30:00Z", attempted: 10, correct: 9, xpEarned: 58 }],
      nextBefore: "2026-09-17T10:30:00Z",
    })
    .mockResolvedValueOnce({
      sessions: [{ sessionId: "s1", mode: "Practice", format: "Memory", completedAtUtc: "2026-09-16T10:30:00Z", attempted: 8, correct: 6, xpEarned: 42 }],
      nextBefore: null,
    });
  mount();
  expect(await screen.findByTestId("student-dashboard-history")).toBeInTheDocument();
  expect(screen.getByText("9 / 10 correct · +58 XP")).toBeInTheDocument();
  const download = screen.getByRole("link", { name: "Download full history (CSV)" });
  expect(download).toHaveAttribute("href", "/api/v1/organizations/org/students/student-1/export.csv");
  fireEvent.click(screen.getByRole("button", { name: "Load more sessions" }));
  expect(await screen.findByText("6 / 8 correct · +42 XP")).toBeInTheDocument();
  expect(api.studentSessionHistory).toHaveBeenLastCalledWith("org", "student-1", "2026-09-17T10:30:00Z");
});

it("shows the student's leaderboard visibility and Team Practice session count", async () => {
  vi.mocked(api.studentDashboard).mockResolvedValue(dashboard);
  const first = mount();
  const social = await screen.findByTestId("student-dashboard-social");
  expect(within(social).getByText("Visible to teammates")).toBeInTheDocument();
  expect(within(social).getByText("4")).toBeInTheDocument();
  first.unmount();
  vi.mocked(api.studentDashboard).mockResolvedValue({ ...dashboard, social: { leaderboardOptIn: false, teamPracticeSessions: 0 } });
  mount();
  const hidden = await screen.findByTestId("student-dashboard-social");
  expect(within(hidden).getByText("Hidden from teammates")).toBeInTheDocument();
});
