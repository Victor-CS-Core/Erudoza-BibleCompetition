import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { api } from "../../api/client";
import { Badge, Button, LinkButton, LoadingState, Notice, Panel } from "../../components/ui";
import { AppIcon } from "../../components/AppIcon";
import { trainingLink } from "./trainingAssets";
import type { SeasonLeaderboardEntry, SeasonLeaderboardResponse } from "../../api/types";
import "./student.css";

type BoardMode = "season" | "week";
const modeXp = (entry: SeasonLeaderboardEntry, mode: BoardMode) => mode === "season" ? entry.seasonXp : entry.weekXp;

/**
 * Season leaderboard — the full-board companion to the home Team leaderboard
 * card. Membership is the season (students assigned in it), ranking is season
 * XP with a This-week toggle, and privacy matches the weekly board: students
 * opt in and see masked names; coaches see every member with full names.
 */
export function SeasonLeaderboardPage() {
  const { me } = useAuth();
  const [params] = useSearchParams();
  const [mode, setMode] = useState<BoardMode>("season");
  const identity = [me?.organizationId, me?.userId];
  const seasons = useQuery({ queryKey: ["assigned-seasons", ...identity], queryFn: () => api.assignedSeasons(), enabled: !!me });
  const seasonId = params.get("seasonId") || seasons.data?.[0]?.id || undefined;
  const board = useQuery({
    queryKey: ["season-leaderboard", me?.organizationId, seasonId, me?.userId],
    queryFn: () => api.seasonLeaderboard(me!.organizationId!, seasonId!),
    enabled: !!me?.organizationId && !!seasonId,
    staleTime: 60_000,
  });
  const client = useQueryClient();
  const optIn = useMutation({
    mutationFn: (next: boolean) => api.setLeaderboardOptIn(next),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["season-leaderboard", me?.organizationId, seasonId, me?.userId] });
      void client.invalidateQueries({ queryKey: ["leaderboard", me?.organizationId, me?.userId] });
    },
  });

  const data = board.data;
  const sorted = useMemo(() => data ? [...data.entries].sort((a, b) => modeXp(b, mode) - modeXp(a, mode) || a.displayName.localeCompare(b.displayName)) : [], [data, mode]);
  const myIndex = data?.me ? sorted.findIndex(entry => entry.userId === data.me!.userId) : -1;
  const myEntry = myIndex >= 0 ? sorted[myIndex] : undefined;
  const above = myIndex > 0 ? sorted[myIndex - 1] : undefined;

  return <div className="training-dashboard season-board">
    <p className="season-board-caption">Current season</p>
    <div className="season-board-title-row">
      <h1>{data?.seasonName ?? seasons.data?.find(s => s.id === seasonId)?.name ?? "Season"}</h1>
      {data && <Badge tone={data.seasonStatus === "Active" ? "success" : "neutral"}>{data.seasonStatus}</Badge>}
    </div>
    <h2 className="season-board-heading">Season leaderboard</h2>

    {!seasonId && !seasons.isPending ? <Notice tone="info">You don’t have an assigned season yet, so there’s no board to show.</Notice>
      : board.isPending ? <LoadingState label="Loading the season leaderboard…" />
      : board.isError || !data ? <Notice tone="danger">The season leaderboard couldn’t load. <Button variant="secondary" size="compact" onClick={() => void board.refetch()}>Try again</Button></Notice>
      : data.me !== null && !data.me.optedIn ? <>
          {/* Not on the board yet: the opt-in prompt replaces the list. */}
          <Panel className="season-board-optin">
            <h3>Your season, at a glance</h3>
            <p>See how your season is going. Names show as first name + last initial — joining is your choice, and you can hide yourself anytime.</p>
            <Button onClick={() => optIn.mutate(true)} disabled={optIn.isPending}>{optIn.isPending ? "Joining…" : "Show me on the board"}</Button>
            {optIn.isError && <Notice tone="danger">Couldn’t update your choice. Try again.</Notice>}
          </Panel>
        </> : <>
          <div className="season-board-toggle" role="group" aria-label="Leaderboard period">
            <button type="button" aria-pressed={mode === "season"} onClick={() => setMode("season")}>Season</button>
            <button type="button" aria-pressed={mode === "week"} onClick={() => setMode("week")}>This week</button>
          </div>

          {data.me && myEntry && <YourRankCard data={data} mode={mode} rank={myIndex + 1} xp={modeXp(myEntry, mode)} above={above} aboveXp={above ? modeXp(above, mode) : null} />}

          {sorted.length === 0 ? <Panel className="season-board-empty">
            <h3>No scores yet — be the first on the board</h3>
            <p>Practice a passage to open the season leaderboard.</p>
            <LinkButton to={trainingLink("/student/study", seasonId)}>Start practice</LinkButton>
          </Panel> : <>
            <ol className="season-board-list">
              {sorted.map((entry, index) => <BoardRow key={entry.userId} entry={entry} rank={index + 1} mode={mode} isMe={data.me?.userId === entry.userId} />)}
            </ol>
            <p className="season-board-note">{data.me === null
              ? "Every student assigned in this season is shown."
              : "Only teammates who joined the board are shown. Names show as first name + last initial."}</p>
            {data.me && <Button variant="ghost" size="compact" onClick={() => optIn.mutate(false)} disabled={optIn.isPending}>{optIn.isPending ? "Updating…" : "Hide me from the board"}</Button>}
            {optIn.isError && <Notice tone="danger">Couldn’t update your choice. Try again.</Notice>}
          </>}
        </>}
  </div>;
}

