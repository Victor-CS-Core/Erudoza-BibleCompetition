import type { TrainingToday } from "../../api/trainingTypes";
import { Badge, LinkButton, Panel } from "../../components/ui";
import { PbeReadinessPanel } from "./PbeReadinessPanel";

/**
 * Card 48 (GitHub #50): the solo PBE entry composed as "PBE Readiness" —
 * deliberately NOT a third HQ (Training HQ and Team Practice HQ already
 * exist). Presentation-only: the hero's action is the training summary's
 * own deterministic nextAction, the run cards link to the real session
 * modes, the dimensions come from card 49's derived view, and the patch
 * strip reads the summary's honors progress. No new contract, no team
 * skill lab, no progression ladder.
 */
const RUN_TYPES: { mode: string; name: string; detail: string; badge: string }[] = [
  { mode: "Practice", name: "Practice", detail: "Learn the material with feedback after every answer and the source aid on request.", badge: "8 questions · untimed" },
  { mode: "Rescue", name: "Rescue", detail: "A short repair run drawn only from questions you recently missed.", badge: "3 questions · untimed" },
  { mode: "Review", name: "Review", detail: "Questions that are due again, so earlier learning sticks.", badge: "Due set · untimed" },
  { mode: "Checkpoint", name: "Checkpoint", detail: "A timed checkpoint on the official clock — answers freeze when time ends.", badge: "10 questions · official clock" },
  { mode: "MockHalf", name: "Half mock", detail: "Half an event sitting, straight through with no break.", badge: "45 questions · official clock" },
  { mode: "MockFull", name: "Full mock", detail: "A full event sitting with a halftime break after question 45.", badge: "90 questions · official clock" },
  { mode: "Simulation", name: "Challenge", detail: "The shortened timed rehearsal — feedback waits until the finish.", badge: "10 questions · official clock" },
];

function runHref(seasonId: string | undefined, mode: string) {
  const params = new URLSearchParams({ mode, format: "Pbe" });
  if (seasonId) params.set("seasonId", seasonId);
  return `/student/study?${params}`;
}

export function PbeReadinessSection({ seasonId, today }: { seasonId?: string; today: TrainingToday }) {
  const action = today.nextAction;
  const actionHref = action ? (() => {
    const params = new URLSearchParams({ mode: action.mode, format: "Pbe" });
    if (seasonId) params.set("seasonId", seasonId);
    if (action.sessionId) params.set("sessionId", action.sessionId);
    return `/student/study?${params}`;
  })() : runHref(seasonId, "Practice");
  const honors = today.honors ?? [];
  const earned = honors.filter(h => h.earnedAtUtc);
  const nextHonor = honors.filter(h => !h.earnedAtUtc && h.target > 0).sort((a, b) => b.completed / b.target - a.completed / a.target)[0];
  const readinessSeasonId = today.seasonId ?? seasonId;
  return <div className="pbe-readiness-stack">
    <Panel as="section" aria-labelledby="pbe-readiness-hero-title" className="pbe-readiness-hero">
      <p className="pbe-readiness-eyebrow">Solo PBE</p>
      <h2 id="pbe-readiness-hero-title">PBE Readiness</h2>
      <p>Build recall, prove it on the official clock, and watch your readiness grow — every run below uses your assigned passages and the real competition timing.</p>
      <LinkButton to={actionHref} data-testid="pbe-readiness-next-action">{action?.label ?? "Start PBE practice"}</LinkButton>
    </Panel>

    <Panel as="section" aria-labelledby="pbe-run-types-title">
      <div className="training-panel-title">
        <div>
          <h3 id="pbe-run-types-title">Choose your run</h3>
          <p>Untimed runs teach; timed runs prove it. A timed run never starts short — if the questions are not ready, it will say so.</p>
        </div>
      </div>
      <ul className="pbe-run-list">
        {RUN_TYPES.map(run => <li key={run.mode} className="pbe-run-row">
          <div className="pbe-run-copy">
            <strong>{run.name}</strong>
            <span>{run.detail}</span>
          </div>
          <Badge>{run.badge}</Badge>
          <LinkButton to={runHref(seasonId, run.mode)} data-testid={`pbe-run-${run.mode}`}>Start</LinkButton>
        </li>)}
      </ul>
    </Panel>

    {readinessSeasonId && <PbeReadinessPanel seasonId={readinessSeasonId} />}

    <Panel as="section" aria-labelledby="pbe-patch-strip-title">
      <div className="training-panel-title">
        <div>
          <h3 id="pbe-patch-strip-title">Your patches</h3>
          <p>{earned.length === 0 ? "No patches earned yet — your first finished runs start filling this shelf." : `${earned.length} ${earned.length === 1 ? "patch" : "patches"} earned so far.`}{nextHonor ? ` Next up: ${nextHonor.title} (${nextHonor.completed} of ${nextHonor.target}).` : ""}</p>
        </div>
        <LinkButton to={seasonId ? `/student/honors?seasonId=${encodeURIComponent(seasonId)}` : "/student/honors"} variant="secondary">See all patches</LinkButton>
      </div>
      {earned.length > 0 && <ul className="pbe-patch-strip">
        {earned.map(h => <li key={h.key}><Badge tone="success">{h.title}</Badge></li>)}
      </ul>}
    </Panel>
  </div>;
}
