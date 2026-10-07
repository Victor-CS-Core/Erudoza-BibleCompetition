import type { RequestContext } from '../types';
import { HttpError } from '../types';
import { student, students } from './model';
import { resolvePreference, type DayRecord, type PreferenceRecord } from '../training/store';
import { levelForXp, XP_VALUES, type XpRecord } from '../training/xp';
import { creditedDates, streakCount } from '../training/streak';
import { addDays, resolveTrainingCalendar } from '../training/calendar';
import { trainingNow } from '../training/clock';
import { honorCatalog } from '../mastery/catalog';
import type { HonorUnlock } from '../mastery/catalog';
import { questWeek } from '../training/quests';
import { ROOM_STORAGE_FORMAT } from '../practice/room-storage';
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
  quests: { completedThisWeek: number; totalThisWeek: number; rate: number };
}

/** Coach/admin-only engagement overview: one row per student. No writes.
 *  The per-student reads are batched (one preferences getMany, one xp getMany,
 *  one honors GROUP BY) and the remaining per-student work runs in parallel
 *  instead of sequentially, so the round-trip count no longer grows 5x with
 *  the roster size. */
export async function engagementOverview(ctx: RequestContext): Promise<EngagementRow[]> {
  const now = trainingNow();
  const list = await students(ctx);
  if (!list.length) return [];
  const userIds = list.map(s => s.userId);
  const [prefRows, xpRows, honorCounts] = await Promise.all([
    ctx.store.getMany<PreferenceRecord>('training-preferences', userIds.map(id => `${ctx.orgId}:${id}`), ctx.orgId),
    ctx.store.getMany<XpRecord>('training-xp', userIds.map(id => `${ctx.orgId}:${id}`), ctx.orgId),
    ctx.env.DB.prepare(`SELECT owner_id AS userId, count(*) AS n FROM Records WHERE kind='mastery-honor' AND org_id=? AND owner_id IN (SELECT value FROM json_each(?)) GROUP BY owner_id`).bind(ctx.orgId, JSON.stringify(userIds)).all<{ userId: string; n: number }>(),
  ]);
  const prefById = new Map(prefRows.map(r => [r.value.id, r]));
  const xpById = new Map(xpRows.map(r => [r.value.id, r]));
  const honorsByUser = new Map(honorCounts.results.map(r => [r.userId, r.n]));
  return Promise.all(list.map(async (s) => {
    const learner = learnerCtx(ctx, s.userId);
    const pref = prefById.get(`${ctx.orgId}:${s.userId}`) ?? null;
    const resolved = resolvePreference(learner, pref, now);
    const calendar = resolveTrainingCalendar(now, resolved);
    const [credited, quests] = await Promise.all([
      creditedDates(learner),
      questWeek(learner, calendar.weekStartLocalDate),
    ]);
    const weekDays = Array.from({ length: 7 }, (_, i) => addDays(calendar.localDate, -i));
    const xpRec = xpById.get(`${ctx.orgId}:${s.userId}`)?.value ?? null;
    const xpThisWeek = weekDays.reduce((n, d) => n + (xpRec?.xpByDay[d] ?? 0), 0);
    const level = levelForXp(xpRec?.totalXp ?? 0);
    return {
      studentId: s.userId,
      name: s.displayName,
      streak: streakCount(credited, calendar.localDate),
      xpThisWeek,
      practiceDaysThisWeek: weekDays.filter(d => credited.has(d)).length,
      lastActiveAtUtc: pref?.value.lastEventAtUtc ?? null,
      level: level.level,
      levelName: level.levelName,
      honorsEarned: honorsByUser.get(s.userId) ?? 0,
      quests,
    };
  }));
}

/** Room-completion hook participation record (written by another agent's hook; may be absent). */
export interface RoomParticipation {
  roomId: string;
  userId: string;
  seasonId: string;
  format: string;
  simulation?: { version?: number } | null;
  completedAtUtc: string;
  questionsAnswered: number;
  xpAwarded: number;
  dayCredited: boolean;
  questsCompleted: string[];
}

/** The match-history fields needed for the coach room surfaces. Both the new
 *  storage envelope (`data.summary`) and legacy raw-Room records (`data`) are
 *  normalized. */
