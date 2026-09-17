import type { SkillScores } from '../../../src/api/trainingTypes';
export interface AcceptedEvidence {
    cardId: string;
    knowledgeUnitId: string;
    isLegacyDuplicate?: boolean;
    isCorrect: boolean;
    before?: SkillScores;
    after?: SkillScores;
}
export const fullTargetReached = (target: number, attempts: AcceptedEvidence[]) => Number.isSafeInteger(target) && target > 0 && new Set(attempts.filter(a => !a.isLegacyDuplicate).map(a => a.cardId)).size >= target;
export const reviewSetComplete = (requiredIds: string[], attempts: AcceptedEvidence[]) => requiredIds.length > 0 && requiredIds.every(id => attempts.some(a => !a.isLegacyDuplicate && a.knowledgeUnitId === id));
export function badgeCounters(sources: {
    id: string;
    bookKey: string;
    chapter: number;
}[], states: (SkillScores & {
    knowledgeUnitId: string;
    algorithmVersion: string;
    level: string;
})[], seen: string[], weeks: number, review: boolean, streak = 0) {
    const current = states.filter(m => m.algorithmVersion === 'v2-skill-evidence' && sources.some(s => s.id === m.knowledgeUnitId));
    const chapters = [...new Set(sources.map(s => `${s.bookKey}:${s.chapter}`))].map(key => {
        const ids = sources.filter(s => `${s.bookKey}:${s.chapter}` === key).map(s => s.id);
        return [ids.filter(id => current.some(m => m.knowledgeUnitId === id && ['Strong', 'Mastered'].includes(m.level))).length, ids.length] as [
            number,
            number
        ];
    });
    const chapter = chapters.sort((a, b) => Number(b[0] === b[1]) - Number(a[0] === a[1]) || b[0] / b[1] - a[0] / a[1])[0] ?? [0, 0];
    return { 'exact-recall': [Math.min(5, new Set(current.filter(m => m.exactWording >= 80).map(m => m.knowledgeUnitId)).size), 5], 'reference-ready': [Math.min(10, new Set(current.filter(m => m.reference >= 70).map(m => m.knowledgeUnitId)).size), 10], 'chapter-strong': chapter, 'full-coverage': [sources.filter(s => seen.includes(s.id)).length, sources.length], 'steady-study': [Math.min(4, weeks), 4], 'review-complete': [review ? 1 : 0, 1], 'streak-7': [Math.min(7, streak), 7], 'streak-14': [Math.min(14, streak), 14], 'streak-30': [Math.min(30, streak), 30] } as Record<import('../../../src/api/trainingTypes').BadgeKey, [
        number,
        number
    ]>;
}
