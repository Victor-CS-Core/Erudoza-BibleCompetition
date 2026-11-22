import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { practiceApi } from "../../api/practice";
import type { PracticeBootstrap, PracticeEvent } from "../../api/practice";
import { nativeCloudflare } from "../../api/practiceTransport";
import { useAuth } from "../../auth/AuthContext";
import { Badge, Button, LinkButton, LoadingState, Notice, Panel } from "../../components/ui";

/** The student Team Practice page: an inbox of the events the coach assigned
 *  to this student — happening now, coming up, and recent results. There is
 *  no create surface and no season selector; rooms arrive pre-assigned. */
export function StudentPracticeInbox({ org, data }: { org: string; data: PracticeBootstrap }) {
  const { me } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const cache = useQueryClient();
  const events = useQuery({ queryKey: ["practice-events", org], queryFn: () => practiceApi.events(org), refetchInterval: nativeCloudflare ? 60000 : 15000 });
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const list = (events.data?.events ?? []).filter(event => !["Cancelled", "Expired"].includes(event.status));
  const live = list.filter(event => ["Open", "Playing"].includes(event.status));
  const upcoming = list.filter(event => event.status === "Scheduled");
  const results = list.filter(event => event.status === "Completed");

  useEffect(() => {
    if (!location.hash.startsWith("#event-") || events.isPending) return;
    document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: "start" });
  }, [location.hash, events.isPending, events.data]);

  async function accept(invitationId: string, team?: number) {
    setPending(true); setError("");
    try {
      const room = await practiceApi.accept(org, invitationId, team);
      await cache.invalidateQueries({ queryKey: ["practice", org] });
      navigate(`/student/practice/${room.id}?seasonId=${encodeURIComponent(room.seasonId)}`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not join the room."); }
    finally { setPending(false); }
  }

  const roomLink = (event: PracticeEvent) => `/student/practice/${event.roomId}?seasonId=${encodeURIComponent(event.seasonId)}`;
  const recapLink = (event: PracticeEvent) => `/student/practice/rooms/${event.roomId}/recap?seasonId=${encodeURIComponent(event.seasonId)}`;
  const card = (event: PracticeEvent) => <Panel key={event.id} id={`event-${event.id}`} className="practice-event-card" aria-label={event.name}>
    <div className="practice-hub-list-title"><strong>{event.name}</strong><Badge tone={event.status === "Playing" ? "success" : event.status === "Open" || event.status === "Scheduled" ? "info" : "neutral"}>{event.status === "Open" ? "Open now" : event.status}</Badge></div>
    <p>{event.activity === "Simulation" ? "Full-event team rehearsal" : "Head-to-head practice"} · {event.seasonName}</p>
    <p>{event.status === "Scheduled" && event.startsAtUtc ? `Starts ${new Date(event.startsAtUtc).toLocaleString()}` : event.status === "Open" ? "Your room is open — join your team." : event.status === "Playing" ? "Your match is in progress." : "Completed"}</p>
    <p>{event.teamCount === 1 ? <>Your team: {event.roster.filter(entry => entry.team === 1).map(entry => entry.userId === me!.userId ? "You" : entry.displayName).join(", ")}</> : <>You are on <strong>Team {event.myTeam}</strong> · Team 1: {event.roster.filter(entry => entry.team === 1).map(entry => entry.displayName).join(", ")} · Team 2: {event.roster.filter(entry => entry.team === 2).map(entry => entry.displayName).join(", ")}</>}</p>
    {event.captainStartUserId === me!.userId && event.status === "Open" && <p>You are the designated captain — you can start this event once your team is ready.</p>}
    {(event.status === "Open" || event.status === "Playing") && event.roomId && <LinkButton to={roomLink(event)}>{event.status === "Playing" ? "Return to match" : "Join your team"}</LinkButton>}
    {event.status === "Completed" && event.roomId && <LinkButton variant="secondary" to={recapLink(event)}>View results</LinkButton>}
  </Panel>;

  return <section id="events" aria-labelledby="student-events-title">
    <h2 id="student-events-title" className="practice-inbox-heading">Your team practice</h2>
    {error && <Notice tone="danger">{error}</Notice>}
    {events.isPending ? <Panel aria-busy="true"><LoadingState label="Loading your team practice…" /></Panel>
      : events.isError ? <Notice tone="danger">{events.error.message}<Button variant="secondary" onClick={() => void events.refetch()}>Retry</Button></Notice>
      : <>
        {!list.length && !data.invitations.length && <Panel><p>No team practice assigned yet. When your coach sets up a practice for you, it will show up here.</p></Panel>}
        {!!live.length && <><h3>Happening now</h3><div className="practice-inbox-list">{live.map(card)}</div></>}
        {!!upcoming.length && <><h3>Coming up</h3><div className="practice-inbox-list">{upcoming.map(card)}</div></>}
        {!!results.length && <><h3>Recent results</h3><div className="practice-inbox-list">{results.map(card)}</div></>}
      </>}
    {data.invitations.length > 0 && <Panel id="invitations" aria-labelledby="practice-invitations-title">
      <div className="practice-hub-section-heading"><h2 id="practice-invitations-title">Invitations</h2><Badge tone="info">{data.invitations.length} pending</Badge></div>
      <p>Your coach sent you a seat in a room that is already open.</p>
      <ul className="practice-hub-invitations">{data.invitations.map(invite => <li key={invite.id}>
        <div><strong>{invite.inviterName} invited you {invite.team ? `to Team ${invite.team}` : "to a room"}.</strong><p>Expires {new Date(invite.expiresAt).toLocaleString()}</p></div>
        <div className="practice-actions">{(invite.team ? [invite.team] : invite.teamCount === 1 ? [1] : [1, 2]).map(team => <Button key={team} disabled={pending} variant="secondary" onClick={() => void accept(invite.id, team)}>Join Team {team}</Button>)}</div>
      </li>)}</ul>
    </Panel>}
    {!data.invitations.length && <section id="invitations" className="practice-hub-no-invitations" aria-labelledby="practice-invitations-title"><h3 id="practice-invitations-title">Invitations</h3><p>No pending invitations.</p></section>}
  </section>;
}
