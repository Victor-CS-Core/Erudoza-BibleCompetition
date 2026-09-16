import type { RequestContext } from '../types';
import { memberId, student, type Assignment, type Membership } from './model';
import { honors, trainingScope } from '../training/query';
import { identity, kid, preference, resolvePreference, type DayRecord, type WeekRecord } from '../training/store';
import { addDays, resolveTrainingCalendar } from '../training/calendar';
import { trainingNow } from '../training/clock';
import type { Mastery, Session } from '../study/routes';
import type { PbeSession } from '../pbe/sessions';
import type { StudentDashboard, TrainingDifficulty } from '../../../src/api/types';

async function listAll<T extends { id: string }>(ctx: RequestContext, kind: string, scope: { seasonId?: string; ownerId?: string } = {}) {
  const result: T[] = []; let after: string | undefined;
  for (;;) { const page = await ctx.store.list<T>(kind, ctx.orgId, { ...scope, after, limit: 5000 }); result.push(...page); if (page.length < 5000) return result; after = page.at(-1)!.id; }
}

/** Coach/admin-only read of one student's full training dashboard. No writes. */
export async function studentDashboard(ctx: RequestContext, studentId: string): Promise<StudentDashboard> {
  const s = await student(ctx, studentId); // 404 unless an active/inactive student in this org
  const learner: RequestContext = { ...ctx, actor: { ...ctx.actor, userId: s.userId, kind: 'Student', role: 'Student' } };
  const now = trainingNow();

  // --- Season scope + training state, read through the learner's own records. ---
  const scope = await trainingScope(learner, null);
  const season = scope.season;
  const pref = await preference(learner);
  const resolved = resolvePreference(learner, pref, now);
  const calendar = resolveTrainingCalendar(now, resolved);
  const week = (await learner.store.get<WeekRecord>('training-week', identity(learner, calendar.weekStartLocalDate), learner.orgId))?.value ?? null;

  // --- Effort: this week, streak, recent sessions, last activity. ---
  const days = await listAll<DayRecord>(learner, 'training-day', { ownerId: s.userId });
  const credited = new Set(days.filter(d => d.credited).map(d => d.localDate));
  let cursor = credited.has(calendar.localDate) ? calendar.localDate : addDays(calendar.localDate, -1);
  let streakDays = 0;
  while (credited.has(cursor)) { streakDays += 1; cursor = addDays(cursor, -1); }
  const sessions = await listAll<Session>(learner, 'session', { ownerId: s.userId });
  const pbeSessions = await listAll<PbeSession>(learner, 'pbe-session', { ownerId: s.userId });
  const weekAgo = Date.parse(now) - 7 * 86400000;
  const recentSessions = sessions.filter(x => x.status === 'Completed' && Date.parse(x.createdAtUtc) >= weekAgo);
  const recentPbe = pbeSessions.filter(x => x.status === 'Completed' && Date.parse(x.createdAtUtc) >= weekAgo);
  const lastActivityAtUtc = pref?.value.lastEventAtUtc ?? null;

  // --- Progress: per-chapter seen/strong/mastered counts. ---
  const sources = season && season.status === 'Active' ? scope.sources : [];
  const states = season ? await listAll<Mastery>(learner, 'mastery', { seasonId: season.id, ownerId: s.userId }) : [];
  const byKnowledge = new Map(sources.map(source => [kid(source), source]));
  const relevant = states.filter(m => byKnowledge.has(m.knowledgeUnitId));
  const chapterRows = new Map<string, { bookKey: string; chapter: number; eligibleCount: number; seenCount: number; strongCount: number; masteredCount: number }>();
  for (const source of sources) {
    const key = `${source.bookKey}:${source.chapter}`;
    let row = chapterRows.get(key);
    if (!row) { row = { bookKey: source.bookKey, chapter: source.chapter, eligibleCount: 0, seenCount: 0, strongCount: 0, masteredCount: 0 }; chapterRows.set(key, row); }
    row.eligibleCount += 1;
    const m = relevant.find(x => x.knowledgeUnitId === kid(source));
    if (!m) continue;
    row.seenCount += 1;
    if (['Strong', 'Mastered'].includes(m.level)) row.strongCount += 1;
    if (m.level === 'Mastered') row.masteredCount += 1;
  }
  const chapters = [...chapterRows.values()].sort((a, b) => a.bookKey.localeCompare(b.bookKey) || a.chapter - b.chapter);
  const attempts = season ? (await listAll<{ id: string; at: string; isLegacyDuplicate?: boolean }>(learner, 'attempt', { seasonId: season.id, ownerId: s.userId })).filter(a => !a.isLegacyDuplicate) : [];

  // --- Mastery: earned badges + level distribution. ---
  const allBadges = await honors(learner, season?.id ?? null);
  const levelCounts = new Map<string, number>();
  for (const m of relevant) levelCounts.set(m.level, (levelCounts.get(m.level) ?? 0) + 1);
  levelCounts.set('Unseen', sources.length - relevant.length);

  // --- Assignments for the active season (with coach-set difficulty like the progress view). ---
  const assignments = await listAll<Assignment>(learner, 'assignment', { ownerId: s.userId });
  const member = season ? (await learner.store.get<Membership>('membership', memberId(season.id, s.userId), learner.orgId))?.value ?? null : null;
  const seasonAssignments = (season ? assignments.filter(a => a.seasonId === season.id) : []).map(a => ({ ...a, difficulty: (member?.difficulty ?? 'Standard') as TrainingDifficulty }));

  // --- Recent activity: last 8 completed sessions, newest first, with inline summaries. ---
  const activity = [
    ...sessions.filter(x => x.status === 'Completed').map(x => ({
      sessionId: x.id, mode: x.mode, format: 'Memory' as const, createdAtUtc: x.createdAtUtc, completedAtUtc: x.completedAtUtc ?? null,
      attempted: x.recap?.attempted ?? x.attempts.length, correct: x.recap ? x.recap.correct : null,
      fullTargetReached: x.recap ? x.recap.fullTargetReached : null,
    })),
    ...pbeSessions.filter(x => x.status === 'Completed').map(x => ({
      sessionId: x.id, mode: x.mode, format: 'Pbe' as const, createdAtUtc: x.createdAtUtc, completedAtUtc: x.completedAtUtc ?? null,
      attempted: x.attempts.length, correct: null as number | null, fullTargetReached: null as boolean | null,
    })),
  ].sort((a, b) => b.createdAtUtc.localeCompare(a.createdAtUtc)).slice(0, 8);

  return {
    student: { userId: s.userId, displayName: s.displayName, userName: s.userName, isActive: s.isActive !== false },
    season: season ? { id: season.id, name: season.name, status: season.status } : null,
    effort: {
      weeklyTarget: week?.target ?? resolved.weeklyTarget,
      completedDays: week?.creditedDates.length ?? 0,
      weekStartLocalDate: calendar.weekStartLocalDate,
      timeZone: week?.timeZone ?? resolved.timeZone,
      days: Array.from({ length: 7 }, (_, i) => { const localDate = addDays(calendar.weekStartLocalDate, i); return { localDate, credited: week?.creditedDates.includes(localDate) ?? false, isToday: localDate === calendar.localDate }; }),
      streakDays,
      sessionsLast7Days: recentSessions.length + recentPbe.length,
      lastActivityAtUtc,
    },
    progress: {
      eligibleCount: sources.length,
      seenCount: chapters.reduce((n, c) => n + c.seenCount, 0),
      strongCount: chapters.reduce((n, c) => n + c.strongCount, 0),
      masteredCount: relevant.filter(m => m.level === 'Mastered').length,
      reviewDueCount: relevant.filter(m => Date.parse(m.reviewDueAt) <= Date.parse(now)).length,
      attemptCount: attempts.length,
      chapters,
    },
    mastery: {
      badges: allBadges.filter(b => b.earnedAtUtc !== null),
      levelCounts: [...levelCounts.entries()].map(([level, count]) => ({ level, count })).sort((a, b) => b.count - a.count),
    },
    assignments: seasonAssignments,
    recentActivity: activity,
  };
}
