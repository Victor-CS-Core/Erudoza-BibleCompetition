import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePbeGraph } from './lib/cloudflare-pbe-graph.mjs';
const row = (kind, id, data, owner = 'student') => ({ table: 'Records', row: { kind, id, org_id: 'org', season_id: 'season', owner_id: owner, data: JSON.stringify(data), revision: 1 } });
const evidence = { attemptId: 'attempt', targetId: 'target', questionId: 'question', atMs: 10, earnedPoints: 1, availablePoints: 1, unaided: true, recall: true };
const event = { id: 'student:season:attempt', scopeVersion: 'scope', acceptedSequence: 1, questionKind: 'ShortAnswer', evidence: [evidence] };
const ref = { id: 'student:season:target:0000000000000001:attempt', eventId: event.id, attemptRecordId: 'attempt', acceptedSequence: 1, questionKind: 'ShortAnswer', evidence };
test('present evidence edges preserve frozen chronology and reject mismatch while missing legacy inputs remain admissible', () => {
    const rows = [row('pbe-recall-event', event.id, event), row('pbe-evidence-ref', ref.id, ref)];
    assert.doesNotThrow(() => validatePbeGraph(rows));
    assert.doesNotThrow(() => validatePbeGraph([rows[1]]));
    assert.throws(() => validatePbeGraph([rows[0], row('pbe-evidence-ref', ref.id.replace('0000000000000001', '0000000000000002'), { ...ref, id: ref.id.replace('0000000000000001', '0000000000000002'), acceptedSequence: 2 })]), /evidence.*correspondence/);
});
const question = { id: 'question', version: 2, parts: [{ targetId: 'target', points: 1 }], evidence: 'frozen source' };
const dispute = { id: 'Solo:session:attempt', organizationId: 'org', seasonId: 'season', activity: 'Solo', sessionId: 'session', attemptId: 'attempt', questionId: 'question', questionVersion: 2, team: null, status: 'Pending', revision: 1, reason: 'review', partPoints: [1], sourceEvidence: 'frozen source', question, answers: ['A'], originalPointsByPart: [0], acceptedAtUtc: '2026-09-12T00:00:00Z', participantIds: ['student'], allParticipantIds: ['student'], resolution: null };
const overlay = d => ({ id: 'Solo:session', activity: 'Solo', sessionId: 'session', entries: { attempt: { id: d.id, status: d.status, revision: d.revision, questionId: d.questionId, questionVersion: d.questionVersion, pointsByPart: d.resolution?.pointsByPart ?? null } } });
const control = d => [row('pbe-dispute', d.id, d), row('pbe-result-overlay', 'Solo:session', overlay(d)), row('pbe-attempt-review', 'student:season:attempt', { id: 'student:season:attempt', questionId: 'question', status: d.status, pointsByTarget: d.resolution ? { target: 1 } : {} }), row('pbe-evidence-dirty', 'student:season:target', { id: 'student:season:target', targetId: 'target', generation: 2, completedGeneration: 1 })];
test('pending dispute atomic discovery and overlay relationship is complete without invented legacy session', () => {
    const rows = [...control(dispute), row('pbe-dispute-pending', dispute.id, dispute, 'Solo')];
    assert.doesNotThrow(() => validatePbeGraph(rows));
    assert.throws(() => validatePbeGraph(rows.filter(e => e.row.kind !== 'pbe-dispute-pending')), /pending discovery/);
    assert.throws(() => validatePbeGraph(rows.map(e => e.row.kind === 'pbe-result-overlay' ? row(e.row.kind, e.row.id, { ...overlay(dispute), entries: { attempt: { ...overlay(dispute).entries.attempt, revision: 2 } } }) : e)), /overlay/);
});
test('resolved correction may be absent after replay, partial replay and historical missing proof remain unchanged', () => {
    const d = { ...dispute, status: 'Resolved', revision: 2, resolution: { pointsByPart: [1], reason: 'accepted', resolvedBy: 'coach', resolvedAtUtc: '2026-09-12T01:00:00Z' } }, adjustment = { id: d.id + ':2', disputeId: d.id, activity: d.activity, sessionId: d.sessionId, attemptId: d.attemptId, questionId: d.questionId, questionVersion: d.questionVersion, team: d.team, ...d.resolution, originalAcceptedAtUtc: d.acceptedAtUtc };
    const rows = [...control(d), row('pbe-grade-adjustment', adjustment.id, adjustment), row('pbe-evidence-replay', 'student:season:target', { id: 'student:season:target', generation: 1, after: 'student:season:target:', projection: { id: 'student:season:target', targetId: 'target', acceptedSequence: 0 }, pendingCount: 1, missingReferenceRepairAttempted: true })];
    const before = JSON.stringify(rows);
    assert.doesNotThrow(() => validatePbeGraph(rows));
    assert.equal(JSON.stringify(rows), before);
    assert.doesNotThrow(() => validatePbeGraph([...rows, row('pbe-dispute-correction', d.id, d, 'Solo')]));
    assert.throws(() => validatePbeGraph([...rows, row('pbe-dispute-pending', d.id, dispute, 'Solo')]), /pending discovery/);
});
test('present session and standalone attempt preserve frozen answers, versions and provider lock metadata', () => {
    const versions = { format: 'Pbe', ruleVersion: 'rule', scoringVersion: 'score', selectionVersion: 'select' }, a = { id: 'attempt', cardId: 'card', clientSubmissionId: 'command', answers: ['A'], hintsUsed: false, atMs: 10, result: { attemptId: 'attempt' }, responseLockedAtMs: 9, canonicalProvenance: { version: 1, responseLockedAtUtc: '2026-09-12T00:00:00.1234567Z' } }, s = { id: 'session', seasonId: 'season', studentUserId: 'student', ...versions, attempts: [a], cards: [] };
    const rows = [row('pbe-session', 'session', s), row('pbe-attempt', 'attempt', { ...a, ...versions, sessionId: 'session' })];
    assert.doesNotThrow(() => validatePbeGraph(rows));
    assert.throws(() => validatePbeGraph([rows[0], row('pbe-attempt', 'attempt', { ...a, ...versions, sessionId: 'session', answers: ['changed'] })]), /frozen correspondence/);
    assert.doesNotThrow(() => validatePbeGraph([rows[1]]));
    assert.doesNotThrow(() => validatePbeGraph([row('pbe-question-head', 'question', { id: 'question:2', question })]));
});
test('Team dispute compares original terminal Room frozen submission while allowing later roster cleanup', async () => {
    const { validatePbeRoomGraph } = await import('./lib/cloudflare-pbe-graph.mjs');
    const d = { ...dispute, id: 'Team:room:attempt', activity: 'Team', sessionId: 'room', team: 1 }, room = { id: 'room', orgId: 'org', seasonId: 'season', questions: [question], submissions: [{ attemptId: 'attempt', questionId: 'question', team: 1, answers: ['A'] }], members: [] };
    assert.doesNotThrow(() => validatePbeRoomGraph(room, [row('pbe-dispute', d.id, d)]));
    assert.throws(() => validatePbeRoomGraph(room, [row('pbe-dispute', d.id, { ...d, answers: ['changed'] })]), /Team dispute\/Room/);
});
import { createHash } from 'node:crypto';
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function historicalChapter() {
    const generation = 'generation', family = 'proof-000000', proofId = generation + ':' + family + ':000000';
    const witness = [{ targetId: 'target', questionId: 'first', questionVersion: 1, attemptId: 'one', atMs: 0, acceptedSequence: 1 }, { targetId: 'target', questionId: 'second', questionVersion: 1, attemptId: 'two', atMs: 172800000, acceptedSequence: 2 }];
    const entries = [{ targetId: 'target', witness }], proof = { id: proofId, generationId: generation, family, entries, hash: digest(entries) };
    const chapterKey = 'chapter:pack:GEN:1', scopeVersion = 'historical', stampId = 'student:season:' + digest([chapterKey, scopeVersion, 'pbe-chapter-v1']);
    const stamp = { id: stampId, summary: { stampId, chapterKey, kind: 'Chapter', label: 'GEN1', scopeLabel: 'Whole assigned chapter', scopeVersion, ruleVersion: 'pbe-chapter-v1', earnedAtUtc: '2026-09-12T00:00:00Z', matchesCurrentScope: true }, proofGenerationId: generation, proofFamily: family, targetCount: 1, qualifyingAttemptCount: 2, proofPageCount: 1, proofHash: digest([[proofId, proof.hash]]) };
    return [row('pbe-chapter-stamp', stampId, stamp), row('pbe-chapter-stamp-proof', proofId, proof)];
}
test('sealed historical chapter stamp requires exact referenced proof family without fabricated legacy parents', () => {
    const rows = historicalChapter(), before = JSON.stringify(rows);
    assert.doesNotThrow(() => validatePbeGraph(rows));
    assert.equal(JSON.stringify(rows), before);
    assert.throws(() => validatePbeGraph(rows.slice(0, 1)), /chapter.*proof/);
    const changed = JSON.parse(rows[1].row.data);
    changed.entries[0].witness[1].attemptId = 'different';
    changed.hash = digest(changed.entries);
    assert.throws(() => validatePbeGraph([rows[0], row('pbe-chapter-stamp-proof', changed.id, changed)]), /chapter.*proof/);
    const abandoned = { ...JSON.parse(rows[1].row.data), id: 'old:proof-000000:000000', generationId: 'old' };
    assert.doesNotThrow(() => validatePbeGraph([...rows, row('pbe-chapter-stamp-proof', abandoned.id, abandoned)]));
});
test('native early stale chapter work preserves captured guards but requires its own complete byte and cursor accounting', () => {
    const entries = [{ kind: 'pbe-target', id: 'old-target', revision: 987 }], page = { id: 'work:guards:000000', generationId: 'work', family: 'guards', ordinal: 0, entries, bytes: 0, hash: digest(entries) };
    while (page.bytes !== Buffer.byteLength(JSON.stringify(page)))
        page.bytes = Buffer.byteLength(JSON.stringify(page));
    const work = { id: 'student:season', workId: 'work', seasonId: 'season', stage: 'Sources', pageCount: 1, bytes: page.bytes, proofBytes: 0, rowIndex: 0, proofOffset: 0, snapshotId: null, scopeVersion: null, abandoned: 'older', aggregate: null };
    const rows = [row('pbe-chapter-work', work.id, work), row('pbe-chapter-manifest', page.id, page)];
    assert.doesNotThrow(() => validatePbeGraph(rows));
    assert.doesNotThrow(() => validatePbeGraph([row('pbe-chapter-work', work.id, { ...work, reason: 'InputTooLarge', pageCount: 2, bytes: work.bytes + 100 }), rows[1]]));
    assert.throws(() => validatePbeGraph(rows.slice(0, 1)), /chapter.*manifest/);
    assert.throws(() => validatePbeGraph([row('pbe-chapter-work', work.id, { ...work, bytes: work.bytes + 1 }), rows[1]]), /chapter.*byte/);
});
