import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, MemoryRouter, RouterProvider } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import type { ChapterPage, ProgressRow } from "../../api/pbeTypes";
import { ApiError } from "../../api/client";
import { trainingApi } from "../../api/training";
import { PassageJourney } from "./PassageJourney";
import { journeyFixture } from "./trainingFixtures";
vi.mock("../../api/training", () => ({ trainingApi: { journey: vi.fn(), chapters: vi.fn(), continueChapters: vi.fn() } }));
vi.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ me: { organizationId: "org", userId: "student" } }) }));
function page(preview = false, format: 'Memory' | 'Pbe' = 'Memory', client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) { return { ...render(<QueryClientProvider client={client}><MemoryRouter><PassageJourney seasonId="s" preview={preview} format={format} /></MemoryRouter></QueryClientProvider>), client }; }
beforeEach(() => { vi.resetAllMocks(); vi.mocked(trainingApi.journey).mockResolvedValue(journeyFixture()); });
it("labels partial assignment and distinct skill evidence", async () => { page(); expect(await screen.findByText("Assigned scope")).toBeInTheDocument(); expect(screen.getByText(/1 of 2 assigned passages practiced/)).toBeInTheDocument(); expect(screen.getByRole("progressbar", { name: "Wording" })).toHaveAttribute("value", "20"); expect(screen.getByRole("progressbar", { name: "Reference" })).toHaveAttribute("value", "70"); });
it("fetches the next server cursor only on request", async () => { vi.mocked(trainingApi.journey).mockResolvedValueOnce(journeyFixture({ after: "cursor" })).mockResolvedValueOnce(journeyFixture({ chapters: [] })); page(); fireEvent.click(await screen.findByRole("button", { name: "Load more passages" })); await screen.findByText("Assigned scope"); expect(trainingApi.journey).toHaveBeenLastCalledWith("s", "cursor"); });
it("shows empty assignment honestly", async () => { vi.mocked(trainingApi.journey).mockResolvedValue(journeyFixture({ chapters: [] })); page(); expect(await screen.findByText("No eligible passages yet")).toBeInTheDocument(); });
it.each(["Learning", "Unknown"])("does not treat legacy %s skill values as current or missing evidence", async level => { const data = journeyFixture(); data.chapters[0].passages[0].level = level; data.chapters[0].passages[0].algorithmVersion = "v1-scaffold"; vi.mocked(trainingApi.journey).mockResolvedValue(data); page(); expect(await screen.findByText(/Earlier scoring/)).toBeInTheDocument(); expect(screen.queryByRole("progressbar", { name: "Wording" })).not.toBeInTheDocument(); });

it("unseen passages have a useful start state instead of legacy scoring", async () => { const data = journeyFixture(); data.chapters[0].passages[0].level = "Unseen"; data.chapters[0].passages[0].algorithmVersion = "unknown"; vi.mocked(trainingApi.journey).mockResolvedValue(data); page(); expect(await screen.findByText(/No practice recorded yet/)).toBeInTheDocument(); expect(screen.queryByText(/Earlier scoring/)).not.toBeInTheDocument(); });

it("keeps the HQ preview compact and links legacy evidence to its full passage", async () => {
  const data = journeyFixture();
  data.chapters[0].passages[0].level = "Mastered";
  data.chapters[0].passages[0].algorithmVersion = "v1-scaffold";
  vi.mocked(trainingApi.journey).mockResolvedValue(data);
  page(true);
  const passage = await screen.findByRole("link", { name: "Daniel 1:1 Legacy scoring" });
  expect(passage).toHaveAttribute("href", "/student/progress?seasonId=s#passage-k");
  expect(screen.queryByText("Mastered")).not.toBeInTheDocument();
  expect(screen.queryByRole("progressbar", { name: "Wording" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "View full passage progress" })).toHaveAttribute("href", "/student/progress?seasonId=s");
});

