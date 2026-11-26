import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { ApiError } from "../../api/client";
import { practiceApi } from "../../api/practice";
import type { PracticeRoom, RoomRecap } from "../../api/practice";
import { useAuth } from "../../auth/AuthContext";
import { AppIcon } from "../../components/AppIcon";
import { Badge, Button, LinkButton, LoadingState, Notice, PageHeader, Panel } from "../../components/ui";
import { evidenceDate, trainingLink } from "../student/trainingAssets";
import { CelebrationBurst } from "../student/CelebrationBurst";
import "../student/student.css";

/** XP awarded per completed bonus quest; mirrors server XP_VALUES.questCompleted. */
const QUEST_XP = 25;

const points = (hundredths: number) => Math.round(hundredths / 100);

/**
 * Recap finality, derived only from existing contracts — never invented:
 * - the recap payload's own `status` (the server serves the recap only for
 *   completed rooms; any other status string maps to interrupted/incomplete);
 * - the room projection's `provisional` / `pendingCount`, the same fields
 *   PracticePage already reads for this room (unresolved appeals and pending
 *   coach reviews). The recap DTO carries no pending-review field of its own.
 */
export type RecapFinality = "finalized" | "review-pending" | "interrupted" | "incomplete";

export function recapFinality(data: Pick<RoomRecap, "status">, room?: Pick<PracticeRoom, "provisional" | "pendingCount"> | null): RecapFinality {
  if (data.status === "Interrupted") return "interrupted";
  if (data.status !== "Completed") return "incomplete";
  if (room && (room.provisional || (room.pendingCount ?? 0) > 0)) return "review-pending";
  return "finalized";
}

const INTERRUPTION_COPY: Record<string, string> = {
  ArmedResponsesUntrusted: "A submitted response could not be verified, so the match stopped to keep the result fair.",
  UnarmedReserveUnavailable: "A question had to be replaced and no verified reserve question was available, so the match stopped.",
};

/** Terminal-but-not-completed recap: finality first, no XP or reward presentation, one next action. */
export function RoomRecapEnded({ finality, interruptionReason, hubTo }: { finality: "interrupted" | "incomplete"; interruptionReason?: string | null; hubTo: string }) {
  const interrupted = finality === "interrupted";
  return <Panel>
    <div className="training-recap-finality" role="status">
      <Badge tone="warning">{interrupted ? "Interrupted" : "Incomplete"}</Badge>
      <p>{interrupted ? "This room did not finish, so its result is not final." : "This room ended before the match finished."}</p>
    </div>
    <h2>{interrupted ? "This match was interrupted." : "This match ended early."}</h2>
    <p>{interrupted ? (INTERRUPTION_COPY[interruptionReason ?? ""] ?? "The match stopped before it finished.") : "The room was abandoned before the match finished. Incomplete matches do not grant completion honors."}</p>
    <p>This room did not complete, so it recorded no XP, quest, or day credit.</p>
    <div className="training-recap-actions"><LinkButton to={hubTo}>Back to Team Practice</LinkButton></div>
  </Panel>;
}

/**
 * The completed-room recap body, regrouped around finality (GitHub #46):
 * finality → team accuracy/points → Arcade speed bonus → personal
 * contribution → XP → quests/day credit → team milestones → one next action.
 * Presentational: query ownership stays in RoomRecapPage.
 */
