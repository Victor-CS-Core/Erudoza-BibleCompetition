import { PbePresentation } from "../study/PbePresentation";
import { ProfileAvatar } from "../profile/ProfileAvatar";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { HubConnectionState } from "@microsoft/signalr";
import { useAuth } from "../../auth/AuthContext";
import { practiceApi, type PracticeCommand, type PracticeRoom } from "../../api/practice";
import { createPracticeConnection, nativeCloudflare, type PracticeConnection } from "../../api/practiceTransport";
import { Badge, Button, Input, LinkButton, LoadingState, Notice, PageHeader, Panel, Select, Textarea } from "../../components/ui";
import { activeRoomTeams, roomSizeLabel, makeCommand, points, remainingSeconds } from "./practiceUtils";
import { ConfirmationDialog } from "../../components/ui/ConfirmationDialog";
import { TrainingDialog } from "../../components/ui/TrainingDialog";
import { AppealForm } from "./AppealForm";
import { PracticeHub } from "./PracticeHub";
import { PracticePatch } from "./PracticePatch";
import "./practice.css";

type Payload = Omit<PracticeCommand, "revision" | "action" | "commandId">;
export function PracticePage() {
  const { me } = useAuth();
  const { roomId } = useParams();
  const base = me!.kind !== "Student" ? "/admin/practice" : "/student/practice";
  return roomId ? <PracticeRoomPage key={roomId} org={me!.organizationId} roomId={roomId} base={base} /> : <PracticeHub />;
}
function PracticeRoomPage({ org, roomId, base }: { org: string; roomId: string; base: string }) {
  const { me } = useAuth();
  const cache = useQueryClient();
  const navigate = useNavigate();
  const key = ["practice-room", org, roomId];
  const roomQuery = useQuery({ queryKey: key, queryFn: () => practiceApi.room(org, roomId), refetchInterval: nativeCloudflare ? false : 2000 });
  const players = useQuery({ queryKey: ["practice", org], queryFn: () => practiceApi.bootstrap(org) });
  const room = roomQuery.data;
  const latestRoom = useRef(room); latestRoom.current = room;
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [connected, setConnected] = useState(false);
  const [abandonConfirm, setAbandonConfirm] = useState(false);
  const [returnConfirm, setReturnConfirm] = useState(false);
  const [latency, setLatency] = useState<number | null>(null);
  const [timingQuality, setTimingQuality] = useState<{ rttMs: number; jitterMs: number; samples: number } | null>(null);
  const [serverClock, setServerClock] = useState<{ now: number; observed: number } | null>(null);
  const [tick, setTick] = useState(0);
  const [invitee, setInvitee] = useState("");
  const [inviteFeedback, setInviteFeedback] = useState("");
  const [swapTargets, setSwapTargets] = useState<Record<string, string>>({});
  const [inviteTeam, setInviteTeam] = useState(0);
  const [chat, setChat] = useState("");
  const [answers, setAnswers] = useState<{ questionId: string; values: string[] } | null>(null);
  const [appealDrafts, setAppealDrafts] = useState<Record<string, string>>({});
  const hubRef = useRef<PracticeConnection | null>(null);
  const acknowledged = useRef("");
  const retryCommand = useRef<PracticeCommand | null>(null);
  const act = useCallback(async (action: string, payload: Payload = {}) => {
    const current = latestRoom.current;
    if (!current) return;
    setPending(true); setError("");
    const command = makeCommand(current.revision, action, payload);
    retryCommand.current = command;
    try {
      // Final answers use the HTTP ingress timestamp, before authentication and room queues.
      const snapshot = !(["submit","draft","present","ack"].includes(action)) && hubRef.current?.state === HubConnectionState.Connected ? await hubRef.current.invoke<PracticeRoom>("Command", org, roomId, command) : await practiceApi.command(org, roomId, command);
      cache.setQueryData(["practice-room", org, roomId], snapshot);
      retryCommand.current = null;
      if (action === "abandon") setAbandonConfirm(false);
      if (action === "leave") navigate(base);
      return true;
    } catch (e) { setError(e instanceof Error ? e.message : "Action failed. Refresh the room and retry."); return false; }
    finally { setPending(false); }
  }, [org, roomId, cache, navigate, base]);
  useEffect(() => {
    let active = true;
    const hub = createPracticeConnection(org, roomId);
    hubRef.current = hub;
    const syncClock = async () => {
      if (hub.state !== HubConnectionState.Connected) return;
      const sent = performance.now();
      try {
        const result = await hub.invoke<{ nonce: string; serverNow: string }>("Ping", crypto.randomUUID());
        const received = performance.now();
        if (active) {
          setLatency(Math.round(received - sent));
          setServerClock({ now: Date.parse(result.serverNow) + (received - sent) / 2, observed: received });
        }
        const probe = await hub.invoke<{ nonce: string; serverNow: string }>("Probe", org, roomId);
        const quality = await hub.invoke<{ rttMs: number; jitterMs: number; samples: number }>("AckProbe", org, roomId, probe.nonce);
        if (active) setTimingQuality(quality);
      } catch { /* Display clock falls back to the next authoritative snapshot. */ }
    };
    const refresh = () => { void cache.invalidateQueries({ queryKey: ["practice-room", org, roomId] }); };
    hub.on("Changed", refresh);
    hub.onreconnecting(() => { if (active) setConnected(false); });
    hub.onreconnected(async () => { await hub.invoke("Watch", org, roomId); if (active) setConnected(true); refresh(); });
    hub.onclose(() => { if (active) setConnected(false); });
    void hub.start().then(async () => { if (!active) return; await hub.invoke("Watch", org, roomId); setConnected(true); await syncClock(); refresh(); }).catch(() => { if (active) setConnected(false); });
    const clockTimer = window.setInterval(() => { void syncClock(); }, 10000);
    return () => { active = false; window.clearInterval(clockTimer); hubRef.current = null; void hub.stop(); };
  }, [org, roomId, cache]);
  useEffect(() => {
    if (room?.serverNow && !connected) setServerClock({ now: Date.parse(room.serverNow), observed: performance.now() });
  }, [room?.serverNow, connected]);
  useEffect(() => { const timer = window.setInterval(() => setTick(t => t + 1), 250); return () => clearInterval(timer); }, []);
  const mine = room?.members.find(m => m.userId === me?.userId);
  useEffect(() => {
    if (room?.format !== "Pbe" && room?.phase === "Scheduled" && room.scheduleId && mine?.scribe && acknowledged.current !== room.scheduleId) {
      acknowledged.current = room.scheduleId;
      void act("ack", { scheduleId: room.scheduleId });
    }
  }, [room?.format, room?.phase, room?.scheduleId, mine?.scribe, act]);
  void tick;
  const remaining = remainingSeconds(room?.phaseEndsAt, serverClock ? serverClock.now + performance.now() - serverClock.observed : Date.now());
  if (roomQuery.isPending) return <Panel aria-busy="true"><LoadingState label="Loading room…" /></Panel>;
  if (!room) return <Notice tone="danger">{roomQuery.error?.message || "Room unavailable."}<LinkButton to={base}>Back to Team Practice</LinkButton></Notice>;
  const pbe=room.format==='Pbe', activeTeams=activeRoomTeams(room), interrupted=room.status==='Interrupted';
  const owner = room.ownerId === me?.userId;
  const lobby = room.status === "Lobby";
  const playing = room.status === "Playing";
  const completed = room.status === "Completed";
  const draft = answers && answers.questionId === room.question?.id ? answers.values : room.draft;
  const teams = activeTeams.map(team => ({ team, members: room.members.filter(member => member.team === team) }));
  const openTeams = teams.filter(team => team.members.length < room.teamSize).map(team => team.team);
  const full = teams.every(team => team.members.length === room.teamSize);
  const readyCount = room.members.filter(member => member.ready).length;
  const allReady = full && room.members.every(member => member.ready);
  const readiness = !full ? `${room.teamSize * activeTeams.length - room.members.length} more ${room.teamSize * activeTeams.length - room.members.length === 1 ? "player is" : "players are"} needed.` : !allReady ? `${room.members.length - readyCount} ${room.members.length - readyCount === 1 ? "player is" : "players are"} still preparing.` : activeTeams.length===1?"Your team is ready to begin.":"Both teams are ready to begin.";
  const availablePlayers = players.data?.players.filter(player => !room.members.some(member => member.userId === player.id)) ?? [];
  const directTeams = openTeams.filter(team => owner || mine?.team === team);
  const destination = directTeams.includes(inviteTeam) ? inviteTeam : 0;
  const selectedInvitee = availablePlayers.find(player => player.id === invitee);
  const canInvite = Boolean(owner || mine);
  const seasonName = players.data?.seasons.find(season => season.id === room.seasonId)?.name || "Room season";
  const currentResults = room.results.filter(result => result.questionId === room.question?.id);
  const previousResults = room.results.filter(result => !playing || room.phase !== "Review" || result.questionId !== room.question?.id);
  const bothJudged = activeTeams.every(team => currentResults.some(result => result.team === team && result.resolved));
  const canRun = owner || (pbe && !room.coached && Boolean(mine?.captain));
  const canGuide = (room.coached && room.isCoach) || (canRun && room.phase === "Paused");
  const canAdvance = (!pbe && room.phase === "Presentation") || room.phase === "Paused" || (room.phase === "Review" && bothJudged) || (room.phase === "Break" && Boolean(room.phaseEndsAt) && remaining === 0);
  const nextLabel = room.phase === "Paused" ? "Resume match" : room.phase === "Presentation" ? "Start response window" : room.phase === "Review" ? room.questionIndex + 1 === room.questionCount ? "Complete match" : "Next question" : room.phase === "Break" ? "Resume after break" : "Waiting for response window";
  const unresolved = room.results.filter(result => !result.resolved).length;
  const visibleScores = activeTeams.map(team => room.scores.find(score => score.team === team));
  const outcome = pbe ? "Rehearsal complete." : !room.results.length || visibleScores.some(score => !score) ? "Match complete." : visibleScores[0]!.totalHundredths === visibleScores[1]!.totalHundredths ? "An evenly matched finish." : `Team ${visibleScores[0]!.totalHundredths > visibleScores[1]!.totalHundredths ? 1 : 2} ${unresolved ? "leads on points" : "wins on points"}.`;
  const connection = <div className="practice-connection"><span className={`practice-status-dot${connected ? " is-connected" : ""}`} aria-hidden="true" /><span>{connected ? "Live connection" : nativeCloudflare ? "Connection interrupted · Reconnecting" : "Reconnecting · Snapshot updates active"}</span></div>;
  const review = (results: PracticeRoom["results"], expanded = false) => <PracticeAnswerReview results={results} room={room} mineTeam={mine?.team} student={me?.kind === "Student"} pending={pending} act={act} expanded={expanded} appealDrafts={appealDrafts} onAppealDraftChange={(key, reason) => setAppealDrafts(current => ({ ...current, [key]: reason }))} />;
  const roster = <div className="practice-teams" data-team-count={activeTeams.length}>{teams.map(({ team, members }) => <Panel key={team} className={`practice-team-card practice-team-${team}`}>
    <div className="practice-team-banner"><PracticePatch kind={team === 1 ? "team-a" : "team-b"} size={112} /><div><h2>Team {team}</h2><p>{mine?.team === team ? "Your team" : ""}{mine?.team === team ? " · " : ""}{members.length} / {room.teamSize} players</p><span className="practice-team-readiness">{lobby ? `${members.filter(member => member.ready).length} of ${room.teamSize} ready` : members.find(member => member.scribe) ? `Scribe: ${members.find(member => member.scribe)!.displayName}` : "No scribe assigned"}</span></div></div>
    <ol className="practice-player-list">{members.map(member => <li key={member.userId}><ProfileAvatar userId={member.userId} displayName={member.displayName} size={36} /><div className="practice-player-label"><strong>{member.displayName}{member.userId === me?.userId && " · You"}</strong><small>{[member.userId === room.ownerId && "Owner", member.captain && "Captain", member.scribe && "Scribe"].filter(Boolean).join(" · ") || "Player"}</small></div>{lobby && <Badge tone={member.ready ? "success" : "neutral"}>{member.ready ? "Ready" : "Preparing"}</Badge>}
      {(lobby || (playing && ["Review", "Break", "Paused"].includes(room.phase))) && mine?.captain && mine.team === team && (!member.captain || !member.scribe) && <div className="practice-role-actions">{!member.captain && <Button size="compact" variant="ghost" disabled={pending} onClick={() => void act("captain", { targetUserId: member.userId })}>Make captain</Button>}{!member.scribe && <Button size="compact" variant="ghost" disabled={pending} onClick={() => void act("scribe", { targetUserId: member.userId })}>Make scribe</Button>}</div>}
    </li>)}{lobby && Array.from({ length: Math.max(0, room.teamSize - members.length) }, (_, index) => <li className="practice-player-empty" key={`empty-${index}`}><span className="practice-player-number" aria-hidden="true">{members.length + index + 1}</span><span>Available seat</span></li>)}</ol>
    {lobby && !room.isCoach && !mine && <div className="practice-team-join"><Button variant="secondary" disabled={pending || members.length >= room.teamSize} onClick={() => void act("join", { team })}>Join Team {team}</Button></div>}
  </Panel>)}</div>;
  const discussion = (mine || room.isCoach) && <Panel className="practice-discussion"><div className="practice-section-heading"><h2>{mine ? `Team ${mine.team} discussion` : "Team discussion"}</h2><Badge>{mine ? "Team only" : "Read-only moderation"}</Badge></div><div className="practice-messages" role="log" aria-label={mine ? `Team ${mine.team} messages` : "Room discussion for moderation"} aria-live="polite">{!room.messages.length && <p className="practice-muted">{mine ? "Share a thought with your team." : "No discussion messages are available."}</p>}{room.messages.map(message => <article key={message.id}><ProfileAvatar userId={message.userId} displayName={message.displayName} size={32} /><div><strong>{message.displayName}{message.userId === me?.userId && " · You"}</strong><p>{message.text}</p></div></article>)}</div>
    {mine && <form className="practice-chat-compose" onSubmit={e => { e.preventDefault(); void act("chat", { text: chat }).then(success => { if (success) setChat(""); }); }}><label className="practice-suggestion">Suggestion<Input placeholder="Share a suggestion…" maxLength={500} required value={chat} onChange={e => setChat(e.target.value)} /></label><Button type="submit" disabled={pending || !chat.trim()} aria-label="Share with team"><span aria-hidden="true">↑</span></Button></form>}
    <p className="practice-note">Private to your team. Coaches can access discussion for moderation; messages are retained for 30 days.</p></Panel>;
  return <div className="practice-page practice-room" data-status={room.status} data-phase={room.phase}>
    <div className="practice-room-context">{playing ? <Button variant="ghost" onClick={() => setReturnConfirm(true)}>← All rooms</Button> : <LinkButton variant="ghost" to={base}>← All rooms</LinkButton>}<div><span>{roomSizeLabel(room)} · {room.questionCount} questions</span><Badge>{room.coached ? "Coach-led" : "Independent"}</Badge></div></div>
    <TrainingDialog open={returnConfirm} title="Return to your rooms?" pending={pending} onClose={() => setReturnConfirm(false)}><p>The match continues while you are away. Unsaved answer text may be lost. Returning to your rooms does not leave your team or abandon the match.</p><div className="practice-actions"><Button variant="secondary" disabled={pending} onClick={() => setReturnConfirm(false)}>Keep playing</Button><Button disabled={pending} onClick={() => navigate(base)}>Return to rooms</Button></div></TrainingDialog>
    {abandonConfirm && <ConfirmationDialog title="Abandon this room?" description="This closes the match for both teams. Incomplete matches do not grant completion honors." confirmLabel="Abandon room" variant="danger" pending={pending} error={error} onCancel={() => setAbandonConfirm(false)} onConfirm={() => void act("abandon")} />}
    {error && <Notice tone="danger">{error}{retryCommand.current && <Button variant="secondary" disabled={pending} onClick={() => { const command = retryCommand.current; if (!command) return; setPending(true); void practiceApi.command(org, roomId, command).then(snapshot => { cache.setQueryData(key, snapshot); retryCommand.current = null; setError(""); }).catch(e => setError(e.message)).finally(() => setPending(false)); }}>Retry original action</Button>}</Notice>}
    {lobby && <>
      <PageHeader className="practice-ready-heading" title="Bring your team together." description={<>{readiness} <span>{readyCount} of {room.teamSize * activeTeams.length} players ready.</span></>} action={<div className="practice-actions">{mine && <Button variant={mine.ready ? "secondary" : "primary"} disabled={pending} onClick={() => void act("ready")}>{mine.ready ? "Not ready" : "I’m ready"}</Button>}{canRun && <Button disabled={pending || !allReady} onClick={() => void act("start")}>Start match</Button>}</div>} />
      <section aria-label="Team rosters">{roster}</section>
      <div className="practice-lobby-foot"><p>{activeTeams.length===1?"Your team must be full and ready.":"Both teams must be full and ready."} Changes to the roster clear readiness.</p>{mine && <Button variant="ghost" disabled={pending || owner} title={owner ? "Transfer room ownership before leaving." : undefined} onClick={() => void act("leave")}>Leave room</Button>}</div>
      <Panel className="practice-room-setup" id="room-setup"><div className="practice-section-heading"><h2>Room setup &amp; Invitations</h2><Badge>{room.coached && room.isCoach ? "Non-playing coach" : owner ? "Room owner" : "Lobby"}</Badge></div><div className="practice-setup-grid"><div><h3>Your match</h3><dl className="practice-room-summary"><div><dt>Season</dt><dd>{seasonName}</dd></div><div><dt>Team size</dt><dd>{roomSizeLabel(room)}</dd></div><div><dt>Length</dt><dd>{room.questionCount} questions</dd></div><div><dt>Format</dt><dd>{room.coached ? "Coach-led" : "Independent"}</dd></div></dl><p className="practice-note">These choices are set for this room.</p><div className="practice-capacity">{teams.map(({ team, members }) => <div key={team}><strong>Team {team}</strong><span>{members.length} / {room.teamSize} players</span><small>{members.length >= room.teamSize ? "Full" : `${room.teamSize - members.length} ${room.teamSize - members.length === 1 ? "seat" : "seats"} open`}</small></div>)}</div></div>
        {canInvite && <div className="practice-invitations"><h3>Invite a player</h3><p className="practice-muted">Choose someone from your academy and where they can join.</p>{inviteFeedback && <Notice tone="success">{inviteFeedback}</Notice>}{players.isPending && <LoadingState label="Loading available players…" />}{players.isError && <Notice tone="danger">Could not load available players.<Button variant="secondary" onClick={() => void players.refetch()}>Retry players</Button></Notice>}{!openTeams.length ? <Notice>{activeTeams.length===1?"Your team is full.":"Both teams are full."} Manage the roster below to open a seat.</Notice> : players.data && !availablePlayers.length && <Notice>No other available players. Everyone in the player list has joined this room.</Notice>}
          <form className="practice-invite-form" onSubmit={e => { e.preventDefault(); if (!selectedInvitee || !openTeams.length) return; setInviteFeedback(""); const invitedName = selectedInvitee.displayName; void act("invite", { targetUserId: selectedInvitee.id, ...(destination ? { team: destination } : {}) }).then(success => { if (success) { setInviteFeedback(`Invitation sent to ${invitedName}${destination ? ` for Team ${destination}` : ""}. They can accept it from Team Practice.`); setInvitee(""); } }); }}><label>Invite player<Select required value={selectedInvitee?.id || ""} disabled={pending || !openTeams.length || !availablePlayers.length} onChange={e => { setInvitee(e.target.value); setInviteFeedback(""); }}><option value="">Choose a player</option>{availablePlayers.map(player => <option key={player.id} value={player.id}>{player.displayName}</option>)}</Select></label><label>Destination<Select value={destination} disabled={pending || !openTeams.length} onChange={e => setInviteTeam(Number(e.target.value))}><option value={0}>{openTeams.length > 1 ? "Let player choose" : openTeams.length ? `Let player join available Team ${openTeams[0]}` : "No available seats"}</option>{directTeams.map(team => <option key={team} value={team}>Team {team} · {room.teamSize - teams[team - 1].members.length} open</option>)}</Select></label><Button type="submit" disabled={pending || !selectedInvitee || !openTeams.length}>{pending ? "Please wait…" : "Send invitation"}</Button></form><p className="practice-note">{owner ? "Invite to an available team, or let the player choose an available seat." : "Direct invitations are limited to your team. A room invitation lets the player choose an available seat."} Invitations expire after 24 hours.</p>
        </div>}
      </div></Panel>
      {owner && <Panel className="practice-management"><h2>Roster management</h2><p className="practice-muted">Move or swap players, transfer ownership, or open a seat. Roster changes clear readiness.</p>{room.members.map(member => <details className="ds-disclosure practice-player-manage" key={member.userId}><summary>Manage {member.displayName}</summary><p>Team {member.team}{member.userId === room.ownerId ? " · Room owner" : ""}</p><div className="practice-player-controls">{activeTeams.length===2&&<Button size="compact" variant="secondary" disabled={pending || !openTeams.includes(member.team === 1 ? 2 : 1)} onClick={() => void act("move", { targetUserId: member.userId, team: member.team === 1 ? 2 : 1 })}>Move to Team {member.team === 1 ? 2 : 1}</Button>}{room.members.some(opponent => opponent.team !== member.team) && <><label>Swap {member.displayName} with<Select value={swapTargets[member.userId] || ""} onChange={e => setSwapTargets(current => ({ ...current, [member.userId]: e.target.value }))}><option value="">Choose opposing player</option>{room.members.filter(opponent => opponent.team !== member.team).map(opponent => <option key={opponent.userId} value={opponent.userId}>{opponent.displayName}</option>)}</Select></label><Button size="compact" variant="secondary" disabled={pending || !room.members.some(opponent => opponent.team !== member.team && opponent.userId === swapTargets[member.userId])} onClick={() => void act("swap", { targetUserId: member.userId, otherUserId: swapTargets[member.userId] })}>Swap teams</Button></>}<Button size="compact" variant="ghost" disabled={pending || member.userId === room.ownerId} onClick={() => void act("remove", { targetUserId: member.userId })}>Remove</Button>{!room.coached && member.userId !== room.ownerId && <Button size="compact" variant="ghost" disabled={pending} onClick={() => void act("owner", { targetUserId: member.userId })}>Make owner</Button>}</div>{member.userId === room.ownerId && <p className="practice-note">Transfer ownership to another player before leaving or removing yourself.</p>}</details>)}</Panel>}
    </>}
    {completed && <PageHeader className="practice-result-heading" title={outcome} description={pbe?`${room.questionCount} questions together. Earned and available rubric points.`:`${room.questionCount} questions together. Accuracy and speed are shown separately.`}><div className="practice-result-status"><Badge>Completed</Badge><Badge tone={unresolved ? "warning" : "success"}>{unresolved ? "Provisional result" : "Finalized result"}</Badge></div></PageHeader>}
    {interrupted && <><PageHeader title="Rehearsal interrupted" description={room.interruptionReason==='UnarmedReserveUnavailable'?"A valid frozen replacement was unavailable. Earlier answers are preserved. This is an incomplete rehearsal; start a new room to continue practicing.":"One or more teams did not have a trusted response when the room clock was lost. Earlier answers and locked finals are preserved. This is a partial result; no reserve was used for this interruption and full completion was not credited."}/><LinkButton to={`${base}#create-room`}>Start a new rehearsal</LinkButton></>}
    {room.status === "Abandoned" && <PageHeader className="practice-result-heading" title="This match ended early." description="The room was abandoned. Incomplete matches do not grant completion honors."><Badge>Abandoned · Incomplete</Badge></PageHeader>}
    {!lobby && <PracticeScoreboard room={room} result={completed} />}
    {playing && <div className="practice-live-grid"><Panel className="practice-live-question"><div className="practice-question-meta"><span>{room.question ? `${room.question.points} accuracy points · ${room.question.durationSeconds}s response window` : room.phase}</span>{room.phaseEndsAt ? <span className="practice-timer" role="timer" aria-label={`${room.phase}: ${remaining} seconds remaining`}>{Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}</span> : <Badge>{room.coached && ["Presentation", "Review"].includes(room.phase) ? "Awaiting coach" : room.phase === "Paused" ? "Paused" : "Awaiting room update"}</Badge>}</div>
      {room.phase === "Break" ? <><h1>Take a breath. Regroup.</h1><p>Five-minute rehearsal break. The next question follows when the break is complete.</p></> : room.phase === "Paused" ? <><h1>The match is paused.</h1><Notice>The interrupted question will be replaced before resuming. Your recorded scores are preserved.</Notice></> : room.question ? <><h1 className="practice-question-prompt">{room.question.prompt}</h1><p className="practice-question-reference">{room.question.reference}</p>
        {room.phase === "Review" ? <><div className="practice-section-heading"><h2>Round review</h2><Badge>{currentResults.length} team answers</Badge></div>{review(currentResults, true)}</> : <>
          {room.phase === "Presentation" && !pbe && <p className="practice-note">Read the question together. {room.coached ? "Your coach will open the response window." : "The shared response window follows presentation."}</p>}{pbe&&room.phase==='Presentation'&&(mine?.scribe&&!room.presentationDelivery?.[me!.userId]?<PbePresentation key={room.question.id} text={`${room.question.reference}. ${room.question.points} points. ${room.question.prompt}`} onReady={async delivery=>{if(!await act('present',{questionId:room.question!.id,delivery}))throw new Error('Presentation was not accepted.');}}/>:<Notice>Waiting for each current scribe to confirm two readings.</Notice>)}{room.phase === "Scheduled" && <Notice>{pbe?'Response starts in three seconds after all scribes confirm their readings.':'Synchronizing the start. Both scribes acknowledge the shared response window.'}</Notice>}{remaining <= 10 && room.phase === "Response" && room.phaseEndsAt && <Notice>Ten seconds or less remaining.</Notice>}
          {room.submitted ? <div className="practice-locked-answer"><h2>Your answer is locked.</h2><Notice tone="success">Answer locked. Wait for the question review.</Notice><p className="practice-note">{activeTeams.length===1?"Wait for the recorded question review.":"Your team can keep discussing while the other answer arrives."}</p></div> : mine?.scribe ? <form onSubmit={e => { e.preventDefault(); void act("submit", { answers: draft, questionId: room.question!.id }); }}><p className="practice-scribe-note">You are Team {mine.team}’s scribe.</p><div className="practice-answer">{Array.from({ length: room.question.partCount }, (_, index) => <label key={index}>Answer {index + 1}<Textarea maxLength={2000} value={draft[index] || ""} disabled={pending || room.phase !== "Response"} onChange={e => { const values = [...draft]; values[index] = e.target.value; setAnswers({ questionId: room.question!.id, values }); }} /></label>)}</div><div className="practice-actions practice-answer-actions"><Button variant="secondary" disabled={pending || room.phase !== "Response"} onClick={() => void act("draft", { answers: draft, questionId: room.question!.id })}>Save team draft</Button><Button type="submit" disabled={pending || room.phase !== "Response"}>Lock final answer</Button></div><p className="practice-note">Locking is final. The latest saved draft is submitted at the deadline.</p></form> : <p className="practice-scribe-note">{mine ? `${room.members.find(member => member.team === mine.team && member.scribe)?.displayName || "Your scribe"} submits your team’s answer. Share suggestions in discussion.` : "Both teams’ scribes submit their own answers."}</p>}
        </>}
      </> : <LoadingState label="Waiting for the question…" />}
    </Panel><aside className="practice-live-side">{canGuide && <Panel className="practice-coach-panel"><h2>Guide the next phase</h2><ol className="practice-phase-flow" aria-label="Match phases">{["Presentation", "Response", "Review"].map(phase => <li key={phase} aria-current={room.phase === phase ? "step" : undefined}>{phase}</li>)}</ol><p className="practice-muted">{room.phase === "Presentation" ? "Coach-led presentation waits for you. There is no countdown during reading." : room.phase === "Review" ? "Review both teams’ answers. Record both judgments before advancing." : room.phase === "Paused" ? "Resume with a replacement question when everyone is ready." : room.phase === "Break" ? "The five-minute break must finish before the next question." : "Both teams have the same response window. Wait for it to finish."}</p>{room.phase === "Review" && <p className="practice-note">{activeTeams.filter(team => currentResults.some(result => result.team === team && result.resolved)).length} of {activeTeams.length} judgments recorded.</p>}<Button disabled={pending || !canAdvance} onClick={() => void act("next")}>{nextLabel}</Button></Panel>}{mine ? discussion : room.isCoach && <details className="ds-disclosure practice-moderation"><summary>Team discussion · coach moderation</summary>{discussion}</details>}<details className="ds-disclosure practice-roster"><summary>Team rosters · {room.members.length} players</summary>{roster}</details>{connection}</aside></div>}
    {(completed || interrupted || room.status === "Abandoned") && <><div className="practice-actions practice-result-actions"><LinkButton to={base}>Back to Team Practice</LinkButton>{!!room.results.length && <Button variant="secondary" onClick={() => { const target = document.getElementById("answer-review"); target?.scrollIntoView({ block: "start" }); target?.focus({ preventScroll: true }); }}>Review answers ↓</Button>}</div><div className="practice-result-detail-grid"><Panel><h2>Every point, explained.</h2><table className="practice-score-table"><thead><tr><th scope="col">Score breakdown</th>{activeTeams.map(team=><th scope="col" key={team}>Team {team}</th>)}</tr></thead><tbody>{(pbe?([['Earned points','accuracyHundredths'],['Available points','availableHundredths']] as const):([['Accuracy', 'accuracyHundredths'], ['Speed bonus', 'speedHundredths'], ['Total points', 'totalHundredths']] as const)).map(([label, field]) => <tr key={field}><th scope="row">{label}</th>{visibleScores.map((score, index) => <td key={index}>{score ? points(score[field]??0) : "—"}</td>)}</tr>)}</tbody></table><p className="practice-note">{pbe?"Only rubric accuracy earns points. These practice results do not declare an official placing.":"Speed uses server-observed elapsed time, including network transit. Correct answers earn up to 25% extra; incorrect answers earn no bonus."}</p></Panel><Panel><h2>{completed ? "Make the next practice count." : "Pick up with a new room."}</h2><p className="practice-muted">{completed ? unresolved ? `${unresolved} ${unresolved === 1 ? "answer needs" : "answers need"} review. Results and team honors remain provisional until outstanding judgments and appeals are resolved.` : "All recorded answers are resolved. Team practice scores are separate from your individual Scripture mastery." : "Review the recorded answers, then bring your team together for a new match."}</p>{me?.kind === "Student" && <LinkButton variant="secondary" to={`/student/study?mode=Review&seasonId=${room.seasonId}`}>Review this season individually</LinkButton>}</Panel></div></>}
    {!lobby && !!previousResults.length && <Panel id="answer-review" tabIndex={-1}><h2>{playing ? "Previous answers" : "Answer review"}</h2>{review(previousResults)}</Panel>}
    {(completed || interrupted || room.status === "Abandoned") && <details className="ds-disclosure practice-roster"><summary>Team rosters · {room.members.length} players</summary>{roster}</details>}
    {!playing && connection}
    <details className="ds-disclosure practice-connection-details"><summary>Connection details{owner && (lobby || playing) ? " & room controls" : ""}</summary>{timingQuality ? <p>{Math.round(timingQuality.rttMs)} ms round trip · {Math.round(timingQuality.jitterMs)} ms jitter · {timingQuality.samples} samples. These diagnostics do not change scoring.</p> : <p>{latency !== null ? `${latency} ms round trip · Display estimate.` : "Waiting for a connection measurement."} Scores use the server’s recorded time.</p>}{owner && (lobby || playing) && <Button variant="ghost" disabled={pending} onClick={() => setAbandonConfirm(true)}>Abandon room</Button>}</details>
    <p className="practice-footnote">{pbe?"PBE rehearsal · Accuracy-only practice points, not official PBE standings.":"Arcade preparation: accuracy plus up to 25% speed bonus. Head-to-head scores are a training adaptation, not official PBE standings."}</p>
  </div>;
}