type ChapterOverviewPage = Omit<ChapterPage, 'view' | 'items'> & { view: 'Chapters'; items: ProgressRow[] };
function chapterPage(overrides: Partial<ChapterOverviewPage> = {}): ChapterOverviewPage {
  const page: ChapterOverviewPage = {
    seasonId: 's', ruleVersion: 'pbe-chapter-v1', scopeVersion: 'scope-v1', snapshotId: 'snapshot-1', chapterKey: null,
    work: { id: 'work-1', state: 'Complete', stage: null, reason: null }, currentAvailable: true, historyAvailable: true,
    asOfUtc: '2026-09-12T14:00:00Z', dueRefreshAtUtc: '2099-09-12T14:05:00Z', nextCursor: null, view: 'Chapters',
    items: [{ key: 'chapter:pack:Daniel:1', parentChapterKey: null, kind: 'Chapter', label: 'Daniel 1', scopeLabel: 'Daniel 1:1–3', contentPackId: 'pack', bookKey: 'Daniel', chapter: 1, wholeChapterAssigned: false,
      counts: { assignedPassages: 3, questionCoveredPassages: 2, totalTargets: 4, practicedTargets: 3, recalledTargets: 2, retainedTargets: 1, dueTargets: 2, missingVariantTargets: 1 },
      currentReadiness: 'Incomplete', stamp: null, hasHistoricalStamps: false,
      actions: [{ mode: 'Practice', label: 'Practice this chapter', progressScope: { key: 'chapter:pack:Daniel:1', scopeVersion: 'scope-v1' } }],
    }],
  };
  return { ...page, ...overrides };
}

it('renders PBE chapter progress while preserving Memory coverage', async () => {
  vi.mocked(trainingApi.chapters).mockResolvedValue(chapterPage());
  page(false, 'Pbe');
  expect(await screen.findByRole('heading', { name: 'Your PBE chapter progress' })).toBeVisible();
  expect(await screen.findByText('2 of 3 assigned passages have questions')).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Your Memory passage progress' })).toBeVisible();
  expect(trainingApi.journey).toHaveBeenCalledWith('s', undefined);
});

it('hides the PBE tile in preview when the chapter bank has no progress', async () => {
  vi.mocked(trainingApi.chapters).mockResolvedValue(chapterPage({ items: [] }));
  page(true, 'Pbe');
  await waitFor(() => expect(trainingApi.chapters).toHaveBeenCalled());
  await waitFor(() => {
    expect(screen.queryByRole('heading', { name: 'Your PBE chapter progress' })).not.toBeInTheDocument();
    expect(screen.queryByText('No chapter progress yet')).not.toBeInTheDocument();
  });
});

it('shows the PBE tile in preview once chapter progress exists', async () => {
  vi.mocked(trainingApi.chapters).mockResolvedValue(chapterPage());
  page(true, 'Pbe');
  expect(await screen.findByRole('heading', { name: 'Your PBE chapter progress' })).toBeVisible();
  expect(screen.getByText('2 of 3 assigned passages have questions')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'View full PBE chapter progress' })).toHaveAttribute('href', '/student/progress?seasonId=s');
});

it('keeps the chapters load error honest in preview', async () => {
  vi.mocked(trainingApi.chapters).mockRejectedValue(new Error('offline'));
  page(true, 'Pbe');
  expect(await screen.findByText('Chapter progress could not load.')).toBeVisible();
});

it('keeps the automatic chapter check running in preview', async () => {
  vi.mocked(trainingApi.chapters).mockResolvedValue(chapterPage({ snapshotId: null, scopeVersion: null, items: [], work: { id: 'work-1', state: 'Working', stage: 'Replaying', reason: null } }));
  vi.mocked(trainingApi.continueChapters).mockReturnValue(new Promise(() => {}));
  page(true, 'Pbe');
  expect(await screen.findByText('Checking chapter progress…')).toBeVisible();
  await waitFor(() => expect(trainingApi.continueChapters).toHaveBeenCalledWith({ seasonId: 's', workId: 'work-1' }));
});

it('forwards the full guarded chapter selection through the study route', async () => {
  vi.mocked(trainingApi.chapters).mockResolvedValue(chapterPage());
  const router = createMemoryRouter([{ path: '*', element: <PassageJourney seasonId="s" format="Pbe" /> }], { initialEntries: ['/student/progress?seasonId=s'] });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RouterProvider router={router} /></QueryClientProvider>);
  fireEvent.click(await screen.findByRole('button', { name: 'Practice this chapter' }));
  expect(router.state.location.pathname).toBe('/student/study');
  expect(router.state.location.search).toBe('?mode=Practice&format=Pbe&progressScopeKey=chapter%3Apack%3ADaniel%3A1&progressScopeVersion=scope-v1&seasonId=s');
});

