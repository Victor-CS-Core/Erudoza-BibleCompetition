import { Badge, HelpTip, LinkButton, Panel } from "../../components/ui";
import { QuestCard, XPBar, nextLevelName } from "../../components/game/GameLayer";
import type { TrainingToday } from "../../api/trainingTypes";
import type { PracticeAward, PracticeTrend, RoomSummary, SimulationAchievement } from "../../api/practice";
import { HonorPatchCard } from "../profile/HonorPatchCard";
import { MasteryHonorArtwork } from "../profile/MasteryHonorArtwork";
import { UseAsProfileImageButton } from "../profile/UseAsProfileImageButton";
import type { MasteryHonorOption } from "../profile/profile";
import { evidenceDate } from "../student/trainingAssets";
import { activeRoomTeams, points, roomSizeLabel } from "./practiceUtils";

/**
 * Practice HQ Phase 1 (GitHub #45): presentational sections that compose the
 * existing training summary + practice bootstrap into a player-first hub.
 * Every value comes from the server DTOs — no new contract, no second ledger.
 * The hub keeps query ownership; these components only render.
 */

export type HubCta = { label: string; to: string };

const dayWord = (count: number) => (count === 1 ? "day" : "days");

/** Progress hero: season context, the role-aware primary CTA, the shared
 *  XP/level bar (real curve values from the training summary), and the
 *  streak. The CTA destination is decided by the hub from bootstrap state:
 *  Students get their assigned room or Study; Coaches get event creation. */
export function PracticeHero({ seasonLabel, heading, today, cta, secondary }: {
  seasonLabel: string;
  heading: string;
  today: TrainingToday | null;
  cta: HubCta;
  secondary?: HubCta;
}) {
  return <Panel className="practice-hq-hero" aria-labelledby="practice-hq-hero-title">
    <div className="practice-hq-hero-copy">
      <p className="practice-hq-eyebrow">{seasonLabel}</p>
      <h2 id="practice-hq-hero-title">{heading}</h2>
      <p className="practice-hq-sub">Practice together, earn XP, and unlock verified patches.</p>
      <div className="practice-hq-actions">
        <LinkButton to={cta.to}>{cta.label}</LinkButton>
        {secondary && <LinkButton variant="secondary" to={secondary.to}>{secondary.label}</LinkButton>}
      </div>
    </div>
    {today && <div className="practice-hq-progress">
      <p className="practice-hq-level">Level {today.xp.level} · {today.xp.levelName}</p>
      <XPBar xp={{ total: today.xp.total, xpIntoLevel: today.xp.xpIntoLevel, xpForNext: today.xp.xpForNext, nextLevelName: nextLevelName(today.xp.level), levelName: today.xp.levelName }} />
      <p className="practice-hq-streak">Streak: <strong>{today.streak.current} {dayWord(today.streak.current)}</strong>{today.streak.best > today.streak.current && <> · Best: {today.streak.best} {dayWord(today.streak.best)}</>}</p>
    </div>}
  </Panel>;
}

/** Today's mission: the real mission steps and bonus quests from the
 *  training summary, with one continuation action (the summary's own
 *  nextAction, routed by the hub through the existing Study flow). */
