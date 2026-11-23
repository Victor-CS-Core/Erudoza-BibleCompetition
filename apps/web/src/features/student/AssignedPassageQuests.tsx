import { useState } from "react";
import { Link } from "react-router-dom";
import type { Assignment, Progress } from "../../api/types";
import { AppIcon } from "../../components/AppIcon";
import { Button, ProgressMeter } from "../../components/ui";
import { formatPassageCitation } from "../admin/passageRanges";
import { trainingLink } from "./trainingAssets";

type MasteryItem = Progress["mastery"][number];

type PassageState = "not-started" | "in-progress" | "strong" | "mastered";

const STATE_LABEL: Record<PassageState, string> = {
  "not-started": "Not started",
  "in-progress": "In progress",
  "strong": "Strong",
  "mastered": "Mastered",
};

type PassageProgress = {
  total: number;
  strong: number;
  due: boolean;
  state: PassageState;
};

/** Per-range mastery roll-up: verses strong/mastered against the assignment's
 *  true verse count (server `verseCount`), never just the practiced rows. */
function passageProgress(item: Assignment, mastery: MasteryItem[]): PassageProgress {
  const inRange = mastery.filter(m => m.bookKey === item.bookKey && m.chapter != null && m.verse != null
    && (m.chapter > item.startChapter || (m.chapter === item.startChapter && m.verse >= item.startVerse))
    && (m.chapter < item.endChapter || (m.chapter === item.endChapter && m.verse <= item.endVerse)));
  // Denominator is the assignment's full verse count when the server
  // provides it; the practiced-row count alone would read "1 of 1" for a
  // 3-verse assignment with a single practiced verse.
  const total = item.verseCount && item.verseCount > 0 ? item.verseCount : inRange.length;
  const strong = inRange.filter(m => m.level === "Mastered" || m.level === "Strong").length;
  const mastered = inRange.filter(m => m.level === "Mastered").length;
  const now = Date.now();
  const due = inRange.some(m => m.level === "Review" || (m.reviewDueAtUtc != null && Date.parse(m.reviewDueAtUtc) <= now));
  const state: PassageState = total > 0 && mastered === total
    ? "mastered"
    : total > 0 && strong === total
      ? "strong"
      : inRange.length > 0
        ? "in-progress"
        : "not-started";
  return { total, strong, due, state };
}

/** How urgently a passage needs the student next: a review due first, then
 *  work already under way, then untouched passages, with strong and mastered
 *  passages last. Passages without mastery data sort with the untouched
 *  group. The incoming (server) order is kept within each group. */
function needRank(progress: PassageProgress | null): number {
  if (progress?.due) return 0;
  switch (progress?.state) {
    case "in-progress": return 1;
    case "strong": return 3;
    case "mastered": return 4;
    default: return 2;
  }
}

/** Rows shown before the student asks for the rest — HQ stays one screen. */
const COLLAPSED_COUNT = 3;

/**
 * HQ's assigned passages as quests: each passage is a quest row with its
 * citation as the title, a game state chip, the shared meter against the
 * true verse count, and one action into practice (Review when a verse in
 * the range is due — the passage picker's established target). Presentation
 * only; the data and navigation targets are the ones the app already uses.
 *
 * The list never grows into a wall: rows are ordered by what needs the
 * student next and, past {@link COLLAPSED_COUNT}, the rest wait behind a
 * "Show all" toggle that expands in place.
 */
export function AssignedPassageQuests({ items, mastery, seasonId }: { items: Assignment[]; mastery?: MasteryItem[]; seasonId: string }) {
  const [expanded, setExpanded] = useState(false);
  const ordered = items
    .map((item, index) => ({ item, index, progress: mastery ? passageProgress(item, mastery) : null }))
    .sort((a, b) => needRank(a.progress) - needRank(b.progress) || a.index - b.index);
  const collapsible = ordered.length > COLLAPSED_COUNT;
  const visible = collapsible && !expanded ? ordered.slice(0, COLLAPSED_COUNT) : ordered;
  return <>
    <ul className="game-passage-quests">{visible.map(({ item, progress }) => {
      const citation = formatPassageCitation(item);
      const due = progress?.due ?? false;
      // The action names this passage, so the session is scoped to this
      // assignment's verses (server-resolved from the assignment id).
      const href = trainingLink(`/student/study?mode=${due ? "Review&format=Memory" : "Practice"}&assignmentId=${encodeURIComponent(item.id)}`, seasonId);
      const actionLabel = due ? "Review this passage" : progress?.state === "not-started" ? "Start this passage" : "Practice this passage";
      return <li key={item.id} className={`game-passage-quest${progress ? ` is-${progress.state}` : ""}`} data-testid="assigned-passage-quest">
        <div className="game-passage-quest__head">
          <span className="game-passage-quest__tile" aria-hidden="true"><AppIcon name="book" /></span>
          <strong className="game-passage-quest__title">{citation}</strong>
          {progress && progress.total > 0 && <span className={`game-passage-chip is-${progress.state}`}>{STATE_LABEL[progress.state]}</span>}
        </div>
        {progress && progress.total > 0 && <>
          <ProgressMeter label={`${citation}: verses strong or mastered`} value={progress.strong} max={progress.total} hideCaption />
          {progress.state === "not-started" && <p className="game-passage-quest__invite">The quest is about to start — every verse here is waiting for its first practice.</p>}
          <div className="game-passage-quest__foot">
            <span className="game-passage-quest__count">{progress.strong} of {progress.total} verses strong or mastered</span>
            <Link className="game-passage-quest__action" to={href}>{actionLabel}<AppIcon name="arrow" /></Link>
          </div>
        </>}
        {(!progress || progress.total === 0) && <div className="game-passage-quest__foot">
          <Link className="game-passage-quest__action" to={href}>{actionLabel}<AppIcon name="arrow" /></Link>
        </div>}
      </li>;
    })}</ul>
    {collapsible && <Button type="button" variant="secondary" className="game-passage-quests__toggle" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
      {expanded ? "Show less" : <>Show all {items.length} passages<span className="game-passage-quests__toggle-more">+{items.length - COLLAPSED_COUNT} more</span></>}
    </Button>}
  </>;
}
