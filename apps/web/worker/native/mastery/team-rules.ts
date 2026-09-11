import type { Room } from '../practice/state';
import { points } from '../practice/scoring';
import type { HonorKey } from './catalog';
export interface QuestionProof { roomId: string; revision: number; completedAtUtc: string; questionId: string; questionVersion: number; sourceUnitId: string; team: number; submitterId: string; manual: boolean; earnedHundredths: number; availableHundredths: number }
const atLeast = (items: QuestionProof[], threshold: number) => items.length > 0 && items.every(x => Number.isSafeInteger(x.earnedHundredths) && x.earnedHundredths >= 0 && x.earnedHundredths <= x.availableHundredths) && items.reduce((n, x) => n + x.availableHundredths, 0) > 0 && items.reduce((n, x) => n + x.earnedHundredths, 0) * 100 >= items.reduce((n, x) => n + x.availableHundredths, 0) * threshold;
const distinct = (items: QuestionProof[]) => [...new Map([...items].reverse().map(p => [p.questionId, p])).values()];
export function teamQualifiers(rooms: Room[], userId: string): { key: HonorKey; evidence: QuestionProof[] }[] {
  const complete = rooms.filter(r => r.status === 'Completed' && r.completedAt && r.questions.length === r.questionCount && r.submissions.length === r.questions.length * 2 && r.submissions.every(s => s.resolved) && new Set(r.questions.map(q => q.id)).size === r.questionCount && r.questions.every(q => [1, 2].every(team => r.submissions.filter(s => s.questionId === q.id && s.team === team).length === 1)) && r.members.some(m => m.userId === userId))
    .sort((a, b) => b.completedAt!.localeCompare(a.completedAt!) || b.id.localeCompare(a.id));
  const perMatch = complete.map(room => {
    const team = room.members.find(m => m.userId === userId)!.team;
    return { room, proofs: room.submissions.filter(s => s.team === team).flatMap(s => {
      const q = room.questions.find(q => q.id === s.questionId); if (!q || points(q) <= 0) return [];
      return [{ roomId: room.id, revision: room.revision, completedAtUtc: room.completedAt!, questionId: q.id, questionVersion: q.version, sourceUnitId: q.sourceUnitId, team, submitterId: s.scribeId, manual: !s.deadlineDraft, earnedHundredths: s.accuracyHundredths, availableHundredths: points(q) * 100 }];
    }) };
  });
  const team = distinct(perMatch.flatMap(x => x.proofs));
  // Latest personal submission is selected independently; a later teammate's submission does not erase personal proof.
  const personal = distinct(perMatch.flatMap(x => x.proofs.filter(p => p.manual && p.submitterId === userId)));
  const personal90 = personal.length >= 10 && atLeast(personal, 90), result: { key: HonorKey; evidence: QuestionProof[] }[] = [];
  const add = (key: HonorKey, evidence: QuestionProof[]) => result.push({ key, evidence });
  if (personal90) add('team:first-fellowship', personal);
  if (perMatch.filter(x => atLeast(x.proofs, 90)).length >= 3 && personal.length >= 30 && atLeast(personal, 90)) add('team:team-steady', [...perMatch.filter(x => atLeast(x.proofs, 90)).flatMap(x => x.proofs), ...personal]);
  if (personal.length >= 30 && new Set(personal.map(p => p.sourceUnitId)).size >= 10 && atLeast(personal, 95)) add('team:shared-scribe', personal);
  if (team.length >= 50 && new Set(team.map(p => p.sourceUnitId)).size >= 15 && atLeast(team, 95) && personal90) add('team:team-precision', [...team, ...personal]);
  const rehearsal = perMatch.find(x => x.room.coached && x.room.questionCount === 90 && atLeast(x.proofs, 90));
  if (rehearsal && personal90) add('team:rehearsal-complete', [...rehearsal.proofs, ...personal]);
  return result;
}