it('loads only the selected chapter groups and keeps their counters nonadditive', async () => {
  const groupPage: Omit<ChapterPage, 'view' | 'items'> & { view: 'Groups'; items: ProgressRow[] } = {
    ...chapterPage(), view: 'Groups', chapterKey: 'chapter:pack:Daniel:1', items: [{
      ...chapterPage().items[0], key: 'group:chapter:pack:Daniel:1:s1:s3', parentChapterKey: 'chapter:pack:Daniel:1', kind: 'PassageGroup', label: 'Daniel 1:1–3', wholeChapterAssigned: null, stamp: null, hasHistoricalStamps: false,
    }],
  };
  vi.mocked(trainingApi.chapters).mockImplementation(async (_seasonId, options) => options?.view === 'Groups' ? groupPage : chapterPage());
  page(false, 'Pbe');
  fireEvent.click(await screen.findByRole('button', { name: 'View passage groups' }));
  expect(await screen.findByRole('heading', { name: 'Passage groups in Daniel 1' })).toBeVisible();
  expect(trainingApi.chapters).toHaveBeenCalledWith('s', expect.objectContaining({ view: 'Groups', chapterKey: 'chapter:pack:Daniel:1' }));
  expect(screen.getByText('Group counters can overlap and are not chapter totals.')).toBeVisible();
});

it('continues an existing bounded projection only while the screen is active', async () => {
  vi.mocked(trainingApi.chapters).mockResolvedValueOnce(chapterPage({ snapshotId: null, scopeVersion: null, items: [], work: { id: 'work-1', state: 'Working', stage: 'Replaying', reason: null } })).mockResolvedValue(chapterPage());
  let finish!: (value: Awaited<ReturnType<typeof trainingApi.continueChapters>>) => void;
  vi.mocked(trainingApi.continueChapters).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  page(false, 'Pbe');
  expect(await screen.findByText('Checking chapter progress…')).toBeVisible();
  finish({ seasonId: 's', scopeVersion: 'scope-v1', work: { id: 'work-1', state: 'Complete', stage: null, reason: null }, next: 'Reload' });
  await screen.findByText('2 of 3 assigned passages have questions');
  expect(trainingApi.continueChapters).toHaveBeenCalledWith({ seasonId: 's', workId: 'work-1' });
  expect(trainingApi.chapters).toHaveBeenCalledTimes(2);
});

it('requests one bounded refresh when due counts have expired', async () => {
  vi.mocked(trainingApi.chapters).mockResolvedValue(chapterPage({ dueRefreshAtUtc: '2020-01-01T00:00:00Z' }));
  vi.mocked(trainingApi.continueChapters).mockResolvedValue({ seasonId: 's', scopeVersion: 'scope-v1', work: { id: null, state: 'Complete', stage: null, reason: null }, next: 'Reload' });
  page(false, 'Pbe');
  await screen.findByText('2 of 3 assigned passages have questions');
  await waitFor(() => expect(trainingApi.continueChapters).toHaveBeenCalledOnce());
  expect(trainingApi.continueChapters).toHaveBeenCalledWith({ seasonId: 's' });
  await waitFor(() => expect(trainingApi.chapters).toHaveBeenCalledTimes(2));
  expect(trainingApi.continueChapters).toHaveBeenCalledTimes(1);
});

it('bootstraps a replacement projection when a completed snapshot exposes updating rows', async () => {
  const updating = chapterPage();
  updating.items[0] = { ...updating.items[0], currentReadiness: 'Updating', actions: [] };
  vi.mocked(trainingApi.chapters).mockResolvedValueOnce(updating).mockResolvedValue(chapterPage({ snapshotId: 'snapshot-2' }));
  vi.mocked(trainingApi.continueChapters).mockResolvedValue({ seasonId: 's', scopeVersion: 'scope-v2', work: { id: 'work-2', state: 'Complete', stage: null, reason: null }, next: 'Reload' });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  page(false, 'Pbe', client);
  await waitFor(() => expect(trainingApi.continueChapters).toHaveBeenCalledOnce());
  expect(trainingApi.continueChapters).toHaveBeenCalledWith({ seasonId: 's' });
  expect(await screen.findByText('2 of 3 assigned passages have questions')).toBeVisible();
  await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['pbe-cooperation', 'student', undefined, 's'], exact: true }));
  expect(trainingApi.continueChapters).toHaveBeenCalledTimes(1);
});