function PracticeScoreboard({ room, result }: { room: PracticeRoom; result: boolean }) {
  const pbe=room.format==='Pbe';
  const scoredQuestions = new Set(room.results.map(answer => answer.questionId)).size;
  const team = (teamNumber: number) => {
    const score = room.scores.find(item => item.team === teamNumber);
    return <div className="practice-score-team"><PracticePatch kind={teamNumber === 1 ? "team-a" : "team-b"} size={result ? 126 : 86} /><div><h2>Team {teamNumber}</h2><strong className="practice-score">{score ? points(score.totalHundredths) : "—"}</strong><p className="practice-subscore">{score ? pbe?`${points(score.accuracyHundredths)} / ${points(score.availableHundredths??0)} rubric points`:`${points(score.accuracyHundredths)} accuracy · ${points(score.speedHundredths)} speed` : "No recorded score"}</p></div></div>;
  };
  return <Panel aria-label="Scoreboard" data-team-count={room.teamCount??2} data-format={room.format??'Arcade'} className={`practice-scoreboard${result ? " practice-result-scoreboard" : ""}`}>{team(1)}<div className="practice-match-center"><h2>{room.status === "Playing" ? `Question ${Math.min(room.questionIndex + 1, room.questionCount)} of ${room.questionCount}` : `${scoredQuestions} questions scored`}</h2><p>{room.status === "Playing" ? room.phase : room.status === "Completed" ? "Match complete" : "Incomplete match"}</p><p>{room.status === "Playing" ? "Revealed scores" : pbe?"Earned / available points":"Accuracy + speed"}</p><progress aria-label="Questions scored" value={scoredQuestions} max={room.questionCount} /></div>{room.teamCount!==1&&team(2)}</Panel>;
}

