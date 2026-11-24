import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { api } from "../../api/client";
import { Badge, Button, LinkButton, LoadingState, Notice, Panel } from "../../components/ui";
import { AppIcon } from "../../components/AppIcon";
import { ChaseBar, EntryAvatar, LevelCrest, PlayerCard, Podium } from "../../components/game/GameLayer";
import { trainingLink } from "./trainingAssets";
import type { SeasonLeaderboardEntry, SeasonLeaderboardResponse } from "../../api/types";
import "./student.css";

type BoardMode = "season" | "week";
const modeXp = (entry: SeasonLeaderboardEntry, mode: BoardMode) => mode === "season" ? entry.seasonXp : entry.weekXp;
const modeSub = (entry: SeasonLeaderboardEntry, mode: BoardMode) => mode === "season" ? `+${entry.weekXp} XP this week` : `${entry.seasonXp} XP this season`;

/**
 * Season leaderboard — the one board, at full size. Membership is the season
 * (students assigned in it), ranking is season XP with a This-week toggle,
 * and privacy matches the HQ mini: students opt in and see masked names;
 * coaches see every member with full names. The top three stand on a podium;
 * every row carries a race bar scaled to the leader; your pinned position is
 * a PlayerCard with an XPBar and a ChaseBar to the person directly above.
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
  const leaderXp = sorted.length ? modeXp(sorted[0], mode) : 0;
  // "Scored" is per active mode: a member with season XP but no XP this week
  // has not scored on the This week board. The podium seats only scorers.
  const scored = sorted.filter(entry => modeXp(entry, mode) > 0);
  const raceNotStarted = scored.length === 0;

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

          {data.me && myEntry && <YourPosition data={data} mode={mode} rank={myIndex + 1} entry={myEntry} xp={modeXp(myEntry, mode)} above={above} aboveXp={above ? modeXp(above, mode) : null} />}

          {raceNotStarted ? <ZeroState entries={sorted} seasonId={seasonId} mode={mode} /> : <>
            <Podium
              entries={scored.map(entry => ({ userId: entry.userId, displayName: entry.displayName, xp: modeXp(entry, mode), avatar: entry.avatar }))}
              isMe={entry => data.me?.userId === entry.userId}
              modeLabel={mode === "season" ? "Season" : "This week"}
              fillGhosts
            />
            <ol className="season-board-list">
              {sorted.map((entry, index) => <BoardRow key={entry.userId} entry={entry} rank={index + 1} mode={mode} leaderXp={leaderXp} isMe={data.me?.userId === entry.userId} />)}
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

function YourPosition({ data, mode, rank, entry, xp, above, aboveXp }: {
  data: SeasonLeaderboardResponse;
  mode: BoardMode;
  rank: number;
  entry: SeasonLeaderboardEntry;
  xp: number;
  above?: SeasonLeaderboardEntry;
  aboveXp: number | null;
}) {
  const me = data.me!;
  const period = mode === "season" ? "this season" : "this week";
  return <div data-testid="season-board-your-rank" className="season-board-your-position">
    <PlayerCard
      name={entry.displayName}
      avatar={<EntryAvatar avatar={entry.avatar ?? me.avatar} name={entry.displayName} size="card" />}
      xp={{ total: me.totalXp, xpIntoLevel: me.xpIntoLevel, xpForNext: me.xpForNext, nextLevelName: me.nextLevelName, level: me.level, levelName: me.levelName }}
      streak={me.streak}
      streakState={me.streakState ?? (me.streak > 0 ? "active" : "none")}
    >
      <p className="season-board-yr-rankline"><strong>#{rank}</strong> · {xp} XP {period}</p>
      {above && aboveXp !== null
        ? <ChaseBar value={xp} max={aboveXp} ariaLabel={`Your ${xp} XP compared with ${above.displayName}'s ${aboveXp} XP`} caption={<><strong>{aboveXp - xp} XP</strong> behind {above.displayName} — one strong practice day catches up.</>} />
        : <p className="season-board-yr-note">You’re leading {period} — keep it going.</p>}
      {me.xpForNext > 0
        ? <p className="season-board-yr-progress">Progress to <b>{me.nextLevelName}</b> — {me.totalXp} / {me.totalXp + me.xpForNext} XP</p>
        : <p className="season-board-yr-note">Top level reached — {me.levelName}.</p>}
    </PlayerCard>
  </div>;
}

/**
 * The starting-line panel: before anyone has scored (in the active mode)
 * the wireframe podium does not render at all. One composed card — flag
 * eyebrow, headline, the one explanation line, the roster as proper rows
 * (face, name, level pair, 0 XP), and the Start practice call. The roster
 * caps at ZERO_ROSTER_CAP rows so a big club stays content-sized; the rest
 * fold into a "+N more Pathfinders" line.
 */
export const ZERO_ROSTER_CAP = 8;

export function ZeroState({ entries, seasonId, mode }: { entries: SeasonLeaderboardEntry[]; seasonId?: string; mode: BoardMode }) {
  const shown = entries.slice(0, ZERO_ROSTER_CAP);
  const extra = entries.length - shown.length;
  return <Panel className="season-board-zero" data-testid="season-board-zero">
    <p className="season-board-zero-eyebrow"><span className="season-board-zero-flag"><AppIcon name="flag" /></span> At the starting line</p>
    <h3>The race is about to start</h3>
    {entries.length === 0
      ? <p>No scores yet — be the first on the board</p>
      : <p>Nobody has scored yet {mode === "season" ? "this season" : "this week"} — the first practice session takes the top spot.</p>}
    {entries.length > 0 && <ul className="season-board-zero-line">
      {shown.map(entry => <li key={entry.userId}>
        <EntryAvatar avatar={entry.avatar} name={entry.displayName} />
        <span className="season-board-zero-line__who">
          <span className="season-board-zero-line__name">{entry.displayName}</span>
          <span className="season-board-zero-line__level">Level {entry.level} · {entry.levelName}</span>
        </span>
        <span className="season-board-zero-line__xp">0 XP</span>
      </li>)}
      {extra > 0 && <li className="season-board-zero-line__more">+{extra} more Pathfinders</li>}
    </ul>}
    <LinkButton to={trainingLink("/student/study", seasonId)}>Start practice</LinkButton>
  </Panel>;
}

export function BoardRow({ entry, rank, mode, leaderXp, isMe }: { entry: SeasonLeaderboardEntry; rank: number; mode: BoardMode; leaderXp: number; isMe: boolean }) {
  const xp = modeXp(entry, mode);
  return <li className={isMe ? "is-me" : ""} data-testid={`season-board-row-${rank}`}>
    <span className="season-board-rank" aria-label={`Position ${rank}`}>{rank}</span>
    <LevelCrest level={entry.level} levelName={entry.levelName} />
    <EntryAvatar avatar={entry.avatar} name={entry.displayName} />
    <div className="season-board-who">
      <div className="season-board-name-line">
        <span className="season-board-name">{entry.displayName}</span>
        {isMe && <Badge tone="info">You</Badge>}
      </div>
      <div className="season-board-meta">
        <span className="season-board-level">Level {entry.level} · {entry.levelName}</span>
        {entry.streak >= 3 && <span className="season-board-streak"><AppIcon name="flame" />{entry.streak}</span>}
      </div>
      <div className="season-board-sub">{modeSub(entry, mode)}</div>
      <ChaseBar value={xp} max={leaderXp} ariaLabel={`${entry.displayName}: ${xp} XP compared with the leader's ${leaderXp} XP`} />
    </div>
    <div className="season-board-xp"><strong>{xp}</strong><span>XP</span></div>
  </li>;
}