export function PracticeMissionCard({ today, continueHref }: { today: TrainingToday; continueHref: string }) {
  const steps = today.mission.steps.filter(step => step.status !== "NotNeeded" || step.completed > 0);
  const action = today.nextAction;
  return <Panel id="practice-mission" aria-labelledby="practice-mission-title">
    <div className="practice-hub-section-heading"><h2 id="practice-mission-title">Today&rsquo;s mission</h2>{today.mission.status === "Complete" && <Badge tone="success">Complete</Badge>}</div>
    {!!steps.length && <ul className="practice-hq-steps">{steps.map(step => <li key={step.kind}>
      <span>{step.kind === "Review" ? "Refresh your memory" : step.kind === "Simulation" ? "Run a rehearsal" : "Practice your passage"}</span>
      <span className="practice-hq-step-count">{step.completed} of {step.target} {step.kind === "Review" ? "passages" : "cards"}{step.status === "Complete" ? " · Done" : ""}</span>
    </li>)}</ul>}
    {!!today.quests.length && <ul className="practice-hq-quests">{today.quests.map(quest => <QuestCard key={quest.key} quest={quest} />)}</ul>}
    {action && <div className="practice-hq-card-action"><LinkButton variant="secondary" to={continueHref}>{action.label}</LinkButton></div>}
    {!steps.length && !today.quests.length && !action && <p className="practice-hub-secondary">No mission steps today. Your next assigned practice will appear here.</p>}
  </Panel>;
}

/** Streak rescue: shown when no room is ready — the summary's nextAction as
 *  a short continuation, plus weekly-goal progress. No second streak ledger:
 *  the streak and week come straight from the training summary. */
export function PracticeStreakCard({ today, continueHref }: { today: TrainingToday; continueHref: string }) {
  const action = today.nextAction;
  return <Panel className="practice-hq-streak-card" aria-labelledby="practice-streak-title">
    <div className="practice-hub-section-heading"><h2 id="practice-streak-title">Keep your streak</h2><Badge tone={today.streak.state === "paused" ? "warning" : "info"}>{today.streak.current} {dayWord(today.streak.current)}</Badge></div>
    <p>{today.streak.state === "paused" || today.streakNudge
      ? "Paused, not lost. A short practice today keeps your streak alive."
      : today.streak.state === "active"
        ? "Your streak is alive. Keep it going with a short practice today."
        : "Start your first streak with a short practice today."}</p>
    <p className="practice-hq-week">Weekly goal: {today.week.completedDays} of {today.week.target} practice {dayWord(today.week.target)} this week.</p>
    <div className="practice-hq-card-action"><LinkButton to={continueHref}>{action ? action.label : "Continue assigned study"}</LinkButton></div>
  </Panel>;
}

/**
 * Practice HQ Phase 2 (GitHub #49): room facts derived ONLY from the
 * bootstrap room summary the server already sends (memberCount + the
 * projected member list with team/ready/captain/scribe). Seats follow the
 * room page's own rule: every active team holds teamSize players, and the
 * per-team join cap makes the totals equivalent to a per-team check.
 */
export type RoomSeatFacts = {
  seatsTotal: number;
  seatsFilled: number;
  readyCount: number | null;
  notReadyNames: string[];
  full: boolean;
  allReady: boolean;
};

export function roomSeatFacts(room: Pick<RoomSummary, "teamSize" | "teamCount" | "memberCount" | "members">): RoomSeatFacts {
  const seatsTotal = room.teamSize * activeRoomTeams(room).length;
  const members = room.members?.length ? room.members : null;
  const seatsFilled = members ? members.length : room.memberCount;
  const notReadyNames = members ? members.filter(member => !member.ready).map(member => member.displayName) : [];
  const full = seatsFilled >= seatsTotal;
  return {
    seatsTotal,
    seatsFilled,
    readyCount: members ? members.filter(member => member.ready).length : null,
    notReadyNames,
    full,
    allReady: full && members !== null && notReadyNames.length === 0,
  };
}

