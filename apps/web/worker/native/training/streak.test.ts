import { expect, it } from 'vitest';
import { streakCount, bestStreak, streakStatus } from './streak';

const days = (...dates: string[]) => new Set(dates);

it('counts a clean consecutive run', () => {
    expect(streakCount(days('2026-09-15', '2026-09-16', '2026-09-17'), '2026-09-17')).toBe(3);
});

it('forgives a single missed day but not two in a row', () => {
    // Practiced Mon-Wed, missed Thu, practiced Fri: the count bridges the single gap.
    expect(streakCount(days('2026-09-14', '2026-09-15', '2026-09-16', '2026-09-18'), '2026-09-18')).toBe(4);
    // Two missed days end the run.
    expect(streakCount(days('2026-09-14', '2026-09-17'), '2026-09-17')).toBe(1);
});

it('forgives repeated isolated misses across the whole run', () => {
    // Practiced every other day: each single-day miss pauses the streak, none reset it.
    expect(streakCount(days('2026-09-11', '2026-09-13', '2026-09-15', '2026-09-17'), '2026-09-17')).toBe(4);
    // A two-day gap in the middle restarts the run at the later practice.
    expect(streakCount(days('2026-09-14', '2026-09-15', '2026-09-18'), '2026-09-18')).toBe(1);
    // Gaps before the run starts do not shorten it.
    expect(streakCount(days('2026-09-16', '2026-09-17'), '2026-09-17')).toBe(2);
});
it('reports active when today or yesterday is credited', () => {
    const credited = days('2026-09-15', '2026-09-16', '2026-09-17');
    expect(streakStatus(credited, '2026-09-17')).toEqual({ current: 3, state: 'active' });
    expect(streakStatus(credited, '2026-09-18')).toEqual({ current: 3, state: 'active' });
});

it('pauses (preserving the count) after exactly one missed day', () => {
    const credited = days('2026-09-15', '2026-09-16', '2026-09-17');
    // Today is the 19th; the 18th was missed, the 17th credited.
    expect(streakStatus(credited, '2026-09-19')).toEqual({ current: 3, state: 'paused' });
    // Practicing on the paused day resumes the count instead of restarting at 1.
    expect(streakCount(days('2026-09-15', '2026-09-16', '2026-09-17', '2026-09-19'), '2026-09-19')).toBe(4);
});

it('resets after two consecutive missed days', () => {
    const credited = days('2026-09-15', '2026-09-16');
    expect(streakStatus(credited, '2026-09-19')).toEqual({ current: 0, state: 'none' });
    expect(streakStatus(new Set(), '2026-09-19')).toEqual({ current: 0, state: 'none' });
});

it('finds the best streak in the history', () => {
    // 3-day run, a gap, then a 5-day run.
    const credited = days('2026-09-01', '2026-09-02', '2026-09-03', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13', '2026-09-14');
    expect(bestStreak(credited)).toBe(5);
    expect(bestStreak(new Set())).toBe(0);
    // A run with isolated single-day pauses still counts as one run.
    expect(bestStreak(days('2026-09-01', '2026-09-03', '2026-09-05'))).toBe(3);
});
