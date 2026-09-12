import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client';
import type { CooperationSnapshot, CooperationStudentSummary } from '../../api/pbeTypes';
import { trainingApi } from '../../api/training';
import { SeasonCoverage, SeasonCoveragePanel } from './SeasonCoverage';

vi.mock('../../api/training', () => ({ trainingApi: {
  cooperation: vi.fn(), continueCooperation: vi.fn(), coachCooperation: vi.fn(), continueCoachCooperation: vi.fn(), cooperationStudents: vi.fn(),
} }));

beforeEach(() => vi.resetAllMocks());

function snapshot(overrides: Partial<CooperationSnapshot> = {}): CooperationSnapshot {
  const value: CooperationSnapshot = {
    seasonId: 'season-1',
    ruleVersion: 'pbe-cooperation-v1',
    scopeVersion: 'scope-1',
    snapshotId: 'snapshot-1',
    state: 'Snapshot',
    reason: null,
    checkedAtUtc: '2026-09-12T14:00:00Z',
    dueRefreshAtUtc: '2026-09-12T14:05:00Z',
    rosterStudents: 3,
    unknownStudents: 0,
    scripture: {
      assigned: 9,
      questionCovered: { known: 7, possible: 7 },
      practiced: { known: 6, possible: 6 },
      retained: { known: 5, possible: 5 },
      due: { known: 2, possible: 2 },
      equalRetained: { lower: 0.5, upper: 0.5, students: 2, unknownStudents: 0, unassignedStudents: 1 },
    },
    introduction: null,
    own: {
      state: 'Known',
      scripture: { assigned: 3, practiced: { known: 3, possible: 3 }, retained: { known: 2, possible: 2 }, due: { known: 1, possible: 1 } },
      introduction: { assigned: 0, practiced: { known: 0, possible: 0 }, retained: { known: 0, possible: 0 }, due: { known: 0, possible: 0 } },
    },
    work: { id: null, next: 'None' },
  };
  return { ...value, ...overrides };
}

it('shows deduplicated team totals and an independent own fraction', () => {
  render(<SeasonCoverage snapshot={snapshot()} audience="student" />);
  expect(screen.getByText('5 of 9 passages retained by at least one student')).toBeVisible();
  expect(screen.getByText('Your retained assignment: 2 of 3 passages')).toBeVisible();
  expect(screen.getByText('Equal student progress: 50%')).toBeVisible();
  expect(screen.getByText('2 passages need maintenance')).toBeVisible();
});

it('keeps provisional known and possible values distinct', () => {
  render(<SeasonCoverage snapshot={snapshot({
    state: 'Provisional',
    unknownStudents: 1,
    scripture: {
      ...snapshot().scripture!,
      retained: { known: 2, possible: 7 },
      due: { known: 1, possible: 4 },
      equalRetained: { lower: 0.25, upper: 0.75, students: 3, unknownStudents: 1, unassignedStudents: 0 },
    },
  })} audience="student" />);
  expect(screen.getByText('2 confirmed retained; up to 7 possible')).toBeVisible();
  expect(screen.getByText('Maintenance known for 1; up to 4 possible')).toBeVisible();
  expect(screen.getByText('Equal student progress: 25–75% known range')).toBeVisible();
  expect(screen.queryByText('7 passages retained')).not.toBeInTheDocument();
});

it('treats zero denominators as unassigned', () => {
  render(<SeasonCoverage snapshot={snapshot({
    scripture: null,
    introduction: null,
    own: {
      state: 'Unassigned',
      scripture: { assigned: 0, practiced: { known: 0, possible: 0 }, retained: { known: 0, possible: 0 }, due: { known: 0, possible: 0 } },
      introduction: { assigned: 0, practiced: { known: 0, possible: 0 }, retained: { known: 0, possible: 0 }, due: { known: 0, possible: 0 } },
    },
  })} audience="student" />);
  expect(screen.getByText('No eligible material is assigned for this season.')).toBeVisible();
  expect(screen.getByText('You are unassigned in this season.')).toBeVisible();
  expect(screen.queryByText('100%')).not.toBeInTheDocument();
});

