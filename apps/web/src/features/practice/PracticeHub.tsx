import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { practiceApi, pbeApi } from "../../api/practice";
import { nativeCloudflare } from "../../api/practiceTransport";
import { useAuth } from "../../auth/AuthContext";
import { Badge, Button, Input, LinkButton, LoadingState, Notice, PageHeader, Panel, Select } from "../../components/ui";
import { TrainingDialog } from "../../components/ui/TrainingDialog";
import { ThemedImage } from "../../components/brand/ThemedImage";
import { SimulationMenu } from "./SimulationMenu";
import { PracticePatch } from "./PracticePatch";
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
  const [pvpOpen,setPvpOpen]=useState(false);
  const [simulationOpen,setSimulationOpen]=useState(false);
  const [availability,setAvailability]=useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState<"create" | "join" | "enable" | "pbe" | null>(null);
  const [seasonId, setSeason] = useState(() => new URLSearchParams(location.search).get("seasonId") ?? "");
  const [format,setFormat]=useState<'Arcade'|'Pbe'>('Arcade');
  const teamCount=2 as const;
  const [teamSize, setSize] = useState(1);
  const [questionCount, setCount] = useState(10);
  const [coached, setCoached] = useState(false);
  const [bookKey, setBook] = useState("");
  const data = bootstrap.data;
  const selectedSeasonId = data?.seasons.some(season => season.id === seasonId) ? seasonId : data?.seasons[0]?.id || "";
  useEffect(()=>{if(location.hash==='#create-room')setPvpOpen(true);},[location.hash,location.key]);
  const closePvp=()=>{setPvpOpen(false);if(location.hash==='#create-room')navigate(`${location.pathname}${location.search}`,{replace:true});};
  const roomLink = (id: string, roomSeason?: string) => `${base}/${id}${!coach && (roomSeason || selectedSeasonId) ? `?seasonId=${encodeURIComponent(roomSeason || selectedSeasonId)}` : ""}`;
  /** Students review completed rooms on the room recap page; coaches keep the room page. */
  const recapLink = (id: string, roomSeason?: string) => `/student/practice/rooms/${encodeURIComponent(id)}/recap${(roomSeason || selectedSeasonId) ? `?seasonId=${encodeURIComponent(roomSeason || selectedSeasonId)}` : ""}`;
  const currentRoom = data?.rooms.find(room => room.status === "Playing") || data?.rooms.find(room => room.status === "Lobby");
  const invitation = data?.invitations[0];
  const seasonName = (id: string) => data?.seasons.find(season => season.id === id)?.name || "Past season";
  /** PBE team practice (simulations, PBE rehearsal rooms) needs the per-season PBE training flag — the club-level toggle alone does not unlock it. */
  const seasonPbeEnabled = data?.seasons.find(season => season.id === selectedSeasonId)?.pbeEnabled ?? false;

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
    {coach&&<Panel><h2>PBE answer reviews</h2><p>Review saved Solo and Team answers without holding up independent practice.</p><LinkButton to="/admin/practice/reviews">Open PBE answer reviews</LinkButton></Panel>}
    {error && <Notice tone="danger">{error}</Notice>}
    {bootstrap.isPending && <Panel aria-busy="true"><LoadingState label="Loading Team Practice…" /></Panel>}
    {bootstrap.isError && <Notice tone="danger">{bootstrap.error.message}<Button variant="secondary" onClick={() => void bootstrap.refetch()}>Retry</Button></Notice>}
    {data && <>
      {!data.enabled ? <Panel>
        <h2>Team Practice is not enabled</h2>
        <p>{coach ? "Enable Team Practice below to run rooms, simulations, and answer reviews for your club." : "Ask your coach to enable Team Practice for your club."}</p>
        {coach && <Button disabled={!!pending} onClick={() => void run("enable", () => practiceApi.enabled(org, true))}>{pending === "enable" ? "Enabling…" : "Enable Team Practice"}</Button>}
      </Panel> : <>
        <label className="practice-active-season">Active season<Select value={selectedSeasonId} disabled={!data.seasons.length||!!pending} onChange={event=>setSeason(event.target.value)}>{!data.seasons.length&&<option value="">No active seasons</option>}{data.seasons.map(season=><option key={season.id} value={season.id}>{season.name}</option>)}</Select></label>
        <div className="practice-mode-grid"><Panel className="practice-mode-entry"><PracticePatch kind="team-practice" size={64}/><div><h2>Full-event team rehearsal</h2><p>PBE simulation · One team · Two readings · Rubric points · Unlocks Simulation honors</p>{seasonPbeEnabled ? <Button disabled={!!pending} onClick={()=>setSimulationOpen(true)}>Set up simulation</Button> : <><Button disabled={true}>Set up simulation</Button>{coach
  ? <p className="practice-hub-secondary">PBE training is off for this season. <Button variant="secondary" size="compact" disabled={pending === "pbe" || !selectedSeasonId} onClick={() => void run("pbe", () => pbeApi.enabled(org, selectedSeasonId, true))}>{pending === "pbe" ? "Turning on…" : "Turn on PBE training"}</Button></p>
  : <p className="practice-hub-secondary">PBE training is off for this season. Ask your coach to turn it on in season settings.</p>}</>}</div></Panel><Panel className="practice-mode-entry"><div className="practice-mode-patches"><PracticePatch kind="team-a" size={64}/><PracticePatch kind="team-b" size={64}/></div><div><h2>Head-to-head practice</h2><p>Two teams · Arcade or PBE</p><Button disabled={!!pending} onClick={()=>setPvpOpen(true)}>Set up PVP</Button></div></Panel></div>
        {availability&&<Notice>{availability}</Notice>}
        <SimulationMenu error={error} org={org} seasonId={selectedSeasonId} creatorId={me!.userId} open={simulationOpen} onClose={()=>setSimulationOpen(false)} pending={pending==='create'} onSave={(simulation,size,count)=>void run('create',async()=>{const available=await practiceApi.simulationAvailability(org,{seasonId:selectedSeasonId,questionCount:count,teamSize:size,simulation});setAvailability(`Pre-room estimate: ${available.eligibleQuestions} eligible questions for ${available.requestedQuestions} requested. Start checks your actual team again.`);const room=await practiceApi.create(org,{seasonId:selectedSeasonId,teamSize:size,questionCount:count,format:'Pbe',teamCount:1,coached:false,simulation});navigate(roomLink(room.id,room.seasonId));})}/>
        {(currentRoom||invitation)&&<Panel className="practice-current-strip" aria-label={currentRoom?'Current room':'Practice invitation'}><div><Badge tone="info">{currentRoom?.status??'Invitation'}</Badge><h2>{currentRoom?currentRoom.status==='Playing'?'Your match is in progress.':'Your room is waiting for players.':'You’re invited to practice.'}</h2><p>{currentRoom?`${seasonName(currentRoom.seasonId)} · ${roomSizeLabel(currentRoom)} · ${currentRoom.questionCount} questions · ${currentRoom.memberCount} players`: `${invitation!.inviterName} invited you to practice.`}</p>{currentRoom?.ownerId===me!.userId&&<p>You’re the room owner.</p>}</div><LinkButton to={currentRoom?roomLink(currentRoom.id,currentRoom.seasonId):`${base}#invitations`}>{currentRoom?currentRoom.status==='Playing'?'Return to match':'Open lobby':'View invitation'}</LinkButton></Panel>}
        <TrainingDialog className="ds-dialog-workspace" open={pvpOpen} title="PVP setup" onClose={closePvp} pending={!!pending}>
          {error&&<Notice tone="danger">{error}</Notice>}
          <Panel id="create-room" className="practice-hub-create" aria-labelledby="practice-create-title">
            <h2 id="practice-create-title">Create a room</h2>
            <p>Choose your format, then invite your players.</p>
            {!data.seasons.length && <Notice>No active season is available. {coach ? "Activate a season before creating a room." : "Your coach will assign an active season so you can join practice."}</Notice>}
            <form aria-label="Create room" onSubmit={event => {
              event.preventDefault();
              if (pending || !selectedSeasonId) return;
              void run("create", async () => {
                const room = await practiceApi.create(org, { ...(format==='Pbe'?{format,teamCount}:{}),seasonId: selectedSeasonId, teamSize, questionCount, coached: coach && coached, bookKey: bookKey.trim() || undefined });
                setPvpOpen(false);navigate(roomLink(room.id, room.seasonId));
              });
            }}>
              <div className="practice-hub-form-grid">
                <label className="practice-hub-field-wide">Season<Select required disabled={!data.seasons.length} value={selectedSeasonId} onChange={event => setSeason(event.target.value)}>
                  {!data.seasons.length && <option value="">No active seasons</option>}
                  {data.seasons.map(season => <option key={season.id} value={season.id}>{season.name}</option>)}
                </Select></label>
                <label className="practice-hub-field-wide">Practice mode<Select value={format} onChange={event=>{const next=event.target.value as 'Arcade'|'Pbe';setFormat(next);setSize(next==='Pbe'?6:1);setCoached(false);}}><option value="Arcade">Arcade · accuracy and speed</option><option value="Pbe" disabled={!seasonPbeEnabled}>PBE rehearsal · rubric points</option></Select></label>
                {coach && !seasonPbeEnabled && <Notice>PBE rehearsal is locked because PBE training is off for this season. <Button variant="secondary" size="compact" disabled={pending === "pbe" || !selectedSeasonId} onClick={() => void run("pbe", () => pbeApi.enabled(org, selectedSeasonId, true))}>{pending === "pbe" ? "Turning on…" : "Turn on PBE training"}</Button></Notice>}
                {format==='Pbe'&&<p>Two active teams. For one team, use Set up simulation.</p>}
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
        </TrainingDialog>

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
            {!data.rooms.length && <p className="practice-hub-secondary">No rooms yet. Create a room or accept an invitation.</p>}
            <ul className="practice-hub-rooms">{data.rooms.map(room => <li key={room.id}>
              <div><div className="practice-hub-list-title"><strong>{seasonName(room.seasonId)}</strong><Badge tone={room.status === "Playing" ? "success" : room.status === "Lobby" ? "info" : "neutral"}>{room.status}</Badge></div><p>{roomSizeLabel(room)} · {room.questionCount} questions · {room.coached ? "Coach-led" : "Independent"} · {room.memberCount} players</p></div>
              <LinkButton size="compact" variant="secondary" to={room.status === "Completed" && !coach ? recapLink(room.id, room.seasonId) : roomLink(room.id, room.seasonId)}>{room.status === "Completed" ? "View results" : "Open room"}</LinkButton>
            </li>)}</ul>
            {!data.invitations.length && <section id="invitations" className="practice-hub-no-invitations" aria-labelledby="practice-invitations-title"><h3 id="practice-invitations-title">Invitations</h3><p>No pending invitations.</p></section>}
          </Panel>

        </div>
      </>}

      {!!data.simulationAchievements?.length&&<Panel id="simulation-achievements"><h2>Simulation patches</h2><p>Earned together through completed simulations. Choose an unlocked patch for your profile.</p><div className="honor-patch-grid" aria-label="Simulation patches">{data.simulationAchievements.filter(h=>h.seasonId===selectedSeasonId).map(h=><HonorPatchCard key={h.key+h.seasonId}
        title={h.title}
        artwork={<MasteryHonorArtwork honorKey={h.key} size={208} muted={!h.earnedAtUtc} />}
        status={<><Badge tone={h.earnedAtUtc?"success":"neutral"}>{h.earnedAtUtc?"Earned":"Locked"}</Badge><span>{h.current} / {h.target}</span></>}
        detail={<><MasteryHonorArtwork honorKey={h.key} size={192} muted={!h.earnedAtUtc} /><p>{h.requirement}</p><p>Progress: {h.current} of {h.target}</p>{h.earnedAtUtc?<><p>Earned <time dateTime={h.earnedAtUtc}>{evidenceDate(h.earnedAtUtc)}</time>. Your qualifying evidence is saved.</p><LinkButton variant="secondary" to={coach?"/admin/profile":"/student/profile"} aria-label={`Use ${h.title} as profile image`}>Use as profile image</LinkButton></>:<p>This patch is locked. Complete simulations together to unlock it for your profile.</p>}</>}
      />)}</div></Panel>}
      <Panel id="achievements" aria-labelledby="practice-honors-title">
        <h2 id="practice-honors-title">Team Honors</h2>
        <p className="practice-hub-secondary">Arcade mastery Honors use finalized personal accuracy across distinct questions and passages. PBE team milestones record participation and finalized team scores separately.</p>
        {profile.isPending ? <LoadingState label="Loading Team Honors…" /> : profile.isError ? <Notice tone="danger">Team Honors could not load. <Button variant="secondary" onClick={() => void profile.refetch()}>Retry Team Honors</Button></Notice> : <div className="honor-patch-grid" aria-label="Team Honors">{teamHonors.map(honor => <HonorPatchCard key={honor.key}
          title={honor.title}
          artwork={<MasteryHonorArtwork honorKey={honor.key} size={208} muted={!honor.earnedAtUtc} />}
          status={<><Badge tone={honor.earnedAtUtc ? "success" : "neutral"}>{honor.earnedAtUtc ? "Earned" : "Locked"}</Badge>{honor.earnedAtUtc && <span>Earned <time dateTime={honor.earnedAtUtc}>{evidenceDate(honor.earnedAtUtc)}</time></span>}</>}
          detail={<><MasteryHonorArtwork honorKey={honor.key} size={192} muted={!honor.earnedAtUtc} /><p>{honor.category}</p><h3>How to unlock</h3><p>{honor.requirement}</p>{honor.earnedAtUtc ? <><p>Earned <time dateTime={honor.earnedAtUtc}>{evidenceDate(honor.earnedAtUtc)}</time>. Your qualifying evidence is saved.</p><LinkButton variant="secondary" to={coach ? "/admin/profile" : "/student/profile"} aria-label={`Use ${honor.title} as profile image`}>{profile.data?.avatarHonorKey === honor.key ? "Worn as profile image" : "Use as profile image"}</LinkButton></> : <p>This patch is locked. Meet every requirement to unlock it for your profile.</p>}</>}
        />)}</div>}
        <details className="ds-disclosure practice-milestone-history"><summary>Practice milestones</summary><p className="practice-hub-secondary">Team milestones record participation and finalized team scores. PBE milestones use their saved team rules and do not unlock profile images.</p><div className="practice-awards">{data.achievements.map(award => <div key={award.key + "-" + award.seasonId}><MasteryHonorArtwork honorKey={"team:" + award.key.replace(/^pbe-team-v1:/, "")} size={72} /><strong>{award.title}</strong><small>{seasonName(award.seasonId)}</small><Badge>Milestone recorded</Badge></div>)}</div>{!data.achievements.length && <p className="practice-hub-secondary">No team milestones recorded.</p>}</details>
      </Panel>
      <Panel id="practice-progress" aria-labelledby="practice-progress-title">
        <h2 id="practice-progress-title">Team practice progress</h2>
        <p className="practice-hub-secondary">Your finalized match evidence, grouped by season, passage scope, team size, and rules. These measures describe team practice, not individual Scripture mastery.</p>
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
