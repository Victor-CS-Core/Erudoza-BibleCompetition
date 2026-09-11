import type { Source } from '../application/model';
import type { Mastery, Session, Attempt } from '../study/routes';
import type { HonorKey } from './catalog';
export interface PassageEvidence { attemptId: string; sessionId: string; sourceUnitId: string; cardId: string; acceptedAtUtc: string; activityType: string; answerMode: string; difficulty: number; exactWording: number; reference: number; recognition: number }
export interface PassageProof {
  id: string; knowledgeUnitId: string; seasonId: string; userId: string;
  firstMasteryEvidence?: PassageEvidence; retainedEvidence?: PassageEvidence; reviewEvidence?: PassageEvidence;
  firstMasteredAtUtc: string | null; retainedAtUtc: string | null; retestAttemptId: string | null;
  reviewCertifiedAtUtc: string | null; reviewAttemptId: string | null;
}
export const masteryStandard = (m: Mastery | undefined) => !!m && m.algorithmVersion === 'v2-skill-evidence' && m.exactWording >= 90 && m.reference >= 80 && m.recognition >= 80;
export const passageId = (s: Source) => s.knowledgeUnitId ?? s.id;
export function updatePassageProof(proof: PassageProof, session: Session, attempt: Attempt, mastery: Mastery, dueAtUtc?: string): PassageProof {
  if (attempt.isLegacyDuplicate) return { ...proof };
  const next = { ...proof }, card = session.cards.find(c => c.id === attempt.cardId);
  const mastered = masteryStandard(mastery);
  const evidence: PassageEvidence | undefined = card ? { attemptId: attempt.id, sessionId: session.id, sourceUnitId: mastery.sourceUnitId, cardId: card.id, acceptedAtUtc: attempt.at, activityType: card.activityType, answerMode: card.answerMode, difficulty: card.payload.difficulty, exactWording: mastery.exactWording, reference: mastery.reference, recognition: mastery.recognition } : undefined;
  // Evidence is bounded to the first certification and one retained mastery proof per passage.
  if (mastered && !next.firstMasteredAtUtc) { next.firstMasteredAtUtc = attempt.at; next.firstMasteryEvidence = evidence; }
  const unaidedTyped = attempt.isCorrect && !attempt.hintsUsed && !attempt.isLegacyDuplicate && card?.answerMode === 'ExactText' && card.payload.difficulty >= 5 && ['MissingWords', 'WhatComesNext'].includes(card.activityType);
  if (mastered && unaidedTyped && next.firstMasteredAtUtc && Date.parse(attempt.at) - Date.parse(next.firstMasteredAtUtc) >= 48 * 3600000 && !next.retainedAtUtc) {
    next.retainedAtUtc = attempt.at; next.retestAttemptId = attempt.id; next.retainedEvidence = evidence;
  }
  const firstInReview = !session.attempts.some(a => a.id !== attempt.id && !a.isLegacyDuplicate && a.knowledgeUnitId === attempt.knowledgeUnitId);
  const dueAtStart = session.training?.reviewKnowledgeUnitIds.includes(attempt.knowledgeUnitId) || !!dueAtUtc && Date.parse(dueAtUtc) <= Date.parse(session.createdAtUtc);
  if (mastered && unaidedTyped && session.mode === 'Review' && firstInReview && dueAtStart && !next.reviewCertifiedAtUtc) {
    next.reviewCertifiedAtUtc = attempt.at; next.reviewAttemptId = attempt.id; next.reviewEvidence = evidence;
  }
  return next;
}
export function soloQualifiers(sources: Source[], states: Mastery[], proofs: PassageProof[]): { key: HonorKey; passageIds: string[] }[] {
  const units = [...new Map(sources.map(s => [passageId(s), s])).values()], byId = new Map(states.map(m => [m.knowledgeUnitId, m]));
  const exact = units.filter(s => { const m = byId.get(passageId(s)); return m?.algorithmVersion === 'v2-skill-evidence' && m.exactWording >= 90; });
  const reference = units.filter(s => { const m = byId.get(passageId(s)); return m?.algorithmVersion === 'v2-skill-evidence' && m.reference >= 90; });
  const mastered = units.filter(s => masteryStandard(byId.get(passageId(s))));
  const result: { key: HonorKey; passageIds: string[] }[] = [];
  const add = (key: HonorKey, eligible: Source[]) => result.push({ key, passageIds: eligible.map(passageId).sort() });
  if (exact.length >= 12) add('solo:exact-recall', exact);
  if (reference.length >= 20) add('solo:reference-ready', reference);
  const chapters = [...new Set(units.map(s => `${s.bookKey}:${s.chapter}`))].sort();
  for (const chapter of chapters) { const group = units.filter(s => `${s.bookKey}:${s.chapter}` === chapter); if (group.length >= 10 && group.every(s => masteryStandard(byId.get(passageId(s))))) { add('solo:chapter-strong', group); break; } }
  if (units.length >= 30 && mastered.length === units.length) add('solo:full-coverage', units);
  const retained = mastered.filter(s => proofs.some(p => p.knowledgeUnitId === passageId(s) && p.retainedAtUtc && p.retestAttemptId && p.firstMasteredAtUtc && Date.parse(p.retainedAtUtc) >= Date.parse(p.firstMasteredAtUtc) + 48 * 3600000));
  if (retained.length >= 20) add('solo:steady-study', retained);
  const reviewed = units.filter(s => proofs.some(p => p.knowledgeUnitId === passageId(s) && p.reviewCertifiedAtUtc && p.reviewAttemptId));
  if (reviewed.length >= 8) add('solo:review-complete', reviewed);
  return result;
}