it('never displays peer identities to students and limits coach detail to a published snapshot', () => {
  const students: CooperationStudentSummary[] = [{
    studentId: 'student-2',
    displayName: 'Leah Student',
    state: 'Known',
    reason: null,
    scripture: { assigned: 4, practiced: { known: 4, possible: 4 }, retained: { known: 3, possible: 3 }, due: { known: 0, possible: 0 } },
    introduction: { assigned: 0, practiced: { known: 0, possible: 0 }, retained: { known: 0, possible: 0 }, due: { known: 0, possible: 0 } },
  }];
  const { rerender } = render(<SeasonCoverage snapshot={snapshot()} audience="student" students={students} />);
  expect(screen.queryByText('Leah Student')).not.toBeInTheDocument();
  rerender(<SeasonCoverage snapshot={snapshot()} audience="coach" students={students} />);
  expect(screen.getByText('Leah Student')).toBeVisible();
  rerender(<SeasonCoverage snapshot={snapshot({ state: 'Updating', snapshotId: null, scripture: null, own: null })} audience="coach" students={students} />);
  expect(screen.queryByText('Leah Student')).not.toBeInTheDocument();
});

it('surfaces finite continuation and explicit retry actions', () => {
  const continueWork = vi.fn(), retry = vi.fn();
  const { rerender } = render(<SeasonCoverage snapshot={snapshot({ state: 'Updating', snapshotId: null, scripture: null, own: null, work: { id: 'work-1', next: 'Continue' } })} audience="student" onContinue={continueWork} />);
  fireEvent.click(screen.getByRole('button', { name: 'Continue checking progress' }));
  expect(continueWork).toHaveBeenCalledOnce();
  rerender(<SeasonCoverage snapshot={snapshot({ state: 'Blocked', snapshotId: null, scripture: null, own: null, reason: 'DataGap', work: { id: null, next: 'None' } })} audience="student" onRetry={retry} />);
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(retry).toHaveBeenCalledOnce();
});

function panel(audience: 'student' | 'coach' = 'student', client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })) {
  return { ...render(<QueryClientProvider client={client}>
    <SeasonCoveragePanel seasonId="season-1" audience={audience} organizationId={audience === 'coach' ? 'org-1' : undefined} />
  </QueryClientProvider>), client };
}

it('does not loop when maintenance refetch returns the same expired snapshot', async () => {
  vi.mocked(trainingApi.cooperation).mockResolvedValue(snapshot({ dueRefreshAtUtc: '2020-01-01T00:00:00Z' }));
  vi.mocked(trainingApi.continueCooperation).mockResolvedValue(snapshot({ dueRefreshAtUtc: '2099-01-01T00:00:00Z' }));
  panel();
  await screen.findByText('5 of 9 passages retained by at least one student');
  await waitFor(() => expect(trainingApi.continueCooperation).toHaveBeenCalledOnce());
  await waitFor(() => expect(trainingApi.cooperation).toHaveBeenCalledTimes(2));
  expect(trainingApi.continueCooperation).toHaveBeenCalledTimes(1);
});

it('advances the bounded invalidated-publication trace through cleanup to published readback', async () => {
  vi.mocked(trainingApi.cooperation)
    .mockResolvedValueOnce(snapshot({ state: 'Updating', snapshotId: null, scopeVersion: null, scripture: null, introduction: null, own: null, work: { id: 'stale-published-work', next: 'Reload' } }))
    .mockResolvedValue(snapshot({ dueRefreshAtUtc: '2099-01-01T00:00:00Z' }));
  vi.mocked(trainingApi.continueCooperation)
    .mockResolvedValueOnce(snapshot({ state: 'Updating', snapshotId: null, scopeVersion: null, scripture: null, introduction: null, own: null, work: { id: null, next: 'Continue' } }))
    .mockResolvedValueOnce(snapshot({ state: 'Updating', snapshotId: null, scopeVersion: null, scripture: null, introduction: null, own: null, work: { id: null, next: 'Continue' } }))
    .mockResolvedValueOnce(snapshot({ state: 'Updating', snapshotId: null, scopeVersion: null, scripture: null, introduction: null, own: null, work: { id: 'replacement-work', next: 'Continue' } }))
    .mockResolvedValueOnce(snapshot({ dueRefreshAtUtc: '2099-01-01T00:00:00Z' }));
  panel();
  await waitFor(() => expect(trainingApi.continueCooperation).toHaveBeenCalledTimes(4));
  expect(trainingApi.continueCooperation).toHaveBeenNthCalledWith(1, { seasonId: 'season-1' });
  expect(trainingApi.continueCooperation).toHaveBeenNthCalledWith(2, { seasonId: 'season-1' });
  expect(trainingApi.continueCooperation).toHaveBeenNthCalledWith(3, { seasonId: 'season-1' });
  expect(trainingApi.continueCooperation).toHaveBeenNthCalledWith(4, { seasonId: 'season-1', workId: 'replacement-work' });
  await waitFor(() => expect(trainingApi.cooperation).toHaveBeenCalledTimes(2));
  expect(await screen.findByText('2 passages need maintenance')).toBeVisible();
  expect(trainingApi.continueCooperation).toHaveBeenCalledTimes(4);
});

