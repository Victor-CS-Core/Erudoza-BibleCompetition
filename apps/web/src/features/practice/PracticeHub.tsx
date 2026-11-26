import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { practiceApi } from "../../api/practice";
import { trainingApi } from "../../api/training";
import type { TrainingToday } from "../../api/trainingTypes";
import { PracticeHero, PracticeMilestones, PracticeMissionCard, PracticeMomentum, PracticePulse, PracticeRoomCard, PracticeStreakCard, SimulationPatchCard, TeamPracticePatchCard, honorPatchState, invitationDestinationText, shelfOrder, shelfSummary, simulationPatchState, type HubCta } from "./PracticeHubSections";
import { nativeCloudflare } from "../../api/practiceTransport";
import { useAuth } from "../../auth/AuthContext";
import { Badge, Button, HelpTip, LinkButton, LoadingState, Notice, PageHeader, Panel, Select } from "../../components/ui";
import { ThemedImage } from "../../components/brand/ThemedImage";
import { CoachEvents } from "./CoachEvents";
import { StudentPracticeInbox } from "./StudentPracticeInbox";
import { useMyProfile } from "../profile/profile";
import { QuestionEditor } from "./QuestionEditor";
import { roomSizeLabel } from "./practiceUtils";
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
  // Practice HQ Phase 1: the hub composes the existing training summary
  // (XP/level, mission, quests, streak, weekly goal, nextAction) beside the
  // practice bootstrap. Same query key as the profile page so the two share
  // one cached read; a failed summary only hides the loop sections.
  const todayQuery = useQuery({ queryKey: ["training-today", undefined, org, me?.userId], queryFn: () => trainingApi.today(undefined), staleTime: 60_000, retry: false });
  const today: TrainingToday | null = todayQuery.data ?? null;
  const [error, setError] = useState("");
  const [pending, setPending] = useState<"join" | "enable" | null>(null);
  const [seasonId, setSeason] = useState(() => new URLSearchParams(location.search).get("seasonId") ?? "");
  const data = bootstrap.data;
  const selectedSeasonId = data?.seasons.some(season => season.id === seasonId) ? seasonId : data?.seasons[0]?.id || "";
  const roomLink = (id: string, roomSeason?: string) => `${base}/${id}${!coach && (roomSeason || selectedSeasonId) ? `?seasonId=${encodeURIComponent(roomSeason || selectedSeasonId)}` : ""}`;
  const currentRoom = data?.rooms.find(room => room.status === "Playing") || data?.rooms.find(room => room.status === "Lobby");
  const invitation = data?.invitations[0];
  const seasonName = (id: string) => data?.seasons.find(season => season.id === id)?.name || "Past season";
  // The summary's nextAction routed through the existing Study flow (the
  // same link shape Training HQ builds, minus its mission bookkeeping).
  const studyHref = (action: NonNullable<TrainingToday["nextAction"]>) => {
    const search = new URLSearchParams({ mode: action.mode });
    if (today?.format) search.set("format", today.format);
    if (action.sessionId) search.set("sessionId", action.sessionId);
    return `/student/study?${search}`;
  };
  const continueHref = today?.nextAction ? studyHref(today.nextAction) : "/student/study";
  // Decided CTA (GitHub #48): a Student with an assigned room or invitation
  // opens it; otherwise they continue assigned study. A Coach creates a team
  // event. No learner-created rooms exist in this scope.
  const studentCta: HubCta = currentRoom
    ? { label: "Open assigned room", to: roomLink(currentRoom.id, currentRoom.seasonId) }
    : invitation
      ? { label: "Open assigned room", to: `${base}#invitations` }
      : { label: "Continue assigned study", to: continueHref };
  const coachCta: HubCta = { label: "Create team event", to: `${base}#create-event` };
  const heroSeason = today?.seasonName || seasonName(selectedSeasonId);
  const loopSections = today && <>
    <PracticeMissionCard today={today} continueHref={continueHref} />
    {!currentRoom && !invitation && <PracticeStreakCard today={today} continueHref={continueHref} />}
  </>;

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
        <PracticeHero seasonLabel={heroSeason} heading="Build a steady team." today={today} cta={coachCta} />
        {loopSections}
        <PracticePulse trends={data.trends} today={today} achievements={data.simulationAchievements} seasonId={today?.seasonId ?? selectedSeasonId} />
        <CoachEvents org={org} seasons={data.seasons} />
        {currentRoom ? <PracticeRoomCard room={currentRoom} meUserId={me!.userId} seasonLabel={seasonName(currentRoom.seasonId)} roomHref={roomLink(currentRoom.id, currentRoom.seasonId)} />
        : invitation && <Panel className="practice-current-strip" aria-label="Practice invitation"><div><Badge tone="info">Invitation</Badge><h2>You’re invited to practice.</h2><p>{invitation.inviterName} invited you to practice.</p>{invitationDestinationText(data.rooms.find(room => room.id === invitation.roomId), seasonName) && <p>{invitationDestinationText(data.rooms.find(room => room.id === invitation.roomId), seasonName)}</p>}<p>Expires {new Date(invitation.expiresAt).toLocaleString()}</p></div><LinkButton to={`${base}#invitations`}>View invitation</LinkButton></Panel>}
        {data.invitations.length > 0 && <Panel id="invitations" aria-labelledby="practice-invitations-title">
          <div className="practice-hub-section-heading"><h2 id="practice-invitations-title">Invitations</h2><Badge tone="info">{data.invitations.length} pending</Badge></div>
          <ul className="practice-hub-invitations">{data.invitations.map(invite => <li key={invite.id}>
            <div><strong>{invite.inviterName} invited you {invite.team ? `to Team ${invite.team}` : "to a room"}.</strong>{invitationDestinationText(data.rooms.find(room => room.id === invite.roomId), seasonName) && <p>{invitationDestinationText(data.rooms.find(room => room.id === invite.roomId), seasonName)}</p>}<p>Expires {new Date(invite.expiresAt).toLocaleString()}</p></div>
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
              <div><div className="practice-hub-list-title"><strong>{seasonName(room.seasonId)}</strong><Badge tone={room.status === "Playing" ? "success" : room.status === "Lobby" ? "info" : "neutral"}>{room.status}</Badge></div><p>{roomSizeLabel(room)} · {room.questionCount} {room.questionCount === 1 ? "question" : "questions"} · {room.coached ? "Coach-led" : "Independent"} · {room.memberCount} {room.memberCount === 1 ? "player" : "players"}</p></div>
              <LinkButton size="compact" variant="secondary" to={roomLink(room.id, room.seasonId)}>{room.status === "Completed" ? "View results" : "Open room"}</LinkButton>
            </li>)}</ul>
            {!data.invitations.length && <section id="invitations" className="practice-hub-no-invitations" aria-labelledby="practice-invitations-title"><h3 id="practice-invitations-title">Invitations</h3><p>No pending invitations.</p></section>}
          </Panel>
        </div>
      </> : <>
        <PracticeHero seasonLabel={heroSeason} heading="Keep your assigned practice moving." today={today} cta={studentCta} />
        {loopSections}
        {currentRoom && <PracticeRoomCard room={currentRoom} meUserId={me!.userId} seasonLabel={seasonName(currentRoom.seasonId)} roomHref={roomLink(currentRoom.id, currentRoom.seasonId)} />}
        <PracticePulse trends={data.trends} today={today} achievements={data.simulationAchievements} seasonId={today?.seasonId ?? selectedSeasonId} />
        <StudentPracticeInbox org={org} data={data} />
      </>}

      <PracticeMomentum trends={data.trends} seasonName={seasonName} />
      {!!data.simulationAchievements?.length&&<Panel id="simulation-achievements"><h2>Simulation patches<HelpTip label="About Simulation patches">Earned together through completed simulations. Choose an unlocked patch for your profile.</HelpTip></h2><p className="practice-shelf-summary">Profile patches · earned together through completed simulations · {shelfSummary(data.simulationAchievements.filter(h=>h.seasonId===selectedSeasonId).map(simulationPatchState))}</p>{data.seasons.length > 1 && <label className="practice-active-season">Season<Select value={selectedSeasonId} disabled={!!pending} onChange={event=>setSeason(event.target.value)}>{data.seasons.map(season=><option key={season.id} value={season.id}>{season.name}</option>)}</Select></label>}<div className="honor-patch-grid" aria-label="Simulation patches">{shelfOrder(data.simulationAchievements.filter(h=>h.seasonId===selectedSeasonId), simulationPatchState).map(h=><SimulationPatchCard key={h.key+h.seasonId} achievement={h} worn={profile.data?.avatarHonorKey === h.key} />)}</div></Panel>}
      <Panel id="achievements" aria-labelledby="practice-honors-title">
        <h2 id="practice-honors-title">Team Achievement patches<HelpTip label="About Team Achievement patches">Arcade mastery Achievement patches use finalized personal accuracy across distinct questions and passages. PBE team milestones record participation and finalized team scores separately.</HelpTip></h2>
        {profile.isPending ? <LoadingState label="Loading Team Achievement patches…" /> : profile.isError ? <Notice tone="danger">Team Achievement patches could not load. <Button variant="secondary" onClick={() => void profile.refetch()}>Retry Team Achievement patches</Button></Notice> : <><p className="practice-shelf-summary">Profile patches · from your finalized Team Practice mastery · {shelfSummary(teamHonors.map(honorPatchState))}</p><div className="honor-patch-grid" aria-label="Team Achievement patches">{shelfOrder(teamHonors, honorPatchState).map(honor => <TeamPracticePatchCard key={honor.key} honor={honor} worn={profile.data?.avatarHonorKey === honor.key} />)}</div></>}
        <PracticeMilestones achievements={data.achievements} seasonName={seasonName} />
      </Panel>
    </>}
    {data && coach && <div id="question-bank"><QuestionEditor org={org} data={data} /></div>}
    <p className="practice-hub-footnote">Team Practice uses your season’s assigned material. Arcade adds up to 25% as a speed bonus; PBE uses rubric points.</p>
  </div>;
}
