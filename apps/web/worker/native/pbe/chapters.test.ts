// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {chapterHash,chapterTextHash} from './chapter-manifest';
import { projectChapter, retainedTargets, initialRetentionState, advanceRetention, replayTargets } from './chapters';
import type { TargetProof } from './chapters';
import type { PbeQuestion, PbeTarget } from './types';
import type { TargetReview } from './review';

const delay = 172_800_000;
const proof = (overrides: Partial<TargetProof> = {}): TargetProof => ({
  targetId: 't', questionId: 'q1', questionVersion: 1, attemptId: 'a1',
  atMs: 0, acceptedSequence: 1, fullCredit: true, unaided: true,
  final: true, recall: true, activity: 'Solo', ...overrides,
});

const target = (id = 't', sourceUnitIds = ['verse-1'], skill: PbeTarget['skill'] = 'FactualRecall'): PbeTarget => ({
  id, sourceUnitIds, skill, label: 'Declared recall target',
});
const question = (id: string, t: PbeTarget, overrides: Partial<PbeQuestion> = {}): PbeQuestion => ({
  schemaVersion: 2, id, version: 1, contentPackId: 'pack',
  sourceUnitId: t.sourceUnitIds[0], sourceUnitIds: t.sourceUnitIds,
  sourceKind: 'Scripture', reference: 'Genesis 1:1', evidence: 'In the beginning',
  kind: t.skill === 'ExactWords' ? 'ExactWords' : 'ShortAnswer',
  prompt: 'What words begin the passage?', ordered: true,
  parts: [{ targetId: t.id, acceptedAnswers: [overrides.kind === 'TrueFalse' ? 'True' : 'In the beginning'], points: 1 }], ...overrides,
});
const pair = (targetId = 't'): TargetProof[] => [
  proof({ targetId }), proof({ targetId, questionId: 'q2', attemptId: 'a2', atMs: delay, acceptedSequence: 2 }),
];
const review = (targetId: string, overrides: Partial<TargetReview> = {}): TargetReview => ({
  targetId, intervalIndex: 0, dueAtMs: delay, unresolved: false,
  lastAttemptId: 'a1', lastQuestionId: 'q1', lastSuccessfulAtMs: 0, ...overrides,
});
const chapter = { chapterKey: 'genesis:1', scopeVersion: 'scope-v1', assignedSourceUnitIds: ['verse-1'], eligibleAssignmentSourceUnitIds: ['verse-1'] };
const context = { asOfMs: delay };