it('starts one new finite chain when a published snapshot is invalidated by another projection', async () => {
  const updating = (id: string, next: 'Continue' | 'Reload') => snapshot({ state: 'Updating', snapshotId: null, scopeVersion: null, scripture: null, introduction: null, own: null, work: { id, next } });
  vi.mocked(trainingApi.cooperation)
    .mockResolvedValueOnce(updating('first-work', 'Continue'))
    .mockResolvedValueOnce(snapshot({ snapshotId: 'first-work', dueRefreshAtUtc: '2099-01-01T00:00:00Z' }))
    .mockResolvedValueOnce(updating('first-work', 'Reload'))
    .mockResolvedValue(snapshot({ snapshotId: 'replacement-work', dueRefreshAtUtc: '2099-01-01T00:00:00Z' }));
  vi.mocked(trainingApi.continueCooperation)
    .mockResolvedValueOnce(updating('first-work', 'Reload'))
    .mockResolvedValueOnce(updating('replacement-work', 'Continue'))
    .mockResolvedValueOnce(snapshot({ snapshotId: 'replacement-work', dueRefreshAtUtc: '2099-01-01T00:00:00Z' }));
  const view = panel();
  await waitFor(() => expect(trainingApi.cooperation).toHaveBeenCalledTimes(2));
  await view.client.invalidateQueries({ queryKey: ['pbe-cooperation'] });
  await waitFor(() => expect(trainingApi.continueCooperation).toHaveBeenCalledTimes(3));
  expect(trainingApi.continueCooperation).toHaveBeenNthCalledWith(1, { seasonId: 'season-1', workId: 'first-work' });
  expect(trainingApi.continueCooperation).toHaveBeenNthCalledWith(2, { seasonId: 'season-1' });
  expect(trainingApi.continueCooperation).toHaveBeenNthCalledWith(3, { seasonId: 'season-1', workId: 'replacement-work' });
  await waitFor(() => expect(trainingApi.cooperation).toHaveBeenCalledTimes(4));
  expect(trainingApi.continueCooperation).toHaveBeenCalledTimes(3);
});

