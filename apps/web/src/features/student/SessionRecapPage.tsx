import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { ApiError } from "../../api/client";
import { trainingApi } from "../../api/training";
import type { SkillScores } from "../../api/trainingTypes";
import { useAuth } from "../../auth/AuthContext";
import { PbeFlagAnswer } from "../practice/PbeFlagAnswer";
import { PatchArtwork } from "../../components/ui/PatchArtwork";
import { Badge, Button, HonorArtwork, LinkButton, LoadingState, Notice, PageHeader, Panel, ProgressMeter } from "../../components/ui";
import { evidenceDate, honorAsset, trainingLink } from "./trainingAssets";
import "./student.css";
import "./student-collections.css";
const skillNames: [keyof SkillScores, string][] = [["exactWording", "Wording"], ["reference", "Reference"], ["sequence", "Sequence"], ["recognition", "Recognition"], ["factualRecall", "Factual recall"]];
export function SessionRecapPage() {
  const { sessionId } = useParams();
  const [params, setParams] = useSearchParams();
  const { me } = useAuth();
  const recap = useQuery({ queryKey: ["training-recap", sessionId, me?.organizationId, me?.userId], queryFn: () => trainingApi.recap(sessionId!), enabled: !!sessionId });
  const data = recap.data;
  const earnedMilestones = data?.version === "training-v1" ? data.earnedBadges.filter(honor => honor.earnedAtUtc) : [];
  const featuredMilestone = earnedMilestones[0];
  const seasonId = data?.seasonId ?? params.get("seasonId");
  useEffect(() => {
    if (data?.seasonId && params.get("seasonId") !== data.seasonId) {
      const next = new URLSearchParams(params); next.set("seasonId", data.seasonId); setParams(next, { replace: true });
    }
  }, [data?.seasonId, params, setParams]);
  const link = (path: string) => trainingLink(path, seasonId);
  const pbeResults = data?.version === "pbe-daily-v2" && <Panel><h2>Saved answer reviews</h2>
    {data.provisional && <Notice>{data.pendingCount} answer{data.pendingCount === 1 ? " is" : "s are"} awaiting review. Scores remain provisional; you can keep practicing.</Notice>}
    {data.finalizedAvailablePoints !== undefined && <p>Finalized accuracy: {data.finalizedEarnedPoints} / {data.finalizedAvailablePoints} points. Pending answers are excluded.</p>}
    {data.results?.map((result, index) => <div key={result.attemptId}><h3>Answer {index + 1}</h3><p>{result.earnedPoints} / {result.availablePoints} points</p>{result.dispute?.status === "Resolved" && <p>Originally {result.originalEarnedPoints} points; the coach’s correction is saved separately.</p>}<PbeFlagAnswer activity="Solo" sessionId={data.sessionId} attemptId={result.attemptId} review={result.dispute}/></div>)}
    <Button variant="secondary" onClick={() => void recap.refetch()}>Refresh reviewed scores</Button>
  </Panel>;
  return <div className="training-dashboard training-recap"><PageHeader title="Session recap" description={data?.version==="pbe-daily-v2"?"Your saved PBE accuracy and daily effort.":"Your saved practice, passage by passage."} action={<LinkButton variant="secondary" to={link("/student")}>Back to training</LinkButton>} />
    {!sessionId ? <Notice tone="danger">This recap link is incomplete. Return to training to find your session.</Notice> : recap.isPending ? <LoadingState label="Loading your saved recap…" /> : recap.isError && recap.error instanceof ApiError && recap.error.status === 409 ? <Panel><h2>This session is still in progress</h2><LinkButton to={link(`/student/study?sessionId=${encodeURIComponent(sessionId)}`)}>Resume session</LinkButton></Panel> : recap.isError ? <Notice tone="danger">This recap is unavailable or you do not have access. <Button variant="secondary" onClick={() => void recap.refetch()}>Try again</Button></Notice> : data?.interrupted ? <><Panel><Badge>Interrupted rehearsal</Badge><h2>Earlier answers are saved</h2><p>{data.correct} fully correct from {data.attempted} accepted attempts.</p>{data.version !== "pbe-daily-v2" && data.results?.map(result=><p key={result.attemptId}>{result.earnedPoints} / {result.availablePoints} points</p>)}<LinkButton to={link('/student/study?mode=Simulation&format=Pbe')}>Start another shortened timed practice</LinkButton></Panel>{pbeResults}</> : data && !data.completedAtUtc ? <Panel><h2>This session is still in progress</h2><p>Complete your session to save its recap.</p><LinkButton to={link(`/student/study?sessionId=${encodeURIComponent(data.sessionId)}&mode=${encodeURIComponent(data.mode)}`)}>Resume session</LinkButton></Panel> : data && <>
      <div className="training-recap-layout">
        <Panel className="training-recap-main">
          <Badge tone={data.fullTargetReached ? "success" : "neutral"}>{data.mode} · {data.fullTargetReached ? "Complete" : "Saved"}</Badge>
          <h2 className="training-recap-title">{data.fullTargetReached ? "Practice complete. Keep growing." : "Your practice is saved."}</h2>
          <p>{data.correct} correct from {data.attempted} accepted attempts.</p>
          <div className="training-recap-award">
            {featuredMilestone ? <>
              <HonorArtwork {...honorAsset(featuredMilestone.key)} size={176} />
              <h3>{featuredMilestone.title}</h3>
              <Badge tone="success">Milestone recorded</Badge>
              <p><small>{featuredMilestone.scopeLabel} · <time dateTime={featuredMilestone.earnedAtUtc!}>{evidenceDate(featuredMilestone.earnedAtUtc!)}</time></small></p>
            </> : <PatchArtwork src="/brand/erudoza-patch-192.webp" size={176} alt="Erudoza field guide patch" />}
          </div>
          <dl className="training-recap-stats" aria-label="Saved session counts">
            <div><dt>Correct answers</dt><dd>{data.correct}</dd></div>
            <div><dt>Accepted attempts</dt><dd>{data.attempted}</dd></div>
            <div><dt>Full session target</dt><dd>{data.targetCardCount}</dd></div>
          </dl>
          <p><small>Completed <time dateTime={data.completedAtUtc!}>{evidenceDate(data.completedAtUtc!)}</time></small></p>
          {!data.fullTargetReached && <p>You finished early. Your accepted answers are saved. The full session target was not reached.</p>}
          <div className="training-recap-actions"><LinkButton to={link("/student")}>Back to Training HQ</LinkButton><LinkButton variant="ghost" to={link("/student/honors")}>View Honors</LinkButton></div>
        </Panel>
        <aside className="training-recap-side" aria-label="Saved practice details">
          {pbeResults}
          {data.version === "legacy-counts" ? <Notice>This earlier session has saved counts only. Passage improvement and milestone evidence are unavailable.</Notice> : <>
            <Panel><h2>What you practiced</h2><p>{data.version==="pbe-daily-v2"?"Daily completion records effort. Unaided target recall is tracked separately; missed targets remain due.":"These are this session’s saved contributions. Later practice may change current scores."}</p>
              {!data.passageChanges.length && data.version!=="pbe-daily-v2" && <p>No passage skill changes were recorded.</p>}
              <ul className="training-passage-list">{data.passageChanges.map((passage, index) => <li key={`${data.sessionId}:${passage.knowledgeUnitId}`}>
                <details className="ds-disclosure training-recap-passage" open={index === 0}>
                <summary><h3>{passage.title}</h3></summary>
                <dl className="training-recap-skill-progress">{skillNames.map(([key, label]) => <div key={key}>
                  <dt>{label}</dt><dd>{passage.before && passage.after ? `${passage.before[key]} → ${passage.after[key]}` : `${passage.delta[key] > 0 ? "+" : ""}${passage.delta[key]} contributed`}</dd>
                  {passage.after && <dd className="training-recap-skill-meter"><ProgressMeter label={`${passage.title}: saved ${label.toLowerCase()} score`} value={passage.after[key]} max={100} /></dd>}
                </div>)}</dl>
                {(!passage.before || !passage.after) && <details className="ds-disclosure"><summary>View saved answer evidence</summary><p>Other sessions may have interleaved. Each answer’s before and after scores are shown separately.</p>{passage.events.map(event => <div key={event.attemptId}><time dateTime={event.acceptedAtUtc}>{new Date(event.acceptedAtUtc).toLocaleString()}</time><dl className="training-recap-skills">{skillNames.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{event.before[key]} → {event.after[key]}</dd></div>)}</dl></div>)}</details>}
                </details>
              </li>)}</ul>
              <LinkButton variant="secondary" to={link("/student/progress")}>View current progress</LinkButton>
            </Panel>
            {!!data.missionSteps.length && <Panel><h2>Daily training evidence</h2><ul className="training-mission-steps">{data.missionSteps.map(step => <li key={step.kind}><strong>{step.kind === "Practice" ? "Daily drill" : "Review"}</strong><span>{step.completed} / {step.target}</span><Badge>{step.status}</Badge></li>)}</ul></Panel>}
            {earnedMilestones.length > 1 && <Panel><h2>More milestones recorded in this session</h2><div className="training-honor-preview-items">{earnedMilestones.slice(1).map((honor, index) => <div key={`${honor.key}:${index}`}><HonorArtwork {...honorAsset(honor.key)} /><h3>{honor.title}</h3><p>{honor.scopeLabel}</p><time dateTime={honor.earnedAtUtc!}>{evidenceDate(honor.earnedAtUtc!)}</time></div>)}</div></Panel>}
          </>}
          <Panel><h2>Steady progress counts.</h2>
            {data.newlyCreditedDay && <p>Practice day credited: {data.creditedLocalDate}.</p>}
            {!data.newlyCreditedDay && data.fullTargetReached && <p>No additional practice day was added by this session. A calendar day counts at most once.</p>}
            {data.missionLocalDate && data.creditedLocalDate && data.missionLocalDate !== data.creditedLocalDate && <p>Mission date: {data.missionLocalDate}. Practice credited on {data.creditedLocalDate}, when the qualifying answer was accepted.</p>}
            <p><small>Your accepted answers are saved. Return when you’re ready for your next practice.</small></p>
            <LinkButton variant="secondary" to={link(`/student/study?mode=Practice&format=${data.version==="pbe-daily-v2"?"Pbe":"Memory"}`)}>Practice again</LinkButton>
            {data.version === "legacy-counts" && <LinkButton variant="ghost" to={link("/student/progress")}>View current progress</LinkButton>}
          </Panel>
        </aside>
      </div>
    </>}
  </div>;
}