export function RoomRecapView({ data, finality, pendingCount, seasonId }: { data: RoomRecap; finality: RecapFinality; pendingCount: number; seasonId: string | null }) {
  const link = (path: string) => trainingLink(path, seasonId);
  const [shareState, setShareState] = useState<"idle" | "copied" | "failed">("idle");
  const questsCompleted = data.questsCompleted ?? [];
  const pending = finality === "review-pending";
  // Rewards are only celebrated — and shareable — once the result is final.
  const hasCelebration = finality === "finalized" && questsCompleted.length > 0;
  const shareText = data && hasCelebration
    ? `I finished a ${data.simulation ? "full-event team rehearsal" : data.format === "Pbe" ? "PBE team practice room" : "team practice room"} on Erudoza: Team ${data.myTeam} scored ${points(data.teamScore.accuracyHundredths)} points, and I answered ${data.contributions.questionsAnswered} question${data.contributions.questionsAnswered === 1 ? "" : "s"}.${questsCompleted.length ? ` Completed quests: ${questsCompleted.map(quest => quest.title).join(", ")} (+${questsCompleted.length * QUEST_XP} XP).` : ""}`
    : null;
  const share = async () => {
    if (!shareText) return;
    try {
      await navigator.clipboard.writeText(shareText);
      setShareState("copied");
    } catch {
      const area = document.createElement("textarea");
      area.value = shareText;
      document.body.appendChild(area);
      area.select();
      try {
        document.execCommand("copy");
        setShareState("copied");
      } catch {
        setShareState("failed");
      }
      document.body.removeChild(area);
    }
  };
  return <div className="training-recap-layout">
    <Panel className="training-recap-main">
      {hasCelebration && <CelebrationBurst celebrate />}
      <div className="training-recap-finality" role="status">
        <Badge tone={pending ? "warning" : "success"}>{pending ? "Review pending" : "Finalized"}</Badge>
        <p>{pending
          ? pendingCount > 0
            ? `${pendingCount} answer${pendingCount === 1 ? " is" : "s are"} awaiting coach review. Scores and rewards stay provisional until every review is resolved.`
            : "A coach review is still open for this room. Scores and rewards stay provisional until it is resolved."
          : "This result is final."}</p>
      </div>
      <Badge tone="success">{data.simulation ? "Full-event team rehearsal" : data.format === "Pbe" ? "PBE team practice" : "Arcade team practice"} · {data.status}</Badge>
      <h2 className="training-recap-title">Match complete.</h2>
      <dl className="training-recap-stats" aria-label="Saved room counts">
        <div><dt>Your team</dt><dd>Team {data.myTeam}</dd></div>
        <div><dt>Team score</dt><dd>{points(data.teamScore.accuracyHundredths)} points</dd></div>
        <div><dt>Points available</dt><dd>{points(data.teamScore.availableHundredths)} points</dd></div>
        {data.format === "Arcade" && data.teamScore.speedHundredths > 0 && <div><dt>Speed bonus</dt><dd>+{points(data.teamScore.speedHundredths)} points</dd></div>}
        <div><dt>Your answers</dt><dd>{data.contributions.questionsAnswered} of {data.questionCount} questions</dd></div>
        <div><dt>Your accuracy</dt><dd>{points(data.contributions.accuracyHundredths)} points</dd></div>
        <div><dt>XP earned</dt><dd>{data.xp.tracked ? `+${data.xp.earned}` : "Not tracked"}</dd></div>
      </dl>
      {!data.xp.tracked && <p><small>This room was played before room XP tracking, so it shows no XP. Newer rooms earn XP automatically.</small></p>}
      {data.completedAtUtc && <p><small>Completed <time dateTime={data.completedAtUtc}>{evidenceDate(data.completedAtUtc)}</time></small></p>}
      {(questsCompleted.length > 0 || data.dayCredited) && <div className="training-recap-celebrations">
        {questsCompleted.map(quest => pending
          ? <p key={quest.key} className="training-recap-recorded"><AppIcon name="check" /><span><strong>Quest complete: {quest.title}</strong> +{QUEST_XP} XP</span></p>
          : <p key={quest.key} className="training-celebration"><AppIcon name="check" /><span><strong>Quest complete: {quest.title}!</strong> +{QUEST_XP} XP</span></p>)}
        {data.dayCredited && <p className={pending ? "training-recap-recorded" : "training-celebration"}><AppIcon name="check" /><span><strong>Practice day credited.</strong> This room counts toward your weekly goal and streak.</span></p>}
        {pending && <p><small>Rewards from this room can change while reviews are open.</small></p>}
      </div>}
      {shareText && <div className="training-recap-share">
        <Button variant="secondary" onClick={() => void share()}>{shareState === "copied" ? "Copied to clipboard" : "Share your progress"}</Button>
        {shareState === "failed" && <p><small>Copy didn’t work on this device. Your summary: {shareText}</small></p>}
      </div>}
      <div className="training-recap-actions"><LinkButton to={link(`/student/practice/${encodeURIComponent(data.roomId)}`)}>Review answers</LinkButton></div>
    </Panel>
    <aside className="training-recap-side" aria-label="Room result details">
      <Panel><h2>How this room counted</h2>
        <p>{data.format === "Pbe" ? "PBE rubric points — no Arcade speed bonus." : "Arcade scoring: accuracy plus up to 25% as a speed bonus."}</p>
        {data.simulation ? <p>Full-event team rehearsal. Completing it counts toward Simulation honors.</p> : <p>Head-to-head practice with {data.teamCount} {data.teamCount === 1 ? "team" : "teams"}.</p>}
        <p>Team results stay separate from your individual Scripture mastery.</p>
      </Panel>
      <Panel><h2>Team milestones</h2>
        {!data.awards.length ? <p>No team milestones recorded for this season yet.</p> : <ul className="training-quest-list">{data.awards.map(award => <li key={award.key}><div className="training-quest-head"><strong>{award.title}</strong><Badge tone="success">Recorded</Badge></div></li>)}</ul>}
        <p><small>Team milestones are recorded from team play across the season, not just this room. They don&rsquo;t become profile patches.</small></p>
      </Panel>
    </aside>
  </div>;
}

