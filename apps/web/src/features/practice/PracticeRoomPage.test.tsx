import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { practiceApi, pbeDisputeApi, type PracticeRoom } from "../../api/practice";
import { PracticePage } from "./PracticePage";

const auth = vi.hoisted(() => ({ me: { userId: "player", organizationId: "org", kind: "Student" } }));
vi.mock("../../auth/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("../../api/practice", () => ({ pbeDisputeApi:{flag:vi.fn()},practiceApi: { room: vi.fn(), bootstrap: vi.fn(), command: vi.fn() } }));
vi.mock("../../api/practiceTransport", () => ({ nativeCloudflare: true, createPracticeConnection: () => ({ state: "Disconnected", on: vi.fn(), onreconnecting: vi.fn(), onreconnected: vi.fn(), onclose: vi.fn(), start: () => new Promise(() => {}), stop: vi.fn() }) }));
const member = (userId: string, team: number, ready = false) => ({ userId, team, ready, displayName: userId, captain: true, scribe: true });
const result = (team: number, resolved = true): PracticeRoom["results"][number] => ({ questionId: "q", team, resolved, appealed: false, prompt: "Who answered?", reference: "Daniel 1:8", evidence: "Source evidence", acceptedAnswers: [["Daniel"]], answers: ["Daniel"], accuracyHundredths: 100, speedHundredths: 10, elapsedMs: 8000 });
function room(overrides: Partial<PracticeRoom> = {}): PracticeRoom {
  return { id: "room", seasonId: "season", teamSize: 1, questionCount: 10, coached: false, ownerId: "player", revision: 4, status: "Lobby", phase: "Lobby", questionIndex: 0, serverNow: new Date().toISOString(), members: [member("player", 1)], draft: [], submitted: false, messages: [], scores: [{ team: 1, accuracyHundredths: 0, speedHundredths: 0, totalHundredths: 0 }, { team: 2, accuracyHundredths: 0, speedHundredths: 0, totalHundredths: 0 }], results: [], achievements: [], isCoach: false, ...overrides };
}
function mount(snapshot: PracticeRoom, path = snapshot.isCoach ? "/admin/practice/room" : "/student/practice/room") {
  vi.mocked(practiceApi.room).mockResolvedValue(snapshot);
  vi.mocked(practiceApi.command).mockResolvedValue(snapshot);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><Routes><Route path="/student/practice/:roomId" element={<PracticePage />} /><Route path="/admin/practice/:roomId" element={<PracticePage />} /></Routes></MemoryRouter></QueryClientProvider>);
  return client;
}
beforeEach(() => {
  vi.clearAllMocks(); auth.me = { userId: "player", organizationId: "org", kind: "Student" };
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  vi.mocked(practiceApi.bootstrap).mockResolvedValue({ enabled: true, seasons: [{ id: "season", name: "Daniel season" }], players: [{ id: "other", displayName: "Other player" }], rooms: [], invitations: [], achievements: [], questions: [] });
});
afterEach(cleanup);

