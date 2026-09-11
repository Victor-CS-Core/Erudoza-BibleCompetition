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
export function HonorsPage() {
  const { me } = useAuth();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState("All");
  const [detail, setDetail] = useState<BadgeProgress | null>(null);
  const seasons = useQuery({ queryKey: ["assigned-seasons", me?.organizationId, me?.userId], queryFn: () => api.assignedSeasons() });
  const seasonId = params.get("seasonId") || seasons.data?.[0]?.id;
  const honors = useQuery({ queryKey: ["training-honors", seasonId, me?.organizationId, me?.userId], queryFn: () => trainingApi.honors(seasonId!), enabled: !!seasonId });
  const visible = honors.data?.filter(honor => filter === "All" || (filter === "Earned" ? !!honor.earnedAtUtc : !honor.earnedAtUtc)) ?? [];
  return <div className="training-dashboard"><PageHeader title="Honors" description="A collection of effort, recall, and steady growth." action={<LinkButton variant="secondary" to={trainingLink("/student", seasonId)}>Back to training</LinkButton>} />
    {!!seasons.data?.length && <label className="training-season-select">Assigned season<Select value={seasonId} onChange={event => { setDetail(null); setParams({ seasonId: event.target.value }); }}>{seasons.data.map(season => <option key={season.id} value={season.id}>{season.name}</option>)}</Select></label>}
    {seasons.isError && <Notice tone="danger">Assigned seasons could not load. <Button variant="secondary" onClick={() => void seasons.refetch()}>Retry seasons</Button></Notice>}
    <div className="training-controls" aria-label="Filter Honors">{["All", "Earned", "In progress"].map(value => <Button key={value} variant={filter === value ? "primary" : "secondary"} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value}</Button>)}</div>
    <p>Earned Honors preserve their original evidence and date. Current skill scores can rise or fall.</p>
    {seasons.isPending || (seasonId && honors.isPending) ? <LoadingState label="Loading Honors…" /> : !seasonId ? <Panel><h2>Your collection starts with an assignment</h2><p>Your coach will add an assigned season here.</p></Panel> : honors.isError ? <Notice tone="danger">Honors could not load. <Button variant="secondary" onClick={() => void honors.refetch()}>Try again</Button></Notice> : <div className="training-honors-grid">{visible.map((honor, index) => <Panel key={`${honor.key}:${honor.scopeLabel}:${index}`} className="training-honor-card"><HonorArtwork {...honorAsset(honor.key)} size={144} muted={!honor.earnedAtUtc} /><h2>{honor.title}</h2><Badge tone={honor.earnedAtUtc ? "success" : "neutral"}>{honor.earnedAtUtc ? "Earned" : "In progress"}</Badge><p>{honorCriteria[honor.key]}</p>{honor.earnedAtUtc ? <p>Earned <time dateTime={honor.earnedAtUtc}>{evidenceDate(honor.earnedAtUtc)}</time></p> : <><ProgressMeter label={honor.title} value={honor.completed} max={honor.target} /><p>{honor.completed} / {honor.target}</p></>}<Button variant="secondary" onClick={() => setDetail(honor)}>View {honor.title} details</Button></Panel>)}{!visible.length && <Panel><h2>{filter === "Earned" ? "No earned Honors yet" : filter === "In progress" ? "No Honors in progress" : "No Honors recorded yet"}</h2><p>Keep practicing your assigned passages. Honors appear when saved evidence meets their criteria.</p></Panel>}</div>}
    {detail && <TrainingDialog open title={detail.title} onClose={() => setDetail(null)}><div className="training-honor-detail"><HonorArtwork {...honorAsset(detail.key)} size={160} muted={!detail.earnedAtUtc} /><h3>How to earn it</h3><p>{honorCriteria[detail.key]}</p><p>{detail.completed} / {detail.target} · {detail.scopeLabel}</p>{(detail.key === "exact-recall" || detail.key === "reference-ready") && <p>A smaller assignment may not contain enough eligible passages for this criterion. Your coach controls assignment scope and difficulty.</p>}{detail.earnedAtUtc ? <p>Earned <time dateTime={detail.earnedAtUtc}>{evidenceDate(detail.earnedAtUtc)}</time>. This is saved historical evidence, not a claim of current mastery.</p> : <p>Not yet earned.</p>}{detail.evidenceSessionId && <LinkButton variant="secondary" to={trainingLink(`/student/sessions/${encodeURIComponent(detail.evidenceSessionId)}/recap`, seasonId)}>View evidence session</LinkButton>}</div></TrainingDialog>}
  </div>;
}
