import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { api } from "../../api/client";
import { trainingApi } from "../../api/training";
import type { BadgeProgress } from "../../api/trainingTypes";
import { useAuth } from "../../auth/AuthContext";
import { Badge, Button, HonorArtwork, LinkButton, LoadingState, Notice, PageHeader, Panel, ProgressMeter, Select } from "../../components/ui";
import { TrainingDialog } from "../../components/ui/TrainingDialog";
import { evidenceDate, honorAsset, honorCriteria, trainingLink } from "./trainingAssets";
import "./student.css";
import "./student-collections.css";
const honorSummaries: Record<BadgeProgress["key"], string> = {
  "exact-recall": "Advanced practice: reach 80 in exact wording across 5 passages.",
  "reference-ready": "Reach 70 in written reference recall across 10 passages.",
  "chapter-strong": "Bring your assigned verses in one chapter to Strong or Mastered.",
  "full-coverage": "Practice every passage in an assigned season.",
  "steady-study": "Meet your weekly goal in 4 recorded weeks.",
  "review-complete": "Complete one full set of due reviews.",
};
export function HonorsPage() {
  const { me } = useAuth();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState("All");
  const [detail, setDetail] = useState<BadgeProgress | null>(null);
  const seasons = useQuery({ queryKey: ["assigned-seasons", me?.organizationId, me?.userId], queryFn: () => api.assignedSeasons() });
  const seasonId = params.get("seasonId") || seasons.data?.[0]?.id;
  const honors = useQuery({ queryKey: ["training-honors", seasonId, me?.organizationId, me?.userId], queryFn: () => trainingApi.honors(seasonId!), enabled: !!seasonId });
  const visible = honors.data?.filter(honor => filter === "All" || (filter === "Earned" ? !!honor.earnedAtUtc : !honor.earnedAtUtc)) ?? [];
  const earnedCount = honors.data?.filter(honor => honor.earnedAtUtc).length ?? 0;
  return <div className="training-dashboard training-collection"><PageHeader title="Honors" description="A collection of effort, recall, and steady growth." action={<LinkButton variant="secondary" to={trainingLink("/student", seasonId)}>Back to training</LinkButton>} />
    {!!seasons.data?.length && <label className="training-season-select">Assigned season<Select value={seasonId} onChange={event => { setDetail(null); setParams({ seasonId: event.target.value }); }}>{seasons.data.map(season => <option key={season.id} value={season.id}>{season.name}</option>)}</Select></label>}
    {seasons.isError && <Notice tone="danger">Assigned seasons could not load. <Button variant="secondary" onClick={() => void seasons.refetch()}>Retry seasons</Button></Notice>}
    <div className="training-collection-summary">
      {honors.isSuccess && <p><strong>{earnedCount} {earnedCount === 1 ? "Honor" : "Honors"} earned</strong> · each one records a meaningful step.</p>}
      <div className="training-collection-filters" aria-label="Filter Honors">{["All", "Earned", "In progress"].map(value => <Button key={value} variant={filter === value ? "secondary" : "ghost"} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value}</Button>)}</div>
    </div>
    {seasons.isPending || (seasonId && honors.isPending) ? <LoadingState label="Loading Honors…" /> : !seasonId ? <Panel><h2>Your collection starts with an assignment</h2><p>Your coach will add an assigned season here.</p></Panel> : honors.isError ? <Notice tone="danger">Honors could not load. <Button variant="secondary" onClick={() => void honors.refetch()}>Try again</Button></Notice> : <div className="training-honors-grid">{visible.map((honor, index) => <Panel as="article" key={`${honor.key}:${honor.scopeLabel}:${index}`} className="training-honor-card">
      <HonorArtwork {...honorAsset(honor.key)} size={160} muted={!honor.earnedAtUtc} />
      <h2>{honor.title}</h2>
      <Badge tone={honor.earnedAtUtc ? "success" : "neutral"}>{honor.earnedAtUtc ? "Earned" : "In progress"}</Badge>
      <p className="training-honor-criterion"><small>{honorSummaries[honor.key]}</small></p>
      <div className="training-honor-evidence">{honor.earnedAtUtc ? <small>Earned <time dateTime={honor.earnedAtUtc}>{evidenceDate(honor.earnedAtUtc)}</time></small> : <><small>{honor.completed} / {honor.target}</small><ProgressMeter label={honor.title} value={honor.completed} max={honor.target} /></>}</div>
      <Button variant="ghost" aria-label={`View ${honor.title} details`} onClick={() => setDetail(honor)}>View details</Button>
    </Panel>)}{!visible.length && <Panel className="training-collection-empty"><h2>{filter === "Earned" ? "No earned Honors yet" : filter === "In progress" ? "No Honors in progress" : "No Honors recorded yet"}</h2><p>Keep practicing your assigned passages. Honors appear when saved evidence meets their criteria.</p></Panel>}</div>}
    <p className="training-collection-note"><small>Earned Honors preserve their original evidence and date. Current skill scores can rise or fall.</small></p>
    {detail && <TrainingDialog open title={detail.title} onClose={() => setDetail(null)}><div className="training-honor-detail"><HonorArtwork {...honorAsset(detail.key)} size={160} muted={!detail.earnedAtUtc} /><h3>How to earn it</h3><p>{honorCriteria[detail.key]}</p><p>{detail.completed} / {detail.target} · {detail.scopeLabel}</p>{(detail.key === "exact-recall" || detail.key === "reference-ready") && <p>A smaller assignment may not contain enough eligible passages for this criterion. Your coach controls assignment scope and difficulty.</p>}{detail.earnedAtUtc ? <p>Earned <time dateTime={detail.earnedAtUtc}>{evidenceDate(detail.earnedAtUtc)}</time>. This is saved historical evidence, not a claim of current mastery.</p> : <p>Not yet earned.</p>}{detail.evidenceSessionId && <LinkButton variant="secondary" to={trainingLink(`/student/sessions/${encodeURIComponent(detail.evidenceSessionId)}/recap`, seasonId)}>View evidence session</LinkButton>}</div></TrainingDialog>}
  </div>;
}
