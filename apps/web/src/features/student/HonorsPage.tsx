import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { api } from "../../api/client";
import { trainingApi } from "../../api/training";
import type { BadgeProgress } from "../../api/trainingTypes";
import { useAuth } from "../../auth/AuthContext";
import { Badge, Button, HonorArtwork, LinkButton, LoadingState, Notice, PageHeader, Panel, ProgressMeter, Select } from "../../components/ui";
import { HonorPatchCard } from "../profile/HonorPatchCard";
import { useMyProfile } from "../profile/profile";
import { MasteryHonorArtwork } from "../profile/MasteryHonorArtwork";
import { evidenceDate, honorAsset, honorCriteria, trainingLink } from "./trainingAssets";
import "./student.css";
import "./student-collections.css";
const milestoneCategory = (key: BadgeProgress["key"]) => key.startsWith("streak-") ? "Streak" : "Practice";
export function HonorsPage({ hideHeader = false }: { hideHeader?: boolean }) {
  const { me } = useAuth();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState("All");
  const [category, setCategory] = useState("All");
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
    {profile.isPending ? <LoadingState label="Loading Honors…" /> : profile.isError ? <Notice tone="danger">Honors could not load. <Button variant="secondary" onClick={() => void profile.refetch()}>Try again</Button></Notice> : <div className="honor-patch-grid" aria-label="Mastery Honors">{visible.map(honor => <HonorPatchCard key={honor.key}
      title={honor.title}
      artwork={<MasteryHonorArtwork honorKey={honor.key} size={208} muted={!honor.earnedAtUtc} />}
      status={<><Badge tone={honor.earnedAtUtc ? "success" : "neutral"}>{honor.earnedAtUtc ? "Earned" : "Locked"}</Badge>{honor.earnedAtUtc && <span>Earned <time dateTime={honor.earnedAtUtc}>{evidenceDate(honor.earnedAtUtc)}</time></span>}</>}
      detail={<><MasteryHonorArtwork honorKey={honor.key} size={192} muted={!honor.earnedAtUtc} /><p>{honor.category}</p><h3>Mastery requirements</h3><p>{honor.requirement}</p>{honor.earnedAtUtc ? <><p>Earned <time dateTime={honor.earnedAtUtc}>{evidenceDate(honor.earnedAtUtc)}</time>. Your qualifying evidence is saved.</p><LinkButton variant="secondary" to="/student/profile" aria-label={`Use ${honor.title} as profile image`}>{profile.data?.avatarHonorKey === honor.key ? "Worn as profile image" : "Use as profile image"}</LinkButton></> : <p>This patch is locked. Meet every requirement to unlock it for your profile.</p>}</>}
    />)}{!visible.length && <Panel className="training-collection-empty"><h2>{filter === "Earned" ? "No earned Honors yet" : filter === "Locked" ? "No locked Honors in this category" : "No Honors in this category"}</h2><p>Earn an Honor by meeting all of its listed practice requirements.</p></Panel>}</div>}
    <p className="training-collection-note"><small>Earned Honors preserve their qualifying evidence and date. Your unlocked profile patches remain available if current skill scores later change.</small></p>
    <Panel className="pbe-stamp-history"><div className="training-panel-title"><div><h2>PBE chapter stamps</h2><p>Chapter stamps record when you met the retention requirements for assigned chapters or book introductions. The date stays saved even if you need more review later.</p></div><Badge>{datedStamps.length} loaded</Badge></div>
      {!seasonId ? <p>Your coach will add an assigned season here.</p> : stamps.isPending ? <LoadingState label="Loading PBE chapter stamps…" /> : stamps.isError ? <Notice tone="danger">PBE chapter stamps could not load. <Button variant="secondary" onClick={() => void stamps.refetch()}>Retry stamps</Button></Notice> : datedStamps.length ? <ul className="training-list pbe-stamp-list">{datedStamps.map(stamp => <li key={stamp.stampId}><div><h3>{stamp.label}</h3><p>{stamp.scopeLabel}</p><time dateTime={stamp.earnedAtUtc}>{evidenceDate(stamp.earnedAtUtc)}</time>{stamp.matchesCurrentScope === false && <p>Earned for an earlier assigned scope.</p>}{stamp.matchesCurrentScope === null && <p>Its match to your current assignment is not yet verified; this dated stamp remains saved.</p>}</div><Badge tone="success">{stamp.kind === 'Introduction' ? 'Introduction stamp' : 'Chapter stamp'}</Badge></li>)}</ul> : <p>No PBE chapter stamps recorded for this season.</p>}
      {stamps.hasNextPage && <Button variant="secondary" disabled={stamps.isFetchingNextPage} onClick={() => void stamps.fetchNextPage()}>{stamps.isFetchingNextPage ? 'Loading…' : 'Load more stamps'}</Button>}
    </Panel>
    <details className="ds-disclosure training-milestone-history" id="practice-milestones"><summary>Practice milestones</summary><p>Earlier practice awards keep their original criteria, progress and evidence. They record practice milestones and do not unlock profile images. Team Practice answers do not establish individual Solo accuracy or satisfy a milestone that requires personal scribe submissions.</p>
      {!!seasons.data?.length && <label className="training-season-select">Assigned season<Select value={seasonId} onChange={event => setParams({ seasonId: event.target.value })}>{seasons.data.map(season => <option key={season.id} value={season.id}>{season.name}</option>)}</Select></label>}
      {seasons.isError && <Notice tone="danger">Assigned seasons could not load. <Button variant="secondary" onClick={() => void seasons.refetch()}>Retry seasons</Button></Notice>}
      {seasons.isPending || (seasonId && milestones.isPending) ? <LoadingState label="Loading practice milestones…" /> : !seasonId ? <p>Your coach will add an assigned season here.</p> : milestones.isError ? <Notice tone="danger">Practice milestones could not load. <Button variant="secondary" onClick={() => void milestones.refetch()}>Retry milestones</Button></Notice> : <div className="honor-patch-grid">{milestones.data?.map((milestone, index) => <HonorPatchCard key={`${milestone.key}:${milestone.scopeLabel}:${index}`}
        title={milestone.title}
        artwork={<HonorArtwork {...honorAsset(milestone.key)} size={208} muted={!milestone.earnedAtUtc} />}
        status={<><Badge tone={milestone.earnedAtUtc ? "success" : "neutral"}>{milestone.earnedAtUtc ? "Milestone recorded" : "In progress"}</Badge>{milestone.earnedAtUtc ? <span>Recorded <time dateTime={milestone.earnedAtUtc}>{evidenceDate(milestone.earnedAtUtc)}</time></span> : <><span>{milestone.completed} / {milestone.target}</span><ProgressMeter label={milestone.title} value={milestone.completed} max={milestone.target} /></>}</>}
        detail={<><HonorArtwork {...honorAsset(milestone.key)} size={192} muted={!milestone.earnedAtUtc} /><p>{milestoneCategory(milestone.key)}</p><h3>Original milestone requirements</h3><p>{honorCriteria[milestone.key]}</p><p>{milestone.completed} / {milestone.target} · {milestone.scopeLabel}</p>{(milestone.key === "exact-recall" || milestone.key === "reference-ready") && <p>A smaller assignment may not contain enough eligible passages for this criterion. Your coach controls assignment scope and difficulty.</p>}{milestone.earnedAtUtc ? <p>Recorded <time dateTime={milestone.earnedAtUtc}>{evidenceDate(milestone.earnedAtUtc)}</time>. This is saved historical evidence, not a mastery Honor or profile unlock.</p> : <p>Not yet recorded.</p>}{milestone.evidenceSessionId && <LinkButton variant="secondary" to={trainingLink(`/student/sessions/${encodeURIComponent(milestone.evidenceSessionId)}/recap`, seasonId)}>View evidence session</LinkButton>}</>}
      />)}{!milestones.data?.length && <p>No practice milestones recorded for this season.</p>}</div>}
    </details>
  </div>;
}
