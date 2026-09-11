import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { HubConnectionState } from "@microsoft/signalr";
import { useAuth } from "../../auth/AuthContext";
import { practiceApi, type PracticeCommand, type PracticeRoom } from "../../api/practice";
import { createPracticeConnection, nativeCloudflare, type PracticeConnection } from "../../api/practiceTransport";
import { Badge, Button, Input, LinkButton, LoadingState, Notice, PageHeader, Panel, Select, Textarea } from "../../components/ui";
import { makeCommand, points, remainingSeconds } from "./practiceUtils";
import { ConfirmationDialog } from "../../components/ui/ConfirmationDialog";
import { AppealForm } from "./AppealForm";
import { QuestionEditor } from "./QuestionEditor";
import "./practice.css";

type Payload = Omit<PracticeCommand, "revision" | "action" | "commandId">;
export function PracticePage() {
  const { me } = useAuth();
  const org = me!.organizationId;
  const coach = me!.kind !== "Student";
  const base = coach ? "/admin/practice" : "/student/practice";
  const { roomId } = useParams();
  const navigate = useNavigate();
  const cache = useQueryClient();
  const bootstrap = useQuery({ queryKey: ["practice", org], queryFn: () => practiceApi.bootstrap(org), enabled: !roomId, refetchInterval: nativeCloudflare ? 60000 : 15000 });
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [seasonId, setSeason] = useState("");
  const [teamSize, setSize] = useState(1);
  const [questionCount, setCount] = useState(10);
  const [coached, setCoached] = useState(false);
  const [bookKey, setBook] = useState("");
  async function run(work: () => Promise<unknown>) { setPending(true); setError(""); try { await work(); await cache.invalidateQueries({ queryKey: ["practice", org] }); } catch (e) { setError(e instanceof Error ? e.message : "Could not complete the action."); } finally { setPending(false); } }
  if (roomId) return <PracticeRoomPage key={roomId} org={org} roomId={roomId} base={base} />;
  return <div className="practice-page">
    <PageHeader title="Team Practice" description="Study together. Answer with care. Grow in Scripture." action={<img src="/brand/practice/team-practice.svg" alt="" width={180} height={100} />} />
    <Notice>Erudoza PBE preparation: accuracy plus up to 25% speed bonus. Head-to-head scores are a training adaptation, not official PBE standings.</Notice>
    {error && <Notice tone="danger">{error}</Notice>}
    {bootstrap.isPending && <LoadingState label="Loading Team Practice…" />}
    {bootstrap.isError && <Notice tone="danger">{bootstrap.error.message}<Button variant="secondary" onClick={() => void bootstrap.refetch()}>Retry</Button></Notice>}
    {bootstrap.data && <>
      {!bootstrap.data.enabled ? <Panel><h2>Team Practice is not enabled</h2><p>A coach can enable this pilot for your organization.</p>{coach && <Button disabled={pending} onClick={() => void run(() => practiceApi.enabled(org, true))}>Enable Team Practice</Button>}</Panel> : <>
        <Panel id="invitations"><div className="practice-section-heading"><h2>Invitations</h2>{bootstrap.data.invitations.length > 0 && <Badge tone="info">{bootstrap.data.invitations.length} pending</Badge>}</div>{!bootstrap.data.invitations.length && <p>No pending invitations.</p>}{bootstrap.data.invitations.map(inv => <div className="practice-row" key={inv.id}><span>{inv.inviterName} invited you {inv.team ? `to Team ${inv.team}` : "to a room"}. <small>Expires {new Date(inv.expiresAt).toLocaleString()}</small></span><div className="practice-actions">{(inv.team ? [inv.team] : [1, 2]).map(team => <Button key={team} disabled={pending} variant="secondary" onClick={() => void run(async () => { const room = await practiceApi.accept(org, inv.id, team); navigate(`${base}/${room.id}`); })}>Join Team {team}</Button>)}</div></div>)}</Panel>
        <Panel id="rooms"><h2>Your rooms</h2><p>Continue a match or revisit a completed room.</p>{!bootstrap.data.rooms.length && <p>No rooms yet. Create a room or accept an invitation.</p>}{bootstrap.data.rooms.map(room => <div className="practice-row" key={room.id}><div><strong>{bootstrap.data!.seasons.find(season => season.id === room.seasonId)?.name || "Past season"}</strong> <Badge tone={room.status === "Playing" ? "success" : "neutral"}>{room.status}</Badge><p>{room.teamSize}v{room.teamSize} · {room.questionCount} questions</p><p>{room.coached ? "Coach-led" : "Independent"} · {room.memberCount} players</p></div><LinkButton size="compact" variant="secondary" to={`${base}/${room.id}`}>{room.status === "Completed" ? "View results" : "Open room"}</LinkButton></div>)}</Panel>
        <Panel id="create-room"><h2>Create a room</h2><p>Choose the season and match format, then invite your players.</p>{!bootstrap.data.seasons.length && <Notice>No active season is available. {coach ? "Activate a season before creating a room." : "Your coach will assign an active season so you can join practice."}</Notice>}<form className="practice-form" onSubmit={e => { e.preventDefault(); void run(async () => { const room = await practiceApi.create(org, { seasonId: seasonId || bootstrap.data.seasons[0]?.id || "", teamSize, questionCount, coached, bookKey: bookKey.trim() || undefined }); navigate(`${base}/${room.id}`); }); }}>
          <label>Season<Select required value={seasonId || bootstrap.data.seasons[0]?.id || ""} onChange={e => setSeason(e.target.value)}>{!bootstrap.data.seasons.length && <option value="">No active seasons</option>}{bootstrap.data.seasons.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></label>
          <label>Team size<Select value={teamSize} onChange={e => setSize(Number(e.target.value))}>{[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}v{n}</option>)}</Select></label>
          <label>Length<Select value={questionCount} onChange={e => setCount(Number(e.target.value))}><option value={10}>10 questions · Practice</option><option value={30}>30 questions · Extended</option><option value={90}>90 questions · Rehearsal</option></Select></label>
          <label>Format<Select value={String(coached)} onChange={e => setCoached(e.target.value === "true")}><option value="false">Independent</option>{coach && <option value="true">Coach-led · Non-playing coach</option>}</Select></label>
          <label>Book scope (optional)<Input value={bookKey} onChange={e => setBook(e.target.value)} placeholder="For example, DAN" aria-describedby="practice-book-help" /></label>
          <Button type="submit" disabled={pending || !bootstrap.data.seasons.length}>{pending ? "Creating…" : "Create room"}</Button>
        </form><p id="practice-book-help">Leave book scope empty to use all approved questions in the season.</p></Panel>
      </>}
      <Panel id="achievements"><h2>Team honors</h2><p>Earned from finalized matches. Team accuracy is separate from your individual mastery.</p><div className="practice-awards">{bootstrap.data.achievements.map(a => <div key={`${a.key}-${a.seasonId}`}><img src={`/brand/practice/${a.key}.svg`} alt="" width={72} height={72} /><strong>{a.title}</strong></div>)}</div>{!bootstrap.data.achievements.length && <p>Your first completed match starts your collection.</p>}</Panel>
      <Panel id="practice-progress"><h2>Team practice progress</h2><p>Finalized match evidence grouped by season, passage scope, team size, and rules. These measures describe team practice, not individual Scripture mastery.</p>{!bootstrap.data.trends?.length && <p>Complete a match and resolve its appeals to see your progress.</p>}{bootstrap.data.trends?.map(trend => <article className="practice-review" key={`${trend.seasonId}-${trend.teamSize}-${trend.bookKey}-${trend.ruleVersion}`}><h3>{bootstrap.data.seasons.find(season => season.id === trend.seasonId)?.name || "Past season"} · {trend.teamSize}v{trend.teamSize} · {trend.bookKey || "Season scope"}</h3><dl className="practice-stats"><div><dt>Accuracy</dt><dd>{trend.availableHundredths ? Math.round(trend.accuracyHundredths / trend.availableHundredths * 100) : 0}%</dd></div><div><dt>Speed bonus</dt><dd>{points(trend.speedHundredths)}</dd></div><div><dt>Completed</dt><dd>{trend.matches}</dd></div><div><dt>Wins / draws</dt><dd>{trend.wins} / {trend.draws}</dd></div><div><dt>Average response</dt><dd>{(trend.averageResponseMs / 1000).toFixed(1)}s</dd></div></dl><p>{trend.distinctQuestions} distinct questions · {trend.distinctPassages} passages · {trend.participatedQuestions} questions with your participation · {trend.unansweredQuestions} unanswered questions.</p><small>Rules: {trend.ruleVersion}</small></article>)}</Panel>
      {coach && <div id="question-bank"><QuestionEditor org={org} data={bootstrap.data} /></div>}
    </>}
  </div>;
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
  const [latency, setLatency] = useState<number | null>(null);
  const [timingQuality, setTimingQuality] = useState<{ rttMs: number; jitterMs: number; samples: number } | null>(null);
  const [serverClock, setServerClock] = useState<{ now: number; observed: number } | null>(null);
  const [tick, setTick] = useState(0);
  const [invitee, setInvitee] = useState("");
  const [swapTargets, setSwapTargets] = useState<Record<string, string>>({});
  const [inviteTeam, setInviteTeam] = useState(0);
  const [chat, setChat] = useState("");
  const [answers, setAnswers] = useState<{ questionId: string; values: string[] } | null>(null);
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
      const snapshot = action !== "submit" && hubRef.current?.state === HubConnectionState.Connected ? await hubRef.current.invoke<PracticeRoom>("Command", org, roomId, command) : await practiceApi.command(org, roomId, command);
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
    if (room?.phase === "Scheduled" && room.scheduleId && mine?.scribe && acknowledged.current !== room.scheduleId) {
      acknowledged.current = room.scheduleId;
      void act("ack", { scheduleId: room.scheduleId });
    }
  }, [room?.phase, room?.scheduleId, mine?.scribe, act]);
  void tick;
  const remaining = remainingSeconds(room?.phaseEndsAt, serverClock ? serverClock.now + performance.now() - serverClock.observed : Date.now());
  if (roomQuery.isPending) return <Panel aria-busy="true"><LoadingState label="Loading room…" /></Panel>;
  if (!room) return <Notice tone="danger">{roomQuery.error?.message || "Room unavailable."}<LinkButton to={base}>Back to Team Practice</LinkButton></Notice>;
  const owner = room.ownerId === me?.userId;
  const lobby = room.status === "Lobby";
  const draft = answers && answers.questionId === room.question?.id ? answers.values : room.draft;
  return <div className="practice-page">
    <PageHeader title={`${room.teamSize}v${room.teamSize} Team Practice`} description={`${room.coached ? "Coach-led rehearsal" : "Independent practice"} · ${room.questionCount} questions`} action={<LinkButton variant="ghost" to={base}>All rooms</LinkButton>} />
    {abandonConfirm && <ConfirmationDialog title="Abandon this room?" description="This closes the match for both teams. Incomplete matches do not grant completion honors." confirmLabel="Abandon room" variant="danger" pending={pending} error={error} onCancel={() => setAbandonConfirm(false)} onConfirm={() => void act("abandon")} />}
    {owner && (room.status === "Lobby" || room.status === "Playing") && <div><Button variant="ghost" disabled={pending} onClick={() => setAbandonConfirm(true)}>Abandon room</Button></div>}
    {timingQuality && <details className="ds-disclosure practice-connection-details"><summary>Connection details</summary><p>{Math.round(timingQuality.rttMs)} ms round trip · {Math.round(timingQuality.jitterMs)} ms jitter · {timingQuality.samples} samples. These diagnostics do not change scoring.</p></details>}
    <div className="practice-actions"><Badge tone={connected ? "success" : "warning"}>{connected ? "Live connection" : nativeCloudflare ? "Connection interrupted · Reconnecting" : "Reconnecting · Snapshot updates active"}</Badge><Badge>{room.status}</Badge>{latency !== null && !timingQuality && <span>{latency} ms round trip · Display estimate</span>}{room.status === "Playing" && <Badge>{room.phase}</Badge>}</div>
    {error && <Notice tone="danger">{error}{retryCommand.current && <Button variant="secondary" disabled={pending} onClick={() => { const command = retryCommand.current; if (!command) return; setPending(true); void practiceApi.command(org, roomId, command).then(snapshot => { cache.setQueryData(key, snapshot); retryCommand.current = null; setError(""); }).catch(e => setError(e.message)).finally(() => setPending(false)); }}>Retry original action</Button>}</Notice>}
      {room.status === "Playing" && <Panel className="practice-live-question"><div className="practice-row"><h2>Question {room.questionIndex + 1} of {room.questionCount}</h2><span role="timer" aria-label={`${room.phase}: ${remaining} seconds remaining`}>{remaining}s</span></div>{remaining <= 10 && room.phase === "Response" && <Notice>Ten seconds or less remaining.</Notice>}{room.phase === "Break" ? <p>Five-minute rehearsal break.</p> : room.phase === "Paused" ? <Notice>Match paused. The interrupted question will be replaced before resuming.</Notice> : room.question && <><Badge>{room.question.points} accuracy points · {room.question.durationSeconds}s response window</Badge><h3 className="practice-question-prompt">{room.question.prompt}</h3><p>{room.question.reference}</p>{mine?.scribe ? <form onSubmit={e => { e.preventDefault(); void act("submit", { answers: draft, questionId: room.question!.id }); }}><div className="practice-answer">{Array.from({ length: room.question.partCount }, (_, index) => <label key={index}>Answer {index + 1}<Textarea value={draft[index] || ""} disabled={pending || room.submitted || room.phase !== "Response"} onChange={e => { const values = [...draft]; values[index] = e.target.value; setAnswers({ questionId: room.question!.id, values }); }} /></label>)}</div><div className="practice-actions"><Button variant="secondary" disabled={pending || room.submitted || room.phase !== "Response"} onClick={() => void act("draft", { answers: draft, questionId: room.question!.id })}>Save team draft</Button><Button type="submit" disabled={pending || room.submitted || room.phase !== "Response"}>Lock final answer</Button></div><p>Locking is final. The latest saved draft is submitted at the deadline without a speed bonus.</p></form> : <p>{room.submitted ? "Your team’s answer is locked." : "Your scribe submits the team’s answer. Share suggestions below."}</p>}{room.submitted && <Notice tone="success">Answer locked. Wait for the question review.</Notice>}</>}
        {(room.isCoach || (owner && room.phase === "Paused")) && <Button disabled={pending} onClick={() => void act("next")}>{room.phase === "Paused" ? "Resume match" : room.phase === "Presentation" ? "Start response window" : "Advance phase"}</Button>}
      </Panel>}
      {mine && room.status === "Playing" && <Panel><h2>Team {mine.team} discussion</h2><p>Private to your team. Coaches can access discussion for moderation; messages are retained for 30 days.</p><div className="practice-messages" role="log" aria-live="polite">{room.messages.map(message => <p key={message.id}><strong>{message.displayName}:</strong> {message.text}</p>)}</div><form className="practice-form" onSubmit={e => { e.preventDefault(); void act("chat", { text: chat }).then(success => { if (success) setChat(""); }); }}><label>Suggestion<Textarea maxLength={500} required value={chat} onChange={e => setChat(e.target.value)} /></label><Button type="submit" disabled={pending || !chat.trim()}>Share with team</Button></form></Panel>}

    <details className="ds-disclosure practice-roster" open={lobby}><summary>Team rosters</summary><div className="practice-teams">{[1, 2].map(team => <Panel key={team}><div className="practice-actions"><img src={`/brand/practice/team-${team === 1 ? "a" : "b"}.svg`} alt="" width={48} height={48} /><h2>Team {team}</h2><Badge>{room.members.filter(member => member.team === team).length} / {room.teamSize}</Badge></div>{room.members.filter(m => m.team === team).map(member => <div className="practice-row" key={member.userId}><div><strong>{member.displayName}</strong><div className="practice-actions">{member.captain && <Badge>Captain</Badge>}{member.scribe && <Badge>Scribe</Badge>}{lobby && <Badge tone={member.ready ? "success" : "neutral"}>{member.ready ? "Ready" : "Preparing"}</Badge>}</div></div><div className="practice-actions">
      {lobby && owner && <details className="ds-disclosure practice-player-manage"><summary>Manage {member.displayName}</summary><div className="practice-player-controls"><Button size="compact" variant="secondary" disabled={pending || room.members.filter(m => m.team !== team).length >= room.teamSize} onClick={() => void act("move", { targetUserId: member.userId, team: team === 1 ? 2 : 1 })}>Move to Team {team === 1 ? 2 : 1}</Button>{room.members.some(m => m.team !== team) && <><label>Swap {member.displayName} with<Select value={swapTargets[member.userId] || ""} onChange={e => setSwapTargets(current => ({ ...current, [member.userId]: e.target.value }))}><option value="">Choose opposing player</option>{room.members.filter(m => m.team !== team).map(opponent => <option key={opponent.userId} value={opponent.userId}>{opponent.displayName}</option>)}</Select></label><Button size="compact" variant="secondary" disabled={pending || !swapTargets[member.userId]} onClick={() => void act("swap", { targetUserId: member.userId, otherUserId: swapTargets[member.userId] })}>Swap teams</Button></>}<Button size="compact" variant="ghost" disabled={pending} onClick={() => void act("remove", { targetUserId: member.userId })}>Remove</Button><Button size="compact" variant="ghost" disabled={pending} onClick={() => void act("owner", { targetUserId: member.userId })}>Make owner</Button></div></details>}
      {lobby && (mine?.captain && mine.team === team) && !member.captain && <Button size="compact" variant="ghost" disabled={pending} onClick={() => void act("captain", { targetUserId: member.userId })}>Make captain</Button>}
      {(lobby || room.phase === "Review" || room.phase === "Break") && (mine?.captain && mine.team === team) && !member.scribe && <Button size="compact" variant="ghost" disabled={pending} onClick={() => void act("scribe", { targetUserId: member.userId })}>Make scribe</Button>}
    </div></div>)}{lobby && !room.isCoach && !mine && <Button variant="secondary" disabled={pending || room.members.filter(m => m.team === team).length >= room.teamSize} onClick={() => void act("join", { team })}>Join Team {team}</Button>}</Panel>)}</div></details>
    {lobby && <Panel><h2>Prepare your room</h2><p>{room.members.length < room.teamSize * 2 ? `${room.teamSize * 2 - room.members.length} more ${room.teamSize * 2 - room.members.length === 1 ? "player is" : "players are"} needed.` : room.members.some(member => !member.ready) ? `${room.members.filter(member => !member.ready).length} ${room.members.filter(member => !member.ready).length === 1 ? "player is" : "players are"} still preparing.` : "Both teams are ready to begin."}</p><div className="practice-actions">{mine && <Button disabled={pending} onClick={() => void act("ready")}>{mine.ready ? "Not ready" : "I’m ready"}</Button>}{owner && <Button disabled={pending || room.members.length !== room.teamSize * 2 || room.members.some(m => !m.ready)} onClick={() => void act("start")}>Start match</Button>}{mine && <Button variant="ghost" disabled={pending} onClick={() => void act("leave")}>Leave room</Button>}</div><p>Both teams must be full and ready. Changes to the roster clear readiness.</p>
      <form className="practice-form" onSubmit={e => { e.preventDefault(); void act("invite", { targetUserId: invitee, ...(inviteTeam ? { team: inviteTeam } : {}) }); }}><label>Invite player<Select required value={invitee} onChange={e => setInvitee(e.target.value)}><option value="">Choose a player</option>{players.data?.players.filter(p => !room.members.some(m => m.userId === p.id)).map(p => <option key={p.id} value={p.id}>{p.displayName}</option>)}</Select></label><label>Destination<Select value={inviteTeam} onChange={e => setInviteTeam(Number(e.target.value))}><option value={0}>Let player choose</option>{[1, 2].filter(t => owner || mine?.team === t).map(t => <option key={t} value={t}>Team {t}</option>)}</Select></label><Button type="submit" disabled={pending || !invitee}>Send invitation</Button></form>
    </Panel>}
    {room.status !== "Lobby" && <>
      <Panel><h2>Scoreboard</h2><div className="practice-teams">{room.scores.map(score => <div key={score.team}><h3>Team {score.team}</h3><dl className="practice-stats"><div><dt>Accuracy</dt><dd>{points(score.accuracyHundredths)}</dd></div><div><dt>Speed bonus</dt><dd>{points(score.speedHundredths)}</dd></div><div><dt>Total</dt><dd>{points(score.totalHundredths)}</dd></div></dl></div>)}</div><p>Speed uses server-observed elapsed time, including network transit. Correct answers earn up to 25% extra; incorrect answers earn no bonus.</p>{room.status === "Completed" && <Notice tone="success">{room.scores.length === 2 && room.scores[0].totalHundredths === room.scores[1].totalHundredths ? "Draw" : `Team ${[...room.scores].sort((a, b) => b.totalHundredths - a.totalHundredths)[0]?.team} leads the final score`}. Results remain provisional while appeals are unresolved.</Notice>}</Panel>
      {!!room.results.length && <Panel><h2>Answer review</h2>{room.results.map(result => <details className="ds-disclosure practice-review" key={`${result.questionId}-${result.team}`} open={room.status === "Playing" && result.questionId === room.results.at(-1)?.questionId}><summary><span>Team {result.team} · {result.prompt}</span><Badge>{points(result.accuracyHundredths)} accuracy points</Badge>{result.appealed && <Badge tone={result.resolved ? "success" : "warning"}>{result.resolved ? "Appeal resolved" : "Appeal pending"}</Badge>}</summary><div className="practice-review-content"><p>{result.reference}</p><p>Submitted: {result.answers.join(" · ") || "No answer"}</p><p>Accepted: {result.acceptedAnswers.map(part => part.join(" / ")).join(" · ")}</p><p>{result.evidence}</p><p>Accuracy {points(result.accuracyHundredths)} · Speed {points(result.speedHundredths)} · {(result.elapsedMs / 1000).toFixed(2)}s server-observed</p><div className="practice-actions">{mine?.team === result.team && !result.appealed && <AppealForm pending={pending} onRequest={text => void act("appeal", { questionId: result.questionId, team: result.team, text })} />}{room.isCoach && (room.coached || result.appealed) && <form className="practice-actions" onSubmit={e => { e.preventDefault(); const form = new FormData(e.currentTarget); void act("judge", { questionId: result.questionId, team: result.team, points: Number(form.get("points")), text: String(form.get("reason")) }); }}><label>Accuracy points<Input name="points" type="number" min={0} step={1} defaultValue={result.accuracyHundredths / 100} required /></label><label>Reason<Input name="reason" required maxLength={500} /></label><Button type="submit" disabled={pending}>Record judgment</Button></form>}{me?.kind === "Student" && <LinkButton variant="ghost" to={`/student/study?mode=Review&seasonId=${room.seasonId}`}>Review this season individually</LinkButton>}</div></div></details>)}</Panel>}
    </>}
  </div>;
}
