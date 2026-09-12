import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../../api/client";
import { scriptureApi } from "../../api/scripture";
import type { Progress } from "../../api/types";
import { StudyPage } from "./StudyPage";

vi.mock("../../api/client", async importOriginal => ({
  ...await importOriginal<typeof import("../../api/client")>(),
  api: {
    progress: vi.fn(),
    startSession: vi.fn(),
    nextCard: vi.fn(),
    submitAttempt: vi.fn(),
    completeSession: vi.fn(),
    resumeSession: vi.fn(),
  },
}));

beforeEach(() => {
  vi.mocked(api.resumeSession).mockImplementation(async (id) => ({session:{id,seasonId:"season-1",status:"Created",mode:"Practice",targetCardCount:8},card:null,attempt:null,summary:null}));
});

afterEach(() => sessionStorage.clear());

function progress(overrides: Partial<Progress> = {}): Progress {
  return {
    seasonId: "season-1",
    seasonName: "Daniel 2026",
    seasonStatus: "Draft",
    assignments: [],
    masteredCount: 0,
    reviewDueCount: 0,
    attemptCount: 0,
    mastery: [],
    ...overrides,
  };
}

function renderStudy(path: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const router = createMemoryRouter([{ path: "/student/study", element: <StudyPage /> }, { path: "/student/sessions/:sessionId/recap", element: <p>Saved session summary</p> }], {
    initialEntries: [path],
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

describe("StudyPage Field Guide Academy honesty", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.startSession).mockResolvedValue({
      id: "session-1",
      seasonId: "season-1",
      status: "Created",
      mode: "Practice",
      targetCardCount: 8,
    });
    vi.mocked(api.nextCard).mockResolvedValue({
      id: "card-1",
      sessionId: "session-1",
      activityType: "MissingWords",
      prompt: "____",
      citation: "Daniel 1:1",
      tokens: [],
      sequence: 1,
      total: 8,
    });
  });

  it("offers enabled Memory purposes without promoting coach difficulty", async()=>{
    vi.mocked(api.progress).mockResolvedValue(progress({seasonStatus:"Active",pbeEnabled:true,assignments:[{difficulty:"Standard"} as Progress['assignments'][number]]}));
    renderStudy("/student/study?format=Memory");
    const warmup=await screen.findByRole("button",{name:"Start Memory warmup"});
    expect(api.startSession).not.toHaveBeenCalled();
    expect(screen.queryByRole("button",{name:"Start Advanced mastery challenge"})).not.toBeInTheDocument();
    fireEvent.click(warmup);
    await waitFor(()=>expect(api.startSession).toHaveBeenCalledWith("season-1","Practice",expect.any(Object),"Memory","Warmup"));
  });
  it("keeps an explicit Advanced mastery challenge available with optional unscored recitation",async()=>{
    vi.mocked(api.progress).mockResolvedValue(progress({seasonStatus:"Active",pbeEnabled:true,assignments:[{difficulty:"Advanced"} as Progress['assignments'][number]]}));
    renderStudy("/student/study?format=Memory");
    fireEvent.click(await screen.findByRole("button",{name:"Start Advanced mastery challenge"}));
    await waitFor(()=>expect(api.startSession).toHaveBeenCalledWith("season-1","Practice",expect.any(Object),"Memory","Advanced"));
    expect(await screen.findByText("Memory activities are study aids. Verse Builder practices sequence, not exact-word recall.")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Optional full-verse recitation"));
    expect(screen.getByLabelText("Your private recitation practice")).toBeInTheDocument();
  });
  it("does not start review when the progress API reports none due", async () => {
    vi.mocked(api.progress).mockResolvedValue(progress({ seasonStatus: "Active", reviewDueCount: 0 }));
    renderStudy("/student/study?mode=Review");

    expect(await screen.findByTestId("academy-track-unavailable")).toHaveTextContent(
      "No passages are due for review.",
    );
    expect(screen.getByTestId("academy-session-kicker")).toHaveTextContent("Due review");
    expect(api.startSession).not.toHaveBeenCalled();
  });

  it("keeps mission review available when another session moved its due dates", async () => {
    vi.mocked(api.progress).mockResolvedValue(progress({ seasonStatus: "Active", reviewDueCount: 0 }));
    renderStudy("/student/study?mode=Review&step=Review&missionId=mission-1&missionRevision=2&startId=start-1");
    await waitFor(() => expect(api.startSession).toHaveBeenCalledWith("season-1", "Review", expect.objectContaining({
      clientStartId: "start-1", step: "Review", missionId: "mission-1", missionRevision: 2,
    })));
  });

  it("reuses its start intent after a lost response", async () => {
    vi.mocked(api.progress).mockResolvedValue(progress({ seasonStatus: "Active" }));
    vi.mocked(api.startSession).mockRejectedValueOnce(new Error("offline"));
    const router = renderStudy("/student/study?startId=retry-intent&step=Practice");
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    await screen.findByTestId("challenge-prompt");
    await waitFor(() => expect(router.state.location.search).toContain("sessionId=session-1"));
    const calls = vi.mocked(api.startSession).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][2]).toEqual(calls[1][2]);
    expect(calls[0][2]).toMatchObject({ clientStartId: "retry-intent", step: "Practice" });
  });

  it("does not start due reviews until the season is Active", async () => {
    vi.mocked(api.progress).mockResolvedValue(progress({ seasonStatus: "Draft", reviewDueCount: 2 }));
    renderStudy("/student/study?mode=Review");

    expect(await screen.findByTestId("academy-track-unavailable")).toHaveTextContent(
      "Reviews open when this season is Active.",
    );
    expect(screen.getByTestId("study-page-title")).toBeInTheDocument();
    expect(screen.getByTestId("academy-session-kicker")).toHaveTextContent("Due review");
    expect(screen.queryByTestId("challenge-card")).not.toBeInTheDocument();
    expect(api.startSession).not.toHaveBeenCalled();
  });

  it.each(["start", "card", "answer"] as const)("recovers a stale %s through the selected HQ rather than repeating a conflict", async stage => {
    vi.mocked(api.progress).mockResolvedValue(progress({ seasonStatus: "Active" }));
    const conflict = new ApiError("Assignment changed", 409);
    if (stage === "start") vi.mocked(api.startSession).mockRejectedValueOnce(conflict);
    if (stage === "card") vi.mocked(api.nextCard).mockRejectedValueOnce(conflict);
    if (stage === "answer") vi.mocked(api.submitAttempt).mockRejectedValueOnce(conflict);
    renderStudy("/student/study?seasonId=season-1");
    if (stage === "answer") {
      fireEvent.change(await screen.findByTestId("missing-words-answer"), { target: { value: "answer" } });
      fireEvent.click(screen.getByTestId("submit-answer"));
    }
    expect(await screen.findByRole("link", { name: "Return to Training HQ" })).toHaveAttribute("href", "/student?seasonId=season-1");
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("does not start learner drill until the season is Active", async () => {
    vi.mocked(api.progress).mockResolvedValue(progress({ seasonStatus: "Draft" }));
    renderStudy("/student/study");

    expect(await screen.findByTestId("academy-track-unavailable")).toHaveTextContent(
      "Learner drill opens when this season is Active.",
    );
    expect(screen.getByTestId("study-page-title")).toBeInTheDocument();
    expect(screen.getByTestId("academy-session-kicker")).toHaveTextContent("Learner drill");
    expect(screen.queryByTestId("challenge-card")).not.toBeInTheDocument();
    expect(api.startSession).not.toHaveBeenCalled();
  });

  it("does not start rehearsal until the season is Active", async () => {
    vi.mocked(api.progress).mockResolvedValue(progress({ seasonStatus: "Draft" }));
    renderStudy("/student/study?mode=Simulation");

    expect(await screen.findByTestId("academy-track-unavailable")).toHaveTextContent(
      "Rehearsal opens when this season is Active.",
    );
    expect(screen.getByTestId("academy-session-kicker")).toHaveTextContent("Rehearsal");
    expect(api.startSession).not.toHaveBeenCalled();
  });

  it("starts learner drill from the existing session API", async () => {
    vi.mocked(api.progress).mockResolvedValue(progress({ seasonStatus: "Active", reviewDueCount: 0 }));
    renderStudy("/student/study");

    await waitFor(() => expect(api.startSession).toHaveBeenCalledWith("season-1", "Practice", expect.objectContaining({ clientStartId: expect.any(String), timeZone: expect.any(String) })));
  });

  it("starts due reviews from the existing session API", async () => {
    vi.mocked(api.progress).mockResolvedValue(progress({ seasonStatus: "Active", reviewDueCount: 2 }));
    renderStudy("/student/study?mode=Review");

    await waitFor(() => expect(api.startSession).toHaveBeenCalledWith("season-1", "Review", expect.objectContaining({ clientStartId: expect.any(String), timeZone: expect.any(String) })));
  });

  it("starts rehearsal when the season is Active", async () => {
    vi.mocked(api.progress).mockResolvedValue(progress({ seasonStatus: "Active", reviewDueCount: 0 }));
    renderStudy("/student/study?mode=Simulation");

    await waitFor(() => expect(api.startSession).toHaveBeenCalledWith("season-1", "Simulation", expect.objectContaining({ clientStartId: expect.any(String), timeZone: expect.any(String) })));
  });

  it("opens learner drill with the activity heading", async () => {
    vi.mocked(api.progress).mockResolvedValue(progress({ seasonStatus: "Active", seasonName: "Daniel 2026" }));
    renderStudy("/student/study");

    expect(await screen.findByTestId("study-page-title")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Missing Words" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("current-season")).toHaveTextContent("Daniel 2026"));
    expect(screen.getByTestId("academy-session-kicker")).toHaveTextContent("Learner drill");
    expect(screen.queryByLabelText("DUE")).not.toBeInTheDocument();
    await waitFor(() => expect(api.startSession).toHaveBeenCalledWith("season-1", "Practice", expect.objectContaining({ clientStartId: expect.any(String), timeZone: expect.any(String) })));
  });

  it("names the drawn card with the academy activity, not the raw API type", async () => {
    vi.mocked(api.progress).mockResolvedValue(progress({ seasonStatus: "Active" }));
    vi.mocked(api.nextCard).mockResolvedValue({
      id: "card-2",
      sessionId: "session-1",
      activityType: "VerseBuilder",
      prompt: "Build the verse",
      citation: "Daniel 1:2",
      tokens: [
        { display: "In", hidden: false, index: 0 },
        { display: "the", hidden: false, index: 1 },
      ],
      sequence: 1,
      total: 8,
    });
    renderStudy("/student/study");

    await waitFor(() => expect(screen.getByTestId("academy-activity-name")).toHaveTextContent("Verse Builder"));
    expect(screen.getByTestId("challenge-prompt")).toHaveTextContent("Build the verse");
    expect(screen.getByTestId("challenge-card")).toHaveTextContent("Daniel 1:2");
    expect(screen.getByTestId("academy-activity-name")).not.toHaveTextContent("VerseBuilder");
    await waitFor(() => expect(api.startSession).toHaveBeenCalledWith("season-1", "Practice", expect.objectContaining({ clientStartId: expect.any(String), timeZone: expect.any(String) })));
  });

  it("keeps season context in a focused study header", async () => {
    vi.mocked(api.progress).mockResolvedValue(
      progress({ seasonStatus: "Active", reviewDueCount: 2, seasonName: "Daniel 2026" }),
    );
    renderStudy("/student/study");

    await waitFor(() => expect(screen.getByTestId("current-season")).toHaveTextContent("Daniel 2026"));
    expect(screen.getByTestId("study-page-title")).toBeInTheDocument();
  });

  it("keeps unavailable review copy on the Field Guide cover", async () => {
    vi.mocked(api.progress).mockResolvedValue(progress({ seasonStatus: "Active", reviewDueCount: 0 }));
    renderStudy("/student/study?mode=Review");

    expect(await screen.findByTestId("academy-track-unavailable")).toHaveTextContent(
      "No passages are due for review.",
    );
    expect(screen.getByTestId("study-page-title")).toBeInTheDocument();
    expect(screen.getByTestId("academy-session-kicker")).toHaveTextContent("Due review");
    expect(screen.queryByTestId("challenge-card")).not.toBeInTheDocument();
    expect(api.startSession).not.toHaveBeenCalled();
  });

  it("starts a new rehearsal session after switching from learner on the same page", async () => {
    vi.mocked(api.progress).mockResolvedValue(progress({ seasonStatus: "Active", reviewDueCount: 0 }));
    const router = renderStudy("/student/study");

    await waitFor(() => expect(api.startSession).toHaveBeenCalledWith("season-1", "Practice", expect.objectContaining({ clientStartId: expect.any(String), timeZone: expect.any(String) })));
    vi.mocked(api.startSession).mockClear();
    vi.mocked(api.startSession).mockResolvedValueOnce({ id: "session-rehearsal", seasonId: "season-1", status: "Created", mode: "Simulation", targetCardCount: 8 });

    await act(async () => { await router.navigate("/student/study?mode=Simulation"); });

    await waitFor(() => expect(api.startSession).toHaveBeenCalledWith("season-1", "Simulation", expect.objectContaining({ clientStartId: expect.any(String), timeZone: expect.any(String) })));
    expect(screen.getByTestId("academy-session-kicker")).toHaveTextContent("Rehearsal");
  });

  it("ignores a stale learner start after switching to rehearsal", async () => {
    let releaseLearner: ((session: { id: string; seasonId: string; status: string; mode: string; targetCardCount: number }) => void) | undefined;
    vi.mocked(api.progress).mockResolvedValue(progress({ seasonStatus: "Active", reviewDueCount: 0 }));
    vi.mocked(api.startSession).mockImplementation((seasonId, mode) => {
      if (mode === "Practice") {
        return new Promise((resolve) => {
          releaseLearner = resolve;
        });
      }
      return Promise.resolve({
        id: "session-rehearsal",
        seasonId,
        status: "Created",
        mode: "Simulation",
        targetCardCount: 10,
      });
    });

    const router = renderStudy("/student/study");
    await waitFor(() => expect(api.startSession).toHaveBeenCalledWith("season-1", "Practice", expect.objectContaining({ clientStartId: expect.any(String), timeZone: expect.any(String) })));
    await act(async () => { await router.navigate("/student/study?mode=Simulation"); });
    await waitFor(() => expect(api.nextCard).toHaveBeenCalledWith("session-rehearsal"));

    releaseLearner?.({
      id: "session-stale-learner",
      seasonId: "season-1",
      status: "Created",
      mode: "Practice",
      targetCardCount: 8,
    });

    await waitFor(() => expect(screen.getByTestId("academy-session-kicker")).toHaveTextContent("Rehearsal"));
    expect(api.nextCard).not.toHaveBeenCalledWith("session-stale-learner");
  });
});

describe("StudyPage Bible Challenge density", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.startSession).mockResolvedValue({
      id: "session-1",
      seasonId: "season-1",
      status: "Created",
      mode: "Practice",
      targetCardCount: 8,
    });
    vi.mocked(api.nextCard).mockResolvedValue({
      id: "card-1",
      sessionId: "session-1",
      activityType: "MissingWords",
      prompt: "In the Sermon on the Mount, Jesus teaches.",
      citation: "Matthew 5:9",
      tokens: [],
      sequence: 1,
      total: 8,
    });
  });

  it("shows focused answer controls without mastery metrics", async () => {
    vi.mocked(api.progress).mockResolvedValue(progress({ seasonStatus: "Active", seasonName: "Daniel 2026" }));
    renderStudy("/student/study");

    const card = await screen.findByTestId("challenge-card");
    expect(card).toHaveClass("ds-panel");
    expect(screen.queryByTestId("challenge-ribbon")).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Missing Words" })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("challenge-prompt")).toHaveTextContent("In the Sermon on the Mount"),
    );
    expect(screen.getByRole("button", { name: "Check answer" })).toBeInTheDocument();
    expect(screen.getByTestId("complete-session")).toBeInTheDocument();
    expect(screen.queryByTestId("progress-top-folio")).not.toBeInTheDocument();
    expect(screen.queryByTestId("progress-mastery-pathway")).not.toBeInTheDocument();
    expect(card).not.toHaveTextContent("%");
    expect(card).not.toHaveTextContent("streak");
    expect(card).not.toHaveTextContent("6/8");
  });

  it("shows session progress without decorative distractions", async () => {
    vi.mocked(api.progress).mockResolvedValue(progress({ seasonStatus: "Active" }));
    renderStudy("/student/study");

    expect(await screen.findByRole("progressbar", { name: "Study session progress" })).toHaveAttribute("value", "1");
    expect(screen.getByTestId("academy-session-kicker")).toHaveTextContent("Learner drill");
  });
});


