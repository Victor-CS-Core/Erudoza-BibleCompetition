import { gradePbe, validatePbeQuestion } from './grading';
import type { PbeQuestion, PbeTarget } from './types';
export interface TargetReview {
    targetId: string;
    intervalIndex: number;
    dueAtMs: number;
    unresolved: boolean;
    lastAttemptId: string | null;
    lastQuestionId: string | null;
    lastSuccessfulAtMs: number | null;
}
export interface RecallEvidence {
    attemptId: string;
    targetId: string;
    questionId: string;
    atMs: number;
    earnedPoints: number;
    availablePoints: number;
    unaided: boolean;
    recall: boolean;
}
export const initialReview = (targetId: string): TargetReview => ({ targetId, intervalIndex: -1, dueAtMs: 0, unresolved: false, lastAttemptId: null, lastQuestionId: null, lastSuccessfulAtMs: null });
export function advanceReview(state: TargetReview, e: RecallEvidence): TargetReview {
    if (state.lastAttemptId === e.attemptId || !e.recall)
        return state;
    const full = e.earnedPoints === e.availablePoints && e.availablePoints > 0;
    if (full && !e.unaided)
        return { ...state, lastAttemptId: e.attemptId };
    if (full && !state.unresolved && state.intervalIndex >= 0 && e.atMs < state.dueAtMs)
        return { ...state, lastAttemptId: e.attemptId, lastQuestionId: e.questionId, lastSuccessfulAtMs: e.atMs };
    const index = full ? Math.min(3, state.intervalIndex + 1) : -1;
    return { ...state, intervalIndex: index, unresolved: !full, dueAtMs: e.atMs + (full ? [1, 3, 7, 14][index] * 86400000 : 0), lastAttemptId: e.attemptId, lastQuestionId: e.questionId, lastSuccessfulAtMs: full ? e.atMs : state.lastSuccessfulAtMs };
}
/** Trusted frozen question/targets and server acceptance time only. No submitted grade enters here. */
export function groupRecallEvidence(question: PbeQuestion, targets: PbeTarget[], answers: string[], attemptId: string, atMs: number, unaided: boolean): RecallEvidence[] {
    validatePbeQuestion(question, targets);
    const grade = gradePbe(question, answers), grouped = new Map<string, RecallEvidence>();
    for (const p of grade.parts) {
        const target = targets.find(t => t.id.toLowerCase() === p.targetId.toLowerCase())!;
        const id = target.id.toLowerCase();
        const e = grouped.get(id) ?? { attemptId, targetId: id, questionId: question.id.toLowerCase(), atMs, earnedPoints: 0, availablePoints: 0, unaided, recall: question.kind !== 'TrueFalse' && (target.skill !== 'ExactWords' || question.kind === 'ExactWords') };
        e.earnedPoints += p.earnedPoints;
        e.availablePoints += p.availablePoints;
        grouped.set(id, e);
    }
    return [...grouped.values()].sort((a, b) => a.targetId < b.targetId ? -1 : 1);
}
