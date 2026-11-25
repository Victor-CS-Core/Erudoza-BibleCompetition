import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { EngagementRow } from "../../api/types";
import { useAuth } from "../../auth/AuthContext";
import { Badge, Button, LoadingState, Notice, Panel, Select } from "../../components/ui";
import { ProfileAvatar } from "../profile/ProfileAvatar";

type SortKey = "name" | "streak" | "xpThisWeek" | "practiceDaysThisWeek" | "quests" | "level" | "honorsEarned" | "lastActiveAtUtc";

const columns: { key: SortKey; label: string }[] = [
  { key: "name", label: "Student" },
  { key: "streak", label: "Streak" },
  { key: "xpThisWeek", label: "XP this week" },
  { key: "practiceDaysThisWeek", label: "Practice days · 7d" },
  { key: "quests", label: "Quests" },
  { key: "level", label: "Level" },
  { key: "honorsEarned", label: "Honors" },
  { key: "lastActiveAtUtc", label: "Last active" },
];

function formatQuests(q: EngagementRow["quests"]): string {
  if (q.totalThisWeek === 0) return "—";
  return `${q.completedThisWeek}/${q.totalThisWeek} · ${Math.round(q.rate * 100)}%`;
}

/** Quests sorts by completion rate; every other key sorts by its own value. */
function sortValue(row: EngagementRow, key: SortKey): string | number | null {
  return key === "quests" ? row.quests.rate : row[key];
}

function formatLastActive(value: string | null): string {
  if (!value) return "—";
  const days = Math.floor((Date.now() - Date.parse(value)) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

/** Phone head-line caption: the same last-active fact, phrased as a status. */
function formatLastActiveCaption(value: string | null): string {
  if (!value) return "Never active";
  const days = Math.floor((Date.now() - Date.parse(value)) / 86400000);
  if (days <= 0) return "Active today";
  if (days === 1) return "Active yesterday";
  return `Active ${days} days ago`;
}

/** Coach engagement overview (§7b): the at-a-glance "who's fading" table.
 *  `initialSeasonId` preselects the season filter (the coach overview's
 *  "haven't practiced" deep link lands here with its season). */
export function EngagementTab({ initialSeasonId }: { initialSeasonId?: string | null } = {}) {
  const { me } = useAuth();
  const [sortKey, setSortKey] = useState<SortKey>("practiceDaysThisWeek");
  const [ascending, setAscending] = useState(true);
  const [seasonId, setSeasonId] = useState(initialSeasonId ?? "");
  const engagement = useQuery({
    queryKey: ["engagement", me?.organizationId],
    queryFn: () => api.engagement(me!.organizationId),
    enabled: !!me,
    staleTime: 30_000,
  });
  const seasons = useQuery({ queryKey: ["seasons", me?.organizationId], queryFn: () => api.seasons(me!.organizationId), enabled: !!me });
  // Engagement rows are org-wide; a season filter keeps the students the
  // season's coverage says are assigned to it — the same membership the
  // coach overview counts.
  const coverage = useQuery({ queryKey: ["coverage", me?.organizationId, seasonId], queryFn: () => api.coverage(me!.organizationId, seasonId), enabled: !!me && !!seasonId });
  const seasonMemberIds = useMemo(() => coverage.data ? new Set(coverage.data.students.map(s => s.studentUserId)) : null, [coverage.data]);
  const rows = useMemo(() => {
    const data = (engagement.data ?? []).filter(row => !seasonId || (seasonMemberIds?.has(row.studentId) ?? false));
    const sorted = [...data].sort((a: EngagementRow, b: EngagementRow) => {
      const av = sortValue(a, sortKey), bv = sortValue(b, sortKey);
      if (av === null) return 1;
      if (bv === null) return -1;
      const cmp = typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return ascending ? cmp : -cmp;
    });
    return sorted;
  }, [engagement.data, sortKey, ascending, seasonId, seasonMemberIds]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) setAscending(!ascending);
    else { setSortKey(key); setAscending(key === "name"); }
  }

  const activeColumn = columns.find(col => col.key === sortKey);
  const sortDirection = sortKey === "name" ? (ascending ? "A–Z" : "Z–A") : (ascending ? "lowest first" : "highest first");

  return <Panel id="engagement" data-testid="engagement-tab">
    <h2>Engagement</h2>
    <p>Who's fading — streaks, XP and practice days at a glance. Choose a column heading to sort.</p>
    {!!seasons.data?.length && <label>Season<Select value={seasonId} onChange={event => setSeasonId(event.target.value)} aria-label="Filter engagement by season"><option value="">All seasons</option>{seasons.data.map(season => <option key={season.id} value={season.id}>{season.name}</option>)}</Select></label>}
    {seasonId && coverage.isPending && <LoadingState label="Loading the season's students…" />}
    {seasonId && coverage.isError && <Notice tone="danger">The season filter could not load. <Button variant="secondary" size="compact" onClick={() => void coverage.refetch()}>Try again</Button></Notice>}
    {engagement.isPending && <LoadingState label="Loading engagement…" />}
    {engagement.isError && <Notice tone="danger">Engagement could not load. <Button variant="secondary" size="compact" onClick={() => void engagement.refetch()}>Try again</Button></Notice>}
    {engagement.data && (rows.length ? <>
      <div className="engagement-mobile-controls">
        <label>Sort by<Select value={sortKey} onChange={event => toggleSort(event.target.value as SortKey)} aria-label="Sort students by">{columns.map(col => <option key={col.key} value={col.key}>{col.label}</option>)}</Select></label>
        <Button variant="secondary" size="compact" onClick={() => setAscending(value => !value)} aria-label={ascending ? "Sort descending" : "Sort ascending"}>{ascending ? "▲" : "▼"}</Button>
      </div>
      <p className="engagement-sort-caption">Sorted by {activeColumn?.label} · {sortDirection}.</p>
      <div className="training-table-scroll" role="region" aria-label="Student engagement" tabIndex={0}>
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
            <td data-label="Student"><div className="engagement-head"><span className="profile-person"><ProfileAvatar userId={row.studentId} displayName={row.name} /><strong>{row.name}</strong></span><span className="engagement-active">{formatLastActiveCaption(row.lastActiveAtUtc)}</span></div>{row.practiceDaysThisWeek === 0 && <p className="engagement-flag"><Badge tone="neutral">No practice this week</Badge></p>}</td>
            <td data-label="Streak">{row.streak} {row.streak === 1 ? "day" : "days"}</td>
            <td data-label="XP this week">{row.xpThisWeek.toLocaleString()}</td>
            <td data-label="Practice days">{row.practiceDaysThisWeek} / 7</td>
            <td data-label="Quests">{formatQuests(row.quests)}</td>
            <td data-label="Level">{row.level} · {row.levelName}</td>
            <td data-label="Honors">{row.honorsEarned}</td>
            <td data-label="Last active">{formatLastActive(row.lastActiveAtUtc)}</td>
          </tr>)}
        </tbody>
      </table>
      </div></> : <p>No students yet.</p>)}
  </Panel>;
}