function PracticeAnswerReview({ results, room, mineTeam, student, pending, act, expanded, appealDrafts, onAppealDraftChange }: { results: PracticeRoom["results"]; room: PracticeRoom; mineTeam?: number; student: boolean; pending: boolean; act: (action: string, payload?: Payload) => Promise<boolean | undefined>; expanded: boolean; appealDrafts: Record<string, string>; onAppealDraftChange: (key: string, reason: string) => void }) {
  return <>{results.map(result => <details className="ds-disclosure practice-review" key={`${result.questionId}-${result.team}`} open={expanded || (room.status === "Playing" && result.questionId === room.results.at(-1)?.questionId)}><summary><span>Team {result.team} · {result.prompt}</span><Badge>{points(result.accuracyHundredths)}{room.format==='Pbe'?` / ${points(result.availableHundredths??0)} rubric points`:' accuracy points'}</Badge>{result.appealed ? <Badge tone={result.resolved ? "success" : "warning"}>{result.resolved ? "Appeal resolved" : "Appeal pending"}</Badge> : room.coached && <Badge tone={result.resolved ? "success" : "warning"}>{result.resolved ? "Judgment recorded" : "Judgment needed"}</Badge>}</summary><div className="practice-review-content"><p className="practice-question-reference">{result.reference}</p><p><strong>Submitted:</strong> {result.answers.join(" · ") || "No answer"}</p><p><strong>Accepted:</strong> {result.acceptedAnswers.map(part => part.join(" / ")).join(" · ")}</p><p><strong>Source evidence:</strong> {result.evidence}</p><p>Accuracy {points(result.accuracyHundredths)}{room.format!=='Pbe'&&<> · Speed {points(result.speedHundredths)}</>} · {(result.elapsedMs / 1000).toFixed(2)}s server-observed</p><div className="practice-actions">{mineTeam === result.team && !result.appealed && (room.status === "Completed" || room.phase === "Review") && <AppealForm reason={appealDrafts[`${result.questionId}-${result.team}`] || ""} onReasonChange={reason => onAppealDraftChange(`${result.questionId}-${result.team}`, reason)} pending={pending} onRequest={text => void act("appeal", { questionId: result.questionId, team: result.team, text })} />}{room.isCoach && (result.appealed || (room.coached && room.phase === "Review")) && <form className="practice-judgment-form" onSubmit={e => { e.preventDefault(); const form = new FormData(e.currentTarget); void act("judge", { questionId: result.questionId, team: result.team, points: Number(form.get("points")), text: String(form.get("reason")) }); }}><label>Accuracy points<Input name="points" type="number" min={0} step={1} defaultValue={result.accuracyHundredths / 100} required /></label><label>Reason<Input name="reason" required maxLength={500} /></label><Button type="submit" disabled={pending}>Record judgment</Button></form>}{student && <LinkButton variant="ghost" to={`/student/study?mode=Review&seasonId=${room.seasonId}`}>Review this season individually</LinkButton>}</div></div></details>)}</>;
}