describe("Study submission recovery", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.clearAllMocks();
    vi.mocked(api.progress).mockResolvedValue(progress({ seasonStatus: "Active" }));
    vi.mocked(api.startSession).mockResolvedValue({ id: "session-1", seasonId: "season-1", status: "Active", mode: "Practice", targetCardCount: 2 });
    vi.mocked(api.nextCard).mockResolvedValue({ id: "card-1", sessionId: "session-1", activityType: "MissingWords", citation: "Daniel 1:1", prompt: "____", tokens: [], sequence: 1, total: 2 });
    vi.mocked(api.submitAttempt).mockResolvedValue({ attemptId: "attempt-1", isCorrect: true, evaluationResult: "Correct", canonicalAnswer: "answer", citation: "Daniel 1:1", sourceText: "answer", masteryLevel: "Learning", exactWordingScore: 18, reviewDueAtUtc: null, alreadyProcessed: false });
  });
  it("starts Builder empty, submits duplicate IDs once each, and preserves pending text on refresh", async () => {
    const card = { id:"builder",sessionId:"session-1",activityType:"VerseBuilder",citation:"Daniel 1:1",prompt:"Build the verse",tokens:[{index:4,display:"one",hidden:false},{index:9,display:"two",hidden:false},{index:12,display:"one",hidden:false}],sequence:1,total:2 };
    vi.mocked(api.nextCard).mockResolvedValue(card);
    renderStudy("/student/study?format=Memory");
    fireEvent.click((await screen.findAllByRole("button",{name:"Add one"}))[1]);
    expect(screen.getByLabelText("Your verse")).toHaveTextContent(/^one$/);
    fireEvent.click(screen.getByRole("button",{name:"Add two"}));
    fireEvent.click(screen.getAllByRole("button",{name:"Add one"})[0]);
    fireEvent.click(screen.getByRole("button",{name:"Check answer"}));
    await waitFor(()=>expect(api.submitAttempt).toHaveBeenCalledWith("session-1",expect.objectContaining({submittedAnswer:"one two one"})));
  });
  it("restores a pending Builder answer without guessing duplicate token identities", async () => {
    const payload={clientSubmissionId:"builder-retry",challengeCardId:"builder",submittedAnswer:"one two one",responseTimeMs:42,hintsUsed:false};
    sessionStorage.setItem("erudoza:attempt:session-1",JSON.stringify(payload));
    vi.mocked(api.resumeSession).mockResolvedValue({session:{id:"session-1",seasonId:"season-1",mode:"Practice",status:"Active",targetCardCount:2},card:{id:"builder",sessionId:"session-1",activityType:"VerseBuilder",citation:"Daniel 1:1",prompt:"Build",tokens:[{index:4,display:"one",hidden:false},{index:9,display:"two",hidden:false},{index:12,display:"one",hidden:false}],sequence:1,total:2},attempt:null,summary:null});
    renderStudy("/student/study?sessionId=session-1");
    expect(await screen.findByTestId("pending-answer")).toHaveTextContent("one two one");
    fireEvent.click(screen.getByRole("button",{name:"Retry saved answer"}));
    await waitFor(()=>expect(api.submitAttempt).toHaveBeenCalledWith("session-1",payload));
  });
  it("resumes the final accepted card after refresh without starting another session", async () => {
    vi.mocked(api.resumeSession).mockResolvedValue({ session: { id: "session-1", seasonId: "season-1", mode: "Practice", status: "Active", targetCardCount: 2, difficulty: "Advanced" }, card: { id: "final", sessionId: "session-1", activityType: "MissingWords", citation: "Daniel 1:1", prompt: "____", tokens: [], sequence: 2, total: 2 }, attempt: { attemptId: "accepted", isCorrect: true, evaluationResult: "Correct", canonicalAnswer: "answer", citation: "Daniel 1:1", sourceText: "answer", masteryLevel: "Learning", exactWordingScore: 18, reviewDueAtUtc: null, alreadyProcessed: true }, summary: null });
    renderStudy("/student/study?sessionId=session-1&seasonId=season-1&mode=Practice");
    await screen.findByTestId("challenge-feedback");
    expect(screen.getByTestId("complete-session")).toBeEnabled();
    expect(screen.queryByTestId("next-card")).not.toBeInTheDocument();
    expect(api.startSession).not.toHaveBeenCalled();
    expect(api.nextCard).not.toHaveBeenCalled();
    expect(screen.getByText("Session difficulty: Advanced")).toBeInTheDocument();
  });
  it("retries a pending answer from before refresh with the original payload", async () => {
    const payload = { clientSubmissionId: "original", challengeCardId: "pending", submittedAnswer: "answer", responseTimeMs: 123, hintsUsed: false };
    sessionStorage.setItem("erudoza:attempt:session-1", JSON.stringify(payload));
    vi.mocked(api.resumeSession).mockResolvedValue({ session: { id: "session-1", seasonId: "season-1", mode: "Practice", status: "Active", targetCardCount: 2 }, card: { id: "pending", sessionId: "session-1", activityType: "MissingWords", citation: "Daniel 1:1", prompt: "____", tokens: [], sequence: 1, total: 2 }, attempt: null, summary: null });
    renderStudy("/student/study?sessionId=session-1&seasonId=season-1&mode=Practice");
    await waitFor(() => expect(screen.getByTestId("missing-words-answer")).toHaveValue("answer"));
    expect(screen.getByTestId("missing-words-answer")).toBeDisabled();
    fireEvent.click(screen.getByTestId("submit-answer"));
    await screen.findByTestId("challenge-feedback");
    expect(api.submitAttempt).toHaveBeenCalledWith("session-1", payload);
    expect(sessionStorage.getItem("erudoza:attempt:session-1")).toBeNull();
  });
  it("shows the saved Verse Builder answer before retrying after refresh", async () => {
    const payload = { clientSubmissionId: "builder-original", challengeCardId: "builder", submittedAnswer: "first second", responseTimeMs: 456, hintsUsed: false };
    sessionStorage.setItem("erudoza:attempt:session-1", JSON.stringify(payload));
    vi.mocked(api.resumeSession).mockResolvedValue({ session: { id: "session-1", seasonId: "season-1", mode: "Practice", status: "Active", targetCardCount: 2 }, card: { id: "builder", sessionId: "session-1", activityType: "VerseBuilder", citation: "Daniel 1:1", prompt: "Build the verse", tokens: [{ display: "second", index: 0, hidden: false }, { display: "first", index: 1, hidden: false }], sequence: 1, total: 2 }, attempt: null, summary: null });
    renderStudy("/student/study?sessionId=session-1&seasonId=season-1&mode=Practice");
    expect(await screen.findByTestId("pending-answer")).toHaveTextContent("first second");
    fireEvent.click(screen.getByTestId("submit-answer"));
    await screen.findByTestId("challenge-feedback");
    expect(api.submitAttempt).toHaveBeenCalledWith("session-1", payload);
  });
  it("shows recovery for a missing saved session", async () => {
    vi.mocked(api.resumeSession).mockRejectedValue(new Error("Session unavailable"));
    renderStudy("/student/study?sessionId=missing&seasonId=season-1");
    expect(await screen.findByRole("button", { name: "Start a new session" })).toBeInTheDocument();
    expect(api.startSession).not.toHaveBeenCalled();
  });
  async function answerCard() {
    fireEvent.change(await screen.findByTestId("missing-words-answer"), { target: { value: "answer" } });
    fireEvent.click(screen.getByTestId("submit-answer"));
  }
  it("uses a multiline answer and presents feedback before the next decision", async () => {
    renderStudy("/student/study");
    const answer = await screen.findByTestId("missing-words-answer");
    expect(answer.tagName).toBe("TEXTAREA");
    expect(screen.getByTestId("submit-answer")).toBeVisible();
    expect(screen.getByTestId("submit-answer")).toBeDisabled();
    expect(screen.queryByTestId("next-card")).not.toBeInTheDocument();
    await answerCard();
    const feedback = await screen.findByTestId("challenge-feedback");
    const next = screen.getByTestId("next-card");
    expect(feedback.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(next).toHaveClass("ds-button-primary");
    expect(screen.getByTestId("mastery-impact")).toHaveTextContent("exact wording 18 / 100");
    expect(screen.getByTestId("submit-answer")).toBeDisabled();
  });
  it("reuses the identical submitted payload after an uncertain response", async () => {
    vi.mocked(api.submitAttempt).mockRejectedValueOnce(new Error("Connection lost"));
    renderStudy("/student/study");
    await answerCard();
    await screen.findByRole("alert");
    expect(screen.getByTestId("missing-words-answer")).toBeDisabled();
    fireEvent.click(screen.getByTestId("submit-answer"));
    await screen.findByTestId("challenge-feedback");
    expect(vi.mocked(api.submitAttempt).mock.calls[1][1]).toEqual(vi.mocked(api.submitAttempt).mock.calls[0][1]);
  });
  it("offers Finish without Next on the final card and reaches its saved summary", async () => {
    const summary = { sessionId: "session-1", mode: "Practice", attempted: 2, correct: 2, targetCardCount: 2, status: "Completed" };
    vi.mocked(api.completeSession).mockResolvedValue(summary);
    vi.mocked(api.nextCard).mockResolvedValue({ id: "last", sessionId: "session-1", activityType: "MissingWords", citation: "Daniel 1:1", prompt: "____", tokens: [], sequence: 2, total: 2 });
    const router = renderStudy("/student/study");
    await answerCard();
    await screen.findByTestId("challenge-feedback");
    expect(screen.queryByTestId("next-card")).not.toBeInTheDocument();
    expect(screen.getByTestId("complete-session")).toBeEnabled();
    fireEvent.click(screen.getByTestId("complete-session"));
    expect(await screen.findByText("Saved session summary")).toBeInTheDocument();
    expect(router.state.location.state).toBeNull();
    expect(router.state.location.pathname).toBe("/student/sessions/session-1/recap");
  });
  it("retains accepted feedback and Finish when loading the next card fails", async () => {
    renderStudy("/student/study");
    await answerCard();
    await screen.findByTestId("challenge-feedback");
    vi.mocked(api.nextCard).mockRejectedValueOnce(new Error("Offline"));
    fireEvent.click(screen.getByTestId("next-card"));
    await screen.findByRole("alert");
    expect(screen.getByTestId("challenge-feedback")).toBeInTheDocument();
    expect(screen.getByTestId("complete-session")).toBeEnabled();
    expect(screen.getByTestId("submit-answer")).toBeDisabled();
  });
});

