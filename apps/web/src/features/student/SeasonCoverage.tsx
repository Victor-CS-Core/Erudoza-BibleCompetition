import { useEffect, useRef } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ApiError } from '../../api/client';
import type { CooperationSnapshot, CooperationStudentSummary, CountRange, MaterialSummary, OwnMaterialSummary } from '../../api/pbeTypes';
import { trainingApi } from '../../api/training';
import { Badge, Button, LoadingState, Notice, Panel, ProgressMeter } from '../../components/ui';
import { evidenceDate } from './trainingAssets';

type SeasonCoverageProps = {
  snapshot: CooperationSnapshot;
  audience: 'student' | 'coach';
  students?: CooperationStudentSummary[];
  onContinue?: () => void;
  onRetry?: () => void;
  busy?: boolean;
};

const percent = (value: number) => `${Math.round(value * 100)}%`;
const rangeText = (range: CountRange, exact: (count: number) => string, provisional: (known: number, possible: number) => string) =>
  range.known === range.possible ? exact(range.known) : provisional(range.known, range.possible);

function TeamMaterial({ kind, summary }: { kind: 'Scripture' | 'Introduction'; summary: MaterialSummary }) {
  const item = kind === 'Scripture' ? 'passage' : 'introduction unit';
  const items = kind === 'Scripture' ? 'passages' : 'introduction units';
  const retained = rangeText(summary.retained,
    count => `${count} of ${summary.assigned} ${items} retained by at least one student`,
    (known, possible) => `${known} confirmed retained; up to ${possible} possible`);
  const due = rangeText(summary.due,
    count => `${count} ${count === 1 ? item : items} ${count === 1 ? 'needs' : 'need'} maintenance`,
    (known, possible) => `Maintenance known for ${known}; up to ${possible} possible`);
  return <div className="pbe-coverage-material">
    <div className="training-panel-title"><h3>{kind}</h3><Badge>{summary.assigned} assigned</Badge></div>
    <p>{retained}</p>
    <p>{due}</p>
    <p>{rangeText(summary.questionCovered, count => `${count} have current question coverage`, (known, possible) => `${known} confirmed with questions; up to ${possible} possible`)}</p>
    <p>{rangeText(summary.practiced, count => `${count} reached by Solo practice`, (known, possible) => `${known} confirmed practiced; up to ${possible} possible`)}</p>
    {summary.equalRetained && <p>Equal student progress: {summary.equalRetained.lower === summary.equalRetained.upper ? percent(summary.equalRetained.lower) : `${percent(summary.equalRetained.lower).replace('%', '')}–${percent(summary.equalRetained.upper)} known range`}</p>}
  </div>;
}

function OwnMaterial({ kind, summary }: { kind: 'passages' | 'introduction units'; summary: OwnMaterialSummary }) {
  if (!summary.assigned) return null;
  return <div>
    <p>Your retained assignment: {rangeText(summary.retained, count => `${count} of ${summary.assigned} ${kind}`, (known, possible) => `${known} confirmed of ${summary.assigned} ${kind}; up to ${possible} possible`)}</p>
    <ProgressMeter label={`Your retained ${kind}`} value={summary.retained.known} max={summary.assigned} />
    <small>{rangeText(summary.due, count => `${count} maintenance ${count === 1 ? 'item' : 'items'} known`, (known, possible) => `${known} maintenance items known; up to ${possible} possible`)}</small>
  </div>;
}

const blockedReason: Record<string, string> = {
  PbeDisabled: 'PBE progress is unavailable while new PBE practice is disabled.',
  SeasonClosed: 'This season is closed. Current cooperation progress is unavailable.',
  ScopeTooLarge: 'This season is larger than the current cooperation-progress limit.',
  InputTooLarge: 'This season has more saved progress than can be checked at once.',
  DataGap: 'Some required progress data could not be checked.',
};

