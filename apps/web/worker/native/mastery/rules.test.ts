// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { soloQualifiers, updatePassageProof } from './solo-rules';
import type { PassageProof } from './solo-rules';
import { teamQualifiers } from './team-rules';
import type { Source } from '../application/model';
import type { Mastery, Session, Attempt } from '../study/routes';
import { makeRoom } from '../practice/state';
import type { Room } from '../practice/state';
import type { Actor } from '../types';
const sources = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, knowledgeUnitId: `s${i}`, bookKey: 'GEN', chapter: 1, canonicalText: 'A verse' } as Source));
const states = (n: number) => sources(n).map(s => ({ knowledgeUnitId: s.id, algorithmVersion: 'v2-skill-evidence', exactWording: 90, reference: 90, recognition: 80 } as Mastery));
const keys = (n: number, ms = states(n), ps: PassageProof[] = []) => soloQualifiers(sources(n), ms, ps).map(x => x.key);
const proof = (id = 's0'): PassageProof => ({ id, knowledgeUnitId: id, userId: 'a', seasonId: 'season', firstMasteredAtUtc: '2026-09-01T00:00:00Z', retainedAtUtc: null, retestAttemptId: null, reviewCertifiedAtUtc: null, reviewAttemptId: null });
function trial(overrides: Partial<Attempt> = {}) {
  const attempt = { id: 'a1', cardId: 'c', knowledgeUnitId: 's0', at: '2026-09-03T00:00:00Z', isCorrect: true, hintsUsed: false, activityType: 'MissingWords', ...overrides } as Attempt;
  const session = { mode: 'Review', createdAtUtc: '2026-09-03T00:00:00Z', cards: [{ id: 'c', answerMode: 'ExactText', activityType: 'MissingWords', payload: { difficulty: 5 } }], attempts: [attempt] } as Session;
  return { attempt, session };
}
describe('solo mastery boundaries', () => {
  it('requires distinct assigned passages and explicit skill floors, not legacy levels', () => {
    expect(keys(9)).toEqual([]);
    expect(keys(11)).not.toContain('solo:exact-recall');
    expect(keys(12)).toContain('solo:exact-recall');
    expect(keys(19)).not.toContain('solo:reference-ready');
    expect(keys(20)).toContain('solo:reference-ready');
    expect(keys(10)).toContain('solo:chapter-strong');
    expect(keys(29)).not.toContain('solo:full-coverage');
    expect(keys(30)).toContain('solo:full-coverage');
    const low = states(30); low[0].reference = 79;
    expect(keys(30, low)).not.toContain('solo:chapter-strong');
    expect(keys(30, low)).not.toContain('solo:full-coverage');
    expect(keys(30, states(30).map(m => ({ ...m, algorithmVersion: 'legacy' })))).toEqual([]);
    expect(soloQualifiers(Array(30).fill(sources(1)[0]), states(1), [])).toEqual([]);
  });
  it('certifies exact48h advanced unaided retest and first due review only', () => {
    const { attempt, session } = trial();
    expect(updatePassageProof({ ...proof(), firstMasteredAtUtc: null }, session, { ...attempt, isLegacyDuplicate: true }, states(1)[0]).firstMasteredAtUtc).toBeNull();
    const certified = updatePassageProof(proof(), session, attempt, states(1)[0], '2026-09-03T00:00:00Z');
    expect(certified).toMatchObject({ retestAttemptId: 'a1', reviewAttemptId: 'a1' });
    expect(updatePassageProof(proof(), session, { ...attempt, at: '2026-09-02T23:59:59Z' }, states(1)[0]).retestAttemptId).toBeNull();
    for (const change of [{ hintsUsed: true }, { isCorrect: false }, { isLegacyDuplicate: true }]) expect(updatePassageProof(proof(), session, { ...attempt, ...change }, states(1)[0], '2026-09-01T00:00:00Z')).toMatchObject({ retestAttemptId: null, reviewAttemptId: null });
    for (const mode of ['SelectedChoice', 'OrderedSequence', 'ShortFact'] as const) { const changed = structuredClone(session); changed.cards[0].answerMode = mode; expect(updatePassageProof(proof(), changed, attempt, states(1)[0]).retestAttemptId).toBeNull(); }
    const low = structuredClone(session); low.cards[0].payload.difficulty = 3;
    expect(updatePassageProof(proof(), low, attempt, states(1)[0]).retestAttemptId).toBeNull();
    const frozen = structuredClone(session); frozen.training = { reviewKnowledgeUnitIds: ['s0'] } as NonNullable<Session['training']>;
    expect(updatePassageProof(proof(), frozen, attempt, states(1)[0], '2026-09-05T00:00:00Z').reviewAttemptId).toBe('a1');
    expect(updatePassageProof(proof(), session, attempt, states(1)[0], '2026-09-05T00:00:00Z').reviewAttemptId).toBeNull();
    session.attempts.unshift({ ...attempt, id: 'failed', isCorrect: false });
    expect(updatePassageProof(proof(), session, attempt, states(1)[0], '2026-09-01T00:00:00Z').reviewAttemptId).toBeNull();
  });
  it('requires20 valid retest certificates and8 distinct review certificates', () => {
    const ps = Array.from({ length: 20 }, (_, i) => ({ ...proof(`s${i}`), retainedAtUtc: '2026-09-03T00:00:00Z', retestAttemptId: `a${i}`, reviewCertifiedAtUtc: '2026-09-03T00:00:00Z', reviewAttemptId: `r${i}` }));
    expect(keys(20, states(20), ps)).toEqual(expect.arrayContaining(['solo:steady-study', 'solo:review-complete']));
    expect(keys(20, states(20), ps.slice(0, 19))).not.toContain('solo:steady-study');
    expect(keys(20, states(20), ps.slice(0, 7))).not.toContain('solo:review-complete');
    expect(keys(20, states(20), ps.map(p => ({ ...p, retainedAtUtc: '2026-09-02T00:00:00Z' })))).not.toContain('solo:steady-study');
  });
});
function room(id: string, n: number, earned = 20, start = 0): Room {
  const actor: Actor = { userId: 'a', organizationId: 'org', organizationName: 'Org', userName: 'a', displayName: 'A', email: null, kind: 'Student', role: 'Student', credentialVersion: 'v1' };
  const r = makeRoom(id, actor, { seasonId: 'season', teamSize: 1, questionCount: 10, coached: false }, 'epoch', 0);
  r.members.push({ userId: 'b', displayName: 'B', team: 2, scribe: true, captain: true, ready: true });
  r.status = 'Completed'; r.questionCount = n; r.completedAt = '2026-09-03T00:00:00Z';
  r.questions = Array.from({ length: n }, (_, i) => ({ id: `q${start + i}`, sourceUnitId: `s${Math.floor((start + i) / 3)}`, contentPackId: 'p', kind: 'ExactWords', prompt: 'Say it', reference: 'GEN1', evidence: 'Evidence', version: 1, ordered: false, parts: [{ points: 20, acceptedAnswers: ['yes'] }] }));
  r.submissions = r.questions.flatMap(q => [1, 2].map(team => ({ questionId: q.id, team, scribeId: team === 1 ? 'a' : 'b', answers: ['yes'], elapsedMs: 100, deadlineDraft: false, accuracyHundredths: earned * 100, speedHundredths: 500, appealed: false, resolved: true })));
  return r;
}
describe('team mastery proof', () => {
  it('uses accuracy floors and distinct manual questions, never attendance/chat/speed', () => {
    expect(teamQualifiers([room('r', 9)], 'a')).toEqual([]);
    expect(teamQualifiers([room('r', 10, 18)], 'a').map(x => x.key)).toContain('team:first-fellowship');
    expect(teamQualifiers([room('r', 10, 17)], 'a')).toEqual([]);
    const idle = room('r', 30); idle.submissions.forEach(s => { s.deadlineDraft = true; });
    expect(teamQualifiers([idle], 'a')).toEqual([]);
    const good = room('r', 30, 19);
    expect(teamQualifiers([good], 'a').map(x => x.key)).toContain('team:shared-scribe');
    good.questions.forEach(q => { q.sourceUnitId = 'same'; });
    expect(teamQualifiers([good], 'a').map(x => x.key)).not.toContain('team:shared-scribe');
  });
  it('deduplicates latest timestamp then room ID and independent personal manual evidence', () => {
    const good = room('a', 10), bad = room('z', 10, 0);
    expect(teamQualifiers([good, bad], 'a')).toEqual([]);
    expect(teamQualifiers([bad, good], 'a')).toEqual([]);
    bad.completedAt = '2026-09-02T00:00:00Z';
    expect(teamQualifiers([bad, good], 'a').map(x => x.key)).toContain('team:first-fellowship');
    expect(teamQualifiers([good, { ...good, id: 'b' }], 'a').map(x => x.key)).not.toContain('team:shared-scribe');
    const repeat = room('z', 10, 0); repeat.submissions.filter(s => s.team === 1).forEach(s => { s.scribeId = 'teammate'; });
    expect(teamQualifiers([repeat, good], 'a').map(x => x.key)).toContain('team:first-fellowship');
  });
  it('requires3 accurate matches,50/15 for team precision and full judged rehearsal', () => {
    const matches = [room('a', 10, 18, 0), room('b', 10, 18, 10), room('c', 10, 18, 20)];
    expect(teamQualifiers(matches, 'a').map(x => x.key)).toContain('team:team-steady');
    expect(teamQualifiers(matches.slice(0, 2), 'a').map(x => x.key)).not.toContain('team:team-steady');
    const weakerTeam = room('d', 20, 0, 30); weakerTeam.submissions.filter(s => s.team === 1).forEach((s, i) => { if (i < 10) s.accuracyHundredths = 2000; else s.scribeId = 'teammate'; });
    const mixed = [...matches.map((r, i) => { const copy = structuredClone(r); if (i === 2) copy.submissions.filter(s => s.team === 1).forEach(s => { s.scribeId = 'teammate'; }); return copy; }), weakerTeam];
    const steady = teamQualifiers(mixed, 'a').find(x => x.key === 'team:team-steady');
    expect(steady).toBeDefined(); expect(new Set(steady!.evidence.filter(x => x.manual && x.submitterId === 'a').map(x => x.questionId)).size).toBe(30);
    expect(teamQualifiers([room('a', 49, 19)], 'a').map(x => x.key)).not.toContain('team:team-precision');
    expect(teamQualifiers([room('a', 50, 19)], 'a').map(x => x.key)).toContain('team:team-precision');
    const rehearsal = room('a', 90, 18); rehearsal.coached = true;
    expect(teamQualifiers([rehearsal], 'a').map(x => x.key)).toContain('team:rehearsal-complete');
    rehearsal.submissions[0].resolved = false; rehearsal.submissions[0].appealed = true;
    expect(teamQualifiers([rehearsal], 'a')).toEqual([]);
    rehearsal.submissions[0].resolved = true; rehearsal.submissions.pop();
    expect(teamQualifiers([rehearsal], 'a')).toEqual([]);
  });
});
it('requires the saved honor profile for cued Advanced retests and preserves legacy proof',()=>{
 const {attempt,session}=trial();
 for(const profile of [undefined,'memory-honor-v2','memory-cued-v3'] as const){
  session.cards[0].payload.evidenceProfile=profile;
  const result=updatePassageProof(proof(),session,attempt,states(1)[0],'2026-09-01T00:00:00Z');
  expect(result.retestAttemptId).toBe(profile==='memory-cued-v3'?null:attempt.id);
  expect(result.reviewAttemptId).toBe(profile==='memory-cued-v3'?null:attempt.id);
 }
});
