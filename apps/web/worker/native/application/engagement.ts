import type { RequestContext } from '../types';
import { student, students } from './model';
import { identity, preference, resolvePreference, type DayRecord } from '../training/store';
import { levelForXp, XP_VALUES, type XpRecord } from '../training/xp';
import { creditedDates, streakCount } from '../training/streak';
import { addDays, resolveTrainingCalendar } from '../training/calendar';
import { trainingNow } from '../training/clock';
import { honorCatalog } from '../mastery/catalog';
import type { HonorUnlock } from '../mastery/catalog';
import type { AwardRecord } from '../training/store';
import type { Session } from '../study/routes';
import type { PbeSession } from '../pbe/sessions';

async function listAll<T extends { id: string }>(ctx: RequestContext, kind: string, scope: { seasonId?: string; ownerId?: string } = {}) {
  const result: T[] = []; let after: string | undefined;
  for (;;) { const page = await ctx.store.list<T>(kind, ctx.orgId, { ...scope, after, limit: 5000 }); result.push(...page); if (page.length < 5000) return result; after = page.at(-1)!.id; }
}

const learnerCtx = (ctx: RequestContext, userId: string): RequestContext =>
  ({ ...ctx, actor: { ...ctx.actor, userId, kind: 'Student', role: 'Student' } });

export interface EngagementRow {
  studentId: string;
  name: string;
  streak: number;
  xpThisWeek: number;
  practiceDaysThisWeek: number;
  lastActiveAtUtc: string | null;
  level: number;
  levelName: string;
  honorsEarned: number;
}

/** Coach/admin-only engagement overview: one row per student. No writes. */
export async function engagementOverview(ctx: RequestContext): Promise<EngagementRow[]> {
  const now = trainingNow();
  const list = await students(ctx);
  const rows: EngagementRow[] = [];
  for (const s of list) {
    const learner = learnerCtx(ctx, s.userId);
    const pref = await preference(learner);
    const resolved = resolvePreference(learner, pref, now);
    const calendar = resolveTrainingCalendar(now, resolved);
    const credited = await creditedDates(learner);
    const weekDays = Array.from({ length: 7 }, (_, i) => addDays(calendar.localDate, -i));
    const xpRec = (await learner.store.get<XpRecord>('training-xp', identity(learner), learner.orgId))?.value ?? null;
    const xpThisWeek = weekDays.reduce((n, d) => n + (xpRec?.xpByDay[d] ?? 0), 0);
    const level = levelForXp(xpRec?.totalXp ?? 0);
    const honors = await listAll<HonorUnlock>(learner, 'mastery-honor', { ownerId: s.userId });
    rows.push({
      studentId: s.userId,
      name: s.displayName,
      streak: streakCount(credited, calendar.localDate),
      xpThisWeek,
      practiceDaysThisWeek: weekDays.filter(d => credited.has(d)).length,
      lastActiveAtUtc: pref?.value.lastEventAtUtc ?? null,
      level: level.level,
      levelName: level.levelName,
      honorsEarned: honors.length,
    });
  }
  return rows;
}

export interface SessionHistoryEntry {
  sessionId: string;
  format: 'Memory' | 'Pbe';
  mode: string;
  completedAtUtc: string | null;
  attempted: number;
  correct: number | null;
  xpEarned: number;
}

