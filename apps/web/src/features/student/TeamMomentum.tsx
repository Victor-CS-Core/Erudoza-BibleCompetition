import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../auth/AuthContext";
import { api } from "../../api/client";
import { Badge, Button, LoadingState, Notice, Panel } from "../../components/ui";
import { AppIcon } from "../../components/AppIcon";
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

function OptInPrompt() {
  const optIn = useOptInMutation();
  return <div className="leaderboard-optin">
    <p>See how your team’s week is going. Only first names show — joining is your choice, and you can hide yourself anytime.</p>
    <Button onClick={() => optIn.mutate(true)} disabled={optIn.isPending}>{optIn.isPending ? "Joining…" : "Show me on the team board"}</Button>
    {optIn.isError && <Notice tone="danger">Couldn’t update your choice. Try again.</Notice>}
  </div>;
}

function BoardRows({ board }: { board: LeaderboardResponse }) {
  const top = board.entries.slice(0, 5);
  return <ol className="leaderboard-list">
    {top.map((entry, index) => <li key={entry.userId} className={board.me?.userId === entry.userId ? "is-me" : ""} data-testid={`leaderboard-row-${index + 1}`}>
      <span className="leaderboard-rank" aria-label={`Position ${index + 1}`}>{index + 1}</span>
      <span className="leaderboard-name">{entry.displayName}{board.me?.userId === entry.userId && <Badge tone="info">You</Badge>}</span>
      <span className="leaderboard-xp"><strong>{entry.xp}</strong> XP</span>
      <Badge tone="neutral">Rank {entry.level}</Badge>
    </li>)}
  </ol>;
}

export function LeaderboardCard() {
  const board = useLeaderboard();
  const optIn = useOptInMutation();
  return <Panel className="leaderboard-card" data-testid="leaderboard-card">
    <div className="training-panel-title"><div className="training-streak-title"><AppIcon name="chart" /><h2>Team leaderboard</h2></div>{board.data && <Badge tone="neutral">This week</Badge>}</div>
    {board.isPending ? <LoadingState label="Loading the leaderboard…" /> : board.isError || !board.data ? <Notice tone="danger">The leaderboard couldn’t load. <Button variant="secondary" size="compact" onClick={() => void board.refetch()}>Try again</Button></Notice> :
      board.data.me === null ? <>
        {/* Coach view: full board, full names. */}
        {board.data.entries.length === 0 ? <p>No practice recorded this week yet.</p> : <BoardRows board={board.data} />}
      </> : !board.data.me.optedIn ? <OptInPrompt /> : <>
        {board.data.entries.length === 0 ? <p>No teammates have joined the board yet — you’re first.</p> : <BoardRows board={board.data} />}
        {board.data.me.rank !== null && board.data.me.rank > 5 && <p className="leaderboard-own-rank">You’re <strong>#{board.data.me.rank}</strong> with {board.data.me.xp} XP this week.</p>}
        {board.data.me.rank === null && <p className="leaderboard-own-rank">You have {board.data.me.xp} XP this week.</p>}
        <Button variant="ghost" size="compact" onClick={() => optIn.mutate(false)} disabled={optIn.isPending}>{optIn.isPending ? "Updating…" : "Hide me from the board"}</Button>
        {optIn.isError && <Notice tone="danger">Couldn’t update your choice. Try again.</Notice>}
      </>}
  </Panel>;
}