/** Team-room recap: the completion summary for a finished practice room, modeled on the solo session recap. */
export function RoomRecapPage() {
  const { roomId } = useParams();
  const [params, setParams] = useSearchParams();
  const { me } = useAuth();
  const recap = useQuery({ queryKey: ["room-recap", roomId, me?.organizationId, me?.userId], queryFn: () => practiceApi.roomRecap(me!.organizationId, roomId!), enabled: !!roomId && !!me });
  // Finality-only read of the room's existing projection (provisional /
  // pendingCount / status). Failure-tolerant and never blocking: on error the
  // recap derives finality from its own payload alone.
  const room = useQuery({ queryKey: ["room-recap-finality", roomId, me?.organizationId], queryFn: () => practiceApi.room(me!.organizationId, roomId!), enabled: !!roomId && !!me, retry: false });
  const data = recap.data;
  const seasonId = data?.seasonId ?? params.get("seasonId");
  useEffect(() => {
    if (data?.seasonId && params.get("seasonId") !== data.seasonId) {
      const next = new URLSearchParams(params); next.set("seasonId", data.seasonId); setParams(next, { replace: true });
    }
  }, [data?.seasonId, params, setParams]);
  const link = (path: string) => trainingLink(path, seasonId);
  const recapNotCompleted = recap.isError && recap.error instanceof ApiError && recap.error.status === 409;
  const waitingOnRoom = !!roomId && (recap.isSuccess || recapNotCompleted) && room.isPending;
  const finality = data ? recapFinality(data, room.data ?? null) : null;
  return <div className="training-dashboard training-recap"><PageHeader title="Room recap" description="Your saved team practice result." action={<LinkButton variant="secondary" to={link("/student/practice")}>Back to Team Practice</LinkButton>} />
    {!roomId ? <Notice tone="danger">This recap link is incomplete. Return to Team Practice to find your room.</Notice> : recap.isPending || waitingOnRoom ? <LoadingState label="Loading your room recap…" /> : recapNotCompleted ? (room.data?.status === "Interrupted" || room.data?.status === "Abandoned"
      ? <RoomRecapEnded finality={room.data.status === "Interrupted" ? "interrupted" : "incomplete"} interruptionReason={room.data.interruptionReason} hubTo={link("/student/practice")} />
      : <Panel><h2>This room has not completed yet</h2><p>Recaps are available once the match is complete.</p><LinkButton to={link(`/student/practice/${encodeURIComponent(roomId)}`)}>Open room</LinkButton></Panel>) : recap.isError ? <Notice tone="danger">This recap is unavailable or you do not have access. <Button variant="secondary" onClick={() => void recap.refetch()}>Try again</Button></Notice> : data && finality !== "interrupted" && finality !== "incomplete" && finality
      ? <RoomRecapView data={data} finality={finality} pendingCount={room.data?.pendingCount ?? 0} seasonId={seasonId} />
      : data ? <RoomRecapEnded finality={finality === "interrupted" ? "interrupted" : "incomplete"} hubTo={link("/student/practice")} /> : null}
  </div>;
}
