import { useQuery } from "@tanstack/react-query";
import { trainingApi } from "../../api/training";
import type { PbeReadinessDimension } from "../../api/pbeTypes";
import { Badge, HelpTip, Panel, ProgressMeter } from "../../components/ui";

/**
 * Card 49 (GitHub #50): the readiness dimensions panel. The server
 * composes the dimensions at read time from stored evidence
 * (pbe-readiness-v1) — this panel only renders them. A dimension with
 * no evidence yet shows "Not measured yet" with NO bar: an honest
 * pending state, never a guessed fill.
 */
export function PbeReadinessPanel({ seasonId }: { seasonId: string }) {
  const readiness = useQuery({ queryKey: ["pbe-readiness", seasonId], queryFn: () => trainingApi.pbeReadiness(seasonId), retry: false });
  if (readiness.isError) return null;
  return <Panel as="section" aria-labelledby="pbe-readiness-title" data-testid="pbe-readiness">
    <div className="training-panel-title">
      <div>
        <h3 id="pbe-readiness-title">Your readiness</h3>
        <p>What your practice so far shows, measured from your real answers.</p>
      </div>
      <HelpTip label="About readiness">
        <p>Each line is worked out from answers you have already given — targets practiced, recall that held up, points earned, timed runs, and finished team matches. Nothing here is a separate score: it explains the same progress your XP already counts. A line that says “Not measured yet” simply means there is nothing to measure so far.</p>
      </HelpTip>
    </div>
    {readiness.isPending || !readiness.data ? <p role="status">Loading your readiness…</p> : <ul className="pbe-readiness-list">
      {readiness.data.dimensions.map(dimension => <ReadinessRow key={dimension.key} dimension={dimension} />)}
    </ul>}
  </Panel>;
}

function ReadinessRow({ dimension }: { dimension: PbeReadinessDimension }) {
  return <li className="pbe-readiness-row">
    <div className="pbe-readiness-head">
      <strong>{dimension.key}</strong>
      {dimension.percent === null ? <Badge tone="neutral">Not measured yet</Badge> : <span className="pbe-readiness-percent">{dimension.percent}%</span>}
    </div>
    {dimension.percent !== null && <ProgressMeter label={`${dimension.key} readiness`} value={dimension.percent} max={100} hideCaption />}
    <p><small>{dimension.basis}</small></p>
  </li>;
}
