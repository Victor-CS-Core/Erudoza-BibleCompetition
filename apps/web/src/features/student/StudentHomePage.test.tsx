import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { trainingApi } from "../../api/training";
import { StudentHomePage } from "./StudentHomePage";
import { todayFixture, journeyFixture, questFixture } from "./trainingFixtures";
vi.mock("../../api/client", () => ({ api: { progress: vi.fn(), assignedSeasons: vi.fn(), teamActivity: vi.fn(), leaderboard: vi.fn(), setLeaderboardOptIn: vi.fn(), myAssignments: vi.fn() } }));
vi.mock("../../api/training", () => ({ trainingApi: { today: vi.fn(), journey: vi.fn(), chapters: vi.fn(), continueChapters: vi.fn(), cooperation: vi.fn(), continueCooperation: vi.fn() } }));
const account = vi.hoisted(() => ({ organizationId: "org", userId: "student", kind: "Student" }));
vi.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ me: account }) }));
function Location() { return <output aria-label="Current search">{useLocation().search}</output>; }
function home() { render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><StudentHomePage /><Location /></MemoryRouter></QueryClientProvider>); }
beforeEach(() => { account.kind = "Student"; vi.mocked(trainingApi.journey).mockResolvedValue(journeyFixture()); vi.mocked(trainingApi.today).mockResolvedValue(todayFixture()); vi.mocked(api.assignedSeasons).mockResolvedValue([{ id: "s", name: "Daniel" }, { id: "other", name: "Joshua" }]); vi.mocked(api.teamActivity).mockResolvedValue({ practicedToday: 2, practicedThisWeek: 4, memberCount: 6 }); vi.mocked(api.leaderboard).mockResolvedValue({ weekStartLocalDate: "2026-09-14", entries: [], me: { userId: "student", rank: null, xp: 0, optedIn: false } }); vi.mocked(api.setLeaderboardOptIn).mockResolvedValue({ leaderboardOptIn: true }); vi.mocked(api.progress).mockResolvedValue(hqProgressFixture()); vi.mocked(api.myAssignments).mockResolvedValue([{ id: 'a1', studentUserId: 'student', type: 'Primary', bookKey: 'Daniel', startChapter: 1, startVerse: 1, endChapter: 1, endVerse: 3 }] as never); });
function hqProgressFixture() { return { seasonId: 's', seasonName: 'Daniel', seasonStatus: 'Active', assignments: [{ id: 'a1', studentUserId: 'student', type: 'Primary', bookKey: 'Daniel', startChapter: 1, startVerse: 1, endChapter: 1, endVerse: 3, difficulty: 'Standard' }], masteredCount: 1, reviewDueCount: 2, attemptCount: 5, mastery: [{ knowledgeUnitId: 'ku-1', title: 'Daniel 1:1', level: 'Review', exactWordingScore: 60, recognitionScore: 60, bookKey: 'Daniel', chapter: 1, verse: 1, reviewDueAtUtc: '2026-09-01T00:00:00Z' }, { knowledgeUnitId: 'ku-2', title: 'Daniel 1:2', level: 'Strong', exactWordingScore: 95, recognitionScore: 95, bookKey: 'Daniel', chapter: 1, verse: 2, reviewDueAtUtc: null }], recentAttempts: [{ id: 'att-1', title: 'Daniel 1:1', activityType: 'MissingWords', isCorrect: true, submittedAnswer: 'In the third year', evaluationResult: 'Correct', createdAtUtc: '2026-09-10T00:00:00Z' }] } as never; }
it("uses bounded today and carries frozen mission and selected season into review", async () => { home(); expect(await screen.findByRole("link", { name: "Continue review" })).toHaveAttribute("href", "/student/study?mode=Review&sessionId=r&step=Review&missionId=m&missionRevision=3&seasonId=s"); expect(await screen.findByTestId("progress-attempts")).toHaveTextContent("5"); expect(screen.getByText("2 of 4 passages completed")).toBeInTheDocument(); expect(screen.getByTestId("start-simulation")).toHaveAttribute("href", "/student/study?mode=Simulation&seasonId=s"); });
it("invalidated missions explain scope changes and do not start study", async () => { const data = todayFixture(); vi.mocked(trainingApi.today).mockResolvedValue({ ...data, mission: { ...data.mission, status: "Invalidated" } }); home(); expect(await screen.findByTestId("academy-track-unavailable")).toHaveTextContent("passages changed"); expect(screen.queryByTestId("start-todays-deck")).not.toBeInTheDocument(); });
it("unassigned students receive honest recovery", async () => { vi.mocked(trainingApi.today).mockResolvedValue(todayFixture({ seasonId: null, seasonStatus: "None", mission: { id: null, revision: null, status: "Unavailable", scopeVersion: null, explanation: null, steps: [] }, nextAction: null })); home(); expect(await screen.findByText("Your coach will add your study assignment here.")).toBeInTheDocument(); expect(screen.getByText("Nothing assigned yet. When your coach adds passages, they will show up here.")).toBeInTheDocument(); });
it("retries failures without showing zero progress", async () => { vi.mocked(trainingApi.today).mockRejectedValueOnce(new Error("offline")); home(); expect(await screen.findByRole("alert")).toHaveTextContent("could not load"); fireEvent.click(screen.getByRole("button", { name: "Try again" })); expect(await screen.findByRole("link", { name: "Continue review" })).toBeInTheDocument(); });
it("switches the bounded request and retained season", async () => { vi.mocked(trainingApi.today).mockImplementation(async id => todayFixture({ seasonId: id ?? "s" })); home(); fireEvent.change(await screen.findByLabelText("Assigned season"), { target: { value: "other" } }); expect(await screen.findByRole("link", { name: "Continue review" })).toHaveAttribute("href", expect.stringContaining("seasonId=other")); });
it("shows the quest board rewards and the triple bonus note", async () => {
  vi.mocked(trainingApi.today).mockResolvedValue(todayFixture({ quests: [questFixture({ xpReward: 25 }), questFixture({ key: "sharpshooter", title: "Sharpshooter" }), questFixture({ key: "marathon", title: "Marathon" })] }));
  home();
  expect(await screen.findByRole("heading", { name: "Today’s bonus quests" })).toBeInTheDocument();
  expect(screen.getAllByText("+25 XP")).toHaveLength(3);
  expect(screen.getByText("Finish all three for a +25 XP triple bonus.")).toBeInTheDocument();
});
it("collapses a finished quest to one completion signal", async () => {
  vi.mocked(trainingApi.today).mockResolvedValue(todayFixture({ quests: [questFixture({ key: "sharpshooter", title: "Done quest", completed: true, progress: 3, target: 3 }), questFixture({ key: "marathon", title: "Open quest", completed: false, progress: 1, target: 3 })] }));
  home();
  expect(await screen.findByRole("heading", { name: "Today’s bonus quests" })).toBeInTheDocument();
  const doneItem = screen.getByText("Done quest").closest("li")!;
  expect(within(doneItem).getByText("Completed")).toBeInTheDocument();
  expect(within(doneItem).queryByText("Done")).not.toBeInTheDocument();
  expect(within(doneItem).queryByText("3 of 3")).not.toBeInTheDocument();
  expect(screen.getByText("1 of 3 done")).toBeInTheDocument();
});
it("shows the XP rank, not a level", async () => {
  home();
  expect(await screen.findByRole("heading", { name: /Rank \d/ })).toBeInTheDocument();
  expect(screen.getByLabelText("Progress to the next rank")).toBeInTheDocument();
});