it('reloads once, bootstraps without a work ID and stops if stale recovery also fails', async () => {
  vi.mocked(trainingApi.cooperation).mockResolvedValue(snapshot({ state: 'Updating', snapshotId: null, scripture: null, own: null, work: { id: 'work-1', next: 'Continue' } }));
  vi.mocked(trainingApi.continueCooperation).mockRejectedValue(new ApiError('PBE_COOPERATION_WORK_STALE', 409, undefined, 'PBE_COOPERATION_WORK_STALE'));
  panel();
  await waitFor(() => expect(trainingApi.continueCooperation).toHaveBeenCalledTimes(2));
  expect(trainingApi.continueCooperation).toHaveBeenNthCalledWith(1, { seasonId: 'season-1', workId: 'work-1' });
  expect(trainingApi.continueCooperation).toHaveBeenNthCalledWith(2, { seasonId: 'season-1' });
  await waitFor(() => expect(trainingApi.cooperation).toHaveBeenCalledTimes(2));
  expect(await screen.findByText('Season cooperation could not finish checking. Use Try again to restart from saved work.')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Continue checking progress' })).toBeVisible();
  expect(trainingApi.continueCooperation).toHaveBeenCalledTimes(2);
});

it('starts one fresh cooperation epoch after a newer chapter publication supersedes two stale attempts', async () => {
  const stale = new ApiError('PBE_COOPERATION_WORK_STALE', 409, undefined, 'PBE_COOPERATION_WORK_STALE');
  const oldWork = snapshot({ state: 'Updating', snapshotId: null, scopeVersion: null, scripture: null, introduction: null, own: null, work: { id: 'old-work', next: 'Continue' } });
  const freshWork = snapshot({ state: 'Updating', snapshotId: null, scopeVersion: null, scripture: null, introduction: null, own: null, work: { id: 'fresh-work', next: 'Continue' } });
  vi.mocked(trainingApi.cooperation).mockResolvedValueOnce(oldWork).mockResolvedValueOnce(oldWork).mockResolvedValue(snapshot({ snapshotId: 'fresh-work', dueRefreshAtUtc: '2099-01-01T00:00:00Z' }));
  vi.mocked(trainingApi.continueCooperation)
    .mockRejectedValueOnce(stale)
    .mockRejectedValueOnce(stale)
    .mockResolvedValueOnce(freshWork)
    .mockResolvedValueOnce(snapshot({ snapshotId: 'fresh-work', dueRefreshAtUtc: '2099-01-01T00:00:00Z' }));
  const view = panel();
  await waitFor(() => expect(trainingApi.continueCooperation).toHaveBeenCalledTimes(2));
  expect(await screen.findByText('Season cooperation could not finish checking. Use Try again to restart from saved work.')).toBeVisible();

  await act(async () => { view.client.setQueryData(['pbe-chapter-publication', 'season-1'], 'chapter-snapshot-2'); });
  await waitFor(() => expect(trainingApi.continueCooperation).toHaveBeenCalledTimes(4));
  expect(trainingApi.continueCooperation).toHaveBeenNthCalledWith(3, { seasonId: 'season-1' });
  expect(trainingApi.continueCooperation).toHaveBeenNthCalledWith(4, { seasonId: 'season-1', workId: 'fresh-work' });
  expect(await screen.findByText('2 passages need maintenance')).toBeVisible();

  await act(async () => { view.client.setQueryData(['pbe-chapter-publication', 'season-1'], 'chapter-snapshot-2'); });
  view.unmount();
  await act(async () => { view.client.setQueryData(['pbe-chapter-publication', 'season-1'], 'chapter-snapshot-3'); });
  expect(trainingApi.continueCooperation).toHaveBeenCalledTimes(4);
});

it('ignores a late Continue from the cooperation epoch superseded by a chapter publication', async () => {
  const oldWork = snapshot({ state: 'Updating', snapshotId: null, scopeVersion: null, scripture: null, introduction: null, own: null, work: { id: 'old-work', next: 'Continue' } });
  vi.mocked(trainingApi.cooperation).mockResolvedValueOnce(oldWork).mockResolvedValue(snapshot({ snapshotId: 'fresh-work', dueRefreshAtUtc: '2099-01-01T00:00:00Z' }));
  let finishOld!: (value: CooperationSnapshot) => void;
  vi.mocked(trainingApi.continueCooperation)
    .mockReturnValueOnce(new Promise(resolve => { finishOld = resolve; }))
    .mockResolvedValueOnce(snapshot({ snapshotId: 'fresh-work', dueRefreshAtUtc: '2099-01-01T00:00:00Z' }));
  const view = panel();
  await waitFor(() => expect(trainingApi.continueCooperation).toHaveBeenCalledOnce());
  await act(async () => { view.client.setQueryData(['pbe-chapter-publication', 'season-1'], 'chapter-snapshot-2'); });
  await waitFor(() => expect(trainingApi.continueCooperation).toHaveBeenCalledTimes(2));
  expect(trainingApi.continueCooperation).toHaveBeenNthCalledWith(2, { seasonId: 'season-1' });

  await act(async () => {
    finishOld(snapshot({ state: 'Updating', snapshotId: null, scopeVersion: null, scripture: null, introduction: null, own: null, work: { id: 'old-work', next: 'Continue' } }));
    await Promise.resolve();
  });
  expect(trainingApi.continueCooperation).toHaveBeenCalledTimes(2);
});

it('does not continue blocked work or a continuation that resolves after navigation', async () => {
  vi.mocked(trainingApi.cooperation).mockResolvedValueOnce(snapshot({ state: 'Blocked', snapshotId: null, scopeVersion: null, scripture: null, introduction: null, own: null, reason: 'DataGap', work: { id: null, next: 'None' } }));
  const blocked = panel();
  expect(await screen.findByText('Some required progress data could not be checked.')).toBeVisible();
  expect(trainingApi.continueCooperation).not.toHaveBeenCalled();
  blocked.unmount();

  let finish!: (value: CooperationSnapshot) => void;
  vi.mocked(trainingApi.cooperation).mockResolvedValueOnce(snapshot({ state: 'Updating', snapshotId: null, scopeVersion: null, scripture: null, introduction: null, own: null, work: { id: 'work-1', next: 'Continue' } }));
  vi.mocked(trainingApi.continueCooperation).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const active = panel();
  await waitFor(() => expect(trainingApi.continueCooperation).toHaveBeenCalledOnce());
  active.unmount();
  finish(snapshot({ state: 'Updating', snapshotId: null, scopeVersion: null, scripture: null, introduction: null, own: null, work: { id: 'work-2', next: 'Continue' } }));
  await Promise.resolve();
  expect(trainingApi.continueCooperation).toHaveBeenCalledTimes(1);
});

it.each(['continue', 'stale error'] as const)('ignores a pending old-scope cooperation %s after the season changes', async outcome => {
  const oldWork = snapshot({ state: 'Updating', snapshotId: null, scopeVersion: null, scripture: null, introduction: null, own: null, work: { id: 'work-old', next: 'Continue' } });
  vi.mocked(trainingApi.cooperation).mockImplementation(async seasonId => seasonId === 'season-1' ? oldWork : snapshot({ seasonId, snapshotId: 'snapshot-new', dueRefreshAtUtc: '2099-01-01T00:00:00Z' }));
  let finish!: (value: CooperationSnapshot) => void;
  let fail!: (error: unknown) => void;
  vi.mocked(trainingApi.continueCooperation).mockReturnValue(new Promise((resolve, reject) => { finish = resolve; fail = reject; }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><SeasonCoveragePanel seasonId="season-1" audience="student" /></QueryClientProvider>);
  await waitFor(() => expect(trainingApi.continueCooperation).toHaveBeenCalledOnce());
  view.rerender(<QueryClientProvider client={client}><SeasonCoveragePanel seasonId="season-2" audience="student" /></QueryClientProvider>);
  expect(await screen.findByText('5 of 9 passages retained by at least one student')).toBeVisible();
  await act(async () => {
    if (outcome === 'continue') finish(snapshot({ seasonId: 'season-1', state: 'Updating', snapshotId: null, scopeVersion: null, scripture: null, introduction: null, own: null, work: { id: 'work-next', next: 'Continue' } }));
    else fail(new ApiError('PBE_COOPERATION_WORK_STALE', 409, undefined, 'PBE_COOPERATION_WORK_STALE'));
    await Promise.resolve();
  });
  expect(trainingApi.continueCooperation).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('Season cooperation could not finish checking. Use Try again to restart from saved work.')).not.toBeInTheDocument();
});

it('clears mismatched coach detail and reloads its aggregate identity once', async () => {
  vi.mocked(trainingApi.coachCooperation).mockResolvedValue(snapshot());
  vi.mocked(trainingApi.cooperationStudents).mockResolvedValue({ seasonId: 'season-1', snapshotId: 'snapshot-other', nextCursor: null, items: [{
    studentId: 'student-2', displayName: 'Leah Student', state: 'Known', reason: null,
    scripture: { assigned: 4, practiced: { known: 4, possible: 4 }, retained: { known: 3, possible: 3 }, due: { known: 0, possible: 0 } },
    introduction: { assigned: 0, practiced: { known: 0, possible: 0 }, retained: { known: 0, possible: 0 }, due: { known: 0, possible: 0 } },
  }] });
  panel('coach');
  await waitFor(() => expect(trainingApi.cooperationStudents).toHaveBeenCalledOnce());
  expect(screen.queryByText('Leah Student')).not.toBeInTheDocument();
  await waitFor(() => expect(trainingApi.coachCooperation).toHaveBeenCalledTimes(2));
});