vi.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ me: { organizationId: "org", userId: "student" } }) }));
vi.mock("../../api/scripture", () => ({ scriptureApi: { assigned: vi.fn() } }));

describe("StudyPage assigned Scripture reading", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(api.resumeSession).mockImplementation(async (id) => ({session:{id,seasonId:"season-1",status:"Created",mode:"Practice",targetCardCount:8},card:null,attempt:null,summary:null}));
    sessionStorage.clear();
    vi.mocked(api.progress).mockResolvedValue(progress({ seasonStatus: "Active" }));
    vi.mocked(api.startSession).mockImplementation(async (_, mode = "Practice") => ({ id: "session-reader", seasonId: "season-1", mode, status: "Active", targetCardCount: 2 }));
    vi.mocked(api.nextCard).mockResolvedValue({ id: "read-card-1", sessionId: "session-reader", activityType: "MissingWords", citation: "Genesis 1:1", prompt: "In the beginning ____ created the heaven and the earth.", tokens: [], sequence: 1, total: 2 });
    vi.mocked(api.submitAttempt).mockResolvedValue({ attemptId: "attempt", isCorrect: true, citation: "Genesis 1:1", sourceText: "In the beginning God created the heaven and the earth.", masteryLevel: "Learning", exactWordingScore: 5, reviewDueAtUtc: "2026-09-11T00:00:00Z", alreadyProcessed: false, evaluationResult: "Correct", canonicalAnswer: "God" });
    vi.mocked(scriptureApi.assigned).mockResolvedValue({ seasonId: "season-1", verses: [
      { id: "source1", citation: "Genesis 1:1", bookKey: "GEN", chapter: 1, verse: 1, ordinal: 1, canonicalText: "In the beginning God created the heaven and the earth." },
      { id: "source2", citation: "Genesis 2:1", bookKey: "GEN", chapter: 2, verse: 1, ordinal: 2, canonicalText: "Thus the heavens and the earth were finished," },
    ] });
  });

  it("preserves the draft answer and card while browsing, then records the existing hint flag", async () => {
    renderStudy("/student/study");
    const answer = await screen.findByTestId("missing-words-answer");
    fireEvent.change(answer, { target: { value: "God" } });
    expect(scriptureApi.assigned).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Read passage" }));
    await screen.findByLabelText("Chapter");
    fireEvent.change(screen.getByLabelText("Chapter"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Search assigned Scripture"), { target: { value: "Genesis 1:1" } });
    fireEvent.click(screen.getByRole("button", { name: "Hide passage" }));
    expect(answer).toHaveValue("God");
    expect(api.startSession).toHaveBeenCalledTimes(1);
    expect(api.nextCard).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Check answer" }));
    await waitFor(() => expect(api.submitAttempt).toHaveBeenCalledWith("session-reader", expect.objectContaining({ submittedAnswer: "God", challengeCardId: "read-card-1", hintsUsed: true })));
  });

  it("counts an open reader for the next card without resetting its search", async () => {
    renderStudy("/student/study");
    fireEvent.change(await screen.findByTestId("missing-words-answer"), { target: { value: "God" } });
    fireEvent.click(screen.getByRole("button", { name: "Read passage" }));
    const search = await screen.findByLabelText("Search assigned Scripture");
    fireEvent.change(search, { target: { value: "Genesis 2:1" } });
    fireEvent.click(screen.getByRole("button", { name: "Check answer" }));
    await screen.findByTestId("challenge-feedback");
    vi.mocked(api.nextCard).mockResolvedValueOnce({ id: "read-card-2", sessionId: "session-reader", activityType: "MissingWords", citation: "Genesis 2:1", prompt: "Thus the ____", tokens: [], sequence: 2, total: 2 });
    fireEvent.click(screen.getByRole("button", { name: "Next card" }));
    await waitFor(() => expect(screen.getByTestId("card-progress")).toHaveTextContent("2 / 2"));
    expect(search).toHaveValue("Genesis 2:1");
    fireEvent.change(screen.getByTestId("missing-words-answer"), { target: { value: "heavens" } });
    fireEvent.click(screen.getByRole("button", { name: "Check answer" }));
    await waitFor(() => expect(api.submitAttempt).toHaveBeenLastCalledWith("session-reader", expect.objectContaining({ challengeCardId: "read-card-2", hintsUsed: true })));
  });

  it("preserves an uncertain submission's exact payload after opening the reader", async () => {
    vi.mocked(api.submitAttempt).mockRejectedValueOnce(new Error("Network lost"));
    renderStudy("/student/study");
    fireEvent.change(await screen.findByTestId("missing-words-answer"), { target: { value: "God" } });
    fireEvent.click(screen.getByRole("button", { name: "Check answer" }));
    await screen.findByRole("alert");
    const payload = vi.mocked(api.submitAttempt).mock.calls[0][1];
    expect(payload.hintsUsed).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Read passage" }));
    await screen.findByLabelText("Chapter");
    fireEvent.click(screen.getByRole("button", { name: "Retry saved answer" }));
    await waitFor(() => expect(api.submitAttempt).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.submitAttempt).mock.calls[1][1]).toEqual(payload);
  });

  it("keeps reading assistance out of simulation", async () => {
    renderStudy("/student/study?mode=Simulation");
    await screen.findByTestId("missing-words-answer");
    expect(screen.queryByRole("button", { name: "Read passage" })).not.toBeInTheDocument();
    expect(scriptureApi.assigned).not.toHaveBeenCalled();
  });
});
