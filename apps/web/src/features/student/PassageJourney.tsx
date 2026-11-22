import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { ApiError } from "../../api/client";
import type { ContinueChaptersRequest, ProgressAction } from "../../api/pbeTypes";
import { trainingApi } from "../../api/training";
import { useAuth } from "../../auth/AuthContext";
import { Button, LoadingState, Notice, Panel } from "../../components/ui";
import { trainingLink } from "./trainingAssets";
import { AppIcon } from "../../components/AppIcon";
import { PbeChapterProgress } from "./PbeChapterProgress";

type ChapterContinuationInput = {
  request: ContinueChaptersRequest;
  scopeId: number;
};

export function PbeJourney({ seasonId, preview }: { seasonId: string; preview: boolean }) {
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
  // Training HQ preview hides the tile entirely when the chapter bank holds no progress:
  // an empty preview would otherwise show jargon ("No chapter progress yet / …question bank
  // is checked") with no news value. Loading, working, and error states stay honest; the full
  // Progress page (preview=false) keeps the empty-state panel. All hooks are above this return.
  if (preview && !chapters.isPending && !chapters.isError && !continuation.isError && !working && !!firstPage?.currentAvailable && rows.length === 0) return null;
  return <section className="training-passage-journey pbe-chapter-journey">
    <div className="training-panel-title"><div><h2>Your PBE chapter progress</h2><p>Current Solo practice, recall and retention for your assigned questions.</p></div>{firstPage?.asOfUtc && <small>Counts checked <time dateTime={firstPage.asOfUtc}>{new Date(firstPage.asOfUtc).toLocaleDateString()}</time></small>}</div>
    {chapters.isPending ? <LoadingState label="Loading chapter progress…" /> : chapters.isError && !chapters.data ? <Notice tone="danger">Chapter progress could not load. <Button variant="secondary" onClick={() => void chapters.refetch()}>Retry chapter progress</Button></Notice> : <>
      {working && <LoadingState label="Checking chapter progress…" />}
      {continuation.isError && <Notice tone="danger">Chapter progress could not finish checking. <Button variant="secondary" onClick={() => { started.current = true; continuation.mutate({ scopeId, request: { seasonId, ...(firstPage?.work.id ? { workId: firstPage.work.id } : {}) } }); }}>Try again</Button></Notice>}
      {firstPage?.work.state === 'Blocked' && <Notice>{firstPage.work.reason === 'NoAssignment' ? 'Your coach will add your PBE assignment here.' : firstPage.work.reason === 'SeasonClosed' ? 'This season is closed. Dated stamps remain with your Achievement patches.' : 'We could not load your chapter progress right now.'}</Notice>}
      {rows.slice(0, preview ? 1 : undefined).map(progress => <PbeChapterProgress key={progress.key} progress={progress} onAction={startAction} onOpenGroups={preview ? undefined : key => setSelectedChapter({ key, label: progress.label })} />)}
      {!working && firstPage?.currentAvailable && !rows.length && <Panel><h3>No chapter progress yet</h3><p>Your assigned PBE material will appear after its current question bank is checked.</p></Panel>}
      {chapters.isFetchNextPageError && <Notice tone="danger">The next chapters could not load.</Notice>}
      {!preview && chapters.hasNextPage && <Button variant="secondary" disabled={chapters.isFetchingNextPage} onClick={() => void chapters.fetchNextPage()}>{chapters.isFetchingNextPage ? 'Loading…' : 'Load more chapters'}</Button>}
      {preview && <Link to={trainingLink('/student', seasonId)}>View full PBE chapter progress<AppIcon name="arrow" /></Link>}
    </>}
    {!preview && selectedChapter && <section className="pbe-group-section" aria-labelledby="pbe-group-title">
      <div className="training-panel-title"><div><h3 id="pbe-group-title">Passage groups in {selectedChapter.label}</h3><p>Group counters can overlap and are not chapter totals.</p></div><Button variant="ghost" onClick={() => setSelectedChapter(null)}>Close groups</Button></div>
      {groups.isPending ? <LoadingState label="Loading passage groups…" /> : groups.isError ? <Notice tone="danger">Passage groups could not load. <Button variant="secondary" onClick={() => void groups.refetch()}>Retry groups</Button></Notice> : <>{groupRows.map(progress => <PbeChapterProgress key={progress.key} progress={progress} onAction={startAction} />)}{!groupRows.length && <p>No smaller passage groups are available.</p>}{groups.hasNextPage && <Button variant="secondary" disabled={groups.isFetchingNextPage} onClick={() => void groups.fetchNextPage()}>{groups.isFetchingNextPage ? 'Loading…' : 'Load more groups'}</Button>}</>}
    </section>}
  </section>;
}
