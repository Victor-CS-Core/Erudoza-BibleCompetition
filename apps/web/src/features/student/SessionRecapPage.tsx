import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { ApiError } from "../../api/client";
import { trainingApi } from "../../api/training";
import type { SkillScores } from "../../api/trainingTypes";
import { useAuth } from "../../auth/AuthContext";
import { Badge, Button, HonorArtwork, LinkButton, LoadingState, Notice, PageHeader, Panel } from "../../components/ui";
import { evidenceDate, honorAsset, trainingLink } from "./trainingAssets";
import "./student.css";
const skillNames: [keyof SkillScores, string][] = [["exactWording", "Wording"], ["reference", "Reference"], ["sequence", "Sequence"], ["recognition", "Recognition"], ["factualRecall", "Factual recall"]];
export function SessionRecapPage() {
  const { sessionId } = useParams();
  const [params, setParams] = useSearchParams();
  const { me } = useAuth();
  const recap = useQuery({ queryKey: ["training-recap", sessionId, me?.organizationId, me?.userId], queryFn: () => trainingApi.recap(sessionId!), enabled: !!sessionId });
  const data = recap.data;
  const seasonId = data?.seasonId ?? params.get("seasonId");
  useEffect(() => {
    if (data?.seasonId && params.get("seasonId") !== data.seasonId) {
      const next = new URLSearchParams(params); next.set("seasonId", data.seasonId); setParams(next, { replace: true });
    }
  }, [data?.seasonId, params, setParams]);
  const link = (path: string) => trainingLink(path, seasonId);
  return <div className="training-dashboard"><PageHeader title="Session recap" description="Your saved practice, passage by passage." action={<LinkButton variant="secondary" to={link("/student")}>Back to training</LinkButton>} />
    {!sessionId ? <Notice tone="danger">This recap link is incomplete. Return to training to find your session.</Notice> : recap.isPending ? <LoadingState label="Loading your saved recap…" /> : recap.isError && recap.error instanceof ApiError && recap.error.status === 409 ? <Panel><h2>This session is still in progress</h2><LinkButton to={link(`/student/study?sessionId=${encodeURIComponent(sessionId)}`)}>Resume session</LinkButton></Panel> : recap.isError ? <Notice tone="danger">This recap is unavailable or you do not have access. <Button variant="secondary" onClick={() => void recap.refetch()}>Try again</Button></Notice> : data && !data.completedAtUtc ? <Panel><h2>This session is still in progress</h2><p>Complete your session to save its recap.</p><LinkButton to={link(`/student/study?sessionId=${encodeURIComponent(data.sessionId)}&mode=${encodeURIComponent(data.mode)}`)}>Resume session</LinkButton></Panel> : data && <>
      <Panel className="training-recap-main"><img src="/brand/erudoza-patch-192.webp" width="192" height="192" alt="Erudoza field guide patch" /><div><h2>{data.fullTargetReached ? "Practice complete. Keep growing." : "Your practice is saved."}</h2><p>{data.correct} correct from {data.attempted} accepted attempts · {data.targetCardCount} cards in the full session</p><Badge tone="success">{data.mode}</Badge><p>Completed <time dateTime={data.completedAtUtc!}>{evidenceDate(data.completedAtUtc!)}</time></p>{!data.fullTargetReached && <p>You finished early. Your accepted answers are saved. The full session target was not reached.</p>}{data.newlyCreditedDay && <p>Practice day credited: {data.creditedLocalDate}.</p>}{!data.newlyCreditedDay && data.fullTargetReached && <p>No additional practice day was added by this session. A calendar day counts at most once.</p>}{data.missionLocalDate && data.creditedLocalDate && data.missionLocalDate !== data.creditedLocalDate && <p>Mission date: {data.missionLocalDate}. Practice credited on {data.creditedLocalDate}, when the qualifying answer was accepted.</p>}</div></Panel>
      {data.version === "legacy-counts" ? <Notice>This earlier session has saved counts only. Passage improvement and Honors evidence are unavailable.</Notice> : <><Panel><h2>What you practiced</h2><p>These are this session’s saved contributions. Later practice may change current scores.</p>{!data.passageChanges.length && <p>No passage skill changes were recorded.</p>}<ul className="training-passage-list">{data.passageChanges.map(passage => <li key={passage.knowledgeUnitId}><h3>{passage.title}</h3><dl className="training-recap-skills">{skillNames.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{passage.before && passage.after ? `${passage.before[key]} → ${passage.after[key]}` : `${passage.delta[key] > 0 ? "+" : ""}${passage.delta[key]} contributed`}</dd></div>)}</dl>{(!passage.before || !passage.after) && <details><summary>View saved answer evidence</summary><p>Other sessions may have interleaved. Each answer’s before and after scores are shown separately.</p>{passage.events.map(event => <div key={event.attemptId}><time dateTime={event.acceptedAtUtc}>{new Date(event.acceptedAtUtc).toLocaleString()}</time><dl className="training-recap-skills">{skillNames.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{event.before[key]} → {event.after[key]}</dd></div>)}</dl></div>)}</details>}</li>)}</ul></Panel>
      {!!data.missionSteps.length && <Panel><h2>Daily training evidence</h2><ul className="training-mission-steps">{data.missionSteps.map(step => <li key={step.kind}><strong>{step.kind === "Practice" ? "Daily drill" : "Review"}</strong><span>{step.completed} / {step.target}</span><Badge>{step.status}</Badge></li>)}</ul></Panel>}
      {!!data.earnedBadges.length && <Panel><h2>Honors earned in this session</h2><div className="training-honor-preview-items">{data.earnedBadges.filter(honor => honor.earnedAtUtc).map((honor, index) => <div key={`${honor.key}:${index}`}><HonorArtwork {...honorAsset(honor.key)} /><h3>{honor.title}</h3><p>{honor.scopeLabel}</p><time dateTime={honor.earnedAtUtc!}>{evidenceDate(honor.earnedAtUtc!)}</time></div>)}</div></Panel>}</>}
      <div className="training-controls"><LinkButton to={link("/student")}>Back to Training HQ</LinkButton><LinkButton variant="secondary" to={link("/student/progress")}>View current progress</LinkButton><LinkButton variant="secondary" to={link("/student/honors")}>View Honors</LinkButton><LinkButton variant="secondary" to={link("/student/study?mode=Practice")}>Practice again</LinkButton></div>
    </>}
  </div>;
}
