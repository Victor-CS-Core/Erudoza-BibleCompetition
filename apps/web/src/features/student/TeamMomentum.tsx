import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../auth/AuthContext";
import { api } from "../../api/client";
import { Badge, Button, LinkButton, LoadingState, Notice, Panel } from "../../components/ui";
import { AppIcon } from "../../components/AppIcon";
import { ChaseBar, LevelCrest } from "../../components/game/GameLayer";
import { trainingLink } from "./trainingAssets";
import type { LeaderboardResponse } from "../../api/types";

/**
 * Gamification Phase 3 §4 — peer momentum. The activity strip shows counts
 * only (never names); the leaderboard is opt-in for students and shows masked
 * names. Coaches see the full board with full names.
 */

function useTeamActivity() {
  const { me } = useAuth();
  const identity = [me?.organizationId, me?.userId];
  return useQuery({ queryKey: ["team-activity", ...identity], queryFn: () => api.teamActivity(), enabled: !!me, staleTime: 60_000 });
}

export function TeamActivityStrip() {
  const activity = useTeamActivity();
  if (activity.isPending) return <LoadingState label="Loading team activity…" />;
  if (activity.isError || !activity.data) return null;
  const { practicedToday, practicedThisWeek, memberCount } = activity.data;
  const dots = Math.min(3, practicedThisWeek);
  return <Panel className="team-activity-strip" data-testid="team-activity-strip">
    <div className="team-activity-copy">
      <AppIcon name="users" />
      <p>
        {practicedThisWeek === 0
          ? <>Be the first on your team to practice today — your teammates will see the momentum.</>
          : <><strong>{practicedThisWeek} {practicedThisWeek === 1 ? "teammate" : "teammates"}</strong> practiced this week{practicedToday > 0 && <span> · <strong>{practicedToday}</strong> today</span>}</>}
      </p>
    </div>
    {dots > 0 && <div className="team-dots" aria-hidden="true">{Array.from({ length: dots }, (_, i) => <span key={i} className="team-dot" />)}</div>}
    {memberCount > 1 && <small className="ds-caption">{memberCount} Pathfinders on your team</small>}
  </Panel>;
}

function useLeaderboard() {
  const { me } = useAuth();
  const identity = [me?.organizationId, me?.userId];
  return useQuery({ queryKey: ["leaderboard", ...identity], queryFn: () => api.leaderboard(me!.organizationId!), enabled: !!me?.organizationId, staleTime: 60_000 });
}

function useOptInMutation() {
  const { me } = useAuth();
  const client = useQueryClient();
  const identity = [me?.organizationId, me?.userId];
  return useMutation({
    mutationFn: (optIn: boolean) => api.setLeaderboardOptIn(optIn),
    onSuccess: () => { void client.invalidateQueries({ queryKey: ["leaderboard", ...identity] }); },
  });
}

function OptInPrompt({ season = false, onOptIn }: { season?: boolean; onOptIn?: (next: boolean) => void } = {}) {
  const optIn = useOptInMutation();
  const pending = optIn.isPending;
  const failed = optIn.isError;
  return <div className="leaderboard-optin">
    <p>{season
      ? "See how your season is going. Names show as first name + last initial — joining is your choice, and you can hide yourself anytime."
      : "See how your team’s week is going. Names show as first name + last initial — joining is your choice, and you can hide yourself anytime."}</p>
    <Button onClick={() => onOptIn ? onOptIn(true) : optIn.mutate(true)} disabled={pending}>{pending ? "Joining…" : season ? "Show me on the board" : "Show me on the team board"}</Button>
    {failed && <Notice tone="danger">Couldn’t update your choice. Try again.</Notice>}
  </div>;
}