/** "Ana", "Ana and Ben", "Ana, Ben and Cid", "Ana, Ben and 2 more". */
export function nameList(names: string[]): string {
  if (names.length <= 1) return names.join("");
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

/** The exact reason a lobby cannot start yet — the same rule the room
 *  enforces at start (every seat filled, then every player ready), in the
 *  room page's own order. Null when the room is not in the lobby or when
 *  nothing blocks the start beyond opening it. */
export function startWaitingText(room: Pick<RoomSummary, "status" | "teamSize" | "teamCount" | "memberCount" | "members">): string | null {
  if (room.status !== "Lobby") return null;
  const facts = roomSeatFacts(room);
  if (!facts.full) {
    const missing = facts.seatsTotal - facts.seatsFilled;
    return `Start is waiting on ${missing} more ${missing === 1 ? "player" : "players"} to fill the seats.`;
  }
  if (facts.readyCount === null) return null;
  if (facts.notReadyNames.length) return `Start is waiting on ${nameList(facts.notReadyNames)} to mark ready.`;
  return "Everyone is ready — open the lobby to start the match.";
}

/** The viewer's own place in the room, from the payload only: owner first,
 *  then their member entry (captain/scribe/teammate), then the guiding
 *  coach of a coached room. Null when the payload gives them no role. */
export function roomRoleText(room: RoomSummary, meUserId: string): string | null {
  if (room.ownerId === meUserId) return "You’re the room owner.";
  const mine = room.members?.find(member => member.userId === meUserId);
  if (mine) {
    const roles = [mine.captain && "captain", mine.scribe && "scribe"].filter(Boolean) as string[];
    const team = activeRoomTeams(room).length === 1 ? "your team" : `Team ${mine.team}`;
    return roles.length ? `You’re ${team}’s ${roles.join(" and ")}.` : `You’re on ${team === "your team" ? "the team" : team}.`;
  }
  if (room.coachId === meUserId) return "You guide this room as its coach.";
  return null;
}

/** Current room, promoted to the hub's next actionable step: seats filled,
 *  the viewer's role, readiness, and the exact reason Start is waiting —
 *  all from the bootstrap summary, agreeing with the hero's room CTA. */
export function PracticeRoomCard({ room, meUserId, seasonLabel, roomHref }: {
  room: RoomSummary;
  meUserId: string;
  seasonLabel: string;
  roomHref: string;
}) {
  const facts = roomSeatFacts(room);
  const role = roomRoleText(room, meUserId);
  const waiting = startWaitingText(room);
  const playing = room.status === "Playing";
  return <Panel className="practice-room-card" aria-label="Current room">
    <div className="practice-room-card-main">
      <div><Badge tone={playing ? "success" : "info"}>{room.status}</Badge></div>
      <h2>{playing ? "Your match is in progress." : "Your room is waiting for players."}</h2>
      <p className="practice-room-card-meta">{seasonLabel} · {roomSizeLabel(room)} · {room.questionCount} {room.questionCount === 1 ? "question" : "questions"}{room.coached ? " · Coach-led" : ""} · {room.memberCount} {room.memberCount === 1 ? "player" : "players"}</p>
      <p className="practice-room-card-seats">{facts.seatsFilled} of {facts.seatsTotal} seats filled</p>
      {role && <p className="practice-room-card-role">{role}</p>}
      {room.status === "Lobby" && facts.readyCount !== null && <p className="practice-room-card-ready">{facts.readyCount} of {facts.seatsTotal} players ready</p>}
      {waiting && <p className="practice-room-card-waiting" aria-live="polite">{waiting}</p>}
    </div>
    <LinkButton to={roomHref}>{playing ? "Return to match" : "Open lobby"}</LinkButton>
  </Panel>;
}

/** Where an invitation leads, when the destination room rides along in the
 *  same bootstrap payload: its season, shape, and how full it already is.
 *  Null when the payload does not carry the room — nothing is invented. */
export function invitationDestinationText(room: RoomSummary | undefined, seasonName: (id: string) => string): string | null {
  if (!room) return null;
  const facts = roomSeatFacts(room);
  return `${seasonName(room.seasonId)} · ${roomSizeLabel(room)} room · ${facts.seatsFilled} of ${facts.seatsTotal} seats filled`;
}

/** Practice pulse: effort, not prestige — streak, finalized accuracy, patch
 *  progress, and average response time ONLY from a finalized trend that
 *  supplies averageResponseMs (provisional trends and missing values omit
 *  it; nothing is computed client-side as a competing metric). */
export function PracticePulse({ trends, today, achievements, seasonId }: {
  trends: PracticeTrend[] | undefined;
  today: TrainingToday | null;
  achievements: SimulationAchievement[] | undefined;
  seasonId: string;
}) {
  const played = (trends ?? []).filter(trend => trend.matches > 0 && trend.availableHundredths > 0);
  const trend = played.filter(item => item.seasonId === seasonId).sort((a, b) => b.matches - a.matches)[0] ?? played.sort((a, b) => b.matches - a.matches)[0];
  const seasonAchievements = (achievements ?? []).filter(item => !seasonId || item.seasonId === seasonId);
  const patchPool = seasonAchievements.length ? seasonAchievements : (achievements ?? []);
  const patchesEarned = patchPool.filter(item => item.earnedAtUtc).length;
  const responseSeconds = trend && !trend.provisional && trend.averageResponseMs > 0 ? (trend.averageResponseMs / 1000).toFixed(1) : null;
  const hasStats = !!today || !!trend || !!patchPool.length;
  return <Panel id="practice-pulse" aria-labelledby="practice-pulse-title">
    <div className="practice-hub-section-heading"><h2 id="practice-pulse-title">Your practice pulse</h2>{trend?.provisional && <Badge tone="warning">Review pending</Badge>}</div>
    {!hasStats && <p className="practice-hub-secondary">Complete a match and resolve its appeals to start your practice pulse.</p>}
    {hasStats && <dl className="practice-stats practice-hq-pulse-stats">
      {today && <div><dt>Streak</dt><dd>{today.streak.current} {dayWord(today.streak.current)}</dd></div>}
      {trend && <div><dt>Finalized accuracy</dt><dd>{Math.round(trend.accuracyHundredths / trend.availableHundredths * 100)}%</dd></div>}
      {!!patchPool.length && <div><dt>Simulation patches</dt><dd>{patchesEarned} of {patchPool.length} earned</dd></div>}
      {responseSeconds && <div><dt>Average response</dt><dd>{responseSeconds}s</dd></div>}
    </dl>}
    {trend?.provisional && <p className="practice-hq-pulse-note">Pending answers are excluded from finalized accuracy.</p>}
  </Panel>;
}

/**
 * Practice HQ Phase 4 (GitHub #47): team momentum — the team's recent
 * finalized form, composed ONLY from the participant-scoped trends the
 * server already groups by season, passage scope, team size, and rules.
 * Nothing is aggregated across groupings in the browser, and team evidence
 * stays visibly separate from individual Scripture mastery. Average
 * response time renders only from a finalized trend (a provisional trend
 * omits it, exactly like the pulse); one-team PBE never renders an
 * opponent-facing line (no wins/draws, no speed bonus).
 */
export function PracticeMomentum({ trends, seasonName }: {
  trends: PracticeTrend[] | undefined;
  seasonName: (id: string) => string;
}) {
  const entries = (trends ?? []).filter(trend => trend.matches > 0);
  return <Panel id="practice-progress" aria-labelledby="practice-progress-title">
    <h2 id="practice-progress-title">Team momentum<HelpTip label="About team momentum">Your team&rsquo;s finalized match evidence, grouped by season, passage scope, team size, and rules. Team evidence describes team practice together; it never changes individual Scripture mastery.</HelpTip></h2>
    {!entries.length && <p className="practice-hub-secondary">No finalized team matches yet. Complete a room together and settle its reviews, and your team&rsquo;s momentum will build here.</p>}
    {entries.map(trend => <article className="practice-review" key={`${trend.seasonId}-${trend.teamSize}-${trend.bookKey}-${trend.format}-${trend.teamCount}-${trend.ruleVersion}-${trend.scoringVersion}`}>
      <h3>{seasonName(trend.seasonId)} · {roomSizeLabel(trend)} · {trend.bookKey || "Season scope"}</h3>
      {trend.provisional && <p><Badge tone="warning">Review pending</Badge> {trend.pendingCount ? <>{trend.pendingCount} answer{trend.pendingCount === 1 ? "" : "s"} awaiting review. </> : <>Some answers are awaiting review. </>}Pending answers are excluded from finalized accuracy.</p>}
      <dl className="practice-stats"><div><dt>{trend.format === "Pbe" ? "Finalized accuracy" : "Accuracy"}</dt><dd>{trend.availableHundredths ? Math.round(trend.accuracyHundredths / trend.availableHundredths * 100) : 0}%</dd></div>{trend.format !== "Pbe" && <div><dt>Speed bonus</dt><dd>{points(trend.speedHundredths)}</dd></div>}<div><dt>Completed</dt><dd>{trend.matches}</dd></div>{trend.format !== "Pbe" && trend.teamCount !== 1 && <div><dt>Wins / draws</dt><dd>{trend.wins} / {trend.draws}</dd></div>}{!trend.provisional && trend.averageResponseMs > 0 && <div><dt>Average response</dt><dd>{(trend.averageResponseMs / 1000).toFixed(1)}s</dd></div>}</dl>
      <p>{trend.distinctQuestions} distinct {trend.distinctQuestions === 1 ? "question" : "questions"} · {trend.distinctPassages} {trend.distinctPassages === 1 ? "passage" : "passages"} · {trend.participatedQuestions} {trend.participatedQuestions === 1 ? "question" : "questions"} with your participation · {trend.unansweredQuestions} unanswered {trend.unansweredQuestions === 1 ? "question" : "questions"}.</p><small>Rules: {trend.ruleVersion}</small>
    </article>)}
    {!!entries.length && <p className="practice-momentum-note">Team evidence stays separate from individual Scripture mastery — these results never change anyone&rsquo;s mastery record.</p>}
  </Panel>;
}

/**
 * Patch shelf states (GitHub #47). A patch is Earned when the server
 * recorded it, In progress only when the payload carries real progress
 * toward it (simulation achievements carry current/target; profile honors
 * carry no progress, so they are never shown as in progress), and Locked
 * otherwise. The shelf orders Earned → In progress → Locked, stable
 * within each state, and locked/in-progress tiles show the requirement
 * the payload carries.
 */
export type PatchState = "earned" | "in-progress" | "locked";

export function simulationPatchState(achievement: SimulationAchievement): PatchState {
  if (achievement.earnedAtUtc) return "earned";
  return achievement.current > 0 ? "in-progress" : "locked";
}

export function honorPatchState(honor: Pick<MasteryHonorOption, "earnedAtUtc">): PatchState {
  return honor.earnedAtUtc ? "earned" : "locked";
}

const patchStateRank: Record<PatchState, number> = { earned: 0, "in-progress": 1, locked: 2 };

export function shelfOrder<T>(items: readonly T[], stateOf: (item: T) => PatchState): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => patchStateRank[stateOf(a.item)] - patchStateRank[stateOf(b.item)] || a.index - b.index)
    .map(({ item }) => item);
}