it("shows the practiced-today state and a weekly heatmap on the streak panel", async () => {
  home();
  expect(await screen.findByRole("heading", { name: "This week" })).toBeInTheDocument();
  expect(screen.getByText("Practiced today")).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "This week: 1 of 1 days practiced" })).toBeInTheDocument();
});

it("shows a not-yet-today state when today is not credited", async () => {
  vi.mocked(trainingApi.today).mockResolvedValue(todayFixture({ week: { weekStartLocalDate: "2026-09-07", timeZone: "America/New_York", target: 5, completedDays: 0, days: [{ localDate: "2026-09-11", credited: false, isToday: true }] } }));
  home();
  expect(await screen.findByRole("heading", { name: "This week" })).toBeInTheDocument();
  expect(screen.getByText("Not yet today")).toBeInTheDocument();
});

it("starts an updated invalidated mission without stale identifiers", async () => { const data = todayFixture(); vi.mocked(trainingApi.today).mockResolvedValue({ ...data, mission: { ...data.mission, status: "Invalidated" } }); home(); const action = await screen.findByRole("link", { name: "Start updated training" }); expect(action).toHaveAttribute("href", "/student/study?mode=Review&step=Review&seasonId=s"); });
it("completed missions link their saved recap without a next action", async () => { const data = todayFixture(); vi.mocked(trainingApi.today).mockResolvedValue({ ...data, nextAction: null, mission: { ...data.mission, status: "Complete", steps: [{ kind: "Review", target: 4, completed: 4, status: "Complete", sessionId: "review-done" }, { kind: "Practice", target: 8, completed: 8, status: "Complete", sessionId: "practice-done" }] } }); home(); expect(await screen.findByRole("link", { name: "See today’s recap" })).toHaveAttribute("href", "/student/sessions/practice-done/recap?seasonId=s"); });

