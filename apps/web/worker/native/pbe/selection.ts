import { stableSeed } from '../study/engine';
export interface SelectionCandidate {
    questionId: string;
    targetIds: string[];
    sourceUnitIds: string[];
    sourceKind: 'Scripture' | 'Commentary';
    kind: string;
    servedCount: number;
    lastServedAtMs: number | null;
    due: boolean;
    repairEligible: boolean;
    targetServedCount?: number;
    lastQuestionId?: string | null;
    alternateForm?: boolean;
    spacedRepair?: boolean;
    repairTargetIds?: string[];
}
export interface SelectionInput {
    sessionId: string;
    count: number;
    mode: 'Practice' | 'Review' | 'Simulation';
    candidates: SelectionCandidate[];
    usedQuestionIds: string[];
    usedTargetIds: string[];
    trueFalseMaxRatio: number;
    acceptedTargetGroups?: string[][];
}
/** Groups are distinct accepted attempts. Simultaneous multipart targets cannot supply spacing. */
export function repairEligible(targetId: string, history: (string | string[])[]): boolean {
    const groups = history.map(g => typeof g === 'string' ? [g] : g);
    let last = -1;
    groups.forEach((g, i) => { if (g.includes(targetId))
        last = i; });
    return last >= 0 && new Set(groups.slice(last + 1).flat().filter(t => t !== targetId)).size >= 2;
}
export function selectPbeQuestions(input: SelectionInput): string[] {
    input = { ...input, sessionId: input.sessionId.toLowerCase(), usedQuestionIds: input.usedQuestionIds.map(id => id.toLowerCase()), usedTargetIds: input.usedTargetIds.map(id => id.toLowerCase()), acceptedTargetGroups: input.acceptedTargetGroups?.map(g => g.map(id => id.toLowerCase())), candidates: input.candidates.map(c => ({ ...c, questionId: c.questionId.toLowerCase(), targetIds: c.targetIds.map(id => id.toLowerCase()), sourceUnitIds: c.sourceUnitIds.map(id => id.toLowerCase()), lastQuestionId: c.lastQuestionId?.toLowerCase(), repairTargetIds: c.repairTargetIds?.map(id => id.toLowerCase()) })) };
    for (const c of input.candidates)
        if (c.repairTargetIds && (c.repairTargetIds.length === 0 || new Set(c.repairTargetIds).size !== c.repairTargetIds.length || c.repairTargetIds.some(t => !c.targetIds.includes(t))))
            throw new Error('Invalid repair target subset.');
    if (!Number.isInteger(input.count) || input.count < 0 || input.count > 100 || !Number.isFinite(input.trueFalseMaxRatio) || input.trueFalseMaxRatio < 0 || input.trueFalseMaxRatio > 1)
        throw new Error('Invalid selection limits.');
    const candidates = input.candidates.filter(c => !input.usedQuestionIds.includes(c.questionId) && (input.mode !== 'Review' || c.due));
    if (new Set(input.candidates.map(c => c.questionId)).size !== input.candidates.length)
        throw new Error('Duplicate question identity.');
    // Find a feasible actual size first: mix limits must also hold after a short bank truncates a set.
    for (let count = Math.min(input.count, candidates.length); count >= 0; count--) {
        const selected: SelectionCandidate[] = [], groups: string[][] = (input.acceptedTargetGroups ?? input.usedTargetIds.map(t => [t])).map(g => [...g]);
        const commentaryMax = Math.max(0, Math.ceil(count * .1) - 1), tfMax = Math.floor(count * input.trueFalseMaxRatio);
        for (let slot = 0; slot < count; slot++) {
            let available = candidates.filter(c => !selected.includes(c) && (input.mode !== 'Simulation' || (c.sourceKind !== 'Commentary' || selected.filter(q => q.sourceKind === 'Commentary').length < commentaryMax) && (c.kind !== 'TrueFalse' || selected.filter(q => q.kind === 'TrueFalse').length < tfMax)));
            const spaced = (c: SelectionCandidate) => c.spacedRepair || (c.repairTargetIds ?? c.targetIds).every(t => repairEligible(t, groups));
            if (input.mode !== 'Simulation') {
                const qualified = available.filter(c => !c.repairEligible || spaced(c));
                if (qualified.length)
                    available = qualified;
            }
            const category = input.mode !== 'Practice' ? 'coverage' : slot < 3 ? 'due' : slot < 6 ? 'coverage' : slot === 6 ? 'repair' : slot === 7 ? 'transfer' : 'coverage';
            let pool = available.filter(c => category === 'due' ? c.due : category === 'repair' ? c.repairEligible && spaced(c) : category === 'transfer' ? c.alternateForm : true);
            if (category === 'due') {
                const distinct = pool.filter(c => !selected.some(q => q.targetIds.some(t => c.targetIds.includes(t))));
                if (distinct.length)
                    pool = distinct;
            }
            const targetCount = (c: SelectionCandidate) => (c.targetServedCount ?? c.servedCount) + selected.filter(q => q.targetIds.some(t => c.targetIds.includes(t))).length;
            const ordered = (pool.length ? pool : available).sort((a, b) => {
                // Coverage is globally least-served: due/repair pressure cannot starve a fixed finite bank.
                const coverage = category === 'coverage' || !pool.length;
                const repeat = (c: SelectionCandidate) => Number(c.questionId === c.lastQuestionId);
                return (input.mode === 'Simulation' ? targetCount(a) - targetCount(b) : coverage ? a.servedCount - b.servedCount : repeat(a) - repeat(b)) || (coverage ? 0 : (a.targetServedCount ?? a.servedCount) - (b.targetServedCount ?? b.servedCount)) || a.servedCount - b.servedCount || (a.lastServedAtMs ?? -1) - (b.lastServedAtMs ?? -1) || stableSeed(a.questionId, input.sessionId, slot) - stableSeed(b.questionId, input.sessionId, slot) || (a.questionId < b.questionId ? -1 : 1);
            });
            if (!ordered.length)
                break;
            selected.push(ordered[0]);
            groups.push(ordered[0].targetIds);
        }
        if (selected.length === count)
            return selected.map(c => c.questionId);
    }
    return [];
}
