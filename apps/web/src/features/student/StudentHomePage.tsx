import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { api } from "../../api/client";
import { trainingApi } from "../../api/training";
import { AppIcon } from "../../components/AppIcon";
import { LandscapeBanner } from "../../components/brand/LandscapeBanner";
import { Badge, Button, HonorArtwork, LinkButton, LoadingState, Notice, Panel, Select } from "../../components/ui";
import { PatchDisplay, PlayerCard, QuestCard, StatTile, nextLevelName } from "../../components/game/GameLayer";
import { PbeJourney } from "./PassageJourney";
import { PassagePicker } from "./PassagePicker";
import { AssignedPassages } from "./AssignedPassages";
import { SeasonCoveragePanel } from "./SeasonCoverage";
import { WeeklyGoalDialog } from "./WeeklyGoalDialog";
import { LeaderboardCard } from "./TeamMomentum";
import { academyActivityName, academyRecentExactPercent, canStartAcademyTrack } from "./academyTracks";
import { honorAsset, trainingLink } from "./trainingAssets";
import "./student.css";
export function StudentHomePage() {
  const { me } = useAuth();
  const [params, setParams] = useSearchParams();
  const [goalOpen, setGoalOpen] = useState(false);
  const selected = params.get("seasonId") || undefined;
  const identity = [me?.organizationId, me?.userId];
  const seasons = useQuery({ queryKey: ["assigned-seasons", ...identity], queryFn: () => api.assignedSeasons() });
  const today = useQuery({ queryKey: ["training-today", selected, ...identity], queryFn: () => trainingApi.today(selected) });
  const data = today.data;
  const seasonId = selected ?? data?.seasonId;
  // Your progress lives on HQ now (the standalone Progress page was retired):
  // the same /progress/me read the old page used, driving the progress beat below.
  const progress = useQuery({ queryKey: ["progress", seasonId, undefined, me?.organizationId, me?.userId], queryFn: () => api.progress(seasonId ?? undefined), enabled: !!data });
  const progressData = progress.data;
  useEffect(() => { if (me?.kind === "Adult" && !selected && data?.seasonId) setParams(previous => { const next = new URLSearchParams(previous); next.set("seasonId", data.seasonId!); return next; }, { replace: true }); }, [me?.kind, selected, data?.seasonId, setParams]);
  const link = (path: string) => trainingLink(path, seasonId);
  const firstName = me?.displayName?.trim().split(/\s+/)[0];
  const available = data?.seasonStatus === "Active" && data.mission.status !== "Unavailable" && data.mission.status !== "Invalidated";
  const action = data?.nextAction;
  const nextHonor = data?.honors.filter(honor => !honor.earnedAtUtc && honor.target > 0).sort((a, b) => b.completed / b.target - a.completed / a.target)[0];
  const completedSessionId = data?.mission.status === "Complete" ? [...data.mission.steps].reverse().find(step => step.status === "Complete" && step.sessionId)?.sessionId : null;
  const nextStep = data?.mission.steps.find(step => step.kind === action?.mode);
  const todayCredited = data?.week.days.some(day => day.isToday && day.credited);
  const study = (mode: string, sessionId: string | null, mission = false) => {
    const search = new URLSearchParams({ mode });
    if(data?.format)search.set("format",data.format);
    if (sessionId) search.set("sessionId", sessionId);
    if (mission && (mode === "Review" || mode === "Practice")) {
      search.set("step", mode);
      if (data?.mission.status !== "Invalidated" && data?.mission.id && data.mission.revision !== null) { search.set("missionId", data.mission.id); search.set("missionRevision", String(data.mission.revision)); }
    }
    return link(`/student/study?${search}`);
  };
  const recent = progressData?.recentAttempts ?? [];
  return <div className="training-dashboard student-home">
    <PlayerCard
      className="training-hq-hero"
      background={<LandscapeBanner className="training-hq-banner" priority />}
      title="Welcome to your PBE training HQ"
      titleId="training-hq-title"
      description={firstName ? `Ready when you are, ${firstName} — here is your Scripture to review and your plan for today.` : "Review your assigned Scripture and prepare for team practice."}
      name={me?.displayName ?? (firstName ? `${firstName}` : "You")}
      avatar={null}
      xp={data ? { total: data.xp.total, xpIntoLevel: data.xp.xpIntoLevel, xpForNext: data.xp.xpForNext, nextLevelName: nextLevelName(data.xp.level), level: data.xp.level, levelName: data.xp.levelName } : null}
      streak={data?.streak?.current}
      streakState={data ? (data.streakNudge || data.streak?.state === "paused" ? "paused" : data.streak?.state === "active" ? "active" : "none") : undefined}
      seasonLabel={data ? <span data-testid="current-season">{data.seasonName || "Not assigned"} · {data.seasonStatus === "None" ? "Awaiting assignment" : data.seasonStatus}</span> : undefined}
      formatLabel={data?.format ? (data.format === "Pbe" ? "PBE questions" : "Memory format") : undefined}
    >
      {data?.format === "Pbe" && <Link className="training-format-switch" to={link("/student/study?mode=Practice&format=Memory")}>Choose Memory</Link>}
    </PlayerCard>
    {(seasons.data?.length ?? 0) > 1 && <label className="training-season-select">Assigned season<Select value={seasonId ?? ""} onChange={event => { setGoalOpen(false); setParams({ seasonId: event.target.value }); }}>{seasons.data?.map(season => <option key={season.id} value={season.id}>{season.name}</option>)}</Select></label>}
    {seasons.isError && <Notice tone="danger">Assigned seasons could not load. <Button variant="secondary" onClick={() => void seasons.refetch()}>Retry seasons</Button></Notice>}
    {today.isPending ? <LoadingState label="Loading your training plan…" /> : today.isError ? <Notice tone="danger">Your training plan could not load. <Button variant="secondary" onClick={() => void today.refetch()}>Try again</Button></Notice> : data && <>
      {seasonId ? <AssignedPassages seasonId={seasonId} seasonName={data.seasonName} seasonStatus={data.seasonStatus} mastery={progressData?.mastery} /> : <Panel className="training-assigned-passages"><div className="training-panel-title"><h2>Your assigned passages</h2></div><p>Nothing assigned yet. When your coach adds passages, they will show up here.</p></Panel>}
      <div className="training-hq-grid">
        <Panel className="training-this-week game-quest-board">
          <div className="training-panel-title"><div className="training-streak-title"><AppIcon name="flame" /><h2>This week</h2></div><Badge tone={todayCredited ? "success" : "neutral"}>{todayCredited ? "Practiced today" : "Not yet today"}</Badge></div>
          {data.streak && <section aria-label="Practice streak">
            <p className="training-week-count" aria-label={`${data.streak.current} day practice streak`}><strong>{data.streak.current} <span>{data.streak.current === 1 ? "day" : "days"}</span></strong><span>in a row</span></p>
            <div className="training-streak-heatmap is-weekly" role="img" aria-label={`This week: ${data.week.days.filter(day => day.credited).length} of ${data.week.days.length} days practiced`}>
              {data.week.days.map(day => <span key={day.localDate} title={`${day.localDate}${day.credited ? " \u00b7 practiced" : ""}${day.isToday ? " \u00b7 today" : ""}`} className={`${day.credited ? "is-credited" : ""}${day.isToday ? " is-today" : ""}`} />)}
            </div>
            <p>{data.streak.state === "active" ? "Keep it going \u2014 practice today to extend it." : data.streak.state === "paused" ? "Paused, not lost. Practice today to keep your streak alive." : "Practice today to start your first streak."}</p>
            {data.streak.best > data.streak.current && <p><small>Best streak: {data.streak.best} {data.streak.best === 1 ? "day" : "days"}</small></p>}
          </section>}
          <section aria-label="Weekly practice goal">
            <div className="training-panel-title"><h3>Weekly practice goal</h3><Button variant="ghost" size="compact" aria-label="Edit weekly goal" onClick={() => setGoalOpen(true)}>Edit goal</Button></div>
            <p className="training-week-count" aria-label={`${data.week.completedDays} of ${data.week.target} practice days`}><strong>{data.week.completedDays} <span>of</span> {data.week.target}</strong><span>practice days this week</span></p>
            <p>{todayCredited ? "Today counts toward your weekly practice goal." : "Complete today\u2019s practice to count toward your weekly goal."}</p>
            {data.preferences.pending && <p>Next week: {data.preferences.pending.weeklyTarget} days.</p>}
          </section>
          {!!data.quests.length && <section aria-label="Bonus quests">
            <div className="training-panel-title"><h3>Today’s bonus quests</h3></div>
            <p className="training-quest-note">Little extras — no penalty for skipping.</p>
            <ul className="training-quest-list">{data.quests.map(quest => <QuestCard key={quest.key} quest={quest} />)}</ul>
            <div className="game-triple-meter">
              <div className="game-triple-meter__segments" aria-hidden="true">{data.quests.map(quest => <span key={quest.key} className={quest.completed ? "is-done" : ""} />)}</div>
              <p>{data.quests.filter(quest => quest.completed).length} of {data.quests.length} done</p>
              <p><small>Finish all three for a +25 XP triple bonus.</small></p>
            </div>
          </section>}
          <section aria-label="Next milestone">
            <div className="training-panel-title"><h3>{nextHonor ? "Your next milestone" : "Practice milestones"}</h3><Link to={link("/student/honors")}>View Achievement patches and requirements<AppIcon name="arrow" /></Link></div>
            {nextHonor ? <PatchDisplay variant="teaser" title={nextHonor.title} artwork={<HonorArtwork {...honorAsset(nextHonor.key)} size={72} muted />} requirement={nextHonor.scopeLabel} completed={nextHonor.completed} target={nextHonor.target} /> : <p>Keep practicing — your next milestone shows up here when you are close.</p>}
          </section>
        </Panel>
        <aside className="training-hq-aside">
          <LeaderboardCard seasonId={seasonId} />
        </aside>
      </div>
      {progress.isPending ? <Panel aria-busy="true"><LoadingState label="Loading progress…" /></Panel> : progress.isError ? <Notice tone="danger">Progress could not load. <Button variant="secondary" onClick={() => void progress.refetch()}>Try again</Button></Notice> : progressData && <>
        <Panel data-testid="progress-top-folio">
          <details className="progress-disclosure">
            <summary><h2>Your activity so far</h2></summary>
            <dl className="game-stat-grid">
              <StatTile label="Attempts" value={progressData.attemptCount} testId="progress-attempts" />
              <StatTile label="Verses mastered" value={progressData.masteredCount} />
              <StatTile label="Due reviews" value={progressData.reviewDueCount} testId="progress-reviews" />
              <StatTile label="Recent correct" value={academyRecentExactPercent(progressData.recentAttempts)} testId="progress-recent" />
            </dl>
            <h3>Recent attempts</h3>
            <ul className="training-list student-progress-records" data-testid="recent-attempts">{recent.length ? recent.map(item => <li key={item.id}>
              <div><h3>{item.title}</h3><p>{academyActivityName(item.activityType)} · <time dateTime={item.createdAtUtc}>{new Date(item.createdAtUtc).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</time></p><p className="er-scripture">{item.submittedAnswer || "—"}</p></div>
              <Badge tone={item.isCorrect ? "success" : "warning"}>{item.isCorrect ? "Correct" : "Keep practicing"}</Badge>
            </li>) : <li><div><p>Nothing here yet — your answers show up after your first session.</p>{canStartAcademyTrack("learner", progressData) && progressData.assignments.length > 0 && <LinkButton size="compact" to={`/student/study?seasonId=${encodeURIComponent(progressData.seasonId)}`}>Start your first study session</LinkButton>}</div></li>}</ul>
          </details>
        </Panel>
      </>}
      {seasonId && data.format === 'Pbe' && <PbeJourney key={`pbe:${seasonId}`} seasonId={seasonId} preview={false} />}
      {seasonId && <PassagePicker key={`picker:${seasonId}`} seasonId={seasonId} mastery={progressData?.mastery} difficulty={progressData?.assignments.find(a => a.difficulty)?.difficulty} />}
      {seasonId && data.format === 'Pbe' && <SeasonCoveragePanel key={`cooperation:${seasonId}`} seasonId={seasonId} audience="student" />}
      <Panel className="training-mission">
        <div className="training-mission-main">
          <h2>{data.mission.status === "Complete" ? "Today’s practice is complete." : available ? "Practice your assigned Scripture." : "Your training assignment"}</h2>
          <p className="training-mission-description">{data.mission.explanation || (data.mission.status === "Complete" ? `${firstName ? `${firstName}, you` : "You"}’ve finished today’s reviews and practice. Everything is saved.` : "Review missed answers, then practice recalling your assigned Scripture.")}</p>
          {available && nextStep && <p className="training-mission-scope"><AppIcon name="book" /><span>{nextStep.target} {nextStep.kind === "Review" ? "due passages" : "cards"} · Your assigned passages</span></p>}
          {progressData && progressData.reviewDueCount > 0 && <p className="training-mission-due"><Badge tone="warning" aria-label="DUE">{progressData.reviewDueCount} {progressData.reviewDueCount === 1 ? "review" : "reviews"} due</Badge>{canStartAcademyTrack("review", progressData) && <LinkButton size="compact" to={`/student/study?mode=Review&seasonId=${encodeURIComponent(progressData.seasonId)}`}>Start due reviews</LinkButton>}</p>}
          {!available && <Notice data-testid="academy-track-unavailable">{data.mission.status === "Invalidated" ? "Your passages changed. Start updated training to build a plan around the new ones." : data.seasonStatus !== "Active" && data.seasonId ? "Training opens when this season is Active." : (me?.kind === "Adult" ? "Choose your study passages in My assignments." : "Your coach will add your study assignment here.")}</Notice>}
          {!available && me?.kind === "Adult" && <LinkButton to={link("/student/assignments")}>My assignments</LinkButton>}
          {data.seasonStatus === "Active" && data.mission.status === "Invalidated" && action && <LinkButton to={study(action.mode, null, true)}>Start updated training<AppIcon name="arrow" /></LinkButton>}
          {completedSessionId && <LinkButton to={link(`/student/sessions/${encodeURIComponent(completedSessionId)}/recap`)}>See today’s recap<AppIcon name="arrow" /></LinkButton>}
          {available && !completedSessionId && action && <LinkButton data-testid="start-todays-deck" to={study(action.mode, action.sessionId, true)}>{action.label}<AppIcon name="arrow" /></LinkButton>}
          {available && <LinkButton variant="secondary" data-testid="start-simulation" to={study("Simulation", null)}>{data.format === "Pbe" ? "Start solo timed rehearsal" : "Start rehearsal"}</LinkButton>}
        </div>
        {!!data.mission.steps.length && <ol className="training-mission-steps">{data.mission.steps.map((step, index) => {
          const resolved = step.status === "Complete" || step.status === "NotNeeded";
          return <li key={step.kind}>
            <span className={`training-step-dot${resolved ? " is-complete" : step.kind === action?.mode ? " is-next" : ""}`} aria-hidden="true">{resolved ? <AppIcon name="check" /> : index + 1}</span>
            <div><h3>{step.kind === "Review" ? "Refresh your memory" : "Practice your passage"}</h3><p>{step.status === "NotNeeded" ? "No review needed today" : `${step.completed} of ${step.target} ${step.kind === "Review" ? "passages" : "cards"} completed`}</p></div>
            <span className="training-step-state">{step.status === "NotNeeded" ? "Up to date" : step.status === "Complete" ? "Done" : step.status === "Active" ? "In progress" : step.status === "Invalidated" ? "Changed" : ""}</span>
          </li>;
        })}</ol>}
      </Panel>
      {goalOpen && <WeeklyGoalDialog preferences={data.preferences} onClose={() => setGoalOpen(false)} />}
    </>}
  </div>;
}