it("counts an unneeded review as resolved without inventing completed practice", async () => {
  const data = todayFixture();
  data.mission.steps[0] = { kind: "Review", target: 0, completed: 0, status: "NotNeeded", sessionId: null };
  data.nextAction = { label: "Start daily drill", mode: "Practice", sessionId: null };
  vi.mocked(trainingApi.today).mockResolvedValue(data);
  home();
  expect(await screen.findByText("No review needed today")).toBeInTheDocument();
  expect(screen.getByText("0 of 8 cards completed")).toBeInTheDocument();
  expect(screen.queryByRole("progressbar", { name: "Today's training steps" })).not.toBeInTheDocument();
});

it("labels effort-based sidebar progress as a milestone", async () => {
  home(); expect(await screen.findByRole("heading", { name: "Your next milestone" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Your next Honor" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "View Achievement patches and requirements" })).toHaveAttribute("href", "/student/honors?seasonId=s");
});

it("offers coaches personal assignments from an empty Training HQ", async () => {
 account.kind = "Adult";
 vi.mocked(trainingApi.today).mockResolvedValue(todayFixture({ seasonId: null, seasonStatus: "None", mission: { id: null, revision: null, status: "Unavailable", scopeVersion: null, explanation: null, steps: [] }, nextAction: null }));
 home(); expect(await screen.findByRole("link", { name: "My assignments" })).toHaveAttribute("href", "/student/assignments");
});

it("records the resolved coach training season in navigation context", async () => {
 account.kind = "Adult"; home();
 await screen.findByRole("link", { name: "Continue review" });
 await waitFor(() => expect(screen.getByLabelText("Current search")).toHaveTextContent("seasonId=s"));
});

it("offers solo timed PBE rehearsal", async () => {
  vi.mocked(trainingApi.today).mockResolvedValue(todayFixture({ format: "Pbe" }));
  vi.mocked(trainingApi.chapters).mockResolvedValue({ seasonId: 's', ruleVersion: 'r', scopeVersion: 'v', snapshotId: 'snap', chapterKey: null, work: { id: null, state: 'Complete', stage: null, reason: null }, currentAvailable: true, historyAvailable: false, asOfUtc: '2026-09-12T00:00:00Z', dueRefreshAtUtc: '2099-09-12T00:00:00Z', nextCursor: null, view: 'Chapters', items: [] });
  vi.mocked(trainingApi.cooperation).mockResolvedValue({ seasonId: 's', ruleVersion: 'r', scopeVersion: 'v', snapshotId: 'coop', state: 'Snapshot', reason: null, checkedAtUtc: '2026-09-12T00:00:00Z', dueRefreshAtUtc: '2099-09-12T00:00:00Z', rosterStudents: 1, unknownStudents: 0, scripture: null, introduction: null, own: null, work: { id: null, next: 'None' } });
  home();
  expect(await screen.findByTestId("start-simulation")).toHaveAttribute("href", expect.stringContaining("mode=Simulation"));
  expect(screen.getByTestId("start-simulation")).toHaveTextContent("Start solo timed rehearsal");
  expect(screen.getByTestId("start-todays-deck")).toHaveAttribute("href", expect.stringContaining("mode=Review"));
  expect(screen.queryByRole("link", { name: "Choose your training" })).not.toBeInTheDocument();
  // The full chapter progress lives on HQ now (the standalone Progress page was
  // retired), so an empty chapter bank shows its honest empty state here; the
  // Season cooperation panel still renders.
  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Season cooperation' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Your PBE chapter progress' })).toBeVisible();
    expect(screen.getByText('No chapter progress yet')).toBeInTheDocument();
  });
});