describe('projectChapter', () => {
  it('reports no target readiness for an empty assigned scope', () => {
    const t = target();
    expect(projectChapter({ ...chapter, assignedSourceUnitIds: [] }, [t], [review('t')], pair(), [question('q1', t), question('q2', t)], context))
      .toEqual({ chapterKey: 'genesis:1', scopeVersion: 'scope-v1', assignedPassages: 0, questionCoveredPassages: 0,
        totalTargets: 0, practicedTargets: 0, recalledTargets: 0, retainedTargets: 0, dueTargets: 0,
        missingVariantTargets: 0, stampEarnedAtUtc: null });
  });

  it('reports an assigned passage without inventing targets or question coverage', () => {
    expect(projectChapter(chapter, [], [], [], [], context)).toEqual({
      chapterKey: 'genesis:1', scopeVersion: 'scope-v1', assignedPassages: 1, questionCoveredPassages: 0,
      totalTargets: 0, practicedTargets: 0, recalledTargets: 0, retainedTargets: 0, dueTargets: 0,
      missingVariantTargets: 0, stampEarnedAtUtc: null,
    });
  });

  it('allows full bank readiness for a one-verse assignment without fabricating an earned date', () => {
    const t = target();
    expect(projectChapter(chapter, [t], [review('t')], pair(), [question('q1', t), question('q2', t)], context))
      .toEqual({ chapterKey: 'genesis:1', scopeVersion: 'scope-v1', assignedPassages: 1, questionCoveredPassages: 1,
        totalTargets: 1, practicedTargets: 1, recalledTargets: 1, retainedTargets: 1, dueTargets: 1,
        missingVariantTargets: 0, stampEarnedAtUtc: null });
  });

  it('includes every declared target, including a target with zero published questions', () => {
    const t = target(), unserved = target('unserved');
    expect(projectChapter(chapter, [t, unserved], [], pair(), [question('q1', t), question('q2', t)], context))
      .toMatchObject({ assignedPassages: 1, questionCoveredPassages: 1, totalTargets: 2,
        practicedTargets: 1, recalledTargets: 1, retainedTargets: 1, dueTargets: 0,
        missingVariantTargets: 1, stampEarnedAtUtc: null });
  });

  it('reports incomplete assigned-passage coverage even if every declared target is retained', () => {
    const t = target();
    expect(projectChapter({ ...chapter, assignedSourceUnitIds: ['verse-1', 'verse-2'], eligibleAssignmentSourceUnitIds: ['verse-1', 'verse-2'] }, [t], [], pair(), [question('q1', t), question('q2', t)], context))
      .toMatchObject({ assignedPassages: 2, questionCoveredPassages: 1, totalTargets: 1,
        retainedTargets: 1, missingVariantTargets: 0, stampEarnedAtUtc: null });
  });

  it('keeps an excluded verse and a cross-range question out of partial-chapter counts', () => {
    const t = target(), excluded = target('excluded', ['verse-2']), spanning = target('spanning', ['verse-1', 'verse-2']);
    const scope = { ...chapter, assignedSourceUnitIds: ['verse-1', 'verse-3', 'verse-1'], eligibleAssignmentSourceUnitIds: ['verse-1', 'verse-3'] };
    expect(projectChapter(scope, [t, excluded, spanning], [review('excluded')], [...pair(), ...pair('excluded'), ...pair('spanning')],
      [question('q1', t), question('q2', t), question('excluded-question', excluded), question('spanning-question', spanning)], context))
      .toMatchObject({ assignedPassages: 2, questionCoveredPassages: 1, totalTargets: 1,
        practicedTargets: 1, recalledTargets: 1, retainedTargets: 1, dueTargets: 0, missingVariantTargets: 0 });
  });

  it('includes a fully assigned cross-chapter target and its question coverage in each intersected chapter', () => {
    const spanning = target('span', ['verse-1', 'chapter-2-verse-1']), neighbor = target('neighbor', ['chapter-2-verse-1']);
    const questions = [question('q1', spanning), question('q2', spanning)];
    const scope = { ...chapter, eligibleAssignmentSourceUnitIds: ['verse-1', 'chapter-2-verse-1'] };
    expect(projectChapter(scope, [spanning, neighbor], [], pair('span'), questions, context))
      .toMatchObject({ assignedPassages: 1, questionCoveredPassages: 1, totalTargets: 1, retainedTargets: 1, missingVariantTargets: 0 });
    expect(projectChapter({ ...scope, chapterKey: 'genesis:2', assignedSourceUnitIds: ['chapter-2-verse-1'] }, [spanning, neighbor], [], pair('span'), questions, context))
      .toMatchObject({ assignedPassages: 1, questionCoveredPassages: 1, totalTargets: 2, retainedTargets: 1, missingVariantTargets: 1 });
    expect(projectChapter(chapter, [spanning, neighbor], [], pair('span'), questions, context))
      .toMatchObject({ assignedPassages: 1, questionCoveredPassages: 0, totalTargets: 0, retainedTargets: 0 });
  });

  it('keeps same-numbered chapters in different books separate by their supplied sources', () => {
    const genesis = target(), exodus = target('exodus-target', ['exodus-verse-1']);
    const questions = [question('q1', genesis), question('q2', genesis), question('exodus-q1', exodus), question('exodus-q2', exodus)];
    const scope = { ...chapter, eligibleAssignmentSourceUnitIds: ['verse-1', 'exodus-verse-1'] };
    expect(projectChapter(scope, [genesis, exodus], [review('t'), review('exodus-target')], pair(), questions, context))
      .toMatchObject({ chapterKey: 'genesis:1', totalTargets: 1, questionCoveredPassages: 1, practicedTargets: 1, retainedTargets: 1, dueTargets: 1 });
    expect(projectChapter({ ...scope, chapterKey: 'exodus:1', assignedSourceUnitIds: ['exodus-verse-1'] }, [genesis, exodus], [review('t'), review('exodus-target')], pair(), questions, context))
      .toMatchObject({ chapterKey: 'exodus:1', totalTargets: 1, questionCoveredPassages: 1, practicedTargets: 0, retainedTargets: 0, dueTargets: 1 });
  });

  it('recomputes a changed scope without carrying old coverage or an earned date into the expansion', () => {
    const old = target(), added = target('added', ['verse-2']);
    const questions = [question('q1', old), question('q2', old)];
    const before = projectChapter(chapter, [old, added], [], pair(), questions, context);
    const after = projectChapter({ ...chapter, scopeVersion: 'scope-v2', assignedSourceUnitIds: ['verse-1', 'verse-2'], eligibleAssignmentSourceUnitIds: ['verse-1', 'verse-2'] }, [old, added], [], pair(), questions, context);
    expect(before).toMatchObject({ scopeVersion: 'scope-v1', totalTargets: 1, assignedPassages: 1, retainedTargets: 1, missingVariantTargets: 0 });
    expect(after).toMatchObject({ scopeVersion: 'scope-v2', totalTargets: 2, assignedPassages: 2, questionCoveredPassages: 1, retainedTargets: 1, missingVariantTargets: 1, stampEarnedAtUtc: null });
  });

  it('counts recognition as practice and passage coverage, but never recall or a recall variant', () => {
    const t = target();
    const questions = [question('q1', t, { kind: 'TrueFalse' }), question('q2', t, { kind: 'TrueFalse' })];
    expect(projectChapter(chapter, [t], [], pair().map(p => ({ ...p, recall: false })), questions, context))
      .toMatchObject({ questionCoveredPassages: 1, practicedTargets: 1, recalledTargets: 0, retainedTargets: 0, missingVariantTargets: 1 });
  });

  it.each([
    { name: 'aided', overrides: { unaided: false }, practiced: 1 },
    { name: 'provisional', overrides: { final: false }, practiced: 1 },
    { name: 'team', overrides: { activity: 'Team' as const }, practiced: 0 },
  ])('excludes $name answers from individual chapter recall', ({ overrides, practiced }) => {
    const t = target();
    expect(projectChapter(chapter, [t], [], pair().map(p => ({ ...p, ...overrides })), [question('q1', t), question('q2', t)], context))
      .toMatchObject({ practicedTargets: practiced, recalledTargets: 0, retainedTargets: 0 });
  });

  it('recomputes current recalled and retained counts after a failure or pending correction', () => {
    const t = target(), questions = [question('q1', t), question('q2', t)];
    const wrong = proof({ attemptId: 'a3', questionId: 'q3', atMs: delay + 1, acceptedSequence: 3, fullCredit: false });
    expect(projectChapter(chapter, [t], [], [...pair(), wrong], questions, context))
      .toMatchObject({ practicedTargets: 1, recalledTargets: 0, retainedTargets: 0 });
    expect(projectChapter(chapter, [t], [], [...pair(), { ...wrong, final: false }], questions, context))
      .toMatchObject({ practicedTargets: 1, recalledTargets: 0, retainedTargets: 0 });
  });

  it('counts distinct question identities, not versions or repeated target parts, as recall variants', () => {
    const t = target();
    const q = question('q1', t, { parts: [
      { targetId: t.id, acceptedAnswers: ['In'], points: 1 }, { targetId: t.id, acceptedAnswers: ['the beginning'], points: 1 },
    ] });
    expect(projectChapter(chapter, [t], [], pair(), [q, { ...q, version: 2 }], context))
      .toMatchObject({ questionCoveredPassages: 1, recalledTargets: 1, retainedTargets: 0, missingVariantTargets: 1 });
    expect(projectChapter(chapter, [t], [], pair(), [q, question('q2', t)], context))
      .toMatchObject({ retainedTargets: 1, missingVariantTargets: 0 });
  });

  it('requires ExactWords question kinds for ExactWords variants and preserves the existing ordered grading semantics', () => {
    const exact = target('t', ['verse-1'], 'ExactWords');
    const short = question('q1', exact, { kind: 'ShortAnswer' }), list = question('q2', exact, { kind: 'List' });
    expect(projectChapter(chapter, [exact], [], pair(), [short, list], context))
      .toMatchObject({ recalledTargets: 1, retainedTargets: 0, missingVariantTargets: 1 });
    expect(projectChapter(chapter, [exact], [], pair(), [question('q1', exact), question('q2', exact, { ordered: false })], context))
      .toMatchObject({ recalledTargets: 1, retainedTargets: 1, missingVariantTargets: 0 });
  });

  it('uses the trusted frozen recall flag instead of regrading historical proof from current heads', () => {
    const exact = target('t', ['verse-1'], 'ExactWords');
    const questions = [question('q1', exact, { version: 2 }), question('q2', exact, { version: 2 })];
    expect(projectChapter(chapter, [exact], [], pair().map(p => ({ ...p, recall: false })), questions, context))
      .toMatchObject({ practicedTargets: 1, recalledTargets: 0, retainedTargets: 0, missingVariantTargets: 0 });
    const historical = pair().map(p => ({ ...p, questionId: `historical-${p.questionId}` }));
    expect(projectChapter(chapter, [exact], [], historical, questions, context))
      .toMatchObject({ recalledTargets: 1, retainedTargets: 1, missingVariantTargets: 0 });
  });

  it('projects approved introductions from opaque source IDs without invented Scripture coordinates', () => {
    const t = target('intro-target', ['intro-source']);
    const scope = { chapterKey: 'intro:pack', scopeVersion: 'intro-v1', assignedSourceUnitIds: ['intro-source'], eligibleAssignmentSourceUnitIds: ['intro-source'] };
    expect(projectChapter(scope, [t], [], pair('intro-target'), [question('q1', t, { sourceKind: 'Commentary' }), question('q2', t, { sourceKind: 'Commentary' })], context))
      .toMatchObject({ chapterKey: 'intro:pack', scopeVersion: 'intro-v1', assignedPassages: 1, questionCoveredPassages: 1, totalTargets: 1, retainedTargets: 1 });
  });

  it('counts scheduled and unresolved reviews at the explicit as-of boundary, excluding initial and outside reviews', () => {
    const targets = ['before', 'equal', 'after', 'failed', 'initial', 'unreviewed'].map(id => target(id));
    const reviews = [review('before', { dueAtMs: delay - 1 }), review('equal'), review('after', { dueAtMs: delay + 1 }),
      review('failed', { unresolved: true, intervalIndex: -1, dueAtMs: delay + 1 }),
      review('initial', { intervalIndex: -1, dueAtMs: 0, lastAttemptId: null, lastQuestionId: null, lastSuccessfulAtMs: null }), review('outside')];
    expect(projectChapter(chapter, targets, reviews, [], [], context)).toMatchObject({ totalTargets: 6, dueTargets: 3 });
    expect(projectChapter(chapter, targets, reviews, [], [], { asOfMs: delay + 1 })).toMatchObject({ dueTargets: 4 });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])('rejects a non-finite as-of time %s', asOfMs => {
    expect(() => projectChapter(chapter, [], [], [], [], { asOfMs })).toThrow();
  });

  it('rejects a chapter source outside the caller-supplied eligible assignment', () => {
    expect(() => projectChapter({ ...chapter, assignedSourceUnitIds: ['unassigned'] }, [], [], [], [], context)).toThrow();
  });
});

