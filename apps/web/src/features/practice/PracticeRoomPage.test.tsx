import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { practiceApi, type PracticeRoom } from "../../api/practice";
import { PracticePage } from "./PracticePage";

const auth = vi.hoisted(() => ({ me: { userId: "player", organizationId: "org", kind: "Student" } }));
vi.mock("../../auth/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("../../api/practice", () => ({ practiceApi: { room: vi.fn(), bootstrap: vi.fn(), command: vi.fn() } }));
vi.mock("../../api/practiceTransport", () => ({ nativeCloudflare: true, createPracticeConnection: () => ({ state: "Disconnected", on: vi.fn(), onreconnecting: vi.fn(), onreconnected: vi.fn(), onclose: vi.fn(), start: () => new Promise(() => {}), stop: vi.fn() }) }));
const member = (userId: string, team: number, ready = false) => ({ userId, team, ready, displayName: userId, captain: true, scribe: true });
const result = (team: number, resolved = true): PracticeRoom["results"][number] => ({ questionId: "q", team, resolved, appealed: false, prompt: "Who answered?", reference: "Daniel 1:8", evidence: "Source evidence", acceptedAnswers: [["Daniel"]], answers: ["Daniel"], accuracyHundredths: 100, speedHundredths: 10, elapsedMs: 8000 });
function room(overrides: Partial<PracticeRoom> = {}): PracticeRoom {
  return { id: "room", seasonId: "season", teamSize: 1, questionCount: 10, coached: false, ownerId: "player", revision: 4, status: "Lobby", phase: "Lobby", questionIndex: 0, serverNow: new Date().toISOString(), members: [member("player", 1)], draft: [], submitted: false, messages: [], scores: [{ team: 1, accuracyHundredths: 0, speedHundredths: 0, totalHundredths: 0 }, { team: 2, accuracyHundredths: 0, speedHundredths: 0, totalHundredths: 0 }], results: [], achievements: [], isCoach: false, ...overrides };
}
function mount(snapshot: PracticeRoom) {
  vi.mocked(practiceApi.room).mockResolvedValue(snapshot);
  vi.mocked(practiceApi.command).mockResolvedValue(snapshot);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/student/practice/room"]}><Routes><Route path="/student/practice/:roomId" element={<PracticePage />} /></Routes></MemoryRouter></QueryClientProvider>);
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
    mount(room({ status: "Playing", phase: "Paused" }));
    const back = await screen.findByRole("button", { name: /All rooms/ });
    back.focus(); fireEvent.click(back);
    expect(screen.getByRole("dialog", { name: "Return to your rooms?" })).toBeInTheDocument();
    expect(screen.getByText(/The match continues while you are away/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep playing" }));
    expect(back).toHaveFocus();
    expect(practiceApi.command).not.toHaveBeenCalled();
  });
  it("shows owner resume during recovery and cannot skip the rehearsal break", async () => {
    const client = mount(room({ status: "Playing", phase: "Paused" }));
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