it("shows the full PBE chapter progress on HQ once chapter progress exists", async () => {
  vi.mocked(trainingApi.today).mockResolvedValue(todayFixture({ format: "Pbe" }));
  vi.mocked(trainingApi.chapters).mockResolvedValue({ seasonId: 's', ruleVersion: 'r', scopeVersion: 'v', snapshotId: 'snap', chapterKey: null, work: { id: null, state: 'Complete', stage: null, reason: null }, currentAvailable: true, historyAvailable: false, asOfUtc: '2026-09-12T00:00:00Z', dueRefreshAtUtc: '2099-09-12T00:00:00Z', nextCursor: null, view: 'Chapters', items: [{
    key: 'chapter:pack:Daniel:1', parentChapterKey: null, kind: 'Chapter', label: 'Daniel 1', scopeLabel: 'Daniel 1:1–3', contentPackId: 'pack', bookKey: 'Daniel', chapter: 1, wholeChapterAssigned: false,
    counts: { assignedPassages: 3, questionCoveredPassages: 2, totalTargets: 4, practicedTargets: 3, recalledTargets: 2, retainedTargets: 1, dueTargets: 2, missingVariantTargets: 1 },
    currentReadiness: 'Incomplete', stamp: null, hasHistoricalStamps: false,
    actions: [{ mode: 'Practice', label: 'Practice this chapter', progressScope: { key: 'chapter:pack:Daniel:1', scopeVersion: 'scope-v1' } }],
  }] });
  home();
  expect(await screen.findByRole('heading', { name: 'Your PBE chapter progress' })).toBeVisible();
  expect(screen.getByText('2 of 3 assigned passages have questions')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'View full PBE chapter progress' })).not.toBeInTheDocument();
});

it("offers the saved PBE mission resume action after its published bank becomes unavailable", async () => {
  vi.mocked(trainingApi.today).mockResolvedValue(todayFixture({
    format: "Pbe",
    mission: { id: "frozen", revision: 1, status: "Active", scopeVersion: "unchanged", explanation: null, steps: [{ kind: "Practice", target: 2, completed: 0, status: "Active", sessionId: "frozen" }] },
    nextAction: { label: "Resume PBE practice", mode: "Practice", sessionId: "frozen" },
  }));
  home();
  expect(await screen.findByTestId("start-todays-deck")).toHaveAttribute("href", "/student/study?mode=Practice&format=Pbe&sessionId=frozen&step=Practice&missionId=frozen&missionRevision=1&seasonId=s");
  expect(screen.queryByTestId("academy-track-unavailable")).not.toBeInTheDocument();
});

it("shows the retired Progress page's contents on HQ: activity totals, worth another look, recent attempts, and per-assignment progress", async () => {
  home();
  // Activity totals (formerly the Progress page's top folio)
  expect(await screen.findByTestId("progress-attempts")).toHaveTextContent("5");
  expect(screen.getByTestId("progress-reviews")).toHaveTextContent("2");
  expect(screen.getByTestId("progress-recent")).toHaveTextContent("100%");
  // Worth another look: the due passage with a Review action
  const attention = await screen.findByTestId("progress-needs-attention");
  expect(within(attention).getByText("Daniel 1:1")).toBeInTheDocument();
  expect(within(attention).getByRole("link", { name: "Review" })).toHaveAttribute("href", "/student/study?mode=Review&seasonId=s");
  // Recent attempts (collapsed disclosure, content present)
  expect(screen.getByTestId("recent-attempts")).toHaveTextContent("Daniel 1:1");
  // Passage browser (formerly on the Progress page)
  expect(screen.getByTestId("progress-mastery")).toBeInTheDocument();
  // Assigned passages notice carries per-range progress woven in
  expect(await screen.findByText("1 of 2 verses strong or mastered")).toBeInTheDocument();
  expect(screen.getByText(/Ready to study — these are your passages for this season\./)).toBeInTheDocument();
});

it("orders HQ as welcome, assigned passages, progress, then what's next", async () => {
  home();
  const heading = await screen.findByRole("heading", { name: "Welcome to your PBE training HQ" });
  const assigned = await screen.findByRole("heading", { name: "Your assigned passages" });
  const activity = await screen.findByRole("heading", { name: "Your activity so far" });
  const mission = await screen.findByRole("heading", { name: "Practice your assigned Scripture." });
  const before = Node.DOCUMENT_POSITION_PRECEDING;
  expect(assigned.compareDocumentPosition(heading) & before).toBeTruthy();
  expect(activity.compareDocumentPosition(assigned) & before).toBeTruthy();
  expect(mission.compareDocumentPosition(activity) & before).toBeTruthy();
});