interface RoomSummaryLike {
  status?: string;
  format?: string;
  completedAt?: string | null;
  members?: { userId?: string }[];
  submissions?: { questionId?: string; scribeId?: string; deadlineDraft?: boolean }[];
}

export interface CompletedRoom {
  roomId: string;
  seasonId: string | null;
  format: 'Pbe' | 'Arcade';
  completedAtUtc: string | null;
  questionsAnswered: number;
  xpEarned: number;
  dayCredited: boolean;
}

/**
 * Completed team rooms for one student, newest first. Participation is read
 * from the room-completion hook's `room-participation` record when present;
 * for older rooms (or when the hook hasn't written one) participation is
 * derived from the match JSON submissions (scribeId === userId, non-draft)
 * and XP is treated as 0. No writes.
 */
export async function completedRooms(ctx: RequestContext, userId: string): Promise<CompletedRoom[]> {
  // Only completed rooms are ever used; filter in SQL so abandoned/lobby
  // match blobs are never downloaded. Both the new storage envelope
  // (data.summary) and legacy raw records (data root) are covered.
  const rows = await ctx.env.DB.prepare(
    `SELECT id, season_id, data FROM Records INDEXED BY Records_scope WHERE kind='match' AND org_id=? AND (json_extract(data,'$.summary.status')='Completed' OR json_extract(data,'$.status')='Completed') LIMIT 5001`
  ).bind(ctx.orgId).all<{ id: string; season_id: string | null; data: string }>();
  // Pilot query limit, matching store.list: never silently truncate a coach's history.
  if (rows.results.length > 5000) throw new HttpError(413, "This collection exceeds the pilot query limit. Use a narrower scope or paginated export.");
  const picked: { roomId: string; seasonId: string | null; summary: RoomSummaryLike }[] = [];
  for (const row of rows.results) {
    let summary: RoomSummaryLike | null = null;
    try {
      const raw = JSON.parse(row.data) as RoomSummaryLike & { format?: string; summary?: RoomSummaryLike };
      summary = raw.format === ROOM_STORAGE_FORMAT ? (raw.summary ?? null) : raw;
    } catch { summary = null; }
    if (!summary || summary.status !== 'Completed') continue;
    if (!summary.members?.some(m => m.userId === userId)) continue;
    picked.push({ roomId: row.id, seasonId: row.season_id, summary });
  }
  const participations = await ctx.store.getMany<RoomParticipation>('room-participation', picked.map(r => `${r.roomId}:${userId}`), ctx.orgId);
  const byRoom = new Map(participations.map(p => [p.value.roomId, p.value]));
  return picked.map(({ roomId, seasonId, summary }) => {
    const part = byRoom.get(roomId);
    const scribeQuestionIds = new Set(
      (summary.submissions ?? []).filter(s => s.scribeId === userId && !s.deadlineDraft).map(s => s.questionId).filter((q): q is string => !!q)
    );
    return {
      roomId,
      seasonId,
      format: summary.format === 'Pbe' ? 'Pbe' as const : 'Arcade' as const,
      completedAtUtc: summary.completedAt ?? null,
      questionsAnswered: part?.questionsAnswered ?? scribeQuestionIds.size,
      xpEarned: part?.xpAwarded ?? 0,
      dayCredited: part?.dayCredited ?? false,
    };
  }).sort((a, b) => (b.completedAtUtc ?? '').localeCompare(a.completedAtUtc ?? ''));
}

export interface SessionHistoryEntry {
  sessionId: string;
  format: 'Memory' | 'Pbe' | 'Room';
  mode: string;
  completedAtUtc: string | null;
  attempted: number;
  correct: number | null;
  xpEarned: number;
  /** Present only when format === 'Room'. */
  roomId?: string;
  teamFormat?: 'Pbe' | 'Arcade';
}