export function SeasonCoverage({ snapshot, audience, students = [], onContinue, onRetry, busy = false }: SeasonCoverageProps) {
  const published = (snapshot.state === 'Snapshot' || snapshot.state === 'Provisional') && !!snapshot.snapshotId;
  const empty = published && (snapshot.scripture?.assigned ?? 0) === 0 && (snapshot.introduction?.assigned ?? 0) === 0;
  return <Panel className="pbe-season-coverage" aria-labelledby="pbe-season-coverage-title">
    <div className="training-panel-title"><div><h2 id="pbe-season-coverage-title">Season cooperation</h2><p>Independent Solo progress across assigned material. Team answers do not count as Solo recall.</p></div><Badge tone={snapshot.state === 'Snapshot' ? 'success' : snapshot.state === 'Provisional' ? 'warning' : 'neutral'}>{snapshot.state === 'Snapshot' ? 'Checked snapshot' : snapshot.state}</Badge></div>
    {snapshot.state === 'NotStarted' && <><p>Season progress has not been checked yet.</p>{onContinue && <Button disabled={busy} onClick={onContinue}>{busy ? 'Starting…' : 'Check season progress'}</Button>}</>}
    {snapshot.state === 'Updating' && <><p role="status">Checking assigned material and saved Solo progress.</p>{snapshot.work.next === 'Continue' && onContinue && <Button disabled={busy} onClick={onContinue}>{busy ? 'Checking…' : 'Continue checking progress'}</Button>}{snapshot.work.next === 'Reload' && onContinue && <Button variant="secondary" disabled={busy} onClick={onContinue}>Refresh checked progress</Button>}</>}
    {snapshot.state === 'Blocked' && <><p>{blockedReason[snapshot.reason ?? ''] ?? 'Season cooperation progress is unavailable.'}</p>{onRetry && <Button variant="secondary" disabled={busy} onClick={onRetry}>Try again</Button>}</>}
    {published && <>
      {snapshot.state === 'Provisional' && <p>{snapshot.unknownStudents} of {snapshot.rosterStudents} student records are still unknown. Possible values are labeled separately.</p>}
      {empty ? <p>No eligible material is assigned for this season.</p> : <div className="pbe-coverage-grid">{snapshot.scripture && <TeamMaterial kind="Scripture" summary={snapshot.scripture} />}{snapshot.introduction && <TeamMaterial kind="Introduction" summary={snapshot.introduction} />}</div>}
      {audience === 'student' && snapshot.own && <div className="pbe-own-contribution"><h3>Your assigned progress</h3>{snapshot.own.state === 'Unassigned' ? <p>You are unassigned in this season.</p> : snapshot.own.state === 'Unknown' ? <p>Your assignment is counted, but your saved progress is still unknown.</p> : <><OwnMaterial kind="passages" summary={snapshot.own.scripture} /><OwnMaterial kind="introduction units" summary={snapshot.own.introduction} /></>}</div>}
      {audience === 'coach' && <div className="pbe-coach-breakdown"><h3>Student progress</h3>{students.length ? <ul className="training-list">{students.map(student => <li key={student.studentId}><div><strong>{student.displayName}</strong>{student.state === 'Unassigned' ? <p>Unassigned</p> : student.state === 'Unknown' ? <p>Progress unknown</p> : <>{student.scripture.assigned > 0 && <p>{student.scripture.retained.known} of {student.scripture.assigned} passages retained</p>}{student.introduction.assigned > 0 && <p>{student.introduction.retained.known} of {student.introduction.assigned} introduction units retained</p>}</>}</div><Badge tone={student.state === 'Known' ? 'success' : 'neutral'}>{student.state}</Badge></li>)}</ul> : <p>No student detail is available for this snapshot.</p>}</div>}
      {snapshot.checkedAtUtc && <p><small>Checked <time dateTime={snapshot.checkedAtUtc}>{evidenceDate(snapshot.checkedAtUtc)}</time>. Maintenance counts are as of this check.</small></p>}
    </>}
  </Panel>;
}