describe('retainedTargets', () => {
  it('requires a different question after a delay, not repeated immediate success', () => {
    const first = proof();
    expect(retainedTargets([first, proof({ attemptId: 'a2', atMs: delay, acceptedSequence: 2 })], ['t'])).toEqual([]);
    expect(retainedTargets([first, proof({ questionId: 'q2', attemptId: 'a3', atMs: delay, acceptedSequence: 2 })], ['t']))
      .toEqual(['t']);
  });

  it('uses original response-lock times despite later projection delivery', () => {
    const first = proof();
    // Both responses were locked together; the second outbox arrives after day 2.
    const projectedLate = proof({ questionId: 'q2', attemptId: 'a2', atMs: 1_000, acceptedSequence: 2 });
    expect(retainedTargets([first, projectedLate], ['t'])).toEqual([]);
    const trulyDelayed = proof({ questionId: 'q3', attemptId: 'a3', atMs: delay, acceptedSequence: 3 });
    expect(retainedTargets([first, projectedLate, trulyDelayed], ['t'])).toEqual(['t']);
  });

  it.each([
    { name: 'one millisecond short', overrides: { atMs: delay - 1 } },
    { name: 'another version of the same question', overrides: { questionId: 'q1', questionVersion: 2 } },
    { name: 'partial credit', overrides: { fullCredit: false } },
    { name: 'aided credit', overrides: { unaided: false } },
    { name: 'recognition credit', overrides: { recall: false } },
    { name: 'a team answer', overrides: { activity: 'Team' as const } },
    { name: 'a provisional grade', overrides: { final: false } },
  ])('cannot establish retention with $name', ({ overrides }) => {
    expect(retainedTargets([proof(), proof({ questionId: 'q2', attemptId: 'a2', atMs: delay, acceptedSequence: 2, ...overrides })], ['t']))
      .toEqual([]);
  });

  it.each([false, true])('requires two new successes after the last failure, even when the failure is aided=%s', aided => {
    const firstPair = [proof(), proof({ questionId: 'q2', attemptId: 'a2', atMs: delay, acceptedSequence: 2 })];
    const failed = proof({ questionId: 'q3', attemptId: 'a3', atMs: delay + 1, acceptedSequence: 3, fullCredit: false, unaided: !aided });
    const recoveredOnce = proof({ questionId: 'q4', attemptId: 'a4', atMs: delay * 2, acceptedSequence: 4 });
    const aidedSuccess = proof({ questionId: 'q5', attemptId: 'a5', atMs: delay * 3, acceptedSequence: 5, unaided: false });
    const recoveredTwice = proof({ questionId: 'q6', attemptId: 'a6', atMs: delay * 3, acceptedSequence: 6 });
    expect(retainedTargets([...firstPair, failed], ['t'])).toEqual([]);
    expect(retainedTargets([...firstPair, failed, recoveredOnce, aidedSuccess], ['t'])).toEqual([]);
    expect(retainedTargets([...firstPair, failed, recoveredOnce, aidedSuccess, recoveredTwice], ['t'])).toEqual(['t']);
  });

  it.each([true, false])('replays equal-time failure and recovery by accepted order (failure first=%s)', failureFirst => {
    const failure = proof({ questionId: 'q2', attemptId: 'a2', atMs: delay, acceptedSequence: failureFirst ? 2 : 3, fullCredit: false });
    const success = proof({ questionId: 'q3', attemptId: 'a3', atMs: delay, acceptedSequence: failureFirst ? 3 : 2 });
    const later = proof({ questionId: 'q4', attemptId: 'a4', atMs: delay * 2, acceptedSequence: 4 });
    const expected = failureFirst ? ['t'] : [];
    expect(retainedTargets([later, success, proof(), failure], ['t'])).toEqual(expected);
    expect(retainedTargets([failure, proof(), success, later], ['t'])).toEqual(expected);
  });

  it('uses acceptance sequence even when a later accepted response was locked earlier', () => {
    const delayedSuccess = proof({ questionId: 'q2', attemptId: 'a2', atMs: delay, acceptedSequence: 2 });
    const laterAcceptedFailure = proof({ questionId: 'q3', attemptId: 'a3', atMs: 1_000, acceptedSequence: 3, fullCredit: false });
    expect(retainedTargets([proof(), laterAcceptedFailure, delayedSuccess], ['t'])).toEqual([]);
  });

  it('replays a late corrected grade at its original sequence', () => {
    const first = proof();
    const second = proof({ questionId: 'q2', attemptId: 'a2', atMs: delay, acceptedSequence: 2 });
    const third = proof({ questionId: 'q3', attemptId: 'a3', atMs: delay * 2, acceptedSequence: 3 });
    expect(retainedTargets([first, second, third], ['t'])).toEqual(['t']);
    expect(retainedTargets([third, first, { ...second, fullCredit: false }], ['t'])).toEqual([]);
    expect(retainedTargets([third, first, { ...second, fullCredit: false }, proof({ questionId: 'q4', attemptId: 'a4', atMs: delay * 3, acceptedSequence: 4 })], ['t']))
      .toEqual(['t']);
  });

  it('does not revive older successes by omitting a pending recall grade', () => {
    const successes = [proof(), proof({ questionId: 'q2', attemptId: 'a2', atMs: delay, acceptedSequence: 2 })];
    const pending = proof({ questionId: 'q3', attemptId: 'a3', atMs: delay * 2, acceptedSequence: 3, fullCredit: false, final: false });
    expect(retainedTargets([...successes, pending], ['t'])).toEqual([]);
    expect(retainedTargets([pending, ...successes, proof({ questionId: 'q4', attemptId: 'a4', atMs: delay * 3, acceptedSequence: 4 })], ['t'])).toEqual([]);
  });

  it.each([
    { name: 'recognition', overrides: { recall: false } },
    { name: 'team', overrides: { activity: 'Team' as const } },
  ])('does not reset individual recall after a wrong $name answer', ({ overrides }) => {
    expect(retainedTargets([proof(), proof({ questionId: 'q2', attemptId: 'a2', atMs: delay, acceptedSequence: 2 }),
      proof({ questionId: 'q3', attemptId: 'a3', atMs: delay * 2, acceptedSequence: 3, fullCredit: false, ...overrides })], ['t']))
      .toEqual(['t']);
  });

  it('groups by eligible target and leaves input order unchanged', () => {
    const other = proof({ targetId: 'outside', questionId: 'q2', attemptId: 'a2', atMs: delay, acceptedSequence: 2 });
    const proofs = [other, proof()];
    const original = structuredClone(proofs);
    expect(retainedTargets(proofs, ['t'])).toEqual([]);
    expect(retainedTargets(proofs, [])).toEqual([]);
    expect(proofs).toEqual(original);
  });
});

