import type { ProgressAction, ProgressRow } from '../../api/pbeTypes';
import { Badge, Button, Panel, ProgressMeter } from '../../components/ui';
import { evidenceDate } from './trainingAssets';

function readinessLabel(progress: ProgressRow) {
  if (progress.currentReadiness === 'Updating') return 'Updating current work';
  if (progress.currentReadiness === 'Incomplete') return 'Current work incomplete';
  if (progress.kind === 'Introduction') return 'Introduction retained';
  if (progress.kind === 'PassageGroup') return 'Group retained';
  return progress.wholeChapterAssigned ? 'Chapter retained' : 'Assigned passages retained';
}

export function PbeChapterProgress({ progress, onAction, onOpenGroups }: {
  progress: ProgressRow;
  onAction: (action: ProgressAction) => void;
  onOpenGroups?: (chapterKey: string) => void;
}) {
  const { counts } = progress;
  const units = progress.kind === 'Introduction' ? 'introduction units' : 'assigned passages';
  return <Panel as="article" className="pbe-chapter-card" aria-labelledby={`pbe-progress-${progress.key}`}>
    <div className="training-panel-title">
      <div><h3 id={`pbe-progress-${progress.key}`}>{progress.label}</h3><p>{progress.scopeLabel}</p></div>
      <Badge tone={progress.currentReadiness === 'Retained' ? 'success' : progress.currentReadiness === 'Updating' ? 'info' : 'neutral'}>{readinessLabel(progress)}</Badge>
    </div>
    <p>{counts.questionCoveredPassages} of {counts.assignedPassages} {units} have questions</p>
    {counts.totalTargets > 0 ? <>
      <ProgressMeter label={`${progress.label} targets practiced`} value={counts.practicedTargets} max={counts.totalTargets} />
      <dl className="pbe-chapter-counts">
        <div><dt>Practiced</dt><dd>{counts.practicedTargets} of {counts.totalTargets}</dd></div>
        <div><dt>Recalled</dt><dd>{counts.recalledTargets} of {counts.totalTargets}</dd></div>
        <div><dt>Retained</dt><dd>{counts.retainedTargets} of {counts.totalTargets}</dd></div>
        <div><dt>Due or repair</dt><dd>{counts.dueTargets}</dd></div>
      </dl>
    </> : <p>No eligible targets yet</p>}
    {counts.missingVariantTargets > 0 && <p><small>{counts.missingVariantTargets} {counts.missingVariantTargets === 1 ? 'target needs' : 'targets need'} another current recall-question variant before retention can be established.</small></p>}
    {progress.stamp && <div className="pbe-chapter-stamp" data-testid="chapter-stamp">
      <Badge tone="success">Dated stamp</Badge>
      <strong>{progress.stamp.label}</strong>
      <span>{progress.stamp.scopeLabel}</span>
      <time dateTime={progress.stamp.earnedAtUtc}>{evidenceDate(progress.stamp.earnedAtUtc)}</time>
      {progress.stamp.matchesCurrentScope === false && <small>Earned for an earlier assigned scope.</small>}
    </div>}
    {progress.hasHistoricalStamps && !progress.stamp && <p><small>A dated stamp exists for an earlier assignment or rule. See stamp history for its saved scope.</small></p>}
    <div className="training-controls">
      {progress.actions.map(action => <Button key={`${action.mode}:${action.progressScope.key}`} variant={action.mode === 'Practice' ? 'primary' : 'secondary'} onClick={() => onAction(action)}>{action.label}</Button>)}
      {progress.kind === 'Chapter' && onOpenGroups && <Button variant="ghost" onClick={() => onOpenGroups(progress.key)}>View passage groups</Button>}
    </div>
  </Panel>;
}
