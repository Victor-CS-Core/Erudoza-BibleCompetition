import { responseSeconds } from './rules';

export interface PresentationState {
  questionId: string;
  revision: number;
  delivery: 'Audio' | 'TextFallback' | 'Coach';
  requiredScribeIds: string[];
  readyScribeIds: string[];
  responseStartsAtMs: number | null;
  responseEndsAtMs: number | null;
}

export function acknowledgePresentation(state: PresentationState, scribeId: string, questionId: string, nowMs: number, points: number): PresentationState {
  if (!Number.isSafeInteger(state.revision) || state.revision < 1 || !Number.isFinite(nowMs) || !Number.isSafeInteger(points) || points < 1 ||
      questionId !== state.questionId || !state.requiredScribeIds.includes(scribeId)) throw new Error('Invalid presentation acknowledgement.');
  if (state.responseStartsAtMs !== null) return state;
  const readyScribeIds = state.readyScribeIds.includes(scribeId) ? state.readyScribeIds : [...state.readyScribeIds, scribeId];
  if (!state.requiredScribeIds.every(id => readyScribeIds.includes(id))) return { ...state, readyScribeIds };
  const responseStartsAtMs = nowMs + 3_000;
  return { ...state, readyScribeIds, responseStartsAtMs, responseEndsAtMs: responseStartsAtMs + responseSeconds(points) * 1_000 };
}

export function rehearsalPoints(earned: number, elapsedMs: number, points: number): number {
  if (!Number.isSafeInteger(points) || points < 1 || !Number.isInteger(earned) || earned < 0 || earned > points || !Number.isFinite(elapsedMs) || elapsedMs < 0)
    throw new Error('Invalid rehearsal score.');
  return elapsedMs <= responseSeconds(points) * 1000 ? earned : 0;
}
