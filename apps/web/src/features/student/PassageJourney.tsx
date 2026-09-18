import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { ApiError } from "../../api/client";
import type { ContinueChaptersRequest, ProgressAction } from "../../api/pbeTypes";
import type { PassageJourneyPage } from "../../api/trainingTypes";
import { trainingApi } from "../../api/training";
import { useAuth } from "../../auth/AuthContext";
import { Badge, Button, LinkButton, LoadingState, Notice, Panel, ProgressMeter } from "../../components/ui";
import { trainingLink } from "./trainingAssets";
import { AppIcon } from "../../components/AppIcon";
import { PbeChapterProgress } from "./PbeChapterProgress";

type ChapterContinuationInput = {
  request: ContinueChaptersRequest;
  scopeId: number;
};

function PbeJourney({ seasonId, preview }: { seasonId: string; preview: boolean }) {
  const { me } = useAuth();
  const navigate = useNavigate();
  const queries = useQueryClient();
  const active = useRef(true), started = useRef(false), staleRecoveryAttempted = useRef(false), currentSeason = useRef(seasonId), requestScope = useRef({ seasonId, id: 0 });
  if (requestScope.current.seasonId !== seasonId) requestScope.current = { seasonId, id: requestScope.current.id + 1 };
  currentSeason.current = seasonId;
  const scopeId = requestScope.current.id;
  const [selectedChapter, setSelectedChapter] = useState<{ key: string; label: string } | null>(null);
  const chapters = useInfiniteQuery({
    queryKey: ["pbe-chapters", seasonId, me?.organizationId, me?.userId],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => trainingApi.chapters(seasonId, { view: 'Chapters', after: pageParam, limit: 32 }),
    getNextPageParam: page => page.nextCursor ?? undefined,
  });
  const groups = useInfiniteQuery({
    queryKey: ["pbe-chapter-groups", seasonId, selectedChapter?.key, me?.organizationId, me?.userId],
    initialPageParam: undefined as string | undefined,
    enabled: !!selectedChapter,
    queryFn: ({ pageParam }) => trainingApi.chapters(seasonId, { view: 'Groups', chapterKey: selectedChapter!.key, after: pageParam, limit: 32 }),
    getNextPageParam: page => page.nextCursor ?? undefined,
  });
  const continuation = useMutation({
    mutationFn: (input: ChapterContinuationInput) => trainingApi.continueChapters(input.request),
    onSuccess: (response, input) => {
      if (!active.current || requestScope.current.id !== input.scopeId || currentSeason.current !== input.request.seasonId || response.seasonId !== input.request.seasonId) return;
      if (response.next === 'Continue' && response.work.id) continuation.mutate({ scopeId: input.scopeId, request: { seasonId: input.request.seasonId, workId: response.work.id } });
      else if (response.next === 'Reload') {
        const previousSnapshotId = chapters.data?.pages[0]?.snapshotId;
        void chapters.refetch().then(result => {
          const refreshed = result.data?.pages[0];
          if (!active.current || requestScope.current.id !== input.scopeId || currentSeason.current !== input.request.seasonId || result.isError || !refreshed?.currentAvailable || !refreshed.snapshotId || refreshed.snapshotId === previousSnapshotId) return;
          queries.setQueryData(['pbe-chapter-publication', input.request.seasonId], refreshed.snapshotId);
          void queries.invalidateQueries({ queryKey: ['pbe-cooperation', 'student', undefined, input.request.seasonId], exact: true });
        });
      }
    },
    onError: (error, input) => {
      if (!active.current || requestScope.current.id !== input.scopeId || currentSeason.current !== input.request.seasonId) return;
      if (!staleRecoveryAttempted.current && error instanceof ApiError && (error.code === 'PBE_CHAPTER_WORK_STALE' || error.code === 'PBE_CHAPTER_SCOPE_STALE')) {
        staleRecoveryAttempted.current = true;
        void chapters.refetch().then(result => {
          if (!active.current || requestScope.current.id !== input.scopeId || currentSeason.current !== input.request.seasonId || result.isError) return;
          started.current = true;
          continuation.mutate({ scopeId: input.scopeId, request: { seasonId: input.request.seasonId } });
        });
      }
    },
  });
  const firstPage = chapters.data?.pages[0];
  useEffect(() => {
    active.current = true;
    continuation.reset();
    started.current = false;
    staleRecoveryAttempted.current = false;
    currentSeason.current = seasonId;
    setSelectedChapter(null);
    return () => { active.current = false; };
    // The mutation observer is reset only when the immutable request scope changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seasonId]);
  useEffect(() => {
    if (!firstPage || started.current || continuation.isPending || continuation.isError) return;
    const dueExpired = firstPage.currentAvailable && !!firstPage.dueRefreshAtUtc && Date.parse(firstPage.dueRefreshAtUtc) <= Date.now();
    const currentRowsUpdating = firstPage.view === 'Chapters' && firstPage.currentAvailable && firstPage.items.some(item => item.currentReadiness === 'Updating');
    const invalidatedComplete = firstPage.work.state === 'Complete' && !firstPage.snapshotId;
    if (firstPage.work.state === 'Working' && firstPage.work.id) {
      started.current = true;
      continuation.mutate({ scopeId, request: { seasonId, workId: firstPage.work.id } });
    } else if ((firstPage.work.state === 'NotStarted' && !firstPage.currentAvailable) || dueExpired || currentRowsUpdating || invalidatedComplete) {
      started.current = true;
      continuation.mutate({ scopeId, request: { seasonId } });
    }
    // Mutation state is intentionally excluded: each mounted screen starts at most one server generation chain.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstPage, seasonId]);
  const startAction = (action: ProgressAction) => {
    const search = new URLSearchParams({ mode: action.mode, format: 'Pbe', progressScopeKey: action.progressScope.key, progressScopeVersion: action.progressScope.scopeVersion });
    navigate(trainingLink(`/student/study?${search}`, seasonId));
  };
  const rows = chapters.data?.pages.flatMap(page => page.view === 'Chapters' ? page.items : []) ?? [];
  const groupRows = groups.data?.pages.flatMap(page => page.view === 'Groups' ? page.items : []) ?? [];
  const working = continuation.isPending || firstPage?.work.state === 'Working';
  return <section className="training-passage-journey pbe-chapter-journey">
    <div className="training-panel-title"><div><h2>Your PBE chapter progress</h2><p>Current Solo practice, recall and retention for your assigned questions.</p></div>{firstPage?.asOfUtc && <small>Counts checked <time dateTime={firstPage.asOfUtc}>{new Date(firstPage.asOfUtc).toLocaleDateString()}</time></small>}</div>
    {chapters.isPending ? <LoadingState label="Loading chapter progress…" /> : chapters.isError && !chapters.data ? <Notice tone="danger">Chapter progress could not load. <Button variant="secondary" onClick={() => void chapters.refetch()}>Retry chapter progress</Button></Notice> : <>
      {working && <LoadingState label="Checking chapter progress…" />}
      {continuation.isError && <Notice tone="danger">Chapter progress could not finish checking. <Button variant="secondary" onClick={() => { started.current = true; continuation.mutate({ scopeId, request: { seasonId, ...(firstPage?.work.id ? { workId: firstPage.work.id } : {}) } }); }}>Try again</Button></Notice>}
      {firstPage?.work.state === 'Blocked' && <Notice>{firstPage.work.reason === 'NoAssignment' ? 'Your coach will add your PBE assignment here.' : firstPage.work.reason === 'SeasonClosed' ? 'This season is closed. Dated stamps remain in Honors.' : 'Current chapter progress is unavailable.'}</Notice>}
      {rows.slice(0, preview ? 1 : undefined).map(progress => <PbeChapterProgress key={progress.key} progress={progress} onAction={startAction} onOpenGroups={preview ? undefined : key => setSelectedChapter({ key, label: progress.label })} />)}
      {!working && firstPage?.currentAvailable && !rows.length && <Panel><h3>No chapter progress yet</h3><p>Your assigned PBE material will appear after its current question bank is checked.</p></Panel>}
      {chapters.isFetchNextPageError && <Notice tone="danger">The next chapters could not load.</Notice>}
      {!preview && chapters.hasNextPage && <Button variant="secondary" disabled={chapters.isFetchingNextPage} onClick={() => void chapters.fetchNextPage()}>{chapters.isFetchingNextPage ? 'Loading…' : 'Load more chapters'}</Button>}
      {preview && <Link to={trainingLink('/student/progress', seasonId)}>View full PBE chapter progress<AppIcon name="arrow" /></Link>}
    </>}
    {!preview && selectedChapter && <section className="pbe-group-section" aria-labelledby="pbe-group-title">
      <div className="training-panel-title"><div><h3 id="pbe-group-title">Passage groups in {selectedChapter.label}</h3><p>Group counters can overlap and are not chapter totals.</p></div><Button variant="ghost" onClick={() => setSelectedChapter(null)}>Close groups</Button></div>
      {groups.isPending ? <LoadingState label="Loading passage groups…" /> : groups.isError ? <Notice tone="danger">Passage groups could not load. <Button variant="secondary" onClick={() => void groups.refetch()}>Retry groups</Button></Notice> : <>{groupRows.map(progress => <PbeChapterProgress key={progress.key} progress={progress} onAction={startAction} />)}{!groupRows.length && <p>No smaller passage groups are available.</p>}{groups.hasNextPage && <Button variant="secondary" disabled={groups.isFetchingNextPage} onClick={() => void groups.fetchNextPage()}>{groups.isFetchingNextPage ? 'Loading…' : 'Load more groups'}</Button>}</>}
    </section>}
  </section>;
}

type JourneyChapter = PassageJourneyPage["chapters"][number];
type JourneyPassage = JourneyChapter["passages"][number];

function passageLevelTone(level: string): "success" | "warning" | "neutral" {
  if (level === "Mastered" || level === "Strong") return "success";
  if (level === "Review") return "warning";
  return "neutral";
}

const JOURNEY_SKILLS = [
  ["Wording", "exactWording"],
  ["Reference", "reference"],
  ["Sequence", "sequence"],
  ["Recognition", "recognition"],
  ["Factual recall", "factualRecall"],
] as const;

function PassageCard({ passage, seasonId }: { passage: JourneyPassage; seasonId: string }) {
  const isV2 = passage.algorithmVersion === "v2-skill-evidence";
  const unseen = (passage.level === "Unseen" || passage.level === "Unknown") && !isV2;
  const average = isV2 ? Math.round(JOURNEY_SKILLS.reduce((sum, [, key]) => sum + passage.skills[key], 0) / JOURNEY_SKILLS.length) : null;
  const tone = passageLevelTone(passage.level);
  return <li id={`passage-${passage.knowledgeUnitId}`} className={`journey-passage-card journey-tone-${tone}${passage.dueAtUtc ? " is-due" : ""}`}>
    <div className="journey-passage-head"><strong>{passage.title}</strong><Badge tone={tone}>{passage.level}</Badge></div>
    {average !== null
      ? <ProgressMeter label={`${passage.title} average skill score`} value={average} max={100} />
      : <p className="journey-passage-hint">{unseen ? "Not practiced yet." : "Skill scores unavailable."}</p>}
    {isV2 && <details className="journey-skill-details"><summary>Skill breakdown</summary>
      <div className="training-skill-list">{JOURNEY_SKILLS.map(([label, key]) => <div key={key}><span>{label}</span><ProgressMeter label={`${passage.title}: ${label}`} value={passage.skills[key]} max={100} /></div>)}</div>
    </details>}
    {passage.dueAtUtc && <p className="journey-due">Review due <time dateTime={passage.dueAtUtc}>{new Date(passage.dueAtUtc).toLocaleDateString()}</time></p>}
    <Link className="journey-practice-link" to={trainingLink(`/student/study?mode=${passage.dueAtUtc ? "Review" : "Practice"}`, seasonId)}>Practice<AppIcon name="arrow" /></Link>
  </li>;
}

function ChapterProgressPanel({ chapter, seasonId }: { chapter: JourneyChapter; seasonId: string }) {
  const dueCount = chapter.passages.filter(passage => passage.dueAtUtc).length;
  const hasLegacy = chapter.passages.some(passage => passage.algorithmVersion !== "v2-skill-evidence" && passage.algorithmVersion !== "unknown");
  return <Panel className="journey-chapter-panel">
    <div className="training-panel-title"><h3>{chapter.bookKey} {chapter.chapter}</h3><Badge>{chapter.scopeLabel}</Badge></div>
    <div className="journey-chapter-stats">
      <div><strong>{chapter.seenCount}<span>/{chapter.eligibleCount}</span></strong><span>practiced</span></div>
      <div><strong>{chapter.strongCount}</strong><span>strong / mastered</span></div>
      {dueCount > 0 && <div className="is-due"><strong>{dueCount}</strong><span>due for review</span></div>}
    </div>
    <ProgressMeter label={`${chapter.bookKey} ${chapter.chapter} assigned passages practiced`} value={chapter.seenCount} max={chapter.eligibleCount} />
    {chapter.eligibleCount === 0 && <p>No eligible assigned passages in this chapter.</p>}
    {hasLegacy && <Notice className="journey-legacy-note">Earlier scoring — detailed skill scores aren't available for these passages.</Notice>}
    <ul className="journey-passage-grid">
      {chapter.passages.map(passage => <PassageCard key={passage.knowledgeUnitId} passage={passage} seasonId={seasonId} />)}
    </ul>
  </Panel>;
}

function MemoryPassageJourney({ seasonId, preview = false, title = 'Your passage progress' }: { seasonId: string; preview?: boolean; title?: string }) {
  const { me } = useAuth();
  const journey = useInfiniteQuery({ queryKey: ["training-journey", seasonId, me?.organizationId, me?.userId], initialPageParam: undefined as string | undefined, queryFn: ({ pageParam }) => trainingApi.journey(seasonId, pageParam), getNextPageParam: page => page.after ?? undefined });
  if (preview) {
    const chapter = journey.data?.pages.flatMap(page => page.chapters).find(item => item.eligibleCount > 0);
    return <Panel className="training-journey-preview">
      <div className="training-panel-title"><h2>Your passage progress</h2>{chapter && <span>{chapter.bookKey} {chapter.chapter} · Assigned scope</span>}</div>
      {journey.isPending ? <LoadingState label="Loading passage progress…" /> : journey.isError && !journey.data ? <Notice tone="danger">Passages could not load. <Button variant="secondary" onClick={() => void journey.refetch()}>Retry passages</Button></Notice> : chapter ? <>
        <ul className="training-passage-tiles">{chapter.passages.slice(0, 5).map(passage => {
          const unseen = (passage.level === "Unseen" || passage.level === "Unknown") && (passage.algorithmVersion === "unknown" || passage.algorithmVersion === "v2-skill-evidence");
          const legacy = !unseen && passage.algorithmVersion !== "v2-skill-evidence";
          const strong = !legacy && (passage.level === "Strong" || passage.level === "Mastered");
          return <li key={passage.knowledgeUnitId}><Link className={`training-passage-tile${strong ? " is-strong" : passage.level === "Review" && !legacy ? " needs-review" : ""}`} to={`${trainingLink("/student/progress", seasonId)}#passage-${encodeURIComponent(passage.knowledgeUnitId)}`}>
            <strong>{passage.title}</strong><span>{unseen ? "Ready to begin" : legacy ? "Legacy scoring" : passage.level}</span>
          </Link></li>;
        })}</ul>
        <div className="training-journey-footer"><p>{chapter.seenCount} of {chapter.eligibleCount} assigned passages practiced · {chapter.strongCount} Strong or Mastered</p><Link to={trainingLink("/student/progress", seasonId)}>View full passage progress<AppIcon name="arrow" /></Link></div>
      </> : <><h3>No eligible passages yet</h3><p>Your coach will add your study assignment here.</p></>}
    </Panel>;
  }
  return <section className="training-passage-journey"><h2>{title}</h2><p>Choose an assigned passage to practice.</p>{journey.isPending ? <LoadingState label="Loading passage progress…" /> : journey.isError && !journey.data ? <Notice tone="danger">Passages could not load. <Button variant="secondary" onClick={() => void journey.refetch()}>Retry passages</Button></Notice> : <>{journey.data?.pages.flatMap((page, pageIndex) => page.chapters.slice(0, preview ? 1 : undefined).map((chapter, index) => <ChapterProgressPanel key={`${pageIndex}:${index}`} chapter={chapter} seasonId={seasonId} />))}{!journey.data?.pages.some(page => page.chapters.some(chapter => chapter.eligibleCount > 0)) && <Panel><h3>No eligible passages yet</h3><p>Your coach will add your study assignment here.</p></Panel>}{journey.isFetchNextPageError && <Notice tone="danger">The next passages could not load. Try loading more again.</Notice>}{!preview && journey.hasNextPage && <Button variant="secondary" disabled={journey.isFetchingNextPage} onClick={() => void journey.fetchNextPage()}>{journey.isFetchingNextPage ? "Loading…" : "Load more passages"}</Button>}<div className="training-controls">{preview && <LinkButton variant="secondary" to={trainingLink("/student/progress", seasonId)}>View full passage progress</LinkButton>}<LinkButton variant="secondary" to={trainingLink("/student/study?mode=Review", seasonId)}>Review due passages</LinkButton><LinkButton variant="secondary" to={trainingLink("/student/study?mode=Practice", seasonId)}>Practice passages</LinkButton></div></>}</section>;
}

export function PassageJourney({ seasonId, preview = false, format = 'Memory' }: { seasonId: string; preview?: boolean; format?: 'Memory' | 'Pbe' }) {
  if (format === 'Pbe') return <><PbeJourney seasonId={seasonId} preview={preview} />{!preview && <MemoryPassageJourney seasonId={seasonId} title="Your Memory passage progress" />}</>;
  return <MemoryPassageJourney seasonId={seasonId} preview={preview} />;
}
