import { expect, it } from 'vitest';
import replay from './replay-fixtures.json';
import { selectPbeQuestions, repairEligible } from './selection';
const id = (i: number) => `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`;
const candidate = (i: number) => ({ questionId: id(i), targetIds: [id(i + 1000)], sourceUnitIds: [id(i + 2000)], sourceKind: 'Scripture' as const, kind: 'ShortAnswer', servedCount: 0, lastServedAtMs: null as number | null, due: false, repairEligible: false });
// The 100-passage case replays 199 variants across 68 sessions; its deadline covers
// that exhaustive simulation, not a single selection's latency on the CI host.
for (const size of [1, 2, 8, 16, 21, 24, 100]) {
  it(`eventually covers every variant in ${size} uneven assigned passages even when all due`, () => {
    const candidates = Array.from({ length: size }, (_, i) => Array.from({ length: i % 3 + 1 }, (_, j) => ({ ...candidate(i * 3 + j + 1), targetIds: [id(i + 1000), id(i + 4000)], sourceUnitIds: [id(i + 2000)] }))).flat();
    const seen = new Set<string>();
    for (let n = 0; n < Math.ceil(candidates.length / 3) + 1; n++) {
        const input = { sessionId: id(n + 7000), count: 8, mode: 'Practice' as const, candidates, usedQuestionIds: [], usedTargetIds: [], trueFalseMaxRatio: .1 };
        const picked = selectPbeQuestions(input);
        expect(selectPbeQuestions(input)).toEqual(picked);
        expect(new Set(picked).size).toBe(picked.length);
        expect(picked.length).toBe(Math.min(8, candidates.length));
        for (const q of candidates)
            if (picked.includes(q.questionId)) {
                q.servedCount++;
                q.lastServedAtMs = n;
                seen.add(q.questionId);
            }
        for (const q of candidates)
            q.due = true;
    }
    expect(seen.size).toBe(candidates.length);
  }, size === 100 ? 30_000 : undefined);
}
it('enforces simulation quotas on actual shortened set but permits focused commentary', () => {
    const candidates = Array.from({ length: 10 }, (_, i) => ({ ...candidate(i + 1), sourceKind: i < 2 ? 'Scripture' as const : 'Commentary' as const }));
    const input = { sessionId: id(7000), count: 90, mode: 'Simulation' as const, candidates, usedQuestionIds: [], usedTargetIds: [], trueFalseMaxRatio: .1 };
    expect(selectPbeQuestions(input)).toHaveLength(2);
    expect(selectPbeQuestions({ ...input, mode: 'Practice' })).toHaveLength(10);
    expect(selectPbeQuestions({ ...input, mode: 'Review' })).toEqual([]);
});
it('repairs need two distinct intervening targets and cannot repeat the failed target', () => {
    expect(repairEligible('t', ['t', 'a', 'a'])).toBe(false);
    expect(repairEligible('t', ['t', 'a', 'b'])).toBe(true);
    expect(repairEligible('t', ['t', 'a', 'b', 't', 'c'])).toBe(false);
});
it('reserves three distinct due targets and balances simulation targets within a set', () => {
    const candidates = Array.from({ length: 12 }, (_, i) => ({ ...candidate(i + 1), targetIds: [id(i < 9 ? 1001 : i + 1000)], due: true, targetServedCount: 0 }));
    const input = { sessionId: id(7000), count: 4, mode: 'Simulation' as const, candidates, usedQuestionIds: [], usedTargetIds: [], trueFalseMaxRatio: .1 };
    expect(new Set(selectPbeQuestions(input).map(q => candidates.find(c => c.questionId === q)!.targetIds[0])).size).toBe(4);
    expect(new Set(selectPbeQuestions({ ...input, count: 8, mode: 'Practice' }).slice(0, 3).map(q => candidates.find(c => c.questionId === q)!.targetIds[0])).size).toBe(3);
});
it('coverage sorts oldest service before target metadata and persists literal signed seed selection', () => {
    const input = { sessionId: replay.selectionSessionId, count: 8, mode: 'Practice' as const, candidates: Array.from({ length: 12 }, (_, i) => candidate(i + 1)), usedQuestionIds: [], usedTargetIds: [], trueFalseMaxRatio: .1 };
    expect(selectPbeQuestions(input)).toEqual(replay.selectionQuestionNumbers.map(id));
    const candidates = [{ ...candidate(1), lastServedAtMs: 2, targetServedCount: 0 }, { ...candidate(2), lastServedAtMs: 1, targetServedCount: 100 }];
    expect(selectPbeQuestions({ ...input, count: 1, candidates })).toEqual([id(2)]);
});
it('allocates due, coverage, spaced repair and alternate-form slots without reusing saved IDs', () => {
    const candidates = Array.from({ length: 9 }, (_, i) => ({ ...candidate(i + 1), due: i < 3 }));
    candidates.push({ ...candidate(98), servedCount: 100, alternateForm: true } as typeof candidates[number], { ...candidate(99), servedCount: 100, repairEligible: true, spacedRepair: true } as typeof candidates[number]);
    const input = { sessionId: id(7000), count: 8, mode: 'Practice' as const, candidates, usedQuestionIds: [], usedTargetIds: [], trueFalseMaxRatio: .1 };
    const picked = selectPbeQuestions(input);
    expect(new Set(picked.slice(0, 3))).toEqual(new Set([id(1), id(2), id(3)]));
    expect(picked.slice(3, 6).every(q => candidates.find(c => c.questionId === q)!.servedCount === 0)).toBe(true);
    expect(picked.slice(6)).toEqual([id(99), id(98)]);
    expect(selectPbeQuestions({ ...input, usedQuestionIds: picked }).some(q => picked.includes(q))).toBe(false);
    expect(selectPbeQuestions({ ...input, sessionId: id(7001) })).not.toEqual(picked);
});
it.each([1, 2, 8, 16, 21, 24, 90, 100])('simulation mix holds at actual %i-card bounds', count => {
    const candidates = Array.from({ length: 120 }, (_, i) => ({ ...candidate(i + 1), sourceKind: i % 5 === 0 ? 'Commentary' as const : 'Scripture' as const, kind: i % 4 === 0 ? 'TrueFalse' : 'ShortAnswer' }));
    const ids = selectPbeQuestions({ sessionId: id(7000), count, mode: 'Simulation', candidates, usedQuestionIds: [], usedTargetIds: [], trueFalseMaxRatio: .1 });
    const selected = candidates.filter(c => ids.includes(c.questionId));
    expect(selected.length).toBeLessThanOrEqual(count);
    expect(selected.filter(c => c.sourceKind === 'Commentary').length).toBeLessThanOrEqual(Math.max(0, Math.ceil(selected.length * .1) - 1));
    expect(selected.filter(c => c.kind === 'TrueFalse').length).toBeLessThanOrEqual(Math.floor(selected.length * .1));
});
it('same-attempt multipart siblings are not intervening targets', () => {
    expect(repairEligible('t', [['t', 'a', 'b']])).toBe(false);
    expect(repairEligible('t', [['t', 'a', 'b'], ['a'], ['a']])).toBe(false);
    expect(repairEligible('t', [['t', 'a', 'b'], ['a', 'b']])).toBe(true);
});
it('a pending repair cannot bypass spacing through a coverage fallback', () => {
    const failed = { ...candidate(1), repairEligible: true }, a = { ...candidate(2), servedCount: 10 }, b = { ...candidate(3), servedCount: 10 };
    const picked = selectPbeQuestions({ sessionId: id(7000), count: 3, mode: 'Practice', candidates: [failed, a, b], usedQuestionIds: [], usedTargetIds: failed.targetIds, trueFalseMaxRatio: .1 });
    expect(picked[2]).toBe(failed.questionId);
});
it('circular same-attempt multipart failures can seed next-session retry and never block Simulation', () => {
    const targets = [id(1001), id(1002), id(1003)];
    const candidates = [1, 2, 3].map(i => ({ ...candidate(i), targetIds: targets, repairEligible: true }));
    const input = { sessionId: id(7000), count: 3, mode: 'Practice' as const, candidates, usedQuestionIds: [], usedTargetIds: [], acceptedTargetGroups: [targets], trueFalseMaxRatio: .1 };
    expect(selectPbeQuestions(input)).toHaveLength(3);
    expect(selectPbeQuestions({ ...input, mode: 'Simulation' })).toHaveLength(3);
});
it('rejects contradictory repair subsets and normalizes GUID casing', () => {
    const c = { ...candidate(1), repairEligible: true };
    const input = { sessionId: id(7000), count: 1, mode: 'Practice' as const, candidates: [c], usedQuestionIds: [], usedTargetIds: [], trueFalseMaxRatio: .1 };
    expect(() => selectPbeQuestions({ ...input, candidates: [{ ...c, repairTargetIds: [id(9999)] }] })).toThrow();
    expect(() => selectPbeQuestions({ ...input, candidates: [{ ...c, repairTargetIds: [c.targetIds[0], c.targetIds[0]] }] })).toThrow();
    const q = 'aaaaaaaa-0000-0000-0000-000000000001';
    expect(selectPbeQuestions({ ...input, candidates: [{ ...c, questionId: q.toUpperCase() }], usedQuestionIds: [q] })).toEqual([]);
});