/** "1 earned · 1 in progress · 1 locked" — zero counts are omitted. */
export function shelfSummary(states: readonly PatchState[]): string {
  const count = (state: PatchState) => states.filter(item => item === state).length;
  return [
    count("earned") && `${count("earned")} earned`,
    count("in-progress") && `${count("in-progress")} in progress`,
    count("locked") && `${count("locked")} locked`,
  ].filter(Boolean).join(" · ");
}

/** Simulation patch tile: a profile patch earned together through
 *  completed simulations, presented on the shipped HonorPatchCard. */
export function SimulationPatchCard({ achievement, worn }: { achievement: SimulationAchievement; worn: boolean }) {
  const state = simulationPatchState(achievement);
  return <HonorPatchCard
    title={achievement.title}
    artwork={<MasteryHonorArtwork honorKey={achievement.key} size={208} muted={state !== "earned"} />}
    status={<>
      <Badge tone={state === "earned" ? "success" : state === "in-progress" ? "info" : "neutral"}>{state === "earned" ? "Earned" : state === "in-progress" ? "In progress" : "Locked"}</Badge>
      <span>{achievement.current} / {achievement.target}</span>
      {state !== "earned" && <span className="practice-shelf-requirement">{achievement.requirement}</span>}
    </>}
    detail={<>
      <MasteryHonorArtwork honorKey={achievement.key} size={192} muted={state !== "earned"} />
      <p>{achievement.requirement}</p>
      <p>Progress: {achievement.current} of {achievement.target}</p>
      {state === "earned" ? <><p>Earned <time dateTime={achievement.earnedAtUtc!}>{evidenceDate(achievement.earnedAtUtc!)}</time>. Your qualifying evidence is saved.</p><UseAsProfileImageButton honorKey={achievement.key} title={achievement.title} worn={worn} /></>
        : state === "in-progress" ? <p>You&rsquo;re on your way. Complete more simulations together to unlock this patch for your profile.</p>
        : <p>This patch is locked. Complete simulations together to unlock it for your profile.</p>}
    </>}
  />;
}