/** Coach/admin-only paginated session history for one student. No writes. */
export async function studentSessionHistory(ctx: RequestContext, studentId: string, before?: string, limit = 30): Promise<{ sessions: SessionHistoryEntry[]; nextBefore: string | null }> {
  const s = await student(ctx, studentId);
  const learner = learnerCtx(ctx, s.userId);
  const sessions = await listAll<Session>(learner, 'session', { ownerId: s.userId });
  const pbeSessions = await listAll<PbeSession>(learner, 'pbe-session', { ownerId: s.userId });
  const all: SessionHistoryEntry[] = [
    ...sessions.filter(x => x.status === 'Completed').map(x => ({
      sessionId: x.id, format: 'Memory' as const, mode: x.mode, completedAtUtc: x.completedAtUtc ?? null,
      attempted: x.recap?.attempted ?? x.attempts.length, correct: x.recap?.correct ?? null, xpEarned: x.training?.xpEarned ?? 0,
    })),
    ...pbeSessions.filter(x => x.status === 'Completed').map(x => ({
      sessionId: x.id, format: 'Pbe' as const, mode: x.mode, completedAtUtc: x.completedAtUtc ?? null,
      attempted: x.attempts.length, correct: null as number | null, xpEarned: x.xpEarned ?? 0,
    })),
  ].sort((a, b) => (b.completedAtUtc ?? '').localeCompare(a.completedAtUtc ?? ''));
  const lim = Math.min(Math.max(limit || 30, 1), 100);
  const filtered = before ? all.filter(x => (x.completedAtUtc ?? '') < before) : all;
  const page = filtered.slice(0, lim);
  return { sessions: page, nextBefore: filtered.length > lim ? page.at(-1)?.completedAtUtc ?? null : null };
}

const csvCell = (v: string | number | null | undefined) => `"${String(v ?? '').replace(/"/g, '""')}"`;

/** Coach/admin-only CSV export of a student's full gamification history. No writes. */
export async function studentExportCsv(ctx: RequestContext, studentId: string): Promise<string> {
  const s = await student(ctx, studentId);
  const learner = learnerCtx(ctx, s.userId);
  const days = await listAll<DayRecord>(learner, 'training-day', { ownerId: s.userId });
  const sessions = await listAll<Session>(learner, 'session', { ownerId: s.userId });
  const pbeSessions = await listAll<PbeSession>(learner, 'pbe-session', { ownerId: s.userId });
  const honors = await listAll<HonorUnlock>(learner, 'mastery-honor', { ownerId: s.userId });
  const badges = await listAll<AwardRecord>(learner, 'solo-badge-award', { ownerId: s.userId });
  const honorTitles = new Map(honorCatalog.map(h => [h.key, h.title]));
  const dayBySession = new Map(days.filter(d => d.credited).map(d => [d.sessionId, d]));

  type Row = { date: string; type: string; mode: string; correct: string; attempted: string; xp: number; streak_day: string; honor_earned: string };
  const rows: Row[] = [];
  for (const d of days.filter(d => d.credited))
    rows.push({ date: d.localDate, type: 'credited_day', mode: '', correct: '', attempted: '', xp: XP_VALUES.dayCredited, streak_day: 'true', honor_earned: '' });
  for (const x of sessions.filter(x => x.status === 'Completed'))
    rows.push({ date: (x.completedAtUtc ?? '').slice(0, 10), type: 'session', mode: `Memory ${x.mode}`, correct: String(x.recap?.correct ?? ''), attempted: String(x.recap?.attempted ?? x.attempts.length), xp: x.training?.xpEarned ?? 0, streak_day: dayBySession.has(x.id) ? 'true' : '', honor_earned: '' });
  for (const x of pbeSessions.filter(x => x.status === 'Completed'))
    rows.push({ date: (x.completedAtUtc ?? '').slice(0, 10), type: 'session', mode: `PBE ${x.mode}`, correct: '', attempted: String(x.attempts.length), xp: x.xpEarned ?? 0, streak_day: dayBySession.has(x.id) ? 'true' : '', honor_earned: '' });
  for (const h of honors)
    rows.push({ date: h.earnedAtUtc.slice(0, 10), type: 'honor', mode: '', correct: '', attempted: '', xp: XP_VALUES.profileHonor, streak_day: '', honor_earned: honorTitles.get(h.key) ?? h.key });
  for (const b of badges)
    rows.push({ date: b.earnedAtUtc.slice(0, 10), type: 'milestone', mode: '', correct: '', attempted: '', xp: XP_VALUES.soloMilestone, streak_day: '', honor_earned: b.title });

  rows.sort((a, b) => b.date.localeCompare(a.date) || a.type.localeCompare(b.type));
  const header = 'date,type,mode,correct,attempted,xp,streak_day,honor_earned';
  return [header, ...rows.map(r => [r.date, r.type, r.mode, r.correct, r.attempted, r.xp, r.streak_day, r.honor_earned].map(csvCell).join(','))].join('\n') + '\n';
}