it('retains reversed delivery using absolute original response time',()=>{
 expect(retainedTargets([proof({atMs:delay}),proof({questionId:'q2',attemptId:'a2',atMs:0,acceptedSequence:2})],['t'])).toEqual(['t']);
});
it('preserves both latest distinct-question extremes after repeated question success',()=>{
 expect(retainedTargets([proof({atMs:0}),proof({atMs:delay*2,attemptId:'a2',acceptedSequence:2}),proof({questionId:'q2',attemptId:'a3',atMs:delay/2,acceptedSequence:3})],['t'])).toEqual(['t']);
});

it('keeps bounded serialized state and identical witnesses across every page split',()=>{
 const events=Array.from({length:85},(_,i)=>proof({questionId:`q${i%5}`,attemptId:`a${i}`,atMs:((i*13)%47)*delay/9,acceptedSequence:i+1,...(i===40?{fullCredit:false}:{})}));
 const expected=replayTargets(events,['t']).get('t');
 for(let split=0;split<=events.length;split++){
  let state=initialRetentionState();
  for(const event of events.slice(0,split))state=advanceRetention(state,event);
  state=JSON.parse(JSON.stringify(state));
  for(const event of events.slice(split))state=advanceRetention(state,event);
  expect(state).toEqual(expected);expect(state.earliest.length).toBeLessThanOrEqual(2);expect(state.latest.length).toBeLessThanOrEqual(2);
 }
});

