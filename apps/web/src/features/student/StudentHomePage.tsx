import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { api } from "../../api/client";
import { trainingApi } from "../../api/training";
import { Badge, Button, HonorArtwork, LinkButton, LoadingState, Notice, PageHeader, Panel, ProgressMeter, Select, WeeklyProgressStrip } from "../../components/ui";
import { PassageJourney } from "./PassageJourney";
import { WeeklyGoalDialog } from "./WeeklyGoalDialog";
import { honorAsset, trainingAssets, trainingLink } from "./trainingAssets";
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
  const study = (mode: string, sessionId: string | null, mission = false) => {
    const search = new URLSearchParams({ mode });
    if (sessionId) search.set("sessionId", sessionId);
    if (mission && (mode === "Review" || mode === "Practice")) {
      search.set("step", mode);
      if (data?.mission.status !== "Invalidated" && data?.mission.id && data.mission.revision !== null) { search.set("missionId", data.mission.id); search.set("missionRevision", String(data.mission.revision)); }
    }
    return link(`/student/study?${search}`);
  };
  return <div className="training-dashboard student-home">
    <PageHeader title="Training HQ" description="A little practice. Lasting knowledge." action={data && <div className="training-season" data-testid="current-season"><small>Current season</small><strong>{data.seasonName || "Not assigned"}</strong><Badge tone={data.seasonStatus === "Active" ? "success" : "neutral"}>{data.seasonStatus === "None" ? "Awaiting assignment" : data.seasonStatus}</Badge></div>} />
    {(seasons.data?.length ?? 0) > 1 && <label className="training-season-select">Assigned season<Select value={seasonId ?? ""} onChange={event => { setGoalOpen(false); setParams({ seasonId: event.target.value }); }}>{seasons.data?.map(season => <option key={season.id} value={season.id}>{season.name}</option>)}</Select></label>}
    {seasons.isError && <Notice tone="danger">Assigned seasons could not load. <Button variant="secondary" onClick={() => void seasons.refetch()}>Retry seasons</Button></Notice>}
    {today.isPending ? <LoadingState label="Loading your training plan…" /> : today.isError ? <Notice tone="danger">Your training plan could not load. <Button variant="secondary" onClick={() => void today.refetch()}>Try again</Button></Notice> : data && <>
      <div className="training-hq-grid"><Panel className="training-mission"><div className="training-mission-heading"><div><Badge tone="info">Daily training</Badge><h2>{data.mission.status === "Complete" ? "Today’s training. Done and growing." : "Today’s training"}</h2><p>{data.mission.explanation || "Review what needs another look, then practice your daily drill."}</p></div><img {...trainingAssets.journey} alt="" width="720" height="480" /></div>
        {!available && <Notice data-testid="academy-track-unavailable">{data.mission.status === "Invalidated" ? "Your assignment changed. Start updated training to build a plan for your current assignment." : data.seasonStatus !== "Active" && data.seasonId ? "Training opens when this season is Active." : "Your coach will add your study assignment here."}</Notice>}
        {data.seasonStatus === "Active" && data.mission.status === "Invalidated" && action && <LinkButton to={study(action.mode, null, true)}>Start updated training</LinkButton>}
        <ol className="training-mission-steps">{data.mission.steps.map(step => <li key={step.kind}><div><h3>{step.kind === "Review" ? "Review due passages" : "Daily drill"}</h3><p>{step.status === "NotNeeded" ? "No review needed today" : `${step.completed} of ${step.target} ${step.kind === "Review" ? "passages" : "cards"} completed`}</p></div><Badge tone={step.status === "Complete" ? "success" : "neutral"}>{step.status === "NotNeeded" ? "Up to date" : step.status}</Badge></li>)}</ol>
        {completedSessionId && <LinkButton to={link(`/student/sessions/${encodeURIComponent(completedSessionId)}/recap`)}>See today’s recap</LinkButton>}
        {available && !completedSessionId && action && <LinkButton data-testid="start-todays-deck" to={study(action.mode, action.sessionId, true)}>{action.label}</LinkButton>}
        <p><Link to={link("/student/progress")}>View passage journey</Link></p>
      </Panel><aside className="training-hq-aside"><Panel className="training-week-panel"><h2>Your week</h2><WeeklyProgressStrip week={data.week} /><p>{data.week.completedDays} of {data.week.target} practice days</p><p>Every recorded day counts once across your seasons. A missed day does not erase progress.</p><Button variant="secondary" onClick={() => setGoalOpen(true)}>Change weekly goal</Button>{data.preferences.pending && <p>Next week: {data.preferences.pending.weeklyTarget} days.</p>}</Panel><Panel className="training-next-honor"><h2>{nextHonor ? "Your next Honor" : "Your Honors"}</h2>{nextHonor ? <div className="training-next-honor-content"><HonorArtwork {...honorAsset(nextHonor.key)} size={96} muted /><div><h3>{nextHonor.title}</h3><p>{nextHonor.scopeLabel}</p><ProgressMeter label={nextHonor.title} value={nextHonor.completed} max={nextHonor.target} /></div></div> : <p>Visit your collection to explore your recorded Honors.</p>}<Link to={link("/student/honors")}>View all Honors</Link></Panel></aside></div>
      <Panel className="training-more"><div><h2>Keep exploring</h2><p>Choose the practice that fits today.</p></div><div className="training-controls">{available && <><LinkButton variant="secondary" to={study("Practice", null)}>Practice another drill</LinkButton>{data.mission.steps.some(step => step.kind === "Review" && step.target > 0 && step.status !== "NotNeeded") && <LinkButton variant="secondary" data-testid="start-reviews" to={study("Review", null)}>Start due reviews</LinkButton>}<LinkButton variant="secondary" data-testid="start-simulation" to={study("Simulation", null)}>Start rehearsal</LinkButton></>}<LinkButton variant="secondary" to={link("/student/practice")}>Team Practice</LinkButton></div></Panel>
      {seasonId && <PassageJourney key={seasonId} seasonId={seasonId} preview />}{goalOpen && <WeeklyGoalDialog preferences={data.preferences} onClose={() => setGoalOpen(false)} />}
    </>}
  </div>;
}
