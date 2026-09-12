import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { practiceApi } from "../../api/practice";
import { nativeCloudflare } from "../../api/practiceTransport";
import { useAuth } from "../../auth/AuthContext";
import { Badge, Button, Input, LinkButton, LoadingState, Notice, PageHeader, Panel, Select } from "../../components/ui";
import { PracticePatch } from "./PracticePatch";
import { useMyProfile } from "../profile/profile";
import { MasteryHonorArtwork } from "../profile/MasteryHonorArtwork";
import { QuestionEditor } from "./QuestionEditor";
import { points, roomSizeLabel } from "./practiceUtils";
import "./practice.css";
import "./practice-hub.css";

export function PracticeHub() {
  const { me } = useAuth();
  const org = me!.organizationId;
  const coach = me!.kind !== "Student";
  const base = coach ? "/admin/practice" : "/student/practice";
  const navigate = useNavigate();
  const cache = useQueryClient();
  const profile = useMyProfile();
  const teamHonors = profile.data?.honors.filter(honor => honor.category === "Team Practice") ?? [];
  const bootstrap = useQuery({ queryKey: ["practice", org], queryFn: () => practiceApi.bootstrap(org), refetchInterval: nativeCloudflare ? 60000 : 15000 });
  const [error, setError] = useState("");
  const [pending, setPending] = useState<"create" | "join" | "enable" | null>(null);
  const [seasonId, setSeason] = useState("");
  const [format,setFormat]=useState<'Arcade'|'Pbe'>('Arcade');
  const [teamCount,setTeamCount]=useState<1|2>(1);
  const [teamSize, setSize] = useState(1);
  const [questionCount, setCount] = useState(10);
  const [coached, setCoached] = useState(false);
  const [bookKey, setBook] = useState("");
  const data = bootstrap.data;
  const selectedSeasonId = data?.seasons.some(season => season.id === seasonId) ? seasonId : data?.seasons[0]?.id || "";
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
    <PageHeader title="Team Practice" description="Study together. Answer with care. Grow in Scripture." action={<PracticePatch kind="team-practice" size={72} className="practice-hub-heading-art" />} />
    {error && <Notice tone="danger">{error}</Notice>}
    {bootstrap.isPending && <Panel aria-busy="true"><LoadingState label="Loading Team Practice…" /></Panel>}
    {bootstrap.isError && <Notice tone="danger">{bootstrap.error.message}<Button variant="secondary" onClick={() => void bootstrap.refetch()}>Retry</Button></Notice>}
    {data && <>
      {!data.enabled ? <Panel>
        <h2>Team Practice is not enabled</h2>
        <p>A coach can enable this pilot for your organization.</p>
        {coach && <Button disabled={!!pending} onClick={() => void run("enable", () => practiceApi.enabled(org, true))}>{pending === "enable" ? "Enabling…" : "Enable Team Practice"}</Button>}
      </Panel> : <>
        <div className="practice-hub-grid">
          <Panel className="practice-hub-current" aria-label={currentRoom ? "Current room" : invitation ? "Practice invitation" : "Start Team Practice"}>
            <div className="practice-hub-room-label">
              <span>{currentRoom ? `${seasonName(currentRoom.seasonId)} · ${roomSizeLabel(currentRoom)} · ${currentRoom.questionCount} questions` : invitation ? "Your next practice" : "Practice together."}</span>
              {currentRoom ? <Badge tone={currentRoom.status === "Playing" ? "success" : "info"}>{currentRoom.status}</Badge> : invitation && <Badge tone="info">Invitation</Badge>}
            </div>
            <h2>{currentRoom ? currentRoom.status === "Playing" ? "Your match is in progress." : "Your room is taking shape." : invitation ? "You’re invited to practice." : "Bring your team together."}</h2>
            <p>{currentRoom ? coach ? "Guide the next team practice." : "Gather your team. Put your preparation into practice." : invitation ? `${invitation.inviterName} invited you ${invitation.team ? `to Team ${invitation.team}` : "to a room"}.` : "Create a room or accept an invitation to put your preparation into practice."}</p>
            <div className="practice-hub-duel" data-team-count={currentRoom?.teamCount??(format==='Pbe'?teamCount:2)}>
              <div className="practice-hub-team"><PracticePatch kind="team-a" size={132} /><strong>Team 1</strong></div>
              {(currentRoom?.teamCount??(format==='Pbe'?teamCount:2))!==1&&<><span className="practice-hub-versus">VS</span>
              <div className="practice-hub-team"><PracticePatch kind="team-b" size={132} /><strong>Team 2</strong></div></>}
            </div>
            <div className="practice-hub-room-footer">
              <LinkButton to={currentRoom ? `${base}/${currentRoom.id}` : invitation ? `${base}#invitations` : `${base}#create-room`}>
                {currentRoom ? currentRoom.status === "Playing" ? "Return to match" : "Open lobby" : invitation ? "View invitation" : "Set up a room"}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M4 12h16m-6-6 6 6-6 6" /></svg>
              </LinkButton>
              <span>{currentRoom ? <>{currentRoom.memberCount} players · {currentRoom.coached ? "Coach-led" : "Independent"}{currentRoom.ownerId === me!.userId && <><br />You’re the room owner.</>}</> : invitation ? "Join from your invitation below." : "Arcade: 1–5 per team · PBE: 2–6 students"}</span>
            </div>
          </Panel>

          <Panel id="create-room" className="practice-hub-create" aria-labelledby="practice-create-title">
            <h2 id="practice-create-title">Create a room</h2>
            <p>Choose your format, then invite your players.</p>
            {!data.seasons.length && <Notice>No active season is available. {coach ? "Activate a season before creating a room." : "Your coach will assign an active season so you can join practice."}</Notice>}
            <form aria-label="Create room" onSubmit={event => {
              event.preventDefault();
              if (pending || !selectedSeasonId) return;
              void run("create", async () => {
                const room = await practiceApi.create(org, { ...(format==='Pbe'?{format,teamCount}:{}),seasonId: selectedSeasonId, teamSize, questionCount, coached: coach && coached, bookKey: bookKey.trim() || undefined });
                navigate(`${base}/${room.id}`);
              });
            }}>
              <div className="practice-hub-form-grid">
                <label className="practice-hub-field-wide">Season<Select required disabled={!data.seasons.length} value={selectedSeasonId} onChange={event => setSeason(event.target.value)}>
                  {!data.seasons.length && <option value="">No active seasons</option>}
                  {data.seasons.map(season => <option key={season.id} value={season.id}>{season.name}</option>)}
                </Select></label>
                <label className="practice-hub-field-wide">Practice mode<Select value={format} onChange={event=>{const next=event.target.value as 'Arcade'|'Pbe';setFormat(next);setSize(next==='Pbe'?6:1);setCoached(false);}}><option value="Arcade">Arcade · accuracy and speed</option><option value="Pbe" disabled={!data.seasons.find(s=>s.id===selectedSeasonId)?.pbeEnabled}>PBE rehearsal · rubric points</option></Select></label>
                {format==='Pbe'&&<label>Active teams<Select value={teamCount} onChange={event=>setTeamCount(Number(event.target.value) as 1|2)}><option value={1}>One team</option><option value={2}>Two teams</option></Select></label>}
                <label>Team size<Select value={teamSize} onChange={event => setSize(Number(event.target.value))}>{(format==='Pbe'?[2,3,4,5,6]:[1,2,3,4,5]).map(size => <option key={size} value={size}>{format==='Pbe'?`${size} students per team`:`${size}v${size}`}</option>)}</Select></label>
                <label>Match length<Select value={questionCount} onChange={event => setCount(Number(event.target.value))}><option value={10}>10 questions</option><option value={30}>30 questions</option><option value={90}>90 questions</option></Select></label>
                <label className="practice-hub-field-wide">Format<Select value={String(coach && coached)} onChange={event => setCoached(event.target.value === "true")}><option value="false">Independent</option>{coach && <option value="true">Coach-led · Non-playing coach</option>}</Select></label>
              </div>
              <details className="practice-hub-scope">
                <summary>Passage scope</summary>
                <label>Book scope (optional)<Input value={bookKey} onChange={event => setBook(event.target.value)} placeholder="For example, DAN" aria-describedby="practice-book-help" /></label>
                <p id="practice-book-help">Leave book scope empty to use all approved questions in the season.</p>
              </details>
              <Button type="submit" disabled={!!pending || !selectedSeasonId || (format==='Pbe'&&!data.seasons.find(s=>s.id===selectedSeasonId)?.pbeEnabled)}>{pending === "create" ? "Creating…" : "Create room"}</Button>
            </form>
          </Panel>
        </div>

        {data.invitations.length > 0 && <Panel id="invitations" aria-labelledby="practice-invitations-title">
          <div className="practice-hub-section-heading"><h2 id="practice-invitations-title">Invitations</h2><Badge tone="info">{data.invitations.length} pending</Badge></div>
          <ul className="practice-hub-invitations">{data.invitations.map(invite => <li key={invite.id}>
            <div><strong>{invite.inviterName} invited you {invite.team ? `to Team ${invite.team}` : "to a room"}.</strong><p>Expires {new Date(invite.expiresAt).toLocaleString()}</p></div>
            <div className="practice-actions">{(invite.team ? [invite.team] : [1, 2]).map(team => <Button key={team} disabled={!!pending} variant="secondary" onClick={() => void run("join", async () => {
              const room = await practiceApi.accept(org, invite.id, team);
              navigate(`${base}/${room.id}`);
            })}>Join Team {team}</Button>)}</div>
          </li>)}</ul>
        </Panel>}

        <div className="practice-hub-lower">
          <Panel id="rooms" aria-labelledby="practice-rooms-title">
            <div className="practice-hub-section-heading"><h2 id="practice-rooms-title">Your rooms</h2><span>{data.rooms.length} {data.rooms.length === 1 ? "room" : "rooms"}</span></div>
            {!data.rooms.length && <p className="practice-hub-secondary">No rooms yet. Create a room or accept an invitation.</p>}
            <ul className="practice-hub-rooms">{data.rooms.map(room => <li key={room.id}>
              <div><div className="practice-hub-list-title"><strong>{seasonName(room.seasonId)}</strong><Badge tone={room.status === "Playing" ? "success" : room.status === "Lobby" ? "info" : "neutral"}>{room.status}</Badge></div><p>{roomSizeLabel(room)} · {room.questionCount} questions · {room.coached ? "Coach-led" : "Independent"} · {room.memberCount} players</p></div>
              <LinkButton size="compact" variant="secondary" to={`${base}/${room.id}`}>{room.status === "Completed" ? "View results" : "Open room"}</LinkButton>
            </li>)}</ul>
            {!data.invitations.length && <section id="invitations" className="practice-hub-no-invitations" aria-labelledby="practice-invitations-title"><h3 id="practice-invitations-title">Invitations</h3><p>No pending invitations.</p></section>}
            <div className="practice-hub-honors-note"><PracticePatch kind="team-practice" size={68} /><div><h3>Teamwork worth keeping.</h3><p>Mastery Honors require proven accuracy and your own submitted answers in finalized matches.</p></div></div>
          </Panel>
          <aside className="practice-hub-rules" aria-labelledby="practice-rules-title">
            <h2 id="practice-rules-title">Know the match.</h2>
            <ul><li><strong>PBE rehearsal.</strong> Earn rubric points after two readings and a shared response window. Arcade adds up to 25% as a speed bonus.</li><li><strong>One scribe, one final answer.</strong> Discuss together, then your scribe locks the team’s response.</li><li><strong>Prepare as a team.</strong> Every active team must be full and ready before the owner can start.</li></ul>
            <p>Choose one or two teams of two to six students for PBE rehearsal. Practice scores are not official PBE standings.</p>
          </aside>
        </div>
      </>}

      <Panel id="achievements" aria-labelledby="practice-honors-title">
        <h2 id="practice-honors-title">Team Honors</h2>
        <p className="practice-hub-secondary">Prove your accuracy across distinct questions and passages. Finalized results and your own manual answers count toward mastery Honors; speed and attendance do not unlock them.</p>
        {profile.isPending ? <LoadingState label="Loading Team Honors…" /> : profile.isError ? <Notice tone="danger">Team Honors could not load. <Button variant="secondary" onClick={() => void profile.refetch()}>Retry Team Honors</Button></Notice> : <div className="practice-mastery-honors">{teamHonors.map(honor => <article key={honor.key}>
          <MasteryHonorArtwork honorKey={honor.key} size={96} muted={!honor.earnedAtUtc} /><h3>{honor.title}</h3><Badge tone={honor.earnedAtUtc ? "success" : "neutral"}>{honor.earnedAtUtc ? "Earned" : "Locked"}</Badge><details className="ds-disclosure"><summary>Mastery requirements</summary><p>{honor.requirement}</p>{honor.earnedAtUtc && <p>Earned <time dateTime={honor.earnedAtUtc}>{new Date(honor.earnedAtUtc).toLocaleDateString()}</time></p>}</details>{honor.earnedAtUtc && <LinkButton variant="secondary" to={coach ? "/admin/profile" : "/student/profile"} aria-label={"Use " + honor.title + " as profile image"}>Use as profile image</LinkButton>}
        </article>)}</div>}
        <details className="ds-disclosure practice-milestone-history"><summary>Practice milestones</summary><p className="practice-hub-secondary">Earlier team awards retain their original history. These milestones do not unlock profile images.</p><div className="practice-awards">{data.achievements.map(award => <div key={award.key + "-" + award.seasonId}><MasteryHonorArtwork honorKey={"team:" + award.key} size={72} /><strong>{award.title}</strong><small>{seasonName(award.seasonId)}</small><Badge>Milestone recorded</Badge></div>)}</div>{!data.achievements.length && <p className="practice-hub-secondary">No earlier team milestones recorded.</p>}</details>
      </Panel>
      <Panel id="practice-progress" aria-labelledby="practice-progress-title">
        <h2 id="practice-progress-title">Team practice progress</h2>
        <p className="practice-hub-secondary">Your finalized match evidence, grouped by season, passage scope, team size, and rules. These measures describe team practice, not individual Scripture mastery.</p>
        {!data.trends?.length && <p className="practice-hub-secondary">Complete a match and resolve its appeals to see your progress.</p>}
        {data.trends?.map(trend => <article className="practice-review" key={`${trend.seasonId}-${trend.teamSize}-${trend.bookKey}-${trend.ruleVersion}`}>
          <h3>{seasonName(trend.seasonId)} · {roomSizeLabel(trend)} · {trend.bookKey || "Season scope"}</h3>
          <dl className="practice-stats"><div><dt>Accuracy</dt><dd>{trend.availableHundredths ? Math.round(trend.accuracyHundredths / trend.availableHundredths * 100) : 0}%</dd></div>{trend.format!=='Pbe'&&<div><dt>Speed bonus</dt><dd>{points(trend.speedHundredths)}</dd></div>}<div><dt>Completed</dt><dd>{trend.matches}</dd></div>{trend.format!=='Pbe'&&trend.teamCount!==1&&<div><dt>Wins / draws</dt><dd>{trend.wins} / {trend.draws}</dd></div>}<div><dt>Average response</dt><dd>{(trend.averageResponseMs / 1000).toFixed(1)}s</dd></div></dl>
          <p>{trend.distinctQuestions} distinct questions · {trend.distinctPassages} passages · {trend.participatedQuestions} questions with your participation · {trend.unansweredQuestions} unanswered questions.</p><small>Rules: {trend.ruleVersion}</small>
        </article>)}
      </Panel>
    </>}
    {data && coach && <div id="question-bank"><QuestionEditor org={org} data={data} /></div>}
    <p className="practice-hub-footnote">Erudoza head-to-head training · Accuracy first, teamwork throughout.</p>
  </div>;
}