it('hashes the shared Unicode semantic scope tuple as unescaped UTF-8 JSON',async()=>{
 const tuple=["pbe-chapter-v1","pbe-passage-groups-v1","cccccccc-0000-0000-0000-000000000001","dddddddd-0000-0000-0000-000000000001",[["aaaaaaaa-0000-0000-0000-000000000002","aaaaaaaa-0000-0000-0000-000000000001","Scripture","GEN",1,1,1,"Génesis 1:1","e6aa8a788864940461c28e56b25c94fd93986035972ae44dab237a9e99858bb7"]],[["bbbbbbbb-0000-0000-0000-000000000001",["aaaaaaaa-0000-0000-0000-000000000002"],"FactualRecall"]],[["bbbbbbbb-0000-0000-0000-000000000100",1,["aaaaaaaa-0000-0000-0000-000000000002"],"ShortAnswer",false,[["bbbbbbbb-0000-0000-0000-000000000001",1]]]],[["assignment","assignment","aaaaaaaa-0000-0000-0000-000000000001","GEN",1,1,1,1]]];
 expect(await chapterTextHash('In the beginning — 世界')).toBe("e6aa8a788864940461c28e56b25c94fd93986035972ae44dab237a9e99858bb7");
 expect(await chapterHash(tuple)).toBe("2c5297378628f8bc69c4aaa06d75eb80d5ea9967d475583c7c39fb605f0a5566");
});