/** Coach/admin-only paginated session history for one student. No writes. */
export async function studentSessionHistory(ctx: RequestContext, studentId: string, before?: string, limit = 30): Promise<{ sessions: SessionHistoryEntry[]; nextBefore: string | null }> {
  const s = await student(ctx, studentId);
  const learner = learnerCtx(ctx, s.userId);
  const sessions = await listAll<Session>(learner, 'session', { ownerId: s.userId });
  const pbeSessions = await listAll<PbeSession>(learner, 'pbe-session', { ownerId: s.userId });
  const rooms = await completedRooms(learner, s.userId);
  const all: SessionHistoryEntry[] = [
    ...sessions.filter(x => x.status === 'Completed').map(x => ({
      sessionId: x.id, format: 'Memory' as const, mode: x.mode, completedAtUtc: x.completedAtUtc ?? null,
      attempted: x.recap?.attempted ?? x.attempts.length, correct: x.recap?.correct ?? null, xpEarned: x.training?.xpEarned ?? 0,
    })),
    ...pbeSessions.filter(x => x.status === 'Completed').map(x => ({
      sessionId: x.id, format: 'Pbe' as const, mode: x.mode, completedAtUtc: x.completedAtUtc ?? null,
      attempted: x.attempts.length, correct: null as number | null, xpEarned: x.xpEarned ?? 0,
    })),
    ...rooms.map(r => ({
      sessionId: r.roomId, format: 'Room' as const, mode: `Team ${r.format === 'Pbe' ? 'PBE' : 'Arcade'}`,
      roomId: r.roomId, teamFormat: r.format, completedAtUtc: r.completedAtUtc,
      attempted: r.questionsAnswered, correct: null as number | null, xpEarned: r.xpEarned,
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
  const rooms = await completedRooms(learner, s.userId);

  type Row = { date: string; type: string; mode: string; correct: string; attempted: string; xp: number; streak_day: string; honor_earned: string };
  const rows: Row[] = [];
  for (const d of days.filter(d => d.credited))
    rows.push({ date: d.localDate, type: 'credited_day', mode: '', correct: '', attempted: '', xp: XP_VALUES.dayCredited, streak_day: 'true', honor_earned: '' });
  for (const x of sessions.filter(x => x.status === 'Completed'))
    rows.push({ date: (x.completedAtUtc ?? '').slice(0, 10), type: 'session', mode: `Memory ${x.mode}`, correct: String(x.recap?.correct ?? ''), attempted: String(x.recap?.attempted ?? x.attempts.length), xp: x.training?.xpEarned ?? 0, streak_day: dayBySession.has(x.id) ? 'true' : '', honor_earned: '' });
  for (const x of pbeSessions.filter(x => x.status === 'Completed'))
    rows.push({ date: (x.completedAtUtc ?? '').slice(0, 10), type: 'session', mode: `PBE ${x.mode}`, correct: '', attempted: String(x.attempts.length), xp: x.xpEarned ?? 0, streak_day: dayBySession.has(x.id) ? 'true' : '', honor_earned: '' });
  for (const r of rooms)
    rows.push({ date: (r.completedAtUtc ?? '').slice(0, 10), type: 'team_room', mode: `Team ${r.format === 'Pbe' ? 'PBE' : 'Arcade'}`, correct: '', attempted: String(r.questionsAnswered), xp: r.xpEarned, streak_day: dayBySession.has(`room:${r.roomId}`) ? 'true' : '', honor_earned: '' });
  for (const h of honors)
    rows.push({ date: h.earnedAtUtc.slice(0, 10), type: 'honor', mode: '', correct: '', attempted: '', xp: XP_VALUES.profileHonor, streak_day: '', honor_earned: honorTitles.get(h.key) ?? h.key });
  for (const b of badges)
    rows.push({ date: b.earnedAtUtc.slice(0, 10), type: 'milestone', mode: '', correct: '', attempted: '', xp: XP_VALUES.soloMilestone, streak_day: '', honor_earned: b.title });

  rows.sort((a, b) => b.date.localeCompare(a.date) || a.type.localeCompare(b.type));
  const header = 'date,type,mode,correct,attempted,xp,streak_day,honor_earned';
  return [header, ...rows.map(r => [r.date, r.type, r.mode, r.correct, r.attempted, r.xp, r.streak_day, r.honor_earned].map(csvCell).join(','))].join('\n') + '\n';
}
