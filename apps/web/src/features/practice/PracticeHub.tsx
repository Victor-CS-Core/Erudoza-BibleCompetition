import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { practiceApi } from "../../api/practice";
import { nativeCloudflare } from "../../api/practiceTransport";
import { useAuth } from "../../auth/AuthContext";
import { Badge, Button, HelpTip, LinkButton, LoadingState, Notice, PageHeader, Panel, Select } from "../../components/ui";
import { ThemedImage } from "../../components/brand/ThemedImage";
import { CoachEvents } from "./CoachEvents";
import { StudentPracticeInbox } from "./StudentPracticeInbox";
import { useMyProfile } from "../profile/profile";
import { HonorPatchCard } from "../profile/HonorPatchCard";
import { MasteryHonorArtwork } from "../profile/MasteryHonorArtwork";
import { evidenceDate } from "../student/trainingAssets";
import { QuestionEditor } from "./QuestionEditor";
import { points, roomSizeLabel } from "./practiceUtils";
import "./practice.css";
import "./practice-hub.css";

export function PracticeHub() {
  const { me } = useAuth();
  const org = me!.organizationId;
  const location = useLocation();
  const coach = location.pathname.startsWith("/admin");
  const base = coach ? "/admin/practice" : "/student/practice";
  const navigate = useNavigate();
  const cache = useQueryClient();
  const profile = useMyProfile();
  const teamHonors = profile.data?.honors.filter(honor => honor.category === "Team Practice") ?? [];
  const bootstrap = useQuery({ queryKey: ["practice", org], queryFn: () => practiceApi.bootstrap(org), refetchInterval: nativeCloudflare ? 60000 : 15000 });
  const [error, setError] = useState("");
  const [pending, setPending] = useState<"join" | "enable" | null>(null);
  const [seasonId, setSeason] = useState(() => new URLSearchParams(location.search).get("seasonId") ?? "");
  const data = bootstrap.data;
  const selectedSeasonId = data?.seasons.some(season => season.id === seasonId) ? seasonId : data?.seasons[0]?.id || "";
  const roomLink = (id: string, roomSeason?: string) => `${base}/${id}${!coach && (roomSeason || selectedSeasonId) ? `?seasonId=${encodeURIComponent(roomSeason || selectedSeasonId)}` : ""}`;
  const currentRoom = data?.rooms.find(room => room.status === "Playing") || data?.rooms.find(room => room.status === "Lobby");
  const invitation = data?.invitations[0];
  const seasonName = (id: string) => data?.seasons.find(season => season.id === id)?.name || "Past season";

  async function run(action: NonNullable<typeof pending>, work: () => Promise<unknown>) {
    setPending(action);
    setError("");
    try {
      await work();
      await cache.invalidateQueries({ queryKey: ["practice", org] });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not complete the action.");
    } finally {
      setPending(null);
    }
  }

  return <div className="practice-page practice-hub">
    <section className="practice-hub-banner ds-inverse-surface" aria-label="Team Practice"><ThemedImage src="/assets/training/team-practice-hero-720.webp" srcSet="/assets/training/team-practice-hero-720.webp 720w, /assets/training/team-practice-hero-1440.webp 1440w" darkSrc="/assets/training/team-practice-hero-dark-720.webp" darkSrcSet="/assets/training/team-practice-hero-dark-720.webp 720w, /assets/training/team-practice-hero-dark-1440.webp 1440w" sizes="(min-width: 1248px) 1200px, calc(100vw - 48px)" width={1440} height={480} alt="" fetchPriority="high" /><div className="practice-hub-banner-copy"><PageHeader title="Team Practice" description="Practice answering questions about your assigned Scripture as a team." /></div></section>
    {coach&&<Panel><h2>PBE answer reviews<HelpTip label="About PBE answer reviews">Review saved Solo and Team answers without holding up independent practice.</HelpTip></h2><LinkButton to="/admin/practice/reviews">Open PBE answer reviews</LinkButton></Panel>}
    {error && <Notice tone="danger">{error}</Notice>}
    {bootstrap.isPending && <Panel aria-busy="true"><LoadingState label="Loading Team Practice…" /></Panel>}
    {bootstrap.isError && <Notice tone="danger">{bootstrap.error.message}<Button variant="secondary" onClick={() => void bootstrap.refetch()}>Retry</Button></Notice>}
    {data && <>
      {!data.enabled ? <Panel>
        <h2>Team Practice is not enabled</h2>
        <p>{coach ? "Enable Team Practice below to run events, simulations, and answer reviews for your club." : "Ask your coach to enable Team Practice for your club."}</p>
        {coach && <Button disabled={!!pending} onClick={() => void run("enable", () => practiceApi.enabled(org, true))}>{pending === "enable" ? "Enabling…" : "Enable Team Practice"}</Button>}
      </Panel> : coach ? <>
        <label className="practice-active-season">Active season<Select value={selectedSeasonId} disabled={!data.seasons.length||!!pending} onChange={event=>setSeason(event.target.value)}>{!data.seasons.length&&<option value="">No active seasons</option>}{data.seasons.map(season=><option key={season.id} value={season.id}>{season.name}</option>)}</Select></label>
        <CoachEvents org={org} seasons={data.seasons} />
        {(currentRoom||invitation)&&<Panel className="practice-current-strip" aria-label={currentRoom?'Current room':'Practice invitation'}><div><Badge tone="info">{currentRoom?.status??'Invitation'}</Badge><h2>{currentRoom?currentRoom.status==='Playing'?'Your match is in progress.':'Your room is waiting for players.':'You’re invited to practice.'}</h2><p>{currentRoom?`${seasonName(currentRoom.seasonId)} · ${roomSizeLabel(currentRoom)} · ${currentRoom.questionCount} questions · ${currentRoom.memberCount} players`: `${invitation!.inviterName} invited you to practice.`}</p>{currentRoom?.ownerId===me!.userId&&<p>You’re the room owner.</p>}</div><LinkButton to={currentRoom?roomLink(currentRoom.id,currentRoom.seasonId):`${base}#invitations`}>{currentRoom?currentRoom.status==='Playing'?'Return to match':'Open lobby':'View invitation'}</LinkButton></Panel>}
        {data.invitations.length > 0 && <Panel id="invitations" aria-labelledby="practice-invitations-title">
          <div className="practice-hub-section-heading"><h2 id="practice-invitations-title">Invitations</h2><Badge tone="info">{data.invitations.length} pending</Badge></div>
          <ul className="practice-hub-invitations">{data.invitations.map(invite => <li key={invite.id}>
            <div><strong>{invite.inviterName} invited you {invite.team ? `to Team ${invite.team}` : "to a room"}.</strong><p>Expires {new Date(invite.expiresAt).toLocaleString()}</p></div>
            <div className="practice-actions">{(invite.team ? [invite.team] : invite.teamCount===1?[1]:[1, 2]).map(team => <Button key={team} disabled={!!pending} variant="secondary" onClick={() => void run("join", async () => {
              const room = await practiceApi.accept(org, invite.id, team);
              navigate(roomLink(room.id, room.seasonId));
            })}>Join Team {team}</Button>)}</div>
          </li>)}</ul>
        </Panel>}
        <div className="practice-hub-room-list">
          <Panel id="rooms" aria-labelledby="practice-rooms-title">
            <div className="practice-hub-section-heading"><h2 id="practice-rooms-title">Your rooms</h2><span>{data.rooms.length} {data.rooms.length === 1 ? "room" : "rooms"}</span></div>
            {!data.rooms.length && <p className="practice-hub-secondary">No rooms yet. Create an event above and its room will appear here when it opens.</p>}
            <ul className="practice-hub-rooms">{data.rooms.map(room => <li key={room.id}>
              <div><div className="practice-hub-list-title"><strong>{seasonName(room.seasonId)}</strong><Badge tone={room.status === "Playing" ? "success" : room.status === "Lobby" ? "info" : "neutral"}>{room.status}</Badge></div><p>{roomSizeLabel(room)} · {room.questionCount} questions · {room.coached ? "Coach-led" : "Independent"} · {room.memberCount} players</p></div>
              <LinkButton size="compact" variant="secondary" to={roomLink(room.id, room.seasonId)}>{room.status === "Completed" ? "View results" : "Open room"}</LinkButton>
            </li>)}</ul>
            {!data.invitations.length && <section id="invitations" className="practice-hub-no-invitations" aria-labelledby="practice-invitations-title"><h3 id="practice-invitations-title">Invitations</h3><p>No pending invitations.</p></section>}
          </Panel>
        </div>
      </> : <StudentPracticeInbox org={org} data={data} />}

      {!!data.simulationAchievements?.length&&<Panel id="simulation-achievements"><h2>Simulation patches<HelpTip label="About Simulation patches">Earned together through completed simulations. Choose an unlocked patch for your profile.</HelpTip></h2><div className="honor-patch-grid" aria-label="Simulation patches">{data.simulationAchievements.filter(h=>h.seasonId===selectedSeasonId).map(h=><HonorPatchCard key={h.key+h.seasonId}
        title={h.title}
        artwork={<MasteryHonorArtwork honorKey={h.key} size={208} muted={!h.earnedAtUtc} />}
        status={<><Badge tone={h.earnedAtUtc?"success":"neutral"}>{h.earnedAtUtc?"Earned":"Locked"}</Badge><span>{h.current} / {h.target}</span></>}
        detail={<><MasteryHonorArtwork honorKey={h.key} size={192} muted={!h.earnedAtUtc} /><p>{h.requirement}</p><p>Progress: {h.current} of {h.target}</p>{h.earnedAtUtc?<><p>Earned <time dateTime={h.earnedAtUtc}>{evidenceDate(h.earnedAtUtc)}</time>. Your qualifying evidence is saved.</p><LinkButton variant="secondary" to={coach?"/admin/profile":"/student/profile"} aria-label={`Use ${h.title} as profile image`}>Use as profile image</LinkButton></>:<p>This patch is locked. Complete simulations together to unlock it for your profile.</p>}</>}
      />)}</div></Panel>}
      <Panel id="achievements" aria-labelledby="practice-honors-title">
        <h2 id="practice-honors-title">Team Achievement patches<HelpTip label="About Team Achievement patches">Arcade mastery Achievement patches use finalized personal accuracy across distinct questions and passages. PBE team milestones record participation and finalized team scores separately.</HelpTip></h2>
        {profile.isPending ? <LoadingState label="Loading Team Achievement patches…" /> : profile.isError ? <Notice tone="danger">Team Achievement patches could not load. <Button variant="secondary" onClick={() => void profile.refetch()}>Retry Team Achievement patches</Button></Notice> : <div className="honor-patch-grid" aria-label="Team Achievement patches">{teamHonors.map(honor => <HonorPatchCard key={honor.key}
          title={honor.title}
          artwork={<MasteryHonorArtwork honorKey={honor.key} size={208} muted={!honor.earnedAtUtc} />}
          status={<><Badge tone={honor.earnedAtUtc ? "success" : "neutral"}>{honor.earnedAtUtc ? "Earned" : "Locked"}</Badge>{honor.earnedAtUtc && <span>Earned <time dateTime={honor.earnedAtUtc}>{evidenceDate(honor.earnedAtUtc)}</time></span>}</>}
          detail={<><MasteryHonorArtwork honorKey={honor.key} size={192} muted={!honor.earnedAtUtc} /><p>{honor.category}</p><h3>How to unlock</h3><p>{honor.requirement}</p>{honor.earnedAtUtc ? <><p>Earned <time dateTime={honor.earnedAtUtc}>{evidenceDate(honor.earnedAtUtc)}</time>. Your qualifying evidence is saved.</p><LinkButton variant="secondary" to={coach ? "/admin/profile" : "/student/profile"} aria-label={`Use ${honor.title} as profile image`}>{profile.data?.avatarHonorKey === honor.key ? "Worn as profile image" : "Use as profile image"}</LinkButton></> : <p>This patch is locked. Meet every requirement to unlock it for your profile.</p>}</>}
        />)}</div>}
        <details className="ds-disclosure practice-milestone-history"><summary>Practice milestones<HelpTip label="About practice milestones">Team milestones record participation and finalized team scores. PBE milestones use their saved team rules and do not unlock profile images.</HelpTip></summary><div className="practice-awards">{data.achievements.map(award => <div key={award.key + "-" + award.seasonId}><MasteryHonorArtwork honorKey={"team:" + award.key.replace(/^pbe-team-v1:/, "")} size={72} /><strong>{award.title}</strong><small>{seasonName(award.seasonId)}</small><Badge>Milestone recorded</Badge></div>)}</div>{!data.achievements.length && <p className="practice-hub-secondary">No team milestones recorded.</p>}</details>
      </Panel>
      <Panel id="practice-progress" aria-labelledby="practice-progress-title">
        <h2 id="practice-progress-title">Team practice progress<HelpTip label="About team practice progress">Your finalized match evidence, grouped by season, passage scope, team size, and rules. These measures describe team practice, not individual Scripture mastery.</HelpTip></h2>
        {!data.trends?.length && <p className="practice-hub-secondary">Complete a match and resolve its appeals to see your progress.</p>}
        {data.trends?.map(trend => <article className="practice-review" key={`${trend.seasonId}-${trend.teamSize}-${trend.bookKey}-${trend.format}-${trend.teamCount}-${trend.ruleVersion}-${trend.scoringVersion}`}>
          <h3>{seasonName(trend.seasonId)} · {roomSizeLabel(trend)} · {trend.bookKey || "Season scope"}</h3>
          {trend.provisional && <p><Badge tone="warning">Review pending</Badge> {trend.pendingCount} answer{trend.pendingCount === 1 ? "" : "s"} awaiting review. Pending answers are excluded from finalized accuracy.</p>}
          <dl className="practice-stats"><div><dt>{trend.format === "Pbe" ? "Finalized accuracy" : "Accuracy"}</dt><dd>{trend.availableHundredths ? Math.round(trend.accuracyHundredths / trend.availableHundredths * 100) : 0}%</dd></div>{trend.format!=='Pbe'&&<div><dt>Speed bonus</dt><dd>{points(trend.speedHundredths)}</dd></div>}<div><dt>Completed</dt><dd>{trend.matches}</dd></div>{trend.format!=='Pbe'&&trend.teamCount!==1&&<div><dt>Wins / draws</dt><dd>{trend.wins} / {trend.draws}</dd></div>}<div><dt>Average response</dt><dd>{(trend.averageResponseMs / 1000).toFixed(1)}s</dd></div></dl>
          <p>{trend.distinctQuestions} distinct questions · {trend.distinctPassages} passages · {trend.participatedQuestions} questions with your participation · {trend.unansweredQuestions} unanswered questions.</p><small>Rules: {trend.ruleVersion}</small>
        </article>)}
      </Panel>
    </>}
    {data && coach && <div id="question-bank"><QuestionEditor org={org} data={data} /></div>}
    <p className="practice-hub-footnote">Team Practice uses your season’s assigned material. Arcade adds up to 25% as a speed bonus; PBE uses rubric points.</p>
  </div>;
}