/** Team Practice Achievement patch tile: a profile patch from the
 *  learner's own finalized Team Practice mastery evidence. The payload
 *  carries no progress for these, so a locked tile shows its requirement
 *  instead of an invented progress bar. */
export function TeamPracticePatchCard({ honor, worn }: { honor: MasteryHonorOption; worn: boolean }) {
  const state = honorPatchState(honor);
  return <HonorPatchCard
    title={honor.title}
    artwork={<MasteryHonorArtwork honorKey={honor.key} size={208} muted={state !== "earned"} />}
    status={state === "earned"
      ? <><Badge tone="success">Earned</Badge><span>Earned <time dateTime={honor.earnedAtUtc!}>{evidenceDate(honor.earnedAtUtc!)}</time></span></>
      : <><Badge>Locked</Badge><span className="practice-shelf-requirement">{honor.requirement}</span></>}
    detail={<>
      <MasteryHonorArtwork honorKey={honor.key} size={192} muted={state !== "earned"} />
      <p>{honor.category}</p>
      <h3>How to unlock</h3>
      <p>{honor.requirement}</p>
      {state === "earned" ? <><p>Earned <time dateTime={honor.earnedAtUtc!}>{evidenceDate(honor.earnedAtUtc!)}</time>. Your qualifying evidence is saved.</p><UseAsProfileImageButton honorKey={honor.key} title={honor.title} worn={worn} /></> : <p>This patch is locked. Meet every requirement to unlock it for your profile.</p>}
    </>}
  />;
}

/** Team milestones: recorded from team participation and finalized team
 *  scores under their saved team rules. Milestones are a separate
 *  category from profile patches — they never become profile images. */
export function PracticeMilestones({ achievements, seasonName }: {
  achievements: PracticeAward[];
  seasonName: (id: string) => string;
}) {
  return <details className="ds-disclosure practice-milestone-history">
    <summary>Practice milestones<HelpTip label="About practice milestones">Team milestones record participation and finalized team scores. PBE milestones use their saved team rules and do not unlock profile images.</HelpTip></summary>
    <p className="practice-shelf-category">Team milestones · recorded from team participation and finalized team scores. Milestones don&rsquo;t become profile patches.</p>
    <div className="practice-awards">{achievements.map(award => <div key={award.key + "-" + award.seasonId}><MasteryHonorArtwork honorKey={"team:" + award.key.replace(/^pbe-team-v1:/, "")} size={72} /><strong>{award.title}</strong><small>{seasonName(award.seasonId)}</small><Badge>Milestone recorded</Badge></div>)}</div>
    {!achievements.length && <p className="practice-hub-secondary">No team milestones recorded.</p>}
  </details>;
}
