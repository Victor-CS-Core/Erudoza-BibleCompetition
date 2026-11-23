import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../auth/AuthContext";
import { api } from "../../api/client";
import type { Progress } from "../../api/types";
import { Button, LoadingState, Notice, Panel } from "../../components/ui";
import { AssignedPassageQuests } from "./AssignedPassageQuests";

type MasteryItem = Progress["mastery"][number];

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
      : <AssignedPassageQuests items={items} mastery={mastery} seasonId={seasonId} />}
  </Panel>;
}