export function SeasonCoveragePanel({ seasonId, audience, organizationId }: { seasonId: string; audience: 'student' | 'coach'; organizationId?: string }) {
  const scopeKey = `${audience}:${organizationId ?? ''}:${seasonId}`;
  const chapterPublication = useQuery<string | null>({ queryKey: ['pbe-chapter-publication', seasonId], queryFn: async () => null, enabled: false });
  const publicationId = audience === 'student' ? chapterPublication.data ?? null : null;
  const active = useRef(true), started = useRef(false), staleRecoveryAttempted = useRef(false), currentScope = useRef(scopeKey), currentPublication = useRef(publicationId), handledPublication = useRef(publicationId), detailReloaded = useRef<string | null>(null), settledSnapshotId = useRef<string | null>(null);
  currentScope.current = scopeKey;
  const snapshot = useQuery({
    queryKey: ['pbe-cooperation', audience, organizationId, seasonId],
    queryFn: () => audience === 'coach' ? trainingApi.coachCooperation(organizationId!, seasonId) : trainingApi.cooperation(seasonId),
    enabled: audience === 'student' || !!organizationId,
  });
  const continuation = useMutation({
    mutationFn: (input: { scopeKey: string; publicationId: string | null; audience: 'student' | 'coach'; organizationId?: string; seasonId: string; workId?: string }) => input.audience === 'coach'
      ? trainingApi.continueCoachCooperation(input.organizationId!, input.seasonId, { seasonId: input.seasonId, ...(input.workId ? { workId: input.workId } : {}) })
      : trainingApi.continueCooperation({ seasonId: input.seasonId, ...(input.workId ? { workId: input.workId } : {}) }),
    onSuccess: (response, input) => {
      if (!active.current || currentScope.current !== input.scopeKey || currentPublication.current !== input.publicationId || response.seasonId !== input.seasonId) return;
      if (response.work.next === 'Continue') continuation.mutate({ ...input, workId: response.work.id ?? undefined });
      else void snapshot.refetch();
    },
    onError: (error, input) => {
      if (!active.current || currentScope.current !== input.scopeKey || currentPublication.current !== input.publicationId) return;
      if (!staleRecoveryAttempted.current && error instanceof ApiError && (error.code === 'PBE_COOPERATION_WORK_STALE' || error.code === 'PBE_COOPERATION_CURSOR_STALE')) {
        staleRecoveryAttempted.current = true;
        void snapshot.refetch().then(result => {
          if (!active.current || currentScope.current !== input.scopeKey || currentPublication.current !== input.publicationId || result.isError) return;
          started.current = true;
          continuation.mutate({ ...input, workId: undefined });
        });
      }
    },
  });
  const published = snapshot.data && (snapshot.data.state === 'Snapshot' || snapshot.data.state === 'Provisional') && !!snapshot.data.snapshotId;
  const students = useQuery({
    queryKey: ['pbe-cooperation-students', organizationId, seasonId, snapshot.data?.snapshotId],
    queryFn: () => trainingApi.cooperationStudents(organizationId!, seasonId, { limit: 32 }),
    enabled: audience === 'coach' && !!organizationId && !!published,
  });
  const detailMismatch = !!published && !!students.data && students.data.snapshotId !== snapshot.data?.snapshotId;
  useEffect(() => {
    active.current = true;
    continuation.reset();
    started.current = false;
    staleRecoveryAttempted.current = false;
    currentScope.current = scopeKey;
    currentPublication.current = publicationId;
    handledPublication.current = publicationId;
    detailReloaded.current = null;
    settledSnapshotId.current = null;
    return () => { active.current = false; };
    // The mutation observer is reset at the same boundary guarded by currentScope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);
  useEffect(() => {
    if (audience !== 'student' || !publicationId || handledPublication.current === publicationId) return;
    handledPublication.current = publicationId;
    currentPublication.current = publicationId;
    continuation.reset();
    staleRecoveryAttempted.current = false;
    started.current = true;
    continuation.mutate({ scopeKey, publicationId, audience, organizationId, seasonId });
    // A new chapter snapshot starts one new cooperation epoch; its identity fences older callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicationId, scopeKey]);
  useEffect(() => {
    if (!detailMismatch || !snapshot.data?.snapshotId || !students.data?.snapshotId) return;
    const mismatchKey = `${snapshot.data.snapshotId}:${students.data.snapshotId}`;
    if (detailReloaded.current === mismatchKey) return;
    detailReloaded.current = mismatchKey;
    void snapshot.refetch();
  }, [detailMismatch, snapshot, students.data?.snapshotId]);
  useEffect(() => {
    const data = snapshot.data;
    if (!data || data.seasonId !== seasonId || continuation.isPending || continuation.isError) return;
    const dueExpired = published && !!data.dueRefreshAtUtc && Date.parse(data.dueRefreshAtUtc) <= Date.now();
    if (published && !dueExpired) {
      if (settledSnapshotId.current !== data.snapshotId) {
        settledSnapshotId.current = data.snapshotId;
        started.current = false;
      }
      return;
    }
    if (started.current) return;
    if (data.state === 'NotStarted' || (data.state === 'Updating' && data.work.next === 'Continue')) {
      started.current = true;
      continuation.mutate({ scopeKey, publicationId: currentPublication.current, audience, organizationId, seasonId, workId: data.work.id ?? undefined });
    } else if (dueExpired || (data.state === 'Updating' && data.work.next === 'Reload')) {
      started.current = true;
      continuation.mutate({ scopeKey, publicationId: currentPublication.current, audience, organizationId, seasonId });
    }
    // Each unpublished or expired generation drives at most one finite server chain.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [published, snapshot.data]);
  if (snapshot.isPending) return <Panel aria-busy="true"><LoadingState label="Loading season cooperation…" /></Panel>;
  if (snapshot.isError || !snapshot.data) return <Notice tone="danger">Season cooperation could not load. <Button variant="secondary" onClick={() => void snapshot.refetch()}>Try again</Button></Notice>;
  if (snapshot.data.seasonId !== seasonId) return <Panel aria-busy="true"><LoadingState label="Loading season cooperation…" /></Panel>;
  return <>
    {continuation.isError && <Notice tone="danger">Season cooperation could not finish checking. Use Try again to restart from saved work.</Notice>}
    {students.isError && <Notice tone="danger">Student cooperation detail could not load. <Button variant="secondary" onClick={() => void students.refetch()}>Retry student detail</Button></Notice>}
    <SeasonCoverage snapshot={snapshot.data} audience={audience} students={detailMismatch ? undefined : students.data?.items} busy={continuation.isPending || snapshot.isFetching}
      onContinue={() => { started.current = true; continuation.mutate({ scopeKey, publicationId: currentPublication.current, audience, organizationId, seasonId, workId: snapshot.data.state === 'Updating' && snapshot.data.work.next === 'Reload' ? undefined : snapshot.data.work.id ?? undefined }); }}
      onRetry={() => {
        continuation.reset();
        staleRecoveryAttempted.current = false;
        started.current = true;
        continuation.mutate({ scopeKey, publicationId: currentPublication.current, audience, organizationId, seasonId });
      }} />
  </>;
}