function YourRankCard({ data, mode, rank, xp, above, aboveXp }: {
  data: SeasonLeaderboardResponse;
  mode: BoardMode;
  rank: number;
  xp: number;
  above?: SeasonLeaderboardEntry;
  aboveXp: number | null;
}) {
  const me = data.me!;
  const nextLevelXp = me.totalXp + me.xpForNext;
  return <Panel className="season-board-your-rank" data-testid="season-board-your-rank">
    <div className="season-board-yr-top">
      <div>
        <p className="season-board-yr-label">Your rank</p>
        <div className="season-board-yr-rank">#{rank}</div>
      </div>
      <div className="season-board-yr-xp">
        <div className="season-board-yr-xp-num">{xp} XP</div>
        <div className="season-board-yr-xp-cap">{mode === "season" ? "this season" : "this week"}</div>
      </div>
    </div>
    {above && aboveXp !== null
      ? <p className="season-board-yr-note"><strong>{aboveXp - xp} XP</strong> behind {above.displayName} — one strong practice day catches up.</p>
      : <p className="season-board-yr-note">You’re leading {mode === "season" ? "the season" : "the week"} — keep it going.</p>}
    {me.xpForNext > 0 ? <>
      <div className="season-board-yr-meter-head">
        <span className="season-board-yr-meter-label">Progress to next rank — <b>{me.nextLevelName}</b></span>
        <span className="season-board-yr-meter-xp">{me.totalXp} / {nextLevelXp} XP</span>
      </div>
      <div className="season-board-yr-meter" role="img" aria-label={`${me.totalXp} of ${nextLevelXp} XP toward the next rank`}>
        <div className="season-board-yr-meter-fill" style={{ width: `${Math.min(100, Math.max(0, (me.xpIntoLevel / (me.xpIntoLevel + me.xpForNext)) * 100))}%` }} />
      </div>
    </> : <p className="season-board-yr-note">Top rank reached — {me.levelName}.</p>}
    <div className="season-board-yr-chips">
      <span className="season-board-chip">Level {me.level} · {me.levelName}</span>
      {me.streak > 0 && <span className="season-board-chip"><AppIcon name="flame" />{me.streak}-day streak</span>}
    </div>
  </Panel>;
}

function BoardRow({ entry, rank, mode, isMe }: { entry: SeasonLeaderboardEntry; rank: number; mode: BoardMode; isMe: boolean }) {
  const xp = modeXp(entry, mode);
  return <li className={isMe ? "is-me" : ""} data-testid={`season-board-row-${rank}`}>
    {rank <= 3
      ? <span className={`season-board-medal medal-${rank}`} aria-label={`Position ${rank}`}>{rank}</span>
      : <span className="season-board-rank" aria-label={`Position ${rank}`}>{rank}</span>}
    <div className="season-board-who">
      <div className="season-board-name-line">
        <span className="season-board-name">{entry.displayName}</span>
        {isMe && <Badge tone="info">You</Badge>}
      </div>
      <div className="season-board-meta">
        <span className="season-board-level">Level {entry.level} · {entry.levelName}</span>
        {entry.streak >= 3 && <span className="season-board-streak"><AppIcon name="flame" />{entry.streak}</span>}
      </div>
      <div className="season-board-sub">{mode === "season" ? `+${entry.weekXp} XP this week` : `${entry.seasonXp} XP this season`}</div>
    </div>
    <div className="season-board-xp"><strong>{xp}</strong><span>XP</span></div>
  </li>;
}
