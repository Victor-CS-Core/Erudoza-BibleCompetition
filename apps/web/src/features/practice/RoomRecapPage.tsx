import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { ApiError } from "../../api/client";
import { practiceApi } from "../../api/practice";
import { useAuth } from "../../auth/AuthContext";
import { AppIcon } from "../../components/AppIcon";
import { Badge, Button, LinkButton, LoadingState, Notice, PageHeader, Panel } from "../../components/ui";
import { evidenceDate, trainingLink } from "../student/trainingAssets";
import { CelebrationBurst } from "../student/CelebrationBurst";
import "../student/student.css";

/** XP awarded per completed bonus quest; mirrors server XP_VALUES.questCompleted. */
const QUEST_XP = 25;

const points = (hundredths: number) => Math.round(hundredths / 100);

/** Team-room recap: the completion summary for a finished practice room, modeled on the solo session recap. */
export function RoomRecapPage() {
  const { roomId } = useParams();
  const [params, setParams] = useSearchParams();
  const { me } = useAuth();
  const recap = useQuery({ queryKey: ["room-recap", roomId, me?.organizationId, me?.userId], queryFn: () => practiceApi.roomRecap(me!.organizationId, roomId!), enabled: !!roomId && !!me });
  const data = recap.data;
  const seasonId = data?.seasonId ?? params.get("seasonId");
  useEffect(() => {
    if (data?.seasonId && params.get("seasonId") !== data.seasonId) {
      const next = new URLSearchParams(params); next.set("seasonId", data.seasonId); setParams(next, { replace: true });
    }
  }, [data?.seasonId, params, setParams]);
  const link = (path: string) => trainingLink(path, seasonId);
  const [shareState, setShareState] = useState<"idle" | "copied" | "failed">("idle");
  const questsCompleted = data?.questsCompleted ?? [];
  const hasCelebration = questsCompleted.length > 0;
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
  return <div className="training-dashboard training-recap"><PageHeader title="Room recap" description="Your saved team practice result." action={<LinkButton variant="secondary" to={link("/student/practice")}>Back to Team Practice</LinkButton>} />
    {!roomId ? <Notice tone="danger">This recap link is incomplete. Return to Team Practice to find your room.</Notice> : recap.isPending ? <LoadingState label="Loading your room recap…" /> : recap.isError && recap.error instanceof ApiError && recap.error.status === 409 ? <Panel><h2>This room has not completed yet</h2><p>Recaps are available once the match is complete.</p><LinkButton to={link(`/student/practice/${encodeURIComponent(roomId)}`)}>Open room</LinkButton></Panel> : recap.isError ? <Notice tone="danger">This recap is unavailable or you do not have access. <Button variant="secondary" onClick={() => void recap.refetch()}>Try again</Button></Notice> : data && <>
      <div className="training-recap-layout">
        <Panel className="training-recap-main">
          {hasCelebration && <CelebrationBurst celebrate />}
          <Badge tone="success">{data.simulation ? "Full-event team rehearsal" : data.format === "Pbe" ? "PBE team practice" : "Arcade team practice"} · {data.status}</Badge>
          <h2 className="training-recap-title">Match complete.</h2>
          {hasCelebration && <div className="training-recap-celebrations" role="status">
            {questsCompleted.map(quest => <p key={quest.key} className="training-celebration"><AppIcon name="check" /><span><strong>Quest complete: {quest.title}!</strong> +{QUEST_XP} XP</span></p>)}
          </div>}
          {data.dayCredited && <p className="training-celebration"><AppIcon name="check" /><span><strong>Practice day credited.</strong> This room counts toward your weekly goal and streak.</span></p>}
          <dl className="training-recap-stats" aria-label="Saved room counts">
            <div><dt>Your team</dt><dd>Team {data.myTeam}</dd></div>
            <div><dt>Team score</dt><dd>{points(data.teamScore.accuracyHundredths)} points{data.format === "Arcade" && data.teamScore.speedHundredths > 0 && <> (+{points(data.teamScore.speedHundredths)} speed bonus)</>}</dd></div>
            <div><dt>Your answers</dt><dd>{data.contributions.questionsAnswered} of {data.questionCount} questions</dd></div>
            <div><dt>XP earned</dt><dd>{data.xp.tracked ? `+${data.xp.earned}` : "Not tracked"}</dd></div>
          </dl>
          {!data.xp.tracked && <p><small>This room was played before room XP tracking, so it shows no XP. Newer rooms earn XP automatically.</small></p>}
          <p><small>Completed <time dateTime={data.completedAtUtc!}>{evidenceDate(data.completedAtUtc!)}</time></small></p>
          <div className="training-recap-actions"><LinkButton to={link("/student/practice")}>Back to Team Practice</LinkButton></div>
          {shareText && <div className="training-recap-share">
            <Button variant="secondary" onClick={() => void share()}>{shareState === "copied" ? "Copied to clipboard" : "Share your progress"}</Button>
            {shareState === "failed" && <p><small>Copy didn’t work on this device. Your summary: {shareText}</small></p>}
          </div>}
        </Panel>
        <aside className="training-recap-side" aria-label="Room result details">
          <Panel><h2>How this room counted</h2>
            <p>{data.format === "Pbe" ? "PBE rubric points — no Arcade speed bonus." : "Arcade scoring: accuracy plus up to 25% as a speed bonus."}</p>
            {data.simulation ? <p>Full-event team rehearsal. Completing it counts toward Simulation honors.</p> : <p>Head-to-head practice with {data.teamCount} {data.teamCount === 1 ? "team" : "teams"}.</p>}
            <p>Team results stay separate from your individual Scripture mastery.</p>
          </Panel>
          <Panel><h2>Team milestones</h2>
            {!data.awards.length ? <p>No team milestones recorded for this season yet.</p> : <ul className="training-quest-list">{data.awards.map(award => <li key={award.key}><div className="training-quest-head"><strong>{award.title}</strong><Badge tone="success">Recorded</Badge></div></li>)}</ul>}
            <p><small>Milestones reflect the season, not just this room.</small></p>
          </Panel>
        </aside>
      </div>
    </>}
  </div>;
}
