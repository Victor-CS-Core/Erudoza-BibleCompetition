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
