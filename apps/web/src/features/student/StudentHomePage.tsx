import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { api } from "../../api/client";
import { trainingApi } from "../../api/training";
import { AppIcon } from "../../components/AppIcon";
import { LandscapeBanner } from "../../components/brand/LandscapeBanner";
import { Badge, Button, HonorArtwork, LinkButton, LoadingState, Notice, PageHeader, Panel, ProgressMeter, Select, WeeklyProgressStrip } from "../../components/ui";
import { PassageJourney } from "./PassageJourney";
import { WeeklyGoalDialog } from "./WeeklyGoalDialog";
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
  const link = (path: string) => trainingLink(path, seasonId);
  const available = data?.seasonStatus === "Active" && data.mission.status !== "Unavailable" && data.mission.status !== "Invalidated";
  const action = data?.nextAction;
  const nextHonor = data?.honors.filter(honor => !honor.earnedAtUtc && honor.target > 0).sort((a, b) => b.completed / b.target - a.completed / a.target)[0];
  const completedSessionId = data?.mission.status === "Complete" ? [...data.mission.steps].reverse().find(step => step.status === "Complete" && step.sessionId)?.sessionId : null;
  const resolvedSteps = data?.mission.steps.filter(step => step.status === "Complete" || step.status === "NotNeeded").length ?? 0;
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
    <PageHeader title="Training HQ" description="A little practice. Lasting knowledge." action={data && <div className="training-season" data-testid="current-season"><small>Current season</small><strong>{data.seasonName || "Not assigned"}</strong><Badge tone={data.seasonStatus === "Active" ? "success" : "neutral"}>{data.seasonStatus === "None" ? "Awaiting assignment" : data.seasonStatus}</Badge></div>} />
    <LandscapeBanner className="training-hq-banner" priority />
    {data?.format === "Pbe" && <div className="flex flex-wrap gap-3"><Badge>PBE questions</Badge><LinkButton variant="secondary" to={link("/student/study?mode=Practice&format=Memory")}>Choose Memory</LinkButton><p>Timed rehearsal is not enabled.</p></div>}
    {(seasons.data?.length ?? 0) > 1 && <label className="training-season-select">Assigned season<Select value={seasonId ?? ""} onChange={event => { setGoalOpen(false); setParams({ seasonId: event.target.value }); }}>{seasons.data?.map(season => <option key={season.id} value={season.id}>{season.name}</option>)}</Select></label>}
    {seasons.isError && <Notice tone="danger">Assigned seasons could not load. <Button variant="secondary" onClick={() => void seasons.refetch()}>Retry seasons</Button></Notice>}
    {today.isPending ? <LoadingState label="Loading your training plan…" /> : today.isError ? <Notice tone="danger">Your training plan could not load. <Button variant="secondary" onClick={() => void today.refetch()}>Try again</Button></Notice> : data && <>
      <div className="training-hq-grid">
        <div className="training-mission-column">
          <Panel className="training-mission">
            <div className="training-mission-main">
              <h2>{data.mission.status === "Complete" ? "That’s a good day’s practice." : available ? "Strengthen your recall." : "Your next step starts here."}</h2>
              <p className="training-mission-description">{data.mission.explanation || (data.mission.status === "Complete" ? "Your reviews and daily drill are finished. Every saved answer is part of your progress." : "Review what needs another look, then help the wording and references stick.")}</p>
              {available && nextStep && <p className="training-mission-scope"><AppIcon name="book" /><span>{nextStep.target} {nextStep.kind === "Review" ? "due passages" : "cards"} · Your assigned passages</span></p>}
              {!available && <Notice data-testid="academy-track-unavailable">{data.mission.status === "Invalidated" ? "Your assignment changed. Start updated training to build a plan for your current assignment." : data.seasonStatus !== "Active" && data.seasonId ? "Training opens when this season is Active." : "Your coach will add your study assignment here."}</Notice>}
              {data.seasonStatus === "Active" && data.mission.status === "Invalidated" && action && <LinkButton to={study(action.mode, null, true)}>Start updated training<AppIcon name="arrow" /></LinkButton>}
              {completedSessionId && <LinkButton to={link(`/student/sessions/${encodeURIComponent(completedSessionId)}/recap`)}>See today’s recap<AppIcon name="arrow" /></LinkButton>}
              {available && !completedSessionId && action && <LinkButton data-testid="start-todays-deck" to={study(action.mode, action.sessionId, true)}>{action.label}<AppIcon name="arrow" /></LinkButton>}
              {!!data.mission.steps.length && <div className="training-mission-progress"><ProgressMeter label="Today's training steps" value={resolvedSteps} max={data.mission.steps.length} /><span>steps complete</span></div>}
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
          <p className="training-mission-note">Your coach’s assigned passages. A manageable step each day.</p>
        </div>
        <aside className="training-hq-aside">
          <Panel className="training-week-panel">
            <div className="training-panel-title"><h2>Find your rhythm</h2><Button variant="ghost" size="compact" aria-label="Edit weekly goal" onClick={() => setGoalOpen(true)}>Edit goal</Button></div>
            <p className="training-week-count" aria-label={`${data.week.completedDays} of ${data.week.target} practice days`}><strong>{data.week.completedDays} <span>of</span> {data.week.target}</strong><span>practice days this week</span></p>
            <WeeklyProgressStrip week={data.week} />
            <p>{todayCredited ? "Today already counts. Keep a pace that works for you." : "A little practice today is a step toward your goal."}</p>
            <div className="training-week-footer"><strong>A fresh start every week.</strong><p>Your learning stays with you after a missed day.</p>{data.preferences.pending && <p>Next week: {data.preferences.pending.weeklyTarget} days.</p>}</div>
          </Panel>
          <Panel className="training-next-honor"><h2>{nextHonor ? "Your next milestone" : "Practice milestones"}</h2>{nextHonor ? <div className="training-next-honor-content"><HonorArtwork {...honorAsset(nextHonor.key)} size={72} muted /><div><h3>{nextHonor.title}</h3><p>{nextHonor.scopeLabel}</p><ProgressMeter label={nextHonor.title} value={nextHonor.completed} max={nextHonor.target} /></div></div> : <p>Your recorded milestones track practice progress. Honors have separate mastery requirements.</p>}<Link to={link("/student/honors")}>Explore mastery Honors<AppIcon name="arrow" /></Link></Panel>
        </aside>
      </div>
      {seasonId && <PassageJourney key={seasonId} seasonId={seasonId} preview />}
      <Panel className="training-more"><div><h2>Keep exploring</h2><p>Choose the practice that fits today.</p></div><div className="training-controls">{available && <><LinkButton variant="secondary" to={study("Practice", null)}>Practice another drill</LinkButton>{data.mission.steps.some(step => step.kind === "Review" && step.target > 0 && step.status !== "NotNeeded") && <LinkButton variant="secondary" data-testid="start-reviews" to={study("Review", null)}>Start due reviews</LinkButton>}<>{data.format === "Pbe" ? <Button variant="secondary" data-testid="start-simulation" disabled>Timed rehearsal is not enabled</Button> : <LinkButton variant="secondary" data-testid="start-simulation" to={study("Simulation", null)}>Start rehearsal</LinkButton>}</></>}<LinkButton variant="secondary" to={link("/student/practice")}>Team Practice</LinkButton></div></Panel>
      {goalOpen && <WeeklyGoalDialog preferences={data.preferences} onClose={() => setGoalOpen(false)} />}
    </>}
  </div>;
}