describe("Team Practice room presentation", () => {
  it("puts readiness before the rosters and prevents starting a missing or unready team", async () => {
    const client = mount(room());
    const start = await screen.findByRole("button", { name: "Start match" });
    expect(start).toBeDisabled();
    expect(start.compareDocumentPosition(screen.getByRole("heading", { name: "Team 1" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    client.setQueryData(["practice-room", "org", "room"], room({ members: [member("player", 1, true), member("other", 2, true)] }));
    await waitFor(() => expect(start).toBeEnabled());
  });
  it("offers only available team destinations and confirms the actual invitation command", async () => {
    mount(room());
    await screen.findByRole("button", { name: "Send invitation" });
    expect(screen.queryByRole("option", { name: /^Team 1/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Invite player"), { target: { value: "other" } });
    fireEvent.change(screen.getByLabelText("Destination"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));
    await waitFor(() => expect(practiceApi.command).toHaveBeenCalledWith("org", "room", expect.objectContaining({ action: "invite", revision: 4, targetUserId: "other", team: 2 })));
    expect(await screen.findByText(/Invitation sent to Other player/)).toBeInTheDocument();
  });
  it("disables invitations when both teams are full", async () => {
    mount(room({ members: [member("player", 1), member("other", 2)] }));
    expect(await screen.findByRole("button", { name: "Send invitation" })).toBeDisabled();
    expect(screen.getByText(/Both teams are full/)).toBeInTheDocument();
  });
  it("limits a teammate's direct invite destination to their own team", async () => {
    mount(room({ ownerId: "owner", teamSize: 2 }));
    await screen.findByRole("button", { name: "Send invitation" });
    expect(screen.getByRole("option", { name: /^Team 1/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /^Team 2/ })).not.toBeInTheDocument();
  });
  it("shows Coach-led presentation without a fabricated timer and offers read-only moderation", async () => {
    auth.me = { ...auth.me, userId: "coach", kind: "Coach" };
    mount(room({ coached: true, ownerId: "coach", isCoach: true, status: "Playing", phase: "Presentation", question: { id: "q", prompt: "Who answered?", reference: "Daniel 1:8", kind: "ShortAnswer", partCount: 1, points: 1, durationSeconds: 30 } }));
    expect(await screen.findByRole("button", { name: "Start response window" })).toBeEnabled();
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
    expect(screen.getByText("Awaiting coach")).toBeInTheDocument();
    expect(screen.getByText("Read-only moderation")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Share with team" })).not.toBeInTheDocument();
  });
  it("cannot advance an active response and requires both Coach judgments in review", async () => {
    auth.me = { ...auth.me, userId: "coach", kind: "Coach" };
    const snapshot = room({ coached: true, ownerId: "coach", isCoach: true, status: "Playing", phase: "Response", phaseEndsAt: new Date(Date.now() + 30000).toISOString(), question: { id: "q", prompt: "Who answered?", reference: "Daniel 1:8", kind: "ShortAnswer", partCount: 1, points: 1, durationSeconds: 30 } });
    const client = mount(snapshot);
    expect(await screen.findByRole("button", { name: "Waiting for response window" })).toBeDisabled();
    client.setQueryData(["practice-room", "org", "room"], { ...snapshot, phase: "Review", phaseEndsAt: undefined, results: [result(1), result(2, false)] });
    expect(await screen.findByRole("button", { name: "Next question" })).toBeDisabled();
    client.setQueryData(["practice-room", "org", "room"], { ...snapshot, phase: "Review", phaseEndsAt: undefined, results: [result(1), result(2)] });
    await waitFor(() => expect(screen.getByRole("button", { name: "Next question" })).toBeEnabled());
  });
  it("preserves multipart final submissions with question identity and no client timing", async () => {
    mount(room({ status: "Playing", phase: "Response", phaseEndsAt: new Date(Date.now() + 30000).toISOString(), question: { id: "q", prompt: "Name both people.", reference: "Daniel 1:8", kind: "ShortAnswer", partCount: 2, points: 2, durationSeconds: 30 } }));
    fireEvent.change(await screen.findByLabelText("Answer 1"), { target: { value: "Daniel" } });
    fireEvent.change(screen.getByLabelText("Answer 2"), { target: { value: "Hananiah" } });
    fireEvent.click(screen.getByRole("button", { name: "Lock final answer" }));
    await waitFor(() => expect(practiceApi.command).toHaveBeenCalledWith("org", "room", expect.objectContaining({ action: "submit", questionId: "q", answers: ["Daniel", "Hananiah"] })));
    expect(vi.mocked(practiceApi.command).mock.calls[0][2]).not.toHaveProperty("responseTimeMs");
  });
  it("keeps an active match open until the return confirmation and restores focus on cancel", async () => {
    mount(room({ status: "Playing", phase: "Paused" }), "/admin/practice/room");
    const back = await screen.findByRole("button", { name: /All rooms/ });
    back.focus(); fireEvent.click(back);
    expect(screen.getByRole("dialog", { name: "Return to your rooms?" })).toBeInTheDocument();
    expect(screen.getByText(/The match continues while you are away/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep playing" }));
    expect(back).toHaveFocus();
    expect(practiceApi.command).not.toHaveBeenCalled();
  });
  it("shows owner resume during recovery and cannot skip the rehearsal break", async () => {
    const client = mount(room({ status: "Playing", phase: "Paused" }), "/admin/practice/room");
    expect(await screen.findByRole("button", { name: "Resume match" })).toBeEnabled();
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
    client.setQueryData(["practice-room", "org", "room"], room({ status: "Playing", phase: "Break", coached: true, isCoach: true, phaseEndsAt: new Date(Date.now() + 300000).toISOString() }));
    expect(await screen.findByRole("button", { name: "Resume after break" })).toBeDisabled();
  });
  it("labels unresolved completed results provisional and abandoned rooms incomplete", async () => {
    const client = mount(room({ status: "Completed", results: [result(1, false), result(2)] }));
    expect(await screen.findByText("Provisional result")).toBeInTheDocument();
    client.setQueryData(["practice-room", "org", "room"], room({ status: "Abandoned" }));
    expect(await screen.findByRole("heading", { name: "This match ended early." })).toBeInTheDocument();
    expect(screen.queryByText("Finalized result")).not.toBeInTheDocument();
  });
  it("retains separate appeal reasons when current review moves into previous answers", async () => {
    const firstAnswer = result(1);
    const firstQuestion = { id: "q", prompt: "Who answered?", reference: "Daniel 1:8", kind: "ShortAnswer", partCount: 1, points: 1, durationSeconds: 30 };
    const snapshot = room({ status: "Playing", phase: "Review", question: firstQuestion, results: [firstAnswer] });
    const client = mount(snapshot);
    const firstReason = "Please check the first answer against our source.";
    const secondReason = "The second answer uses another accepted spelling.";
    fireEvent.change(await screen.findByLabelText("Reason for review"), { target: { value: firstReason } });
    const nextQuestion = { ...firstQuestion, id: "q2", prompt: "Second question." };
    client.setQueryData(["practice-room", "org", "room"], { ...snapshot, phase: "Presentation", questionIndex: 1, question: nextQuestion });
    await screen.findByRole("heading", { name: "Second question." });
    expect(screen.queryByRole("button", { name: "Request coach review" })).not.toBeInTheDocument();
    const reviewedNext = { ...snapshot, questionIndex: 1, question: nextQuestion, results: [firstAnswer, { ...firstAnswer, questionId: "q2", prompt: "Second question." }] };
    client.setQueryData(["practice-room", "org", "room"], reviewedNext);
    expect(await screen.findByDisplayValue(firstReason)).toBeInTheDocument();
    const secondInput = screen.getAllByLabelText("Reason for review").find(input => (input as HTMLTextAreaElement).value === "")!;
    fireEvent.change(secondInput, { target: { value: secondReason } });
    client.setQueryData(["practice-room", "org", "room"], { ...reviewedNext, status: "Completed" });
    await screen.findByText("Finalized result");
    expect(screen.getByDisplayValue(firstReason)).toBeInTheDocument();
    expect(screen.getByDisplayValue(secondReason)).toBeInTheDocument();
    fireEvent.submit(screen.getByDisplayValue(firstReason).closest("form")!);
    await waitFor(() => expect(practiceApi.command).toHaveBeenCalledWith("org", "room", expect.objectContaining({ action: "appeal", questionId: "q", team: 1, text: firstReason })));
  });
  it.each(["Completed", "Abandoned"])("keeps the %s roster available in a collapsed disclosure", async status => {
    mount(room({ status, members: [member("player", 1), member("other", 2)], results: [result(1), result(2)] }));
    const roster = (await screen.findByText("Team rosters · 2 players")).closest("details")!;
    expect(roster).not.toHaveAttribute("open");
    expect(within(roster).getByText("player · You")).toBeInTheDocument();
    expect(within(roster).getByText("other")).toBeInTheDocument();
  });
});

it("keeps coach-only rooms out of Student mode controls", async () => {
 auth.me = { ...auth.me, userId: "coach", kind: "Adult" };
 mount(room({ coached: true, ownerId: "coach", isCoach: true }), "/student/practice/room");
 expect(await screen.findByRole("link", { name: "Open room in Coach mode" })).toHaveAttribute("href", "/admin/practice/room?seasonId=season");
 expect(screen.queryByRole("button", { name: "Start match" })).not.toBeInTheDocument();
});
it("excludes the assigned non-playing coach from player invitations", async () => {
  vi.mocked(practiceApi.bootstrap).mockResolvedValue({ enabled: true, seasons: [], players: [{ id: "guide", displayName: "Assigned coach" }, { id: "other", displayName: "Other player" }], rooms: [], invitations: [], achievements: [], questions: [] });
  mount(room({ coached: true, coachId: "guide" }));
  await screen.findByRole("option", { name: "Other player" });
  expect(screen.queryByRole("option", { name: "Assigned coach" })).not.toBeInTheDocument();
});
it('starts a full six-student PBE team without an opponent',async()=>{
 mount(room({format:'Pbe',ownerId:'offline-coach',teamCount:1,teamSize:6,members:Array.from({length:6},(_,i)=>({...member(i?'pbe-'+i:'player',1,true),captain:i===0,scribe:i===0})),scores:[{team:1,accuracyHundredths:0,speedHundredths:0,totalHundredths:0,availableHundredths:0}]}));
 expect(await screen.findByRole('button',{name:'Start match'})).toBeEnabled();
 expect(screen.queryByRole('heading',{name:'Team 2'})).not.toBeInTheDocument();
});
it('retains mixed-team interrupted evidence with earned/available points and independent restart',async()=>{
 mount(room({format:'Pbe',teamCount:2,teamSize:6,status:'Interrupted',phase:'Interrupted',results:[{...result(1),speedHundredths:0,availableHundredths:200}],scores:[{team:1,accuracyHundredths:100,speedHundredths:0,totalHundredths:100,availableHundredths:200},{team:2,accuracyHundredths:0,speedHundredths:0,totalHundredths:0,availableHundredths:0}]}));
 expect(await screen.findByRole('heading',{name:'Rehearsal interrupted'})).toBeInTheDocument();
 expect(screen.getByRole('link',{name:'Start a new rehearsal'})).toHaveAttribute('href','/student/practice#create-room');
 expect(screen.getByText(/one or more teams did not have a trusted response/i)).toBeInTheDocument();
 expect(screen.queryByText(/wins on points|Speed bonus/)).not.toBeInTheDocument();
 expect(screen.getByText('Submitted:').parentElement).toHaveTextContent('Daniel');
});
it('requires two text readings from the current PBE scribe and does not send a late acknowledgement',async()=>{
 const snapshot=room({format:'Pbe',teamCount:1,teamSize:6,status:'Playing',phase:'Presentation',question:{id:'q',prompt:'Who answered?',reference:'Daniel 1:8',kind:'ShortAnswer',partCount:1,points:2,durationSeconds:30}});
 const client=mount(snapshot);fireEvent.click(await screen.findByRole('button',{name:'I’m ready to hear the question'}));
 fireEvent.click(await screen.findByRole('button',{name:'Finished first reading'}));expect(practiceApi.command).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Finished second reading'}));await waitFor(()=>expect(practiceApi.command).toHaveBeenCalledWith('org','room',expect.objectContaining({action:'present',delivery:'TextFallback',questionId:'q'})));
 client.setQueryData(['practice-room','org','room'],{...snapshot,phase:'Scheduled',scheduleId:'already-armed'});await waitFor(()=>expect(screen.getByText(/Response starts in three seconds/)).toBeInTheDocument());expect(vi.mocked(practiceApi.command).mock.calls.some(c=>c[2].action==='ack')).toBe(false);
});

it('lets an independent student captain resume an unarmed replacement without the adult owner',async()=>{
 mount(room({format:'Pbe',ownerId:'offline-coach',teamCount:1,status:'Playing',phase:'Paused',question:null,members:[{...member('player',1),captain:true,scribe:true}]}));
 fireEvent.click(await screen.findByRole('button',{name:'Resume match'}));await waitFor(()=>expect(practiceApi.command).toHaveBeenCalledWith('org','room',expect.objectContaining({action:'next'})));
});

it('keeps revoked-material owner cleanup reachable without play controls',async()=>{
 mount(room({format:'Pbe',materialUnavailable:true,members:[member('player',1),member('other',1)],question:null}));
 expect(await screen.findByText(/Room material is unavailable/)).toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Start match'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Remove other'}));
 await waitFor(()=>expect(practiceApi.command).toHaveBeenCalledWith('org','room',expect.objectContaining({action:'remove',targetUserId:'other'})));
 expect(screen.getByRole('button',{name:'Abandon room'})).toBeInTheDocument();
});
it('lets a saved lobby member leave a room with unavailable material',async()=>{
 mount(room({format:'Pbe',materialUnavailable:true,ownerId:'other',question:null}));
 fireEvent.click(await screen.findByRole('button',{name:'Leave room'}));
 await waitFor(()=>expect(practiceApi.command).toHaveBeenCalledWith('org','room',expect.objectContaining({action:'leave'})));
 expect(screen.queryByRole('button',{name:'Abandon room'})).not.toBeInTheDocument();
});
it('requires two coach confirmations and exposes no adult answer controls',async()=>{
 auth.me={...auth.me,kind:'Adult'};
 mount(room({format:'Pbe',coached:true,coachId:'player',isCoach:true,members:[member('student',1)],status:'Playing',phase:'Presentation',question:{id:'q',prompt:'Who answered?',reference:'Daniel 1:8',kind:'ShortAnswer',partCount:1,points:2,durationSeconds:30}}));
 fireEvent.click(await screen.findByRole('button',{name:'Confirm first coach reading'}));
 expect(practiceApi.command).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Confirm second coach reading'}));
 await waitFor(()=>expect(practiceApi.command).toHaveBeenCalledWith('org','room',expect.objectContaining({action:'present',delivery:'Coach',questionId:'q'})));
 expect(screen.queryByRole('button',{name:'Lock final answer'})).not.toBeInTheDocument();
});
it('lets the current coached student scribe confirm readiness without claiming Coach delivery',async()=>{
 mount(room({format:'Pbe',coached:true,coachId:'coach',status:'Playing',phase:'Presentation',question:{id:'q',prompt:'Who answered?',reference:'Daniel 1:8',kind:'ShortAnswer',partCount:1,points:2,durationSeconds:30}}));
 fireEvent.click(await screen.findByRole('button',{name:'Ready for coach presentation'}));
 await waitFor(()=>expect(practiceApi.command).toHaveBeenCalledWith('org','room',expect.objectContaining({action:'present-ready',questionId:'q'})));
 expect(vi.mocked(practiceApi.command).mock.calls[0][2].delivery).toBeUndefined();
});

it('lets the saved owner terminate unavailable active material through confirmation',async()=>{
 mount(room({format:'Pbe',materialUnavailable:true,status:'Playing',phase:'Response',question:null}));
 expect(await screen.findByText(/Room material is unavailable/)).toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Lock final answer'})).not.toBeInTheDocument();
 expect(screen.queryByRole('textbox',{name:'Suggestion'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Abandon room'}));
 fireEvent.click(within(screen.getByRole('dialog',{name:'Abandon this room?'})).getByRole('button',{name:'Abandon room'}));
 await waitFor(()=>expect(practiceApi.command).toHaveBeenCalledWith('org','room',expect.objectContaining({action:'abandon'})));
});

it("flags a saved interrupted PBE answer without sending a legacy appeal or stopping independent replay",async()=>{
 const accepted={...result(1),attemptId:'accepted-attempt'};mount(room({format:'Pbe',teamCount:1,status:'Interrupted',phase:'Interrupted',results:[accepted]}));
 vi.mocked(pbeDisputeApi.flag).mockResolvedValue({id:'dispute',status:'Pending',revision:1} as Awaited<ReturnType<typeof pbeDisputeApi.flag>>);
 fireEvent.click(await screen.findByRole('button',{name:'Flag answer'}));fireEvent.change(screen.getByLabelText('Reason for review'),{target:{value:'Please check the saved rubric'}});fireEvent.click(screen.getByRole('button',{name:'Request coach review'}));
 expect(await screen.findByText('Review pending')).toBeInTheDocument();expect(pbeDisputeApi.flag).toHaveBeenCalledWith({activity:'Team',sessionId:'room',attemptId:'accepted-attempt',reason:'Please check the saved rubric'});expect(practiceApi.command).not.toHaveBeenCalled();expect(screen.getByRole('link',{name:'Back to Team Practice'})).toBeInTheDocument();
});
