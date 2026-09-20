import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { api } from "../../api/client";
import { trainingApi } from "../../api/training";
import { AppIcon } from "../../components/AppIcon";
import { LandscapeBanner } from "../../components/brand/LandscapeBanner";
import { Badge, Button, HonorArtwork, LinkButton, LoadingState, Notice, PageHeader, Panel, ProgressMeter, Select, WeeklyProgressStrip } from "../../components/ui";
import { PassageJourney } from "./PassageJourney";
import { AssignedPassages } from "./AssignedPassages";
import { SeasonCoveragePanel } from "./SeasonCoverage";
import { WeeklyGoalDialog } from "./WeeklyGoalDialog";
import { TeamActivityStrip, LeaderboardCard } from "./TeamMomentum";
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
  useEffect(() => { if (me?.kind === "Adult" && !selected && data?.seasonId) setParams(previous => { const next = new URLSearchParams(previous); next.set("seasonId", data.seasonId!); return next; }, { replace: true }); }, [me?.kind, selected, data?.seasonId, setParams]);
  const link = (path: string) => trainingLink(path, seasonId);
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
  return <div className="training-dashboard student-home">
    <section className="training-hq-hero ds-inverse-surface" aria-labelledby="training-hq-title">
      <LandscapeBanner className="training-hq-banner" priority />
      <div className="training-hq-hero-copy">
        <PageHeader as="div" titleId="training-hq-title" title="Training HQ" description="Review your assigned Scripture and prepare for team practice." />
        {data && <div className="training-hq-season" data-testid="current-season"><small className="ds-caption">Current season</small><strong>{data.seasonName || "Not assigned"}</strong><Badge tone={data.seasonStatus === "Active" ? "success" : "neutral"}>{data.seasonStatus === "None" ? "Awaiting assignment" : data.seasonStatus}</Badge>{data.format && <Badge tone="neutral">{data.format === "Pbe" ? "PBE questions" : "Memory format"}</Badge>}{data.format === "Pbe" && <><Link className="training-format-switch" to={link("/student/study?mode=Practice&format=Memory")}>Choose Memory</Link><small className="ds-caption">Solo timed rehearsal is available.</small></>}</div>}
      </div>
    </section>
    {(seasons.data?.length ?? 0) > 1 && <label className="training-season-select">Assigned season<Select value={seasonId ?? ""} onChange={event => { setGoalOpen(false); setParams({ seasonId: event.target.value }); }}>{seasons.data?.map(season => <option key={season.id} value={season.id}>{season.name}</option>)}</Select></label>}
    {seasons.isError && <Notice tone="danger">Assigned seasons could not load. <Button variant="secondary" onClick={() => void seasons.refetch()}>Retry seasons</Button></Notice>}
    {today.isPending ? <LoadingState label="Loading your training plan…" /> : today.isError ? <Notice tone="danger">Your training plan could not load. <Button variant="secondary" onClick={() => void today.refetch()}>Try again</Button></Notice> : data && <>
      {data.streakNudge && <Notice tone="info" data-testid="streak-nudge" className="training-streak-nudge">One missed day just pauses your streak — practice today to keep it going.</Notice>}
      <TeamActivityStrip />
      <div className="training-hq-grid">
        <div className="training-mission-column">
          <Panel className="training-mission">
            <div className="training-mission-main">
              <h2>{data.mission.status === "Complete" ? "Today’s practice is complete." : available ? "Practice your assigned Scripture." : "Your training assignment"}</h2>
              <p className="training-mission-description">{data.mission.explanation || (data.mission.status === "Complete" ? "You’ve finished today’s reviews and practice. Your answers are saved." : "Review missed answers, then practice recalling your assigned Scripture.")}</p>
              {available && nextStep && <p className="training-mission-scope"><AppIcon name="book" /><span>{nextStep.target} {nextStep.kind === "Review" ? "due passages" : "cards"} · Your assigned passages</span></p>}
              {!available && <Notice data-testid="academy-track-unavailable">{data.mission.status === "Invalidated" ? "Your assignment changed. Start updated training to build a plan for your current assignment." : data.seasonStatus !== "Active" && data.seasonId ? "Training opens when this season is Active." : (me?.kind === "Adult" ? "Choose your study passages in My assignments." : "Your coach will add your study assignment here.")}</Notice>}
              {!available && me?.kind === "Adult" && <LinkButton to={link("/student/assignments")}>My assignments</LinkButton>}
              {data.seasonStatus === "Active" && data.mission.status === "Invalidated" && action && <LinkButton to={study(action.mode, null, true)}>Start updated training<AppIcon name="arrow" /></LinkButton>}
              {completedSessionId && <LinkButton to={link(`/student/sessions/${encodeURIComponent(completedSessionId)}/recap`)}>See today’s recap<AppIcon name="arrow" /></LinkButton>}
              {available && !completedSessionId && action && <LinkButton data-testid="start-todays-deck" to={study(action.mode, action.sessionId, true)}>{action.label}<AppIcon name="arrow" /></LinkButton>}
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
          <p className="training-mission-note">Practice follows the passages assigned for this season.</p>
          {seasonId && <AssignedPassages seasonId={seasonId} />}
        </div>
        <aside className="training-hq-aside">
          <Panel className="training-this-week">
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
              <WeeklyProgressStrip week={data.week} />
              <p>{todayCredited ? "Today counts toward your weekly practice goal." : "Complete today\u2019s practice to count toward your weekly goal."}</p>
              <div className="training-week-footer"><strong>Your weekly count starts fresh each week.</strong><p>Missing a day does not erase your saved progress.</p>{data.preferences.pending && <p>Next week: {data.preferences.pending.weeklyTarget} days.</p>}</div>
            </section>
            <section aria-label="Experience">
              <div className="training-panel-title"><h3>Rank {data.xp.level}</h3><Badge tone="info">{data.xp.levelName}</Badge></div>
              <p className="training-week-count" aria-label={`${data.xp.total} experience points total`}><strong>{data.xp.total} <span>XP</span></strong><span>total</span></p>
              <ProgressMeter label="Progress to the next rank" value={data.xp.xpIntoLevel} max={data.xp.xpForNext} />
            </section>
            {!!data.quests.length && <section aria-label="Bonus quests">
              <div className="training-panel-title"><h3>Today’s bonus quests</h3></div>
              <p className="training-quest-note">Little extras — no penalty for skipping.</p>
              <ul className="training-quest-list">{data.quests.map(quest => <li key={quest.key}>
                <div className="training-quest-head"><strong>{quest.title}</strong><span className="training-quest-xp">+{quest.xpReward ?? 25} XP</span></div>
                <p>{quest.description}</p>
                <ProgressMeter label={`${quest.title}: quest progress`} value={quest.progress} max={quest.target} hideCaption />
                {quest.completed
                  ? <p className="training-quest-status is-done"><AppIcon name="check" /> Completed</p>
                  : <p className="training-quest-status">{quest.progress} of {quest.target} done</p>}
              </li>)}</ul>
              <p className="training-quest-note"><small>Finish all three for a +25 XP triple bonus.</small></p>
            </section>}
            <section aria-label="Next milestone">
              <div className="training-panel-title"><h3>{nextHonor ? "Your next milestone" : "Practice milestones"}</h3><Link to={link("/student/honors")}>View Honors and requirements<AppIcon name="arrow" /></Link></div>
              {nextHonor ? <div className="training-next-honor-content"><HonorArtwork {...honorAsset(nextHonor.key)} size={72} muted /><div><h4>{nextHonor.title}</h4><p>{nextHonor.scopeLabel}</p><ProgressMeter label={nextHonor.title} value={nextHonor.completed} max={nextHonor.target} /></div></div> : <p>Your recorded milestones track practice progress. Honors have separate mastery requirements.</p>}
            </section>
          </Panel>
          <LeaderboardCard />
        </aside>
      </div>
      {seasonId && <PassageJourney key={`${seasonId}:${data.format ?? 'Memory'}`} seasonId={seasonId} format={data.format ?? 'Memory'} preview />}
      {seasonId && data.format === 'Pbe' && <SeasonCoveragePanel key={`cooperation:${seasonId}`} seasonId={seasonId} audience="student" />}
      <Panel className="training-practice-paths"><div><h2>Practice paths</h2><p>Every finished session counts toward your streak and weekly goal. Solo rehearsal earns XP; full-event team rehearsal unlocks Simulation honors.</p></div><div className="training-controls">{available && <><LinkButton variant="secondary" to={link("/student/study")}>Choose your training</LinkButton>{data.mission.steps.some(step => step.kind === "Review" && step.target > 0 && step.status !== "NotNeeded") && <LinkButton variant="secondary" data-testid="start-reviews" to={study("Review", null)}>Start due reviews</LinkButton>}<>{data.format === "Pbe" ? <LinkButton variant="secondary" data-testid="start-simulation" to={study("Simulation", null)}>Start solo timed rehearsal</LinkButton> : <LinkButton variant="secondary" data-testid="start-simulation" to={study("Simulation", null)}>Start rehearsal</LinkButton>}</></>}<LinkButton variant="secondary" to={link("/student/practice")}>Team Practice</LinkButton></div></Panel>
      {goalOpen && <WeeklyGoalDialog preferences={data.preferences} onClose={() => setGoalOpen(false)} />}
    </>}
  </div>;
}
