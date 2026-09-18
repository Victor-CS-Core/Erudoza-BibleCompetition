import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { ProgressRow } from '../../api/pbeTypes';
import { PbeChapterProgress } from './PbeChapterProgress';

function row(overrides: Partial<ProgressRow> = {}): ProgressRow {
  return {
    key: 'chapter:pack:Daniel:1',
    parentChapterKey: null,
    kind: 'Chapter',
    label: 'Daniel 1',
    scopeLabel: 'Daniel 1:1–3',
    contentPackId: 'pack',
    bookKey: 'Daniel',
    chapter: 1,
    wholeChapterAssigned: false,
    counts: {
      assignedPassages: 3,
      questionCoveredPassages: 2,
      totalTargets: 4,
      practicedTargets: 3,
      recalledTargets: 2,
      retainedTargets: 1,
      dueTargets: 2,
      missingVariantTargets: 1,
    },
    currentReadiness: 'Incomplete',
    stamp: null,
    hasHistoricalStamps: false,
    actions: [{ mode: 'Practice', label: 'Practice this chapter', progressScope: { key: 'chapter:pack:Daniel:1', scopeVersion: 'v1' } }],
    ...overrides,
  };
}

it('gives a small assignment an honest next action', () => {
  const act = vi.fn();
  render(<PbeChapterProgress progress={row()} onAction={act} />);
  expect(screen.getByText('2 of 3 assigned passages have questions')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Practice this chapter' }));
  expect(act).toHaveBeenCalledWith(row().actions[0]);
  expect(screen.queryByText('Chapter retained')).toBeNull();
});

it('separates a dated stamp from current readiness', () => {
  render(<PbeChapterProgress progress={row({
    currentReadiness: 'Incomplete',
    stamp: {
      stampId: 'stamp-1',
      chapterKey: 'chapter:pack:Daniel:1',
      kind: 'Chapter',
      label: 'Assigned passages retained',
      scopeLabel: 'Daniel 1:1–3',
      scopeVersion: 'v1',
      ruleVersion: 'pbe-chapter-v1',
      earnedAtUtc: '2026-09-10T12:00:00Z',
      matchesCurrentScope: true,
    },
  })} onAction={() => {}} />);
  expect(screen.getByText('Current work incomplete')).toBeVisible();
  const stamp = screen.getByTestId('chapter-stamp');
  expect(stamp).toHaveTextContent('Assigned passages retained');
  expect(within(stamp).getByText('Sep 10, 2026')).toHaveAttribute('datetime', '2026-09-10T12:00:00Z');
});

it('labels introduction units separately and never fabricates a percentage for zero targets', () => {
  render(<PbeChapterProgress progress={row({
    key: 'intro:pack',
    kind: 'Introduction',
    label: 'Daniel introduction',
    chapter: null,
    wholeChapterAssigned: null,
    counts: {
      assignedPassages: 2,
      questionCoveredPassages: 0,
      totalTargets: 0,
      practicedTargets: 0,
      recalledTargets: 0,
      retainedTargets: 0,
      dueTargets: 0,
      missingVariantTargets: 0,
    },
    actions: [],
  })} onAction={() => {}} />);
  expect(screen.getByText('0 of 2 introduction units have questions')).toBeVisible();
  expect(screen.getByText('No eligible targets yet')).toBeVisible();
  expect(screen.queryByText('100%')).not.toBeInTheDocument();
});

it('uses the server action and exposes chapter groups without adding child totals', () => {
  const act = vi.fn(), openGroups = vi.fn();
  const progress = row({
    currentReadiness: 'Retained',
    wholeChapterAssigned: true,
    actions: [{ mode: 'Review', label: 'Comeback practice', progressScope: { key: 'chapter:pack:Daniel:1', scopeVersion: 'v2' } }],
  });
  render(<PbeChapterProgress progress={progress} onAction={act} onOpenGroups={openGroups} />);
  expect(screen.getByText('Chapter retained')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Comeback practice' }));
  expect(act).toHaveBeenCalledWith(progress.actions[0]);
  fireEvent.click(screen.getByRole('button', { name: 'View passage groups' }));
  expect(openGroups).toHaveBeenCalledWith(progress.key);
});

it('does not repeat the practiced count beside the progress meter', () => {
  render(<PbeChapterProgress progress={row()} onAction={() => {}} />);
  expect(screen.getByRole('progressbar', { name: 'Daniel 1 targets practiced' })).toBeInTheDocument();
  expect(screen.getByText('3 of 4')).toBeInTheDocument();
  expect(screen.queryByText('Practiced')).not.toBeInTheDocument();
  expect(screen.getByText('Recalled')).toBeInTheDocument();
  expect(screen.getByText('Retained')).toBeInTheDocument();
  expect(screen.getByText('Due or repair')).toBeInTheDocument();
});
