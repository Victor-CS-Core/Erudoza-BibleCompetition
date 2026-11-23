import { AppIcon } from "../../components/AppIcon";
import { LinkButton, Notice, Panel, ProgressMeter } from "../../components/ui";

export type MissionStepView = {
  kind: string;
  target: number;
  completed: number;
  status: string;
};

type TrainingMissionCardProps = {
  title: string;
  description: string;
  /** Assigned-passage scope line ("N cards · Your assigned passages"). */
  scope: { target: number; kind: string } | null;
  /** Due reviews as one mission row; href is null when the learner cannot start them. */
  reviewDue: { count: number; href: string | null } | null;
  /** Unavailable-state explanation (not used in the choose-passages state). */
  notice: string | null;
  /** Adult with no usable assignment: the notice's meaning folds into this
   *  subtext and the single My assignments action — no separate notice box. */
  choosePassages: boolean;
  myAssignmentsHref: string | null;
  updatedTrainingHref: string | null;
  recapHref: string | null;
  startDeck: { label: string; href: string } | null;
  simulation: { label: string; href: string } | null;
  steps: MissionStepView[];
  /** The next action's mode, for the is-next step dot. */
  nextKind: string | null;
};

/**
 * HQ's "Your training assignment" card, presented with the game layer: one
 * action hierarchy, the due review as a single coral mission row (count
 * integrated with its action, no floating chip), and the passage steps as
 * meter rows on the shared spacing scale. Presentation only — every href,
 * label, and data point is computed by StudentHomePage exactly as before.
 */
export function TrainingMissionCard({ title, description, scope, reviewDue, notice, choosePassages, myAssignmentsHref, updatedTrainingHref, recapHref, startDeck, simulation, steps, nextKind }: TrainingMissionCardProps) {
  return <Panel className="training-mission game-mission-card">
    <div className="training-mission-main">
      <h2>{title}</h2>
      <p className="training-mission-description">{description}</p>
      {scope && <p className="training-mission-scope"><AppIcon name="book" /><span>{scope.target} {scope.kind === "Review" ? "due passages" : "cards"} · Your assigned passages</span></p>}
      {reviewDue && <div className="game-mission-due">
        <span className="game-mission-due__icon" aria-hidden="true"><AppIcon name="review" /></span>
        <strong className="game-mission-due__count">{reviewDue.count} {reviewDue.count === 1 ? "review" : "reviews"} due</strong>
        {reviewDue.href && <LinkButton to={reviewDue.href}>Start due reviews</LinkButton>}
      </div>}
      {notice && <Notice data-testid="academy-track-unavailable">{notice}</Notice>}
      {choosePassages && <p className="training-mission-choose">Choose your study passages in My assignments.</p>}
      <div className="training-mission-actions">
        {myAssignmentsHref && <LinkButton to={myAssignmentsHref}>My assignments</LinkButton>}
        {updatedTrainingHref && <LinkButton to={updatedTrainingHref}>Start updated training</LinkButton>}
        {recapHref && <LinkButton to={recapHref}>See today’s recap<AppIcon name="arrow" /></LinkButton>}
        {startDeck && <LinkButton data-testid="start-todays-deck" to={startDeck.href}>{startDeck.label}<AppIcon name="arrow" /></LinkButton>}
        {simulation && <LinkButton variant="secondary" data-testid="start-simulation" to={simulation.href}>{simulation.label}</LinkButton>}
      </div>
    </div>
    {!!steps.length && <ol className="training-mission-steps">{steps.map((step, index) => {
      const resolved = step.status === "Complete" || step.status === "NotNeeded";
      const stepTitle = step.kind === "Review" ? "Refresh your memory" : "Practice your passage";
      return <li key={step.kind}>
        <span className={`training-step-dot${resolved ? " is-complete" : step.kind === nextKind ? " is-next" : ""}`} aria-hidden="true">{resolved ? <AppIcon name="check" /> : index + 1}</span>
        <div className="training-mission-step-copy">
          <h3>{stepTitle}</h3>
          <p>{step.status === "NotNeeded" ? "No review needed today" : `${step.completed} of ${step.target} ${step.kind === "Review" ? "passages" : "cards"} completed`}</p>
          <ProgressMeter label={`${stepTitle} progress`} value={step.completed} max={step.target} hideCaption />
        </div>
        <span className="training-step-state">{step.status === "NotNeeded" ? "Up to date" : step.status === "Complete" ? "Done" : step.status === "Active" ? "In progress" : step.status === "Invalidated" ? "Changed" : ""}</span>
      </li>;
    })}</ol>}
  </Panel>;
}
