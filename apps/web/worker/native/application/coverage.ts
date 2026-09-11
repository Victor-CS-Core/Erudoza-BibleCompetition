import type { RequestContext } from '../types';
import { contains, effectiveSources, students } from './model';
import type { Assignment, Season } from './model';
import { MASTERY_VERSION } from '../study/engine';
export async function coverage(ctx: RequestContext, season: Season) {
    const { store, orgId } = ctx, seasonId = season.id;
    const assignments = await store.list<Assignment>('assignment', orgId, { seasonId });
    const usersById = new Map((await students(ctx)).map(u => [u.userId, u]));
    const sources = await effectiveSources(ctx, seasonId);
    const mastery = await store.list<{
        studentUserId: string;
        sourceUnitId: string;
        level: string;
        algorithmVersion?: string;
        reviewDueAt?: string | null;
    }>('mastery', orgId, { seasonId });
    const counts = await ctx.env.DB.prepare("SELECT owner_id AS studentUserId,count(*) AS count FROM Records WHERE kind='attempt' AND org_id=? AND season_id=? AND coalesce(json_extract(data,'$.isLegacyDuplicate'),0)=0 GROUP BY owner_id").bind(orgId, seasonId).all<{
        studentUserId: string;
        count: number;
    }>();
    const countByStudent = new Map(counts.results.map(r => [r.studentUserId, r.count]));
    const rows = [];
    for (const userId of new Set(assignments.map(a => a.studentUserId))) {
        const user = usersById.get(userId);
        if (!user)
            continue;
        const assigned = assignments.filter(a => a.studentUserId === userId).sort((a, b) => ['PrimarySpecialist', 'RequiredCoverage', 'OptionalReview'].indexOf(a.type) - ['PrimarySpecialist', 'RequiredCoverage', 'OptionalReview'].indexOf(b.type));
        const a = assigned[0], eligibleIds = new Set(sources.filter(u => assigned.some(a => a.contentPackId === u.contentPackId && contains(a, u))).map(u => u.id));
        const studentMastery = mastery.filter(m => m.studentUserId === userId && eligibleIds.has(m.sourceUnitId));
        rows.push({ studentUserId: userId, displayName: user.displayName, userName: user.userName, assignmentType: a.type, bookKey: a.bookKey, startChapter: a.startChapter, startVerse: a.startVerse, endChapter: a.endChapter, endVerse: a.endVerse, eligibleUnitCount: eligibleIds.size, masteredCount: studentMastery.filter(m => m.level === 'Mastered' && m.algorithmVersion === MASTERY_VERSION).length, reviewDueCount: studentMastery.filter(m => m.reviewDueAt && Date.parse(m.reviewDueAt) <= Date.now()).length, attemptCount: countByStudent.get(userId) ?? 0 });
    }
    return { seasonId, seasonName: season.name, seasonStatus: season.status, students: rows };
}