it('infeasible spacing cannot starve a failed target behind eight variants of one other target', () => {
    const witness = replay.selectionWitnesses.infeasibleSpacing;
    const failed = { ...candidate(witness.failedQuestion), due: true, repairEligible: true };
    const candidates = [failed, ...witness.otherQuestions.map(n => ({ ...candidate(n), targetIds: [id(1002)] }))];
    const history = [failed.targetIds];
    for (let session = 0; session < witness.sessions; session++) {
        const input = { sessionId: id(7000 + session), count: witness.count, mode: 'Practice' as const, candidates, usedQuestionIds: [], usedTargetIds: [], acceptedTargetGroups: history, trueFalseMaxRatio: .1 };
        const picked = selectPbeQuestions(input);
        expect(picked).toHaveLength(8);
        expect(picked).toContain(failed.questionId);
        expect(selectPbeQuestions(input)).toEqual(picked);
        for (const questionId of picked) {
            const c = candidates.find(q => q.questionId === questionId)!;
            c.servedCount++;
            c.lastServedAtMs = session;
            history.push(c.targetIds);
        }
    }
});
it('Simulation preserves an eleven-card feasible set across overlapping commentary and true-false quotas', () => {
    const witness = replay.selectionWitnesses.overlappingQuotas;
    const candidates = [
        ...witness.ordinaryQuestions.map(n => ({ ...candidate(n), servedCount: 1 })),
        { ...candidate(witness.commentaryOnly), sourceKind: 'Commentary' as const, servedCount: 1 },
        { ...candidate(witness.trueFalseOnly), kind: 'TrueFalse', servedCount: 1 },
        { ...candidate(witness.both), sourceKind: 'Commentary' as const, kind: 'TrueFalse' }
    ];
    const input = { sessionId: id(7000), count: witness.count, mode: 'Simulation' as const, candidates, usedQuestionIds: [], usedTargetIds: [], trueFalseMaxRatio: .1 };
    const picked = selectPbeQuestions(input);
    expect(picked).toHaveLength(11);
    expect(new Set(picked)).toEqual(new Set(witness.expectedQuestions.map(id)));
    expect(selectPbeQuestions(input)).toEqual(picked);
});

it('multipart siblings that always repeat the failed target cannot make spacing feasible', () => {
    const failed = { ...candidate(1), targetIds: [id(1001), id(1003)], repairEligible: true, due: true };
    const candidates = [failed, ...Array.from({ length: 8 }, (_, i) => ({ ...candidate(i + 2), targetIds: [id(1002)] }))];
    const picked = selectPbeQuestions({ sessionId: id(7000), count: 8, mode: 'Practice', candidates, usedQuestionIds: [], usedTargetIds: [], acceptedTargetGroups: [failed.targetIds], trueFalseMaxRatio: .1 });
    expect(picked).toHaveLength(8);
    expect(picked).toContain(failed.questionId);
});
