import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { api } from "../../api/client";
import { trainingApi } from "../../api/training";
import type { BadgeProgress } from "../../api/trainingTypes";
import { useAuth } from "../../auth/AuthContext";
import { Badge, Button, HonorArtwork, LinkButton, LoadingState, Notice, PageHeader, Panel, ProgressMeter, Select } from "../../components/ui";
import { TrainingDialog } from "../../components/ui/TrainingDialog";
import { useMyProfile, type MasteryHonorOption } from "../profile/profile";
import { MasteryHonorArtwork } from "../profile/MasteryHonorArtwork";
import { evidenceDate, honorAsset, honorCriteria, trainingLink } from "./trainingAssets";
import "./student.css";
import "./student-collections.css";
const milestoneSummaries: Record<BadgeProgress["key"], string> = {
  "exact-recall": "Advanced practice: reach 80 in exact wording across 5 passages.",
  "reference-ready": "Reach 70 in written reference recall across 10 passages.",
  "chapter-strong": "Bring your assigned verses in one chapter to Strong or Mastered.",
  "full-coverage": "Practice every passage in an assigned season.",
  "steady-study": "Meet your weekly goal in 4 recorded weeks.",
  "review-complete": "Complete one full set of due reviews.",
  "streak-7": "Practice 7 days in a row.",
  "streak-14": "Practice 14 days in a row.",
  "streak-30": "Practice 30 days in a row.",
};
const milestoneCategory = (key: BadgeProgress["key"]) => key.startsWith("streak-") ? "Streak" : "Practice";
export function HonorsPage({ hideHeader = false }: { hideHeader?: boolean }) {
  const { me } = useAuth();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState("All");
  const [category, setCategory] = useState("All");
  const [detail, setDetail] = useState<MasteryHonorOption | null>(null);
  const [milestoneDetail, setMilestoneDetail] = useState<BadgeProgress | null>(null);
  const profile = useMyProfile();
  const seasons = useQuery({ queryKey: ["assigned-seasons", me?.organizationId, me?.userId], queryFn: () => api.assignedSeasons() });
  const seasonId = params.get("seasonId") || seasons.data?.[0]?.id;
  const milestones = useQuery({ queryKey: ["training-honors", seasonId, me?.organizationId, me?.userId], queryFn: () => trainingApi.honors(seasonId!), enabled: !!seasonId });
  const stamps = useInfiniteQuery({ queryKey: ['pbe-chapter-stamps', seasonId, me?.organizationId, me?.userId], initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => trainingApi.chapters(seasonId!, { view: 'Stamps', after: pageParam, limit: 32 }), enabled: !!seasonId,
    getNextPageParam: page => page.nextCursor ?? undefined });
  const datedStamps = stamps.data?.pages.flatMap(page => page.view === 'Stamps' ? page.items : []) ?? [];
  const visible = profile.data?.honors.filter(honor => (category === "All" || honor.category === category) && (filter === "All" || (filter === "Earned" ? !!honor.earnedAtUtc : !honor.earnedAtUtc))) ?? [];
  const earnedCount = profile.data?.honors.filter(honor => honor.earnedAtUtc).length ?? 0;
  return <div className="training-dashboard training-collection">{!hideHeader && <PageHeader title="Honors" description="See your Scripture recall achievements and their requirements." action={<LinkButton variant="secondary" to={trainingLink("/student", seasonId)}>Back to training</LinkButton>} />}
    <p>Erudoza Honors record Scripture recall and Team Practice achievements. Earn a patch to use it on your profile. These are app achievements, not official Pathfinder Honors.</p>
    <div className="training-collection-summary">
      {profile.isSuccess && <p><strong>{earnedCount} {earnedCount === 1 ? "Honor" : "Honors"} earned</strong> · {profile.data.honors.length} mastery challenges.</p>}
      <label className="training-honor-category">Honor category<Select value={category} onChange={event => setCategory(event.target.value)}><option value="All">All categories</option><option value="Scripture">Scripture</option><option value="Team Practice">Team Practice</option><option value="Simulation">Simulation</option></Select></label>
      <div className="training-collection-filters" aria-label="Filter Honors">{["All", "Earned", "Locked"].map(value => <Button key={value} variant={filter === value ? "secondary" : "ghost"} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value}</Button>)}</div>
    </div>
    {profile.isPending ? <LoadingState label="Loading Honors…" /> : profile.isError ? <Notice tone="danger">Honors could not load. <Button variant="secondary" onClick={() => void profile.refetch()}>Try again</Button></Notice> : <div className="training-honors-grid" aria-label="Mastery Honors">{visible.map(honor => <Panel as="article" key={honor.key} className="training-honor-card">
      <MasteryHonorArtwork honorKey={honor.key} size={160} muted={!honor.earnedAtUtc} />
      <h2>{honor.title}</h2><small>{honor.category}</small>
      <p className="training-honor-criterion"><span className="training-honor-criterion-label">Requirement</span>{honor.requirement}</p>
      <p className="training-honor-status"><Badge tone={honor.earnedAtUtc ? "success" : "neutral"}>{honor.earnedAtUtc ? "Earned" : "Locked"}</Badge>{honor.earnedAtUtc && <span>Earned <time dateTime={honor.earnedAtUtc}>{evidenceDate(honor.earnedAtUtc)}</time></span>}</p>
      {honor.earnedAtUtc
        ? <LinkButton to="/student/profile" aria-label={`Use ${honor.title} as profile image`} variant={profile.data?.avatarHonorKey === honor.key ? "secondary" : undefined}>{profile.data?.avatarHonorKey === honor.key ? "Worn as profile image" : "Use as profile image"}</LinkButton>
        : <Button variant="ghost" aria-label={`View ${honor.title} requirements`} onClick={() => setDetail(honor)}>View requirements</Button>}
    </Panel>)}{!visible.length && <Panel className="training-collection-empty"><h2>{filter === "Earned" ? "No earned Honors yet" : filter === "Locked" ? "No locked Honors in this category" : "No Honors in this category"}</h2><p>Earn an Honor by meeting all of its listed practice requirements.</p></Panel>}</div>}
    <p className="training-collection-note"><small>Earned Honors preserve their qualifying evidence and date. Your unlocked profile patches remain available if current skill scores later change.</small></p>
    <Panel className="pbe-stamp-history"><div className="training-panel-title"><div><h2>PBE chapter stamps</h2><p>Chapter stamps record when you met the retention requirements for assigned chapters or book introductions. The date stays saved even if you need more review later.</p></div><Badge>{datedStamps.length} loaded</Badge></div>
      {!seasonId ? <p>Your coach will add an assigned season here.</p> : stamps.isPending ? <LoadingState label="Loading PBE chapter stamps…" /> : stamps.isError ? <Notice tone="danger">PBE chapter stamps could not load. <Button variant="secondary" onClick={() => void stamps.refetch()}>Retry stamps</Button></Notice> : datedStamps.length ? <ul className="training-list pbe-stamp-list">{datedStamps.map(stamp => <li key={stamp.stampId}><div><h3>{stamp.label}</h3><p>{stamp.scopeLabel}</p><time dateTime={stamp.earnedAtUtc}>{evidenceDate(stamp.earnedAtUtc)}</time>{stamp.matchesCurrentScope === false && <p>Earned for an earlier assigned scope.</p>}{stamp.matchesCurrentScope === null && <p>Its match to your current assignment is not yet verified; this dated stamp remains saved.</p>}</div><Badge tone="success">{stamp.kind === 'Introduction' ? 'Introduction stamp' : 'Chapter stamp'}</Badge></li>)}</ul> : <p>No PBE chapter stamps recorded for this season.</p>}
      {stamps.hasNextPage && <Button variant="secondary" disabled={stamps.isFetchingNextPage} onClick={() => void stamps.fetchNextPage()}>{stamps.isFetchingNextPage ? 'Loading…' : 'Load more stamps'}</Button>}
    </Panel>
    <details className="ds-disclosure training-milestone-history" id="practice-milestones"><summary>Practice milestones</summary><p>Earlier practice awards keep their original criteria, progress and evidence. They record practice milestones and do not unlock profile images. Team Practice answers do not establish individual Solo accuracy or satisfy a milestone that requires personal scribe submissions.</p>
      {!!seasons.data?.length && <label className="training-season-select">Assigned season<Select value={seasonId} onChange={event => { setMilestoneDetail(null); setParams({ seasonId: event.target.value }); }}>{seasons.data.map(season => <option key={season.id} value={season.id}>{season.name}</option>)}</Select></label>}
      {seasons.isError && <Notice tone="danger">Assigned seasons could not load. <Button variant="secondary" onClick={() => void seasons.refetch()}>Retry seasons</Button></Notice>}
      {seasons.isPending || (seasonId && milestones.isPending) ? <LoadingState label="Loading practice milestones…" /> : !seasonId ? <p>Your coach will add an assigned season here.</p> : milestones.isError ? <Notice tone="danger">Practice milestones could not load. <Button variant="secondary" onClick={() => void milestones.refetch()}>Retry milestones</Button></Notice> : <div className="training-honors-grid">{milestones.data?.map((milestone, index) => <Panel as="article" key={`${milestone.key}:${milestone.scopeLabel}:${index}`} className="training-honor-card">
        <HonorArtwork {...honorAsset(milestone.key)} size={160} muted={!milestone.earnedAtUtc} /><h2>{milestone.title}</h2><small>{milestoneCategory(milestone.key)}</small>
        <p className="training-honor-criterion"><span className="training-honor-criterion-label">Requirement</span>{milestoneSummaries[milestone.key]}</p>
        <div className="training-honor-status"><Badge tone={milestone.earnedAtUtc ? "success" : "neutral"}>{milestone.earnedAtUtc ? "Milestone recorded" : "In progress"}</Badge>{milestone.earnedAtUtc ? <span>Recorded <time dateTime={milestone.earnedAtUtc}>{evidenceDate(milestone.earnedAtUtc)}</time></span> : <><span>{milestone.completed} / {milestone.target}</span><ProgressMeter label={milestone.title} value={milestone.completed} max={milestone.target} /></>}</div>
        <Button variant="ghost" aria-label={`View ${milestone.title} milestone details`} onClick={() => setMilestoneDetail(milestone)}>View milestone</Button>
      </Panel>)}{!milestones.data?.length && <p>No practice milestones recorded for this season.</p>}</div>}
    </details>
    {detail && <TrainingDialog open title={detail.title} onClose={() => setDetail(null)}><div className="training-honor-detail"><MasteryHonorArtwork honorKey={detail.key} size={160} muted={!detail.earnedAtUtc} /><h3>Mastery requirements</h3><p>{detail.requirement}</p><p>{detail.category}</p>{detail.earnedAtUtc ? <><p>Earned <time dateTime={detail.earnedAtUtc}>{evidenceDate(detail.earnedAtUtc)}</time>. Your qualifying evidence is saved.</p><LinkButton variant="secondary" to="/student/profile">Use as profile image</LinkButton></> : <p>This patch is locked. Meet every requirement to unlock it for your profile.</p>}</div></TrainingDialog>}
    {milestoneDetail && <TrainingDialog open title={milestoneDetail.title} onClose={() => setMilestoneDetail(null)}><div className="training-honor-detail"><HonorArtwork {...honorAsset(milestoneDetail.key)} size={160} muted={!milestoneDetail.earnedAtUtc} /><h3>Original milestone requirements</h3><p>{honorCriteria[milestoneDetail.key]}</p><p>{milestoneDetail.completed} / {milestoneDetail.target} · {milestoneDetail.scopeLabel}</p>{(milestoneDetail.key === "exact-recall" || milestoneDetail.key === "reference-ready") && <p>A smaller assignment may not contain enough eligible passages for this criterion. Your coach controls assignment scope and difficulty.</p>}{milestoneDetail.earnedAtUtc ? <p>Recorded <time dateTime={milestoneDetail.earnedAtUtc}>{evidenceDate(milestoneDetail.earnedAtUtc)}</time>. This is saved historical evidence, not a mastery Honor or profile unlock.</p> : <p>Not yet recorded.</p>}{milestoneDetail.evidenceSessionId && <LinkButton variant="secondary" to={trainingLink(`/student/sessions/${encodeURIComponent(milestoneDetail.evidenceSessionId)}/recap`, seasonId)}>View evidence session</LinkButton>}</div></TrainingDialog>}
  </div>;
}
