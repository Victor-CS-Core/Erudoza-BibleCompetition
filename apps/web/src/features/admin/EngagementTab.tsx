import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { EngagementRow } from "../../api/types";
import { useAuth } from "../../auth/AuthContext";
import { Badge, Button, LoadingState, Notice, Panel } from "../../components/ui";

type SortKey = "name" | "streak" | "xpThisWeek" | "practiceDaysThisWeek" | "level" | "honorsEarned" | "lastActiveAtUtc";

const columns: { key: SortKey; label: string }[] = [
  { key: "name", label: "Student" },
  { key: "streak", label: "Streak" },
  { key: "xpThisWeek", label: "XP this week" },
  { key: "practiceDaysThisWeek", label: "Practice days · 7d" },
  { key: "level", label: "Level" },
  { key: "honorsEarned", label: "Honors" },
  { key: "lastActiveAtUtc", label: "Last active" },
];

function formatLastActive(value: string | null): string {
  if (!value) return "—";
  const days = Math.floor((Date.now() - Date.parse(value)) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

/** Coach engagement overview (§7b): the at-a-glance "who's fading" table. */
export function EngagementTab() {
  const { me } = useAuth();
  const [sortKey, setSortKey] = useState<SortKey>("practiceDaysThisWeek");
  const [ascending, setAscending] = useState(true);
  const engagement = useQuery({
    queryKey: ["engagement", me?.organizationId],
    queryFn: () => api.engagement(me!.organizationId),
    enabled: !!me,
    staleTime: 30_000,
  });
  const rows = useMemo(() => {
    const data = engagement.data ?? [];
    const sorted = [...data].sort((a: EngagementRow, b: EngagementRow) => {
      const av = a[sortKey], bv = b[sortKey];
      if (av === null) return 1;
      if (bv === null) return -1;
      const cmp = typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return ascending ? cmp : -cmp;
    });
    return sorted;
  }, [engagement.data, sortKey, ascending]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) setAscending(!ascending);
    else { setSortKey(key); setAscending(key === "name"); }
  }

  return <Panel id="engagement" data-testid="engagement-tab">
    <h2>Engagement</h2>
    <p>Who's fading — streaks, XP and practice days at a glance. Choose a column heading to sort.</p>
    {engagement.isPending && <LoadingState label="Loading engagement…" />}
    {engagement.isError && <Notice tone="danger">Engagement could not load. <Button variant="secondary" size="compact" onClick={() => void engagement.refetch()}>Try again</Button></Notice>}
    {engagement.data && (rows.length ? <div className="training-table-scroll" role="region" aria-label="Student engagement" tabIndex={0}>
      <table className="training-table" data-testid="engagement-table">
        <thead><tr>{columns.map(col =>
          <th key={col.key} aria-sort={sortKey === col.key ? (ascending ? "ascending" : "descending") : "none"}>
            <button type="button" className="ds-table-sort" onClick={() => toggleSort(col.key)} aria-label={`Sort by ${col.label}`}>
              {col.label}{sortKey === col.key ? (ascending ? " ▲" : " ▼") : ""}
            </button>
          </th>)}
        </tr></thead>
        <tbody>{rows.map(row =>
          <tr key={row.studentId}>
            <td><strong>{row.name}</strong>{row.practiceDaysThisWeek === 0 && <><br /><Badge tone="neutral">No practice this week</Badge></>}</td>
            <td>{row.streak} {row.streak === 1 ? "day" : "days"}</td>
            <td>{row.xpThisWeek.toLocaleString()}</td>
            <td>{row.practiceDaysThisWeek} / 7</td>
            <td>{row.levelName}<br /><small>Level {row.level}</small></td>
            <td>{row.honorsEarned}</td>
            <td>{formatLastActive(row.lastActiveAtUtc)}</td>
          </tr>)}
        </tbody>
      </table>
    </div> : <p>No students yet.</p>)}
  </Panel>;
}