it.each([true, false])('bootstraps once when completed work has no current published snapshot (currentAvailable=%s)', async currentAvailable => {
  const invalidated = chapterPage({ snapshotId: null, scopeVersion: null, currentAvailable, items: [], work: { id: 'work-complete', state: 'Complete', stage: null, reason: null } });
  vi.mocked(trainingApi.chapters).mockResolvedValue(invalidated);
  vi.mocked(trainingApi.continueChapters).mockResolvedValue({ seasonId: 's', scopeVersion: 'scope-v2', work: { id: 'work-replacement', state: 'Complete', stage: null, reason: null }, next: 'Reload' });
  page(false, 'Pbe');
  await waitFor(() => expect(trainingApi.continueChapters).toHaveBeenCalledOnce());
  expect(trainingApi.continueChapters).toHaveBeenCalledWith({ seasonId: 's' });
  await waitFor(() => expect(trainingApi.chapters).toHaveBeenCalledTimes(2));
  expect(trainingApi.continueChapters).toHaveBeenCalledTimes(1);
});

it('does not invalidate cooperation when an old chapter continuation finishes after unmount', async () => {
  vi.mocked(trainingApi.chapters).mockResolvedValue(chapterPage({ snapshotId: null, scopeVersion: null, items: [], work: { id: 'work-1', state: 'Working', stage: 'Projecting', reason: null } }));
  let finish!: (value: Awaited<ReturnType<typeof trainingApi.continueChapters>>) => void;
  vi.mocked(trainingApi.continueChapters).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const view = page(false, 'Pbe', client);
  await waitFor(() => expect(trainingApi.continueChapters).toHaveBeenCalledOnce());
  view.unmount();
  finish({ seasonId: 's', scopeVersion: 'scope-v2', work: { id: 'work-1', state: 'Complete', stage: null, reason: null }, next: 'Reload' });
  await Promise.resolve();
  expect(invalidate).not.toHaveBeenCalled();
});

it('does not invalidate cooperation when an old chapter continuation finishes after the season changes', async () => {
  const oldWork = chapterPage({ snapshotId: null, scopeVersion: null, items: [], work: { id: 'work-1', state: 'Working', stage: 'Projecting', reason: null } });
  vi.mocked(trainingApi.chapters).mockImplementation(async seasonId => seasonId === 's' ? oldWork : chapterPage({ seasonId, snapshotId: 'snapshot-other' }));
  let finish!: (value: Awaited<ReturnType<typeof trainingApi.continueChapters>>) => void;
  vi.mocked(trainingApi.continueChapters).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const view = render(<QueryClientProvider client={client}><MemoryRouter><PassageJourney seasonId="s" format="Pbe" /></MemoryRouter></QueryClientProvider>);
  await waitFor(() => expect(trainingApi.continueChapters).toHaveBeenCalledOnce());
  view.rerender(<QueryClientProvider client={client}><MemoryRouter><PassageJourney seasonId="season-2" format="Pbe" /></MemoryRouter></QueryClientProvider>);
  finish({ seasonId: 's', scopeVersion: 'scope-v2', work: { id: 'work-1', state: 'Complete', stage: null, reason: null }, next: 'Reload' });
  await screen.findByText('2 of 3 assigned passages have questions');
  expect(invalidate).not.toHaveBeenCalled();
});

