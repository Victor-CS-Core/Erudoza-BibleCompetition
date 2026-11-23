import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../auth/AuthContext";
import { api } from "../../api/client";
import type { Assignment, Progress } from "../../api/types";
import { Button, LoadingState, Notice, Panel, ProgressMeter } from "../../components/ui";
import { formatPassageCitation } from "../admin/passageRanges";

type MasteryItem = Progress["mastery"][number];

/** Verses of one assignment range that already have mastery evidence, and how many are Strong/Mastered. */
function rangeProgress(item: Assignment, mastery: MasteryItem[]) {
  const inRange = mastery.filter(m => m.bookKey === item.bookKey && m.chapter != null && m.verse != null
    && (m.chapter > item.startChapter || (m.chapter === item.startChapter && m.verse >= item.startVerse))
    && (m.chapter < item.endChapter || (m.chapter === item.endChapter && m.verse <= item.endVerse)));
  if (!inRange.length) return null;
  // Denominator is the assignment's full verse count when the server
  // provides it; the practiced-row count alone would read "1 of 1" for a
  // 3-verse assignment with a single practiced verse.
  const total = item.verseCount && item.verseCount > 0 ? item.verseCount : inRange.length;
  return { total, strong: inRange.filter(m => m.level === "Mastered" || m.level === "Strong").length };
}

/** Student-facing list of exactly the passages (down to the verse) assigned for this season. */
export function AssignedPassages({ seasonId, seasonName, seasonStatus, mastery }: { seasonId: string; seasonName?: string | null; seasonStatus?: string; mastery?: MasteryItem[] }) {
  const { me } = useAuth();
  const list = useQuery({
    queryKey: ["my-assignments", me?.organizationId, seasonId],
    queryFn: () => api.myAssignments(me!.organizationId, seasonId),
    enabled: !!me?.organizationId,
  });
  const items = [...(list.data ?? [])].sort((a, b) => a.bookKey.localeCompare(b.bookKey) || a.startChapter - b.startChapter || a.startVerse - b.startVerse);
  return <Panel className="training-assigned-passages">
    <div className="training-panel-title"><h2>Your assigned passages</h2></div>
    {seasonStatus && <p className="training-assigned-state">{seasonName ? <><strong>{seasonName}</strong> · </> : null}{seasonStatus === "Active" ? "Ready to study — these are your passages for this season." : seasonStatus === "None" ? "Nothing assigned yet." : "Not started yet — your passages are saved here, and training opens when this season starts."}</p>}
    {list.isPending ? <LoadingState label="Loading assigned passages…" />
      : list.isError ? <Notice tone="danger">Assigned passages could not load. <Button variant="secondary" size="compact" onClick={() => void list.refetch()}>Retry</Button></Notice>
      : !items.length ? <p>No passages assigned yet. Your coach will add your study assignment here.</p>
      : <ul>{items.map(item => {
          const citation = formatPassageCitation(item);
          const range = mastery ? rangeProgress(item, mastery) : null;
          return <li key={item.id}><span>{citation}</span>{range && <><ProgressMeter label={`${citation}: verses strong or mastered`} value={range.strong} max={range.total} hideCaption /><small>{range.strong} of {range.total} verses strong or mastered</small></>}
          </li>;
        })}</ul>}
  </Panel>;
}
