import { bibleBookName } from './catalog';
import { id } from './model';
import type { Range } from './model';

export type AssignmentNotificationAction = 'added' | 'removed' | 'updated';

/** A short, student-facing note about a coach's assignment change. Stored as a
 *  profile-scoped record (kind 'notification', owned by the student) so the top
 *  bar bell can surface pending updates without touching assignment data. */
export interface AssignmentNotification {
  id: string;
  seasonId: string;
  seasonName: string;
  studentUserId: string;
  actorUserId: string;
  actorDisplayName: string;
  action: AssignmentNotificationAction;
  /** Verse-aware citation, e.g. "John 3:16–18". */
  citation: string;
  readAtUtc: string | null;
  createdAtUtc: string;
}

/** Mirror of the web app's formatPassageCitation, with known book codes resolved
 *  to display names so the short description reads naturally on its own. */
export function notificationCitation(range: Range): string {
  const book = bibleBookName(range.bookKey);
  if (range.startChapter === range.endChapter)
    return range.startVerse === range.endVerse
      ? `${book} ${range.startChapter}:${range.startVerse}`
      : `${book} ${range.startChapter}:${range.startVerse}–${range.endVerse}`;
  return `${book} ${range.startChapter}:${range.startVerse}–${range.endChapter}:${range.endVerse}`;
}

export function buildAssignmentNotification(input: {
  seasonId: string;
  seasonName: string;
  studentUserId: string;
  actorUserId: string;
  actorDisplayName: string;
  action: AssignmentNotificationAction;
  range: Range;
}): AssignmentNotification {
  const createdAtUtc = new Date().toISOString();
  return {
    id: id(),
    seasonId: input.seasonId,
    seasonName: input.seasonName,
    studentUserId: input.studentUserId,
    actorUserId: input.actorUserId,
    actorDisplayName: input.actorDisplayName,
    action: input.action,
    citation: notificationCitation(input.range),
    readAtUtc: null,
    createdAtUtc,
  };
}

/** One-line student-facing description, e.g. "Coach Maya added John 3:16–18". */
export function notificationSummary(notification: Pick<AssignmentNotification, 'actorDisplayName' | 'action' | 'citation'>): string {
  const verb = notification.action === 'added' ? 'added' : notification.action === 'removed' ? 'removed' : 'updated your assignment to';
  return `${notification.actorDisplayName} ${verb} ${notification.citation}`;
}

export type TeamPracticeNotificationAction = 'assigned' | 'removed' | 'rescheduled' | 'cancelled';

/** Team Practice event variant of the bell record (kind 'notification', owned
 *  by the assignee). Discriminated from assignment notifications by `type`. */
export interface TeamPracticeNotification {
  id: string;
  type: 'team-practice';
  eventId: string;
  eventName: string;
  activity: 'Simulation' | 'HeadToHead';
  seasonId: string;
  seasonName: string;
  studentUserId: string;
  actorUserId: string;
  actorDisplayName: string;
  action: TeamPracticeNotificationAction;
  startsAtUtc: string | null;
  readAtUtc: string | null;
  createdAtUtc: string;
}

export function buildTeamPracticeNotification(input: {
  eventId: string;
  eventName: string;
  activity: 'Simulation' | 'HeadToHead';
  seasonId: string;
  seasonName: string;
  studentUserId: string;
  actorUserId: string;
  actorDisplayName: string;
  action: TeamPracticeNotificationAction;
  startsAtUtc: string | null;
}): TeamPracticeNotification {
  return {
    id: id(),
    type: 'team-practice',
    eventId: input.eventId,
    eventName: input.eventName,
    activity: input.activity,
    seasonId: input.seasonId,
    seasonName: input.seasonName,
    studentUserId: input.studentUserId,
    actorUserId: input.actorUserId,
    actorDisplayName: input.actorDisplayName,
    action: input.action,
    startsAtUtc: input.startsAtUtc,
    readAtUtc: null,
    createdAtUtc: new Date().toISOString(),
  };
}

export const teamPracticeActivityLabel = (activity: 'Simulation' | 'HeadToHead'): string =>
  activity === 'Simulation' ? 'Full-event team rehearsal' : 'Head-to-head practice';

/** Format a scheduled start the way the bell copy reads: "Tue Nov 25, 6:00 PM". */
export function teamPracticeWhen(startsAtUtc: string): string {
  const date = new Date(startsAtUtc);
  const day = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
  return `${day}, ${time}`;
}

/** One-line bell description for a team-practice notification, following the
 *  assignment pattern ("Coach Maya added John 3:16–18"). */
export function teamPracticeNotificationSummary(notification: Pick<TeamPracticeNotification, 'actorDisplayName' | 'action' | 'eventName' | 'activity' | 'seasonName' | 'startsAtUtc'>): string {
  const label = teamPracticeActivityLabel(notification.activity);
  const what = `${label} · ${notification.seasonName}`;
  switch (notification.action) {
    case 'assigned':
      return notification.startsAtUtc
        ? `${notification.actorDisplayName} assigned you to ${what} — ${teamPracticeWhen(notification.startsAtUtc)}`
        : `${notification.actorDisplayName} assigned you to ${what} — join now`;
    case 'removed':
      return `${notification.actorDisplayName} removed you from ${what}`;
    case 'rescheduled':
      return notification.startsAtUtc
        ? `${notification.actorDisplayName} moved ${what} to ${teamPracticeWhen(notification.startsAtUtc)}`
        : `${notification.actorDisplayName} opened ${what} — join now`;
    case 'cancelled':
      return `${notification.actorDisplayName} cancelled ${what}`;
  }
}

/** Summary for either notification variant stored under kind 'notification'. */
export function anyNotificationSummary(notification: AssignmentNotification | TeamPracticeNotification): string {
  return (notification as TeamPracticeNotification).type === 'team-practice'
    ? teamPracticeNotificationSummary(notification as TeamPracticeNotification)
    : notificationSummary(notification as AssignmentNotification);
}
