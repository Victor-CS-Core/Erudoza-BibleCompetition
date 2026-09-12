import { isDeepStrictEqual as same } from 'node:util';
import { createHash } from 'node:crypto';
const fail = message => { throw new Error('Restore blocked: PBE graph ' + message); };
const need = (condition, message) => {
    if (!condition)
        fail(message);
};
const versions = ['format', 'ruleVersion', 'scoringVersion', 'selectionVersion'];
const fields = (a, b, keys) => keys.every(k => same(a?.[k] ?? null, b?.[k] ?? null));
function index(rows) {
    const records = rows.filter(e => e.table === 'Records' && e.row.kind.startsWith('pbe-')).map(e => ({ ...e.row, value: JSON.parse(e.row.data) }));
    const lookup = new Map(records.map(r => [JSON.stringify([r.kind, r.org_id, r.id]), r]));
    return { records, get: (r, kind, id) => lookup.get(JSON.stringify([kind, r.org_id, id])) };
}
const scope = (a, b) => {
    if (b)
        need(a.org_id === b.org_id && a.season_id === b.season_id, 'present reference scope differs');
};
const ownerScope = (a, b) => {
    scope(a, b);
    if (b)
        need(a.owner_id === b.owner_id, 'present reference owner differs');
};
/** Validate present immutable edges and accepted atomic controls. Never repair or invent legacy missing facts. */
export function validatePbeGraph(rows) {
    const { records, get } = index(rows);
    for (const r of records) {
        const v = r.value;
        if (['pbe-session', 'pbe-attempt', 'pbe-daily-mission', 'pbe-daily-mission-head', 'pbe-recall-event', 'pbe-evidence-ref', 'pbe-evidence-index', 'pbe-recall-sequence', 'pbe-evidence-dirty', 'pbe-evidence-replay', 'pbe-dispute', 'pbe-dispute-pending', 'pbe-dispute-correction', 'pbe-grade-adjustment', 'pbe-result-overlay', 'pbe-attempt-review'].includes(r.kind))
            need(v.id === r.id, 'record/body identity differs');
        if (r.kind === 'pbe-session') {
            need(v.seasonId === r.season_id && v.studentUserId === r.owner_id, 'session ownership differs');
            for (const a of v.attempts ?? []) {
                const stored = get(r, 'pbe-attempt', a.id);
                if (stored) {
                    ownerScope(r, stored);
                    need(stored.value.sessionId === r.id && fields(stored.value, a, ['id', 'cardId', 'clientSubmissionId', 'answers', 'hintsUsed', 'atMs', 'result', 'responseLockedAtMs', 'canonicalProvenance']), 'session/attempt frozen correspondence');
                }
            }
        }
        if (r.kind === 'pbe-attempt') {
            const s = get(r, 'pbe-session', v.sessionId);
            if (s) {
                ownerScope(r, s);
                const a = s.value.attempts?.find(a => a.id === v.id);
                need(a && fields(v, a, ['id', 'cardId', 'clientSubmissionId', 'answers', 'hintsUsed', 'atMs', 'result', 'responseLockedAtMs', 'canonicalProvenance']) && fields(v, s.value, versions), 'attempt/session frozen correspondence');
            }
        }
        if (['pbe-session-start', 'pbe-daily-mission'].includes(r.kind)) {
            const s = get(r, 'pbe-session', v.sessionId);
            if (s) {
                ownerScope(r, s);
                need(fields(v, s.value, versions), 'session control versions differ');
            }
        }
        if (r.kind === 'pbe-daily-mission-head') {
            const mission = get(r, 'pbe-daily-mission', v.missionId);
            if (mission) {
                ownerScope(r, mission);
                need(fields(v, mission.value, versions), 'mission head versions differ');
            }
        }
        if (r.kind === 'pbe-recall-event') {
            for (const e of v.evidence ?? []) {
                need(v.id === `${r.owner_id}:${r.season_id}:${e.attemptId}`, 'recall event identity');
                const first = v.evidence[0];
                need(fields(e, first, ['attemptId', 'questionId', 'atMs', 'unaided']), 'recall event frozen grouping');
                const a = get(r, 'pbe-attempt', e.attemptId);
                if (a) {
                    ownerScope(r, a);
                    need(a.value.atMs === e.atMs, 'recall event accepted time differs');
                }
            }
        }
        if (r.kind === 'pbe-evidence-ref') {
            need(v.attemptRecordId === v.evidence.attemptId && v.id === `${r.owner_id}:${r.season_id}:${v.evidence.targetId}:${String(v.acceptedSequence).padStart(16, '0')}:${v.evidence.attemptId}`, 'evidence reference identity');
            const event = get(r, 'pbe-recall-event', v.eventId);
            if (event) {
                ownerScope(r, event);
                need(fields(v, event.value, ['acceptedSequence', 'questionKind', 'questionVersion', 'responseLockedAtMs']) && event.value.evidence.some(e => same(e, v.evidence)), 'evidence event correspondence');
            }
            const a = get(r, 'pbe-attempt', v.attemptRecordId);
            if (a) {
                ownerScope(r, a);
                need(a.value.atMs === v.evidence.atMs, 'evidence attempt accepted time differs');
            }
        }
        if (['pbe-evidence-index', 'pbe-recall-sequence'].includes(r.kind))
            need(r.id === `${r.owner_id}:${r.season_id}`, 'owner/season control identity');
        if (r.kind === 'pbe-evidence-dirty')
            need(r.id === `${r.owner_id}:${r.season_id}:${v.targetId}` && v.completedGeneration >= 0 && v.completedGeneration <= v.generation, 'dirty generation/identity');
        if (r.kind === 'pbe-evidence-replay') {
            const dirty = get(r, 'pbe-evidence-dirty', r.id);
            if (dirty) {
                ownerScope(r, dirty);
                need(v.generation <= dirty.value.generation && v.projection.id === r.id && v.projection.targetId === dirty.value.targetId, 'replay generation/control differs');
            }
            need(typeof v.after === 'string' && v.after.startsWith(r.id + ':'), 'replay cursor scope');
        }
        if (r.kind === 'pbe-dispute') {
            need(v.id === `${v.activity}:${v.sessionId}:${v.attemptId}` && v.organizationId === r.org_id && v.seasonId === r.season_id && v.participantIds[0] === r.owner_id, 'dispute identity/scope');
            const pending = get(r, 'pbe-dispute-pending', r.id), correction = get(r, 'pbe-dispute-correction', r.id);
            need(v.status === 'Pending' ? pending && same(pending.value, v) : !pending, 'pending discovery differs');
            if (pending) {
                scope(r, pending);
                need(pending.owner_id === v.activity, 'pending discovery owner');
            }
            if (correction) {
                scope(r, correction);
                need(v.activity === 'Solo' && v.status === 'Resolved' && correction.owner_id === 'Solo' && same(correction.value, v), 'correction discovery differs');
            }
            const overlay = get(r, 'pbe-result-overlay', `${v.activity}:${v.sessionId}`), expected = { id: v.id, status: v.status, revision: v.revision, questionId: v.questionId, questionVersion: v.questionVersion, pointsByPart: v.resolution?.pointsByPart ?? null };
            need(overlay && same(overlay.value.entries?.[v.attemptId], expected), 'dispute overlay differs');
            scope(r, overlay);
            if (v.activity === 'Solo') {
                const s = get(r, 'pbe-session', v.sessionId);
                if (s) {
                    scope(r, s);
                    const a = s.value.attempts?.find(a => a.id === v.attemptId), card = s.value.cards?.find(c => c.id === a?.cardId);
                    need(a && card && same(card.question, v.question) && same(a.answers, v.answers) && a.result.acceptedAtUtc === v.acceptedAtUtc && same(v.participantIds, [s.value.studentUserId]) && same(v.allParticipantIds, [s.value.studentUserId]), 'dispute/session frozen correspondence');
                }
                const key = `${v.participantIds[0]}:${v.seasonId}`, review = get(r, 'pbe-attempt-review', `${key}:${v.attemptId}`), points = {};
                if (v.resolution)
                    v.question.parts.forEach((p, i) => points[p.targetId] = (points[p.targetId] ?? 0) + v.resolution.pointsByPart[i]);
                need(review && review.value.status === v.status && review.value.questionId === v.questionId && same(review.value.pointsByTarget, points), 'dispute attempt review differs');
                scope(r, review);
                need(review.owner_id === v.participantIds[0], 'attempt review owner differs');
                for (const target of new Set(v.question.parts.map(p => p.targetId.toLowerCase()))) {
                    const dirty = get(r, 'pbe-evidence-dirty', `${key}:${target}`);
                    need(dirty, 'dispute dirty control absent');
                    scope(r, dirty);
                    need(dirty.owner_id === v.participantIds[0], 'dirty owner differs');
                }
            }
            if (v.status === 'Resolved') {
                const adjustment = get(r, 'pbe-grade-adjustment', `${v.id}:${v.revision}`);
                need(adjustment, 'resolved adjustment absent');
            }
        }
        if (['pbe-dispute-pending', 'pbe-dispute-correction'].includes(r.kind)) {
            const parent = get(r, 'pbe-dispute', r.id);
            need(parent && same(parent.value, v), 'discovery has no matching dispute');
            scope(r, parent);
        }
        if (r.kind === 'pbe-grade-adjustment') {
            const d = get(r, 'pbe-dispute', v.disputeId);
            if (d) {
                scope(r, d);
                need(fields(v, d.value, ['activity', 'sessionId', 'attemptId', 'questionId', 'questionVersion', 'team']) && v.originalAcceptedAtUtc === d.value.acceptedAtUtc, 'adjustment frozen correspondence');
                if (r.id === `${d.id}:${d.value.revision}`)
                    need(d.value.status === 'Resolved' && fields(v, d.value.resolution, ['pointsByPart', 'reason', 'resolvedBy', 'resolvedAtUtc']), 'adjustment resolution differs');
            }
        }
        if (r.kind === 'pbe-result-overlay') {
            need(r.id === `${v.activity}:${v.sessionId}`, 'overlay identity');
            for (const [attemptId, entry] of Object.entries(v.entries ?? {})) {
                const d = get(r, 'pbe-dispute', entry.id);
                need(d && d.value.attemptId === attemptId && d.value.activity === v.activity && d.value.sessionId === v.sessionId, 'overlay dispute correspondence');
                scope(r, d);
            }
        }
    }
    validateChapterGraph(records);
    return true;
}
/** Called while one original Room is already decoded; avoids retaining additional full roots. */
export function validatePbeRoomGraph(room, rows) {
    const { records } = index(rows);
    for (const r of records.filter(r => r.kind === 'pbe-dispute' && r.org_id === room.orgId && r.value.activity === 'Team' && r.value.sessionId === room.id)) {
        const d = r.value, s = room.submissions.find(s => (s.attemptId?.toLowerCase() ?? `team:${room.id.toLowerCase()}:${s.questionId.toLowerCase()}:${s.team}`) === d.attemptId), q = room.questions.find(q => q.id === s?.questionId);
        need(r.season_id === room.seasonId && s && q && d.team === s.team && same(q, d.question) && same(s.answers, d.answers), 'Team dispute/Room frozen correspondence');
        // Frozen participant/service rosters can legitimately precede later terminal member cleanup.
    }
    return true;
}
function validateChapterGraph(records) {
    const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
    const key = (r, generation) => JSON.stringify([r.org_id, r.season_id, r.owner_id, generation]);
    const generations = new Map();
    const generation = (r, id) => {
        const idKey = key(r, id);
        if (!generations.has(idKey))
            generations.set(idKey, { manifests: [], proofs: [], projections: [], families: new Map() });
        return generations.get(idKey);
    };
    for (const r of records) {
        const field = { 'pbe-chapter-manifest': 'manifests', 'pbe-chapter-stamp-proof': 'proofs', 'pbe-chapter-projection': 'projections' }[r.kind];
        if (!field)
            continue;
        const g = generation(r, r.value.generationId);
        g[field].push(r);
        if (field === 'proofs') {
            if (!g.families.has(r.value.family))
                g.families.set(r.value.family, []);
            g.families.get(r.value.family).push(r);
        }
    }
    const ordered = rows => [...rows].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    for (const r of records.filter(r => r.kind === 'pbe-chapter-stamp')) {
        const s = r.value, proofs = ordered(generation(r, s.proofGenerationId).families.get(s.proofFamily) ?? []);
        need(r.id === `${r.owner_id}:${r.season_id}:${hash([s.summary.chapterKey, s.summary.scopeVersion, 'pbe-chapter-v1'])}`, 'chapter stamp scope identity');
        need(proofs.length === s.proofPageCount && s.proofPageCount > 0 && hash(proofs.map(p => [p.id, p.value.hash])) === s.proofHash, 'chapter referenced proof family/count/hash');
        const targets = new Set();
        let witnesses = 0, offset = 0;
        for (const p of proofs) {
            need(p.id === `${s.proofGenerationId}:${s.proofFamily}:${String(offset).padStart(6, '0')}`, 'chapter referenced proof offset');
            for (const entry of p.value.entries) {
                need(!targets.has(entry.targetId), 'chapter duplicate proof target');
                targets.add(entry.targetId);
                witnesses += entry.witness.length;
            }
            offset += p.value.entries.length;
        }
        need(targets.size === s.targetCount && s.targetCount > 0 && witnesses === s.qualifyingAttemptCount && witnesses === s.targetCount * 2, 'chapter proof target/witness totals');
    }
    for (const r of records.filter(r => r.kind === 'pbe-chapter-work')) {
        const w = r.value, g = generation(r, w.workId), manifests = [...g.manifests].sort((a, b) => a.value.ordinal - b.value.ordinal), projections = ordered(g.projections);
        need(r.id === `${r.owner_id}:${r.season_id}` && w.seasonId === r.season_id, 'chapter work owner/scope');
        // A producer can store prepared-but-unwritten page counters when a capture page exceeds its budget.
        // Blocked work is retained for ordinary replacement/cleanup, never fabricated back into a runnable cursor.
        const plannedTail = w.reason === 'InputTooLarge';
        need(manifests.every((p, i) => p.value.ordinal === i) && (plannedTail ? manifests.length <= w.pageCount : manifests.length === w.pageCount), 'chapter manifest count/ordinal');
        const proofBytes = g.proofs.reduce((n, p) => n + Buffer.byteLength(JSON.stringify(p.value)), 0), totalBytes = proofBytes + manifests.reduce((n, p) => n + p.value.bytes, 0);
        need(totalBytes <= 16 * 1024 ** 2, 'chapter stored generation byte cap');
        need((plannedTail ? totalBytes <= w.bytes : totalBytes === w.bytes) && (w.proofBytes === undefined || proofBytes === w.proofBytes), 'chapter stored manifest/proof byte accounting');
        need(projections.length === w.rowIndex && projections.every((p, i) => p.id === `${w.workId}:${String(i).padStart(6, '0')}`), 'chapter projection cursor/ordinal');
        const pending = g.families.get(`proof-${String(w.rowIndex).padStart(6, '0')}`) ?? [];
        need(pending.reduce((n, p) => n + p.value.entries.length, 0) === w.proofOffset, 'chapter pending proof cursor');
        if (w.stage === 'Complete') {
            const groups = manifests.filter(p => p.value.family === 'groups').flatMap(p => p.value.entries).sort((a, b) => a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0);
            need(w.snapshotId === w.workId && !w.aggregate && projections.length === groups.length && projections.every((p, i) => p.value.row.key === groups[i].key), 'chapter Complete projection closure');
        }
    }
}
