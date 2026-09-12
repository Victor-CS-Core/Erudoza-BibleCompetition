import { describe, expect, it } from 'vitest';
import { acknowledgePresentation, rehearsalPoints, type PresentationState } from './presentation';

const state = (): PresentationState => ({ questionId: 'q', revision: 4, delivery: 'Audio', requiredScribeIds: ['a', 'b'], readyScribeIds: [], responseStartsAtMs: null, responseEndsAtMs: null });

describe('presentation readiness', () => {
  it('schedules exactly once after every required scribe acknowledges', () => {
    const first = acknowledgePresentation(state(), 'a', 'q', 1_000, 1);
    expect(first.responseStartsAtMs).toBeNull();
    const scheduled = acknowledgePresentation(first, 'b', 'q', 2_000, 1);
    expect(scheduled.responseStartsAtMs).toBe(5_000);
    expect(scheduled.responseEndsAtMs).toBe(30_000);
    expect(acknowledgePresentation(scheduled, 'b', 'q', 9_000, 1)).toEqual(scheduled);
  });

  it('rejects stale questions and unauthorized scribes', () => {
    expect(() => acknowledgePresentation(state(), 'a', 'old', 0, 1)).toThrow();
    expect(() => acknowledgePresentation(state(), 'x', 'q', 0, 1)).toThrow();
  });
});

describe('authoritative scoring boundary', () => {
  it('keeps the inclusive deadline', () => {
    expect(rehearsalPoints(1, 5_000, 1)).toBe(1);
    expect(rehearsalPoints(1, 25_000, 1)).toBe(1);
    expect(rehearsalPoints(1, 25_001, 1)).toBe(0);
  });

  it.each([[NaN, 0, 1], [1, NaN, 1], [1, -1, 1], [2, 0, 1], [1.5, 0, 2]])('rejects malformed scores', (earned, elapsed, points) => {
    expect(() => rehearsalPoints(earned, elapsed, points)).toThrow('Invalid rehearsal score.');
  });
});