function BoardRows({ board }: { board: LeaderboardResponse }) {
  const top = board.entries.slice(0, 5);
  return <ol className="leaderboard-list">
    {top.map((entry, index) => <li key={entry.userId} className={board.me?.userId === entry.userId ? "is-me" : ""} data-testid={`leaderboard-row-${index + 1}`}>
      <span className="leaderboard-rank" aria-label={`Position ${index + 1}`}>{index + 1}</span>
      <span className="leaderboard-name">{entry.displayName}{board.me?.userId === entry.userId && <Badge tone="info">You</Badge>}</span>
      <span className="leaderboard-xp"><strong>{entry.xp}</strong> XP</span>
      <Badge tone="neutral">Level {entry.level}</Badge>
    </li>)}
  </ol>;
}

/**
 * The HQ leaderboard surface: the season board at mini size — podium strip,
 * your chase row, and the team-activity line as a quiet footer. This replaced
 * the old weekly "Team leaderboard" card and the separate TeamActivityStrip
 * panel on HQ: one board, one name, one team surface.
 */
function SeasonLeaderboardMini({ seasonId }: { seasonId: string }) {
  const { me } = useAuth();
  const client = useQueryClient();
  const board = useQuery({
    queryKey: ["season-leaderboard", me?.organizationId, seasonId, me?.userId],
    queryFn: () => api.seasonLeaderboard(me!.organizationId!, seasonId),
    enabled: !!me?.organizationId,
    staleTime: 60_000,
  });
  const activity = useTeamActivity();
  const optIn = useMutation({
    mutationFn: (next: boolean) => api.setLeaderboardOptIn(next),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["season-leaderboard", me?.organizationId, seasonId, me?.userId] });
      void client.invalidateQueries({ queryKey: ["leaderboard", me?.organizationId, me?.userId] });
    },
  });
  const data = board.data;
  const sorted = data ? [...data.entries].sort((a, b) => b.seasonXp - a.seasonXp || a.displayName.localeCompare(b.displayName)) : [];
  const top = sorted.slice(0, 3);
  const myIndex = data?.me ? sorted.findIndex(entry => entry.userId === data.me!.userId) : -1;
  const myEntry = myIndex >= 0 ? sorted[myIndex] : undefined;
  const above = myIndex > 0 ? sorted[myIndex - 1] : undefined;
  const raceNotStarted = !sorted.length || sorted[0].seasonXp <= 0;
  const act = activity.data;
  return <Panel className="leaderboard-card game-leaderboard-mini" data-testid="leaderboard-card">
    <div className="training-panel-title"><div className="training-streak-title"><AppIcon name="chart" /><h2>Season leaderboard</h2></div>{data && <Badge tone="neutral">{data.seasonName}</Badge>}</div>
    {board.isPending ? <LoadingState label="Loading the leaderboard…" /> : board.isError || !data ? <Notice tone="danger">The leaderboard couldn’t load. <Button variant="secondary" size="compact" onClick={() => void board.refetch()}>Try again</Button></Notice> :
      data.me !== null && !data.me.optedIn ? <OptInPrompt season onOptIn={next => optIn.mutate(next)} /> : <>
        {raceNotStarted ? <p data-testid="leaderboard-mini-zero">The race is about to start — be the first on the board.</p> : <>
          <ol className="game-leaderboard-mini__strip" aria-label="Top of the season leaderboard">
            {top.map((entry, index) => <li key={entry.userId} className={data.me?.userId === entry.userId ? "is-me" : ""} data-testid={`leaderboard-mini-row-${index + 1}`}>
              <span className="leaderboard-rank" aria-label={`Position ${index + 1}`}>{index + 1}</span>
              <LevelCrest level={entry.level} levelName={entry.levelName} />
              <span className="game-leaderboard-mini__name">{entry.displayName}{data.me?.userId === entry.userId && <Badge tone="info">You</Badge>}</span>
              <span className="game-leaderboard-mini__xp">{entry.seasonXp} XP</span>
            </li>)}
          </ol>
          {data.me && myEntry && (above
            ? <ChaseBar value={myEntry.seasonXp} max={above.seasonXp} ariaLabel={`Your ${myEntry.seasonXp} XP compared with ${above.displayName}'s ${above.seasonXp} XP`} caption={<>You’re <strong>#{myIndex + 1}</strong> — <strong>{above.seasonXp - myEntry.seasonXp} XP</strong> behind {above.displayName}.</>} />
            : <p className="game-chase-bar__caption">You’re <strong>#{myIndex + 1}</strong> — leading the season. Keep it going.</p>)}
          {data.me && !myEntry && <p className="game-chase-bar__caption">You have {data.me.seasonXp} XP this season.</p>}
        </>}
        <div className="game-leaderboard-mini__actions">
          <LinkButton variant="ghost" size="compact" to={trainingLink("/student/leaderboard", seasonId)}>See full board<AppIcon name="arrow" /></LinkButton>
          {data.me && <Button variant="ghost" size="compact" onClick={() => optIn.mutate(false)} disabled={optIn.isPending}>{optIn.isPending ? "Updating…" : "Hide me from the board"}</Button>}
        </div>
        {optIn.isError && <Notice tone="danger">Couldn’t update your choice. Try again.</Notice>}
        {act && <p className="game-leaderboard-mini__footer" data-testid="leaderboard-mini-team-line"><AppIcon name="users" /><span>{act.practicedThisWeek === 0
          ? "Be the first on your team to practice today — your teammates will see the momentum."
          : <><strong>{act.practicedThisWeek} {act.practicedThisWeek === 1 ? "teammate" : "teammates"}</strong> practiced this week{act.practicedToday > 0 && <> · <strong>{act.practicedToday}</strong> today</>}</>}{act.memberCount > 1 && <> · {act.memberCount} Pathfinders on your team</>}</span></p>}
      </>}
  </Panel>;
}

export function LeaderboardCard({ seasonId }: { seasonId?: string | null } = {}) {
  if (seasonId) return <SeasonLeaderboardMini seasonId={seasonId} />;
  return <WeeklyLeaderboardCard />;
}

function WeeklyLeaderboardCard() {
  const board = useLeaderboard();
  const optIn = useOptInMutation();
  const fullBoard = null;
  return <Panel className="leaderboard-card" data-testid="leaderboard-card">
    <div className="training-panel-title"><div className="training-streak-title"><AppIcon name="chart" /><h2>Team leaderboard</h2></div>{board.data && <Badge tone="neutral">This week</Badge>}</div>
    {board.isPending ? <LoadingState label="Loading the leaderboard…" /> : board.isError || !board.data ? <Notice tone="danger">The leaderboard couldn’t load. <Button variant="secondary" size="compact" onClick={() => void board.refetch()}>Try again</Button></Notice> :
      board.data.me === null ? <>
        {/* Coach view: full board, full names. */}
        {board.data.entries.length === 0 ? <p>No practice recorded this week yet.</p> : <BoardRows board={board.data} />}
        {fullBoard}
      </> : !board.data.me.optedIn ? <OptInPrompt /> : <>
        {board.data.entries.length === 0 ? <p>No teammates have joined the board yet — you’re first.</p> : <BoardRows board={board.data} />}
        {board.data.me.rank !== null && board.data.me.rank > 5 && <p className="leaderboard-own-rank">You’re <strong>#{board.data.me.rank}</strong> with {board.data.me.xp} XP this week.</p>}
        {board.data.me.rank === null && <p className="leaderboard-own-rank">You have {board.data.me.xp} XP this week.</p>}
        {fullBoard}
        <Button variant="ghost" size="compact" onClick={() => optIn.mutate(false)} disabled={optIn.isPending}>{optIn.isPending ? "Updating…" : "Hide me from the board"}</Button>
        {optIn.isError && <Notice tone="danger">Couldn’t update your choice. Try again.</Notice>}
      </>}
  </Panel>;
}
