import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { practiceApi, pbeApi } from "../../api/practice";
import type { PracticeEvent, PracticeEventInput, PracticeRoom, SimulationConfig } from "../../api/practice";
import { nativeCloudflare } from "../../api/practiceTransport";
import { useAuth } from "../../auth/AuthContext";
import { Badge, Button, HelpTip, Input, LinkButton, LoadingState, Notice, Panel, Select } from "../../components/ui";
import { ConfirmationDialog } from "../../components/ui/ConfirmationDialog";
import { SimulationMenu } from "./SimulationMenu";

type SeasonOption = { id: string; name: string; pbeEnabled?: boolean };

const activityLabel = (event: PracticeEvent) => event.activity === "Simulation" ? "Full-event team rehearsal" : "Head-to-head practice";
const whenText = (event: PracticeEvent) => event.status === "Scheduled" && event.startsAtUtc ? `Starts ${new Date(event.startsAtUtc).toLocaleString()}` : event.status === "Open" ? "Open now" : event.status === "Playing" ? "In progress" : event.status;

function EventForm({ org, seasons, initial, onDone, onCancel }: { org: string; seasons: SeasonOption[]; initial?: PracticeEvent | null; onDone: () => void; onCancel: () => void }) {
  const { me } = useAuth();
  const cache = useQueryClient();
  const [seasonId, setSeasonId] = useState(initial?.seasonId ?? seasons[0]?.id ?? "");
  const [activity, setActivity] = useState<'Simulation' | 'HeadToHead'>(initial?.activity ?? "HeadToHead");
  const [format, setFormat] = useState<'Arcade' | 'Pbe'>(initial?.format ?? "Arcade");
  const [teamSize, setTeamSize] = useState(initial?.teamSize ?? 2);
  const [questionCount, setQuestionCount] = useState(initial?.questionCount ?? 10);
  const [coached, setCoached] = useState(initial?.coached ?? false);
  const [bookKey, setBookKey] = useState(initial?.bookKey ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [when, setWhen] = useState<'now' | 'later'>(initial?.startsAtUtc ? "later" : "now");
  const [startsAt, setStartsAt] = useState(initial?.startsAtUtc ? new Date(initial.startsAtUtc).toISOString().slice(0, 16) : "");
  const [captainStart, setCaptainStart] = useState(initial?.captainStartUserId ?? "");
  const [simulation, setSimulation] = useState<SimulationConfig | null>(initial?.simulation ?? null);
  const [simulationOpen, setSimulationOpen] = useState(false);
  const [assignments, setAssignments] = useState<Record<string, 0 | 1 | 2>>(() => Object.fromEntries((initial?.roster ?? []).map(entry => [entry.userId, entry.team])));
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [pbePending, setPbePending] = useState(false);
  const roster = useQuery({ queryKey: ["practice-event-roster", org, seasonId], queryFn: () => practiceApi.eventRoster(org, seasonId), enabled: !!seasonId });
  const season = seasons.find(entry => entry.id === seasonId);
  const pbeNeeded = activity === "Simulation" || format === "Pbe";
  const teams: (1 | 2)[] = activity === "Simulation" ? [1] : [1, 2];
  const counts = useMemo(() => ({ 1: Object.values(assignments).filter(team => team === 1).length, 2: Object.values(assignments).filter(team => team === 2).length }), [assignments]);
  const seatsFilled = teams.every(team => counts[team] === teamSize);
  const assignedIds = Object.entries(assignments).filter(([, team]) => team !== 0).map(([userId]) => userId);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setError("");
    if (!seasonId) return setError("Choose a season.");
    if (pbeNeeded && !season?.pbeEnabled) return setError("PBE training is off for this season.");
    if (activity === "Simulation" && !simulation) return setError("Set up the simulation settings first.");
    if (activity === "Simulation" && simulation?.audioPresenterId && assignments[simulation.audioPresenterId] !== 1) return setError("The readings presenter must be assigned to the team. Open Simulation settings or assign the presenter.");
    if (!seatsFilled) return setError(`Fill every seat: ${teams.map(team => `Team ${team} has ${counts[team]} of ${teamSize}`).join("; ")}.`);
    if (when === "later" && !startsAt) return setError("Choose the start time, or switch to Open now.");
    const input: PracticeEventInput = {
      seasonId, activity, name: name.trim() || undefined,
      ...(activity === "Simulation" ? { simulation: simulation! } : { format, coached, bookKey: bookKey.trim() || undefined }),
      teamSize, questionCount,
      roster: assignedIds.map(userId => ({ userId, team: assignments[userId] as 1 | 2 })),
      captainStartUserId: captainStart || null,
      startsAtUtc: when === "later" ? new Date(startsAt).toISOString() : null,
      ...(initial && when === "now" ? { openNow: true } : {}),
    };
    setPending(true);
    try {
      if (initial) await practiceApi.updateEvent(org, initial.id, input); else await practiceApi.createEvent(org, input);
      await cache.invalidateQueries({ queryKey: ["practice-events", org] });
      await cache.invalidateQueries({ queryKey: ["practice", org] });
      onDone();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save the event.");
    } finally { setPending(false); }
  }

  return <Panel id="create-event" aria-labelledby="practice-event-form-title">
    <h2 id="practice-event-form-title">{initial ? "Edit event" : "Create a team practice event"}</h2>
    <p>Choose the activity, fill every seat from the season roster, and open it now or schedule it. Assigned students are notified and find the room waiting in Team Practice.</p>
    {error && <Notice tone="danger">{error}</Notice>}
    <form aria-label={initial ? "Edit event" : "Create event"} onSubmit={event => void submit(event)}>
      <div className="practice-hub-form-grid">
        <label className="practice-hub-field-wide">Season<Select required value={seasonId} disabled={!!initial} onChange={event => { setSeasonId(event.target.value); setAssignments({}); setCaptainStart(""); }}>{!seasons.length && <option value="">No active seasons</option>}{seasons.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</Select></label>
        <label className="practice-hub-field-wide">Activity<Select value={activity} onChange={event => { const next = event.target.value as 'Simulation' | 'HeadToHead'; setActivity(next); if (next === "Simulation") { setTeamSize(size => Math.min(6, Math.max(2, size))); } }}>{<option value="HeadToHead">Head-to-head practice · two teams</option>}<option value="Simulation">Full-event team rehearsal · one team (PBE simulation)</option></Select></label>
        <label className="practice-hub-field-wide">Event name (optional)<Input value={name} onChange={event => setName(event.target.value)} placeholder={activity === "Simulation" ? "Full-event team rehearsal" : "Head-to-head practice"} maxLength={120} /></label>
        {activity === "HeadToHead" && <>
          <label className="practice-hub-field-wide">Practice mode<Select value={format} onChange={event => { const next = event.target.value as 'Arcade' | 'Pbe'; setFormat(next); setTeamSize(next === "Pbe" ? 6 : 2); setCoached(false); }}><option value="Arcade">Arcade · accuracy and speed</option><option value="Pbe" disabled={!season?.pbeEnabled}>PBE rehearsal · rubric points</option></Select></label>
          <label>Team size<Select value={teamSize} onChange={event => setTeamSize(Number(event.target.value))}>{(format === "Pbe" ? [2, 3, 4, 5, 6] : [1, 2, 3, 4, 5]).map(size => <option key={size} value={size}>{format === "Pbe" ? `${size} students per team` : `${size}v${size}`}</option>)}</Select></label>
          <label>Match length<Select value={questionCount} onChange={event => setQuestionCount(Number(event.target.value))}><option value={10}>10 questions</option><option value={30}>30 questions</option><option value={90}>90 questions</option></Select></label>
          <label className="practice-hub-field-wide">Format<Select value={String(coached)} onChange={event => setCoached(event.target.value === "true")}><option value="false">Independent</option><option value="true">Coach-led · Non-playing coach</option></Select></label>
          <details className="practice-hub-scope practice-hub-field-wide"><summary>Passage scope</summary><label>Book scope (optional)<Input value={bookKey} onChange={event => setBookKey(event.target.value)} placeholder="For example, DAN" /></label><p>Leave book scope empty to use all approved questions in the season.</p></details>
        </>}
        {activity === "Simulation" && <div className="practice-hub-field-wide">
          <p>{simulation ? `${simulation.preset === 'FullEvent' ? 'Full event' : simulation.preset === 'ShortPractice' ? 'Short practice' : 'Custom'} · ${questionCount} questions · ${teamSize} students · ${simulation.discussion === 'InPerson' ? 'In person' : 'Team chat'}` : "No simulation settings yet."}</p>
          <Button type="button" variant="secondary" disabled={!seasonId || !season?.pbeEnabled} onClick={() => setSimulationOpen(true)}>{simulation ? "Edit simulation settings" : "Set up simulation"}</Button>
        </div>}
        {pbeNeeded && season && !season.pbeEnabled && <Notice>PBE training is off for this season. <Button type="button" variant="secondary" size="compact" disabled={pbePending || !seasonId} onClick={() => { setPbePending(true); void pbeApi.enabled(org, seasonId, true).then(async () => { await cache.invalidateQueries({ queryKey: ["practice", org] }); }).catch(reason => setError(reason instanceof Error ? reason.message : "Could not turn on PBE training.")).finally(() => setPbePending(false)); }}>{pbePending ? "Turning on…" : "Turn on PBE training"}</Button></Notice>}
        <label className="practice-hub-field-wide">Who can start it<Select value={captainStart} onChange={event => setCaptainStart(event.target.value)}><option value="">Coach only</option>{(roster.data?.members ?? []).filter(member => assignments[member.userId]).map(member => <option key={member.userId} value={member.userId}>{member.displayName} (team captain)</option>)}</Select></label>
        <label className="practice-hub-field-wide">When<Select value={when} onChange={event => setWhen(event.target.value as 'now' | 'later')}><option value="now">Open now</option><option value="later">Schedule for later</option></Select></label>
        {when === "later" && <label>Start time<Input type="datetime-local" required value={startsAt} onChange={event => setStartsAt(event.target.value)} /></label>}
      </div>
      <fieldset className="practice-event-roster">
        <legend>Assign players — every seat must be filled</legend>
        <p>{teams.map(team => `Team ${team}: ${counts[team]} of ${teamSize} seats filled`).join(" · ")}</p>
        {roster.isPending ? <LoadingState label="Loading season roster…" /> : roster.isError ? <Notice tone="danger">The season roster could not load. <Button type="button" variant="secondary" size="compact" onClick={() => void roster.refetch()}>Retry</Button></Notice> : !(roster.data?.members.length) ? <p className="practice-hub-secondary">No one is on this season’s roster yet. Assign passages to students first.</p> : <ul className="practice-event-roster-list">{(roster.data?.members ?? []).map(member => <li key={member.userId}>
          <span>{member.displayName}{member.kind === "Adult" ? " · Coach (playing)" : ""}</span>
          <Select aria-label={`Team for ${member.displayName}`} value={assignments[member.userId] ?? 0} onChange={event => setAssignments(current => ({ ...current, [member.userId]: Number(event.target.value) as 0 | 1 | 2 }))}>
            <option value={0}>Not assigned</option>
            {teams.map(team => <option key={team} value={team}>Team {team}</option>)}
          </Select>
        </li>)}</ul>}
      </fieldset>
      <div className="practice-actions">
        <Button type="submit" disabled={pending || !seasonId}>{pending ? "Saving…" : initial ? "Save event" : when === "later" ? "Schedule event" : "Create and open event"}</Button>
        <Button type="button" variant="secondary" disabled={pending} onClick={onCancel}>Cancel</Button>
      </div>
    </form>
    {activity === "Simulation" && <SimulationMenu error={error} org={org} seasonId={seasonId} creatorId={me!.userId} open={simulationOpen} onClose={() => setSimulationOpen(false)} pending={pending} seed={simulation ? ({ simulation, teamSize, questionCount, seasonId } as unknown as PracticeRoom) : undefined} onSave={(config, size, count) => { setSimulation(config); setTeamSize(size); setQuestionCount(count); setSimulationOpen(false); }} />}
  </Panel>;
}

function LiveView({ event }: { event: PracticeEvent }) {
  if (!event.room) return null;
  const ready = event.room.members.filter(member => member.ready).length;
  return <div className="practice-event-live">
    <p>{event.room.memberCount} in the room · {ready} ready{event.room.status === "Lobby" ? " · Waiting in the lobby" : ""}</p>
    <ul>{event.room.members.map(member => <li key={member.userId}><span>{member.displayName} · Team {member.team}{member.captain ? " · Captain" : ""}{member.scribe ? " · Scribe" : ""}</span><Badge tone={member.ready ? "success" : "neutral"}>{member.ready ? "Ready" : "Preparing"}</Badge></li>)}</ul>
  </div>;
}

export function CoachEvents({ org, seasons }: { org: string; seasons: SeasonOption[] }) {
  const location = useLocation();
  const navigate = useNavigate();
  const cache = useQueryClient();
  const events = useQuery({ queryKey: ["practice-events", org], queryFn: () => practiceApi.events(org), refetchInterval: nativeCloudflare ? 60000 : 15000 });
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PracticeEvent | null>(null);
  const [cancelTarget, setCancelTarget] = useState<PracticeEvent | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  useEffect(() => { if (location.hash === "#create-event" || location.hash === "#create-room") { setEditing(null); setFormOpen(true); } }, [location.hash, location.key]);
  const closeForm = () => { setFormOpen(false); setEditing(null); if (location.hash) navigate(`${location.pathname}${location.search}`, { replace: true }); };
  const list = events.data?.events ?? [];
  const live = list.filter(event => ["Open", "Playing"].includes(event.status));
  const scheduled = list.filter(event => event.status === "Scheduled");
  const finished = list.filter(event => ["Completed", "Cancelled", "Expired"].includes(event.status));

  async function act(work: () => Promise<unknown>) {
    setPending(true); setError("");
    try { await work(); await cache.invalidateQueries({ queryKey: ["practice-events", org] }); await cache.invalidateQueries({ queryKey: ["practice", org] }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not complete the action."); }
    finally { setPending(false); }
  }

  const card = (event: PracticeEvent) => <li key={event.id} className="practice-event-card">
    <div>
      <div className="practice-hub-list-title"><strong>{event.name}</strong><Badge tone={event.status === "Playing" ? "success" : event.status === "Open" || event.status === "Scheduled" ? "info" : "neutral"}>{event.status}</Badge></div>
      <p>{activityLabel(event)} · {event.seasonName} · {whenText(event)}</p>
      <p>{event.roster.map(entry => entry.displayName).join(", ")}</p>
      {(event.status === "Open" || event.status === "Playing") && <LiveView event={event} />}
    </div>
    <div className="practice-actions">
      {event.roomId && (event.status === "Open" || event.status === "Playing") && <LinkButton size="compact" variant="secondary" to={`/admin/practice/${event.roomId}`}>{event.status === "Playing" ? "Watch live" : "Open room"}</LinkButton>}
      {event.roomId && event.status === "Completed" && <LinkButton size="compact" variant="secondary" to={`/admin/practice/${event.roomId}`}>View results</LinkButton>}
      {event.status === "Scheduled" && <><Button size="compact" variant="secondary" disabled={pending} onClick={() => { setEditing(event); setFormOpen(true); }}>Edit</Button><Button size="compact" variant="secondary" disabled={pending} onClick={() => void act(() => practiceApi.openEvent(org, event.id))}>Open now</Button></>}
      {!["Playing", "Completed"].includes(event.status) && <Button size="compact" variant="secondary" disabled={pending} onClick={() => void act(() => practiceApi.duplicateEvent(org, event.id))}>Use as template</Button>}
      {["Scheduled", "Open"].includes(event.status) && <Button size="compact" variant="ghost" disabled={pending} onClick={() => setCancelTarget(event)}>Cancel event</Button>}
    </div>
  </li>;

  return <section id="events" aria-labelledby="practice-events-title">
    <Panel>
      <div className="practice-hub-section-heading"><h2 id="practice-events-title">Your events<HelpTip label="About team practice events">You set up each practice and assign the teams. Students see only the events they are assigned to, with the room ready to join.</HelpTip></h2>{!formOpen && <Button onClick={() => { setEditing(null); setFormOpen(true); }}>Create event</Button>}</div>
      {error && <Notice tone="danger">{error}</Notice>}
      {events.isPending ? <LoadingState label="Loading events…" /> : events.isError ? <Notice tone="danger">{events.error.message}<Button variant="secondary" onClick={() => void events.refetch()}>Retry</Button></Notice> : <>
        {!list.length && !formOpen && <p className="practice-hub-secondary">No events yet. Create one and assign your teams — students are notified and the room opens with everyone in place.</p>}
        {!!live.length && <><h3>Happening now</h3><ul className="practice-hub-rooms">{live.map(card)}</ul></>}
        {!!scheduled.length && <><h3>Coming up</h3><ul className="practice-hub-rooms">{scheduled.map(card)}</ul></>}
        {!!finished.length && <><h3>Finished</h3><ul className="practice-hub-rooms">{finished.map(card)}</ul></>}
      </>}
    </Panel>
    {formOpen && <EventForm org={org} seasons={seasons} initial={editing} onDone={closeForm} onCancel={closeForm} />}
    {cancelTarget && <ConfirmationDialog title="Cancel this event?" description="The assigned students will be notified. If the room is open, it closes and no one can join." confirmLabel="Cancel event" variant="danger" pending={pending} error={error} onCancel={() => setCancelTarget(null)} onConfirm={() => void act(() => practiceApi.cancelEvent(org, cancelTarget.id)).then(() => setCancelTarget(null))} />}
  </section>;
}