it('ignores an old-season stale rejection without consuming the current season recovery', async () => {
  const working = (seasonId: string, workId: string) => chapterPage({ seasonId, snapshotId: null, scopeVersion: null, items: [], work: { id: workId, state: 'Working', stage: 'Projecting', reason: null } });
  vi.mocked(trainingApi.chapters).mockImplementation(async seasonId => working(seasonId, seasonId === 's' ? 'old-work' : 'current-work'));
  let rejectOld!: (error: unknown) => void;
  let rejectCurrent!: (error: unknown) => void;
  vi.mocked(trainingApi.continueChapters).mockImplementation(input => {
    if (input.workId === 'old-work') return new Promise((_resolve, reject) => { rejectOld = reject; });
    if (input.workId === 'current-work') return new Promise((_resolve, reject) => { rejectCurrent = reject; });
    return Promise.resolve({ seasonId: input.seasonId, scopeVersion: 'scope-current', work: { id: 'replacement-work', state: 'Complete', stage: null, reason: null }, next: 'Reload' });
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><MemoryRouter><PassageJourney seasonId="s" format="Pbe" /></MemoryRouter></QueryClientProvider>);
  await waitFor(() => expect(trainingApi.continueChapters).toHaveBeenCalledWith({ seasonId: 's', workId: 'old-work' }));

  view.rerender(<QueryClientProvider client={client}><MemoryRouter><PassageJourney seasonId="season-2" format="Pbe" /></MemoryRouter></QueryClientProvider>);
  await waitFor(() => expect(trainingApi.continueChapters).toHaveBeenCalledWith({ seasonId: 'season-2', workId: 'current-work' }));
  await act(async () => {
    rejectOld(new ApiError('PBE_CHAPTER_WORK_STALE', 409, undefined, 'PBE_CHAPTER_WORK_STALE'));
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  expect(trainingApi.continueChapters).toHaveBeenCalledTimes(2);

  await act(async () => { rejectCurrent(new ApiError('PBE_CHAPTER_SCOPE_STALE', 409, undefined, 'PBE_CHAPTER_SCOPE_STALE')); });
  await waitFor(() => expect(trainingApi.continueChapters).toHaveBeenCalledTimes(3));
  expect(trainingApi.continueChapters).toHaveBeenNthCalledWith(3, { seasonId: 'season-2' });
});

it('attempts one bounded bootstrap and leaves an actionable error when stale recovery also fails', async () => {
  vi.mocked(trainingApi.chapters).mockResolvedValue(chapterPage({ snapshotId: null, scopeVersion: null, items: [], work: { id: 'work-stale', state: 'Working', stage: 'Replaying', reason: null } }));
  vi.mocked(trainingApi.continueChapters).mockRejectedValue(new ApiError('PBE_CHAPTER_WORK_STALE', 409, undefined, 'PBE_CHAPTER_WORK_STALE'));
  page(false, 'Pbe');
  await waitFor(() => expect(trainingApi.continueChapters).toHaveBeenCalledTimes(2));
  expect(trainingApi.continueChapters).toHaveBeenNthCalledWith(2, { seasonId: 's' });
  await waitFor(() => expect(trainingApi.chapters).toHaveBeenCalledTimes(2));
  expect(await screen.findByText('Chapter progress could not finish checking.')).toBeVisible();
  expect(trainingApi.continueChapters).toHaveBeenCalledTimes(2);
});

it.each(['PBE_CHAPTER_WORK_STALE', 'PBE_CHAPTER_SCOPE_STALE'] as const)('bootstraps replacement chapter work after reloading the same stale work identity for %s', async code => {
  vi.mocked(trainingApi.chapters)
    .mockResolvedValueOnce(chapterPage({ snapshotId: null, scopeVersion: null, items: [], work: { id: 'work-stale', state: 'Working', stage: 'Replaying', reason: null } }))
    .mockResolvedValueOnce(chapterPage({ snapshotId: null, scopeVersion: null, items: [], work: { id: 'work-stale', state: 'Working', stage: 'Projecting', reason: null } }))
    .mockResolvedValue(chapterPage());
  vi.mocked(trainingApi.continueChapters)
    .mockRejectedValueOnce(new ApiError(code, 409, undefined, code))
    .mockResolvedValueOnce({ seasonId: 's', scopeVersion: 'scope-v1', work: { id: 'work-replacement', state: 'Complete', stage: null, reason: null }, next: 'Reload' });
  page(false, 'Pbe');
  await waitFor(() => expect(trainingApi.continueChapters).toHaveBeenCalledTimes(2));
  expect(trainingApi.continueChapters).toHaveBeenNthCalledWith(2, { seasonId: 's' });
  expect(await screen.findByText('2 of 3 assigned passages have questions')).toBeVisible();
  expect(screen.queryByText('Chapter progress could not finish checking.')).not.toBeInTheDocument();
});
