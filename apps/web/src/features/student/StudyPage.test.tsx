import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../../api/client";
import { scriptureApi } from "../../api/scripture";
import { trainingApi } from "../../api/training";
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
    shuffleSession: vi.fn(),
    reblankCard: vi.fn(),
  },
}));

const studyClients = new Set<QueryClient>();
const studyRouters = new Set<ReturnType<typeof createMemoryRouter>>();

vi.mock("../admin/ContentPage", () => ({ ContentPage: () => <div data-testid="library-embed">Scripture library</div> }));
vi.mock("../../api/training", () => ({ trainingApi: { today: vi.fn() } }));

beforeEach(() => {
  vi.mocked(api.resumeSession).mockImplementation(async (id) => ({session:{id,seasonId:"season-1",status:"Created",mode:"Practice",targetCardCount:8},card:null,attempt:null,summary:null}));
});

afterEach(async () => {
  cleanup();
  for (const router of studyRouters) router.dispose();
  await Promise.all([...studyClients].map(client => client.cancelQueries()));
  for (const client of studyClients) client.clear();
  studyRouters.clear();
  studyClients.clear();
  await new Promise(resolve => setTimeout(resolve, 0));
  sessionStorage.clear();
});

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

function today() {
  return {
    streak: { current: 5, best: 9, state: "active" as const },
    xp: { total: 240, level: 3, levelName: "Disciple", xpIntoLevel: 40, xpForNext: 100 },
    quests: [{ key: "warmup" as const, title: "Answer 5 questions", description: "", target: 5, progress: 2, completed: false, xpReward: 25 }],
  } as never;
}

function renderStudy(path: string) {  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const router = createMemoryRouter([{ path: "/student/study", element: <StudyPage /> }, { path: "/student/sessions/:sessionId/recap", element: <p>Saved session summary</p> }], {
    initialEntries: [path],
  });
  studyClients.add(client);
  studyRouters.add(router);
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
      tokens: [{index:2,display:"____",hidden:true}],
      sequence: 1,
      total: 8,
    });
  });

  it("offers enabled Memory purposes without promoting coach difficulty", async()=>{
    vi.mocked(api.progress).mockResolvedValue(progress({seasonStatus:"Active",pbeEnabled:true,assignments:[{difficulty:"Standard"} as Progress['assignments'][number]]}));
    renderStudy("/student/study?mode=Practice&format=Memory");
    const warmup=await screen.findByRole("button",{name:"Start Memory warmup"});
    expect(api.startSession).not.toHaveBeenCalled();
    // R1: choosing a purpose is pre-session — no session-active marker.
    expect(document.querySelector("[data-session-active]")).toBeNull();
    expect(screen.queryByRole("button",{name:"Start Advanced mastery challenge"})).not.toBeInTheDocument();
    fireEvent.click(warmup);
    await waitFor(()=>expect(api.startSession).toHaveBeenCalledWith("season-1","Practice",expect.any(Object),"Memory","Warmup"));
  });
  it("keeps an explicit Advanced mastery challenge available with optional unscored recitation",async()=>{
    vi.mocked(api.progress).mockResolvedValue(progress({seasonStatus:"Active",pbeEnabled:true,assignments:[{difficulty:"Advanced"} as Progress['assignments'][number]]}));
    renderStudy("/student/study?mode=Practice&format=Memory");
    fireEvent.click(await screen.findByRole("button",{name:"Start Advanced mastery challenge"}));
    await waitFor(()=>expect(api.startSession).toHaveBeenCalledWith("season-1","Practice",expect.any(Object),"Memory","Advanced"));
    expect(screen.queryByText("Memory activities are study aids. Verse Builder practices sequence, not exact-word recall.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Optional full-verse recitation"));
    expect(screen.getByLabelText("Your private recitation practice")).toBeInTheDocument();
  });
  it("does not start review when the progress API reports none due", async () => {
    vi.mocked(api.progress).mockResolvedValue(progress({ seasonStatus: "Active", reviewDueCount: 0 }));
    renderStudy("/student/study?mode=Review");

    expect(await screen.findByTestId("academy-track-unavailable")).toHaveTextContent(
      "Nothing is due for review right now.",
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
    const router = renderStudy("/student/study?mode=Practice&startId=retry-intent&step=Practice");
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    await screen.findByRole("group",{name:"Fill-in-the-blank passage"});
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
      "Review opens once your season starts.",
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
    renderStudy("/student/study?mode=Practice&seasonId=season-1");
    if (stage === "answer") {
      fireEvent.change(await screen.findByRole("textbox",{name:"Blank 1 of 1"}), { target: { value: "answer" } });
      fireEvent.click(screen.getByTestId("submit-answer"));
    }
    expect(await screen.findByRole("link", { name: "Return to Training HQ" })).toHaveAttribute("href", "/student?seasonId=season-1");
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("does not start learner drill until the season is Active", async () => {
    vi.mocked(api.progress).mockResolvedValue(progress({ seasonStatus: "Draft" }));
    renderStudy("/student/study?mode=Practice");

    expect(await screen.findByTestId("academy-track-unavailable")).toHaveTextContent(
      "Learn opens once your season starts.",
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
      "Rehearse opens once your season starts.",
    );
    expect(screen.getByTestId("academy-session-kicker")).toHaveTextContent("Rehearsal");
    expect(api.startSession).not.toHaveBeenCalled();
  });

  it("starts learner drill from the existing session API", async () => {
    vi.mocked(api.progress).mockResolvedValue(progress({ seasonStatus: "Active", reviewDueCount: 0 }));
    renderStudy("/student/study?mode=Practice");

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
    renderStudy("/student/study?mode=Practice");

    expect(await screen.findByTestId("study-page-title")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Fill in the Blank" })).toBeInTheDocument();
    // Season details stay off the activity screen (Task B): no season name in the header.
    expect(screen.queryByTestId("current-season")).not.toBeInTheDocument();
    expect(screen.queryByText("Daniel 2026")).not.toBeInTheDocument();
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
    renderStudy("/student/study?mode=Practice");

    // The activity name lives in the page heading only (not repeated in the card header).
    expect(await screen.findByRole("heading", { name: "Verse Builder" })).toBeInTheDocument();
    expect(screen.getByTestId("challenge-prompt")).toHaveTextContent("Build the verse");
    expect(screen.getByTestId("challenge-prompt").tagName).toBe("H2");
    expect(screen.getByTestId("challenge-card")).toHaveTextContent("Daniel 1:2");
    expect(screen.queryByTestId("academy-activity-name")).not.toBeInTheDocument();
    await waitFor(() => expect(api.startSession).toHaveBeenCalledWith("season-1", "Practice", expect.objectContaining({ clientStartId: expect.any(String), timeZone: expect.any(String) })));
  });

  it("keeps season details off the activity screen", async () => {
    vi.mocked(api.progress).mockResolvedValue(
      progress({ seasonStatus: "Active", reviewDueCount: 2, seasonName: "Daniel 2026" }),
    );
    renderStudy("/student/study?mode=Practice");

    expect(await screen.findByTestId("study-page-title")).toBeInTheDocument();
    await screen.findByTestId("challenge-card");
    expect(screen.queryByTestId("current-season")).not.toBeInTheDocument();
    expect(screen.queryByText("Daniel 2026")).not.toBeInTheDocument();
    expect(screen.queryByText(/Session difficulty/)).not.toBeInTheDocument();
  });

  it("keeps unavailable review copy on the Field Guide cover", async () => {
    vi.mocked(api.progress).mockResolvedValue(progress({ seasonStatus: "Active", reviewDueCount: 0 }));
    renderStudy("/student/study?mode=Review");

    expect(await screen.findByTestId("academy-track-unavailable")).toHaveTextContent(
      "Nothing is due for review right now.",
    );
    expect(screen.getByTestId("study-page-title")).toBeInTheDocument();
    expect(screen.getByTestId("academy-session-kicker")).toHaveTextContent("Due review");
    expect(screen.queryByTestId("challenge-card")).not.toBeInTheDocument();
    expect(api.startSession).not.toHaveBeenCalled();
  });

  it("starts a new rehearsal session after switching from learner on the same page", async () => {
    vi.mocked(api.progress).mockResolvedValue(progress({ seasonStatus: "Active", reviewDueCount: 0 }));
    const router = renderStudy("/student/study?mode=Practice");

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

    const router = renderStudy("/student/study?mode=Practice");
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
      prompt: "In the Sermon on the Mount, ____ teaches.",
      citation: "Matthew 5:9",
      tokens: [{index:0,display:"In the Sermon on the Mount,",hidden:false},{index:2,display:"____",hidden:true},{index:3,display:"teaches.",hidden:false}],
      sequence: 1,
      total: 8,
    });
  });

  it("shows focused answer controls without mastery metrics", async () => {
    vi.mocked(api.progress).mockResolvedValue(progress({ seasonStatus: "Active", seasonName: "Daniel 2026" }));
    renderStudy("/student/study?mode=Practice");

    const card = await screen.findByTestId("challenge-card");
    expect(card).toHaveClass("ds-panel");
    expect(screen.queryByTestId("challenge-ribbon")).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Fill in the Blank" })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("group",{name:"Fill-in-the-blank passage"})).toHaveTextContent("In the Sermon on the Mount"),
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
    renderStudy("/student/study?mode=Practice");

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
    vi.mocked(api.nextCard).mockResolvedValue({ id: "card-1", sessionId: "session-1", activityType: "MissingWords", citation: "Daniel 1:1", prompt: "____", tokens: [{index:2,display:"____",hidden:true}], sequence: 1, total: 2 });
    vi.mocked(api.submitAttempt).mockResolvedValue({ attemptId: "attempt-1", isCorrect: true, evaluationResult: "Correct", canonicalAnswer: "answer", citation: "Daniel 1:1", sourceText: "answer", masteryLevel: "Learning", exactWordingScore: 18, skillKey: "exactWording", skillLabel: "Exact wording", skillScore: 18, reviewDueAtUtc: null, alreadyProcessed: false });
  });
  it("submits adjacent indexed blanks without the separate textarea and shows only accepted slot feedback", async () => {
    const tokens = [{index:0,display:'He',hidden:false},{index:2,display:'____',hidden:true},{index:3,display:'____',hidden:true}];
    vi.mocked(api.nextCard).mockResolvedValue({id:'card-1',sessionId:'session-1',activityType:'MissingWords',citation:'Esther 1:22',prompt:'He ____ ____',tokens,sequence:1,total:2});
    vi.mocked(api.submitAttempt).mockRejectedValueOnce(new Error('lost'));
    renderStudy('/student/study?mode=Practice&format=Memory');
    const first = await screen.findByRole('textbox',{name:'Blank 1 of 2'}), second = screen.getByRole('textbox',{name:'Blank 2 of 2'});
    expect(screen.queryByLabelText('Type the missing phrase')).not.toBeInTheDocument();
    expect(screen.queryByTestId('challenge-prompt')).not.toBeInTheDocument();
    fireEvent.change(first,{target:{value:'sent'}}); fireEvent.change(second,{target:{value:'letters'}});
    fireEvent.click(screen.getByTestId('submit-answer'));
    await screen.findByRole('alert');
    expect(api.submitAttempt).toHaveBeenCalledWith('session-1',expect.objectContaining({missingWordAnswers:[{index:2,text:'sent'},{index:3,text:'letters'}]}));
    expect(vi.mocked(api.submitAttempt).mock.calls[0][1]).not.toHaveProperty('submittedAnswer');
    expect(first).toBeDisabled(); expect(second).toHaveValue('letters');
    expect(screen.queryByText('Blank 1: Correct')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('submit-answer'));
    await screen.findByTestId('challenge-feedback');
    expect(vi.mocked(api.submitAttempt).mock.calls[1][1]).toEqual(vi.mocked(api.submitAttempt).mock.calls[0][1]);
  });
  it('restores structured pending slots including an explicit empty middle without compacting',async()=>{
    const payload={clientSubmissionId:'slots-original',challengeCardId:'slots',missingWordAnswers:[{index:2,text:'in the'},{index:3,text:''},{index:5,text:'king'}],responseTimeMs:456,hintsUsed:true};
    sessionStorage.setItem('erudoza:attempt:session-1',JSON.stringify(payload));
    vi.mocked(api.resumeSession).mockResolvedValue({session:{id:'session-1',seasonId:'season-1',mode:'Practice',status:'Active',targetCardCount:2},card:{id:'slots',sessionId:'session-1',activityType:'MissingWords',citation:'Esther 1:22',prompt:'____ ____ of ____',tokens:[{index:2,display:'____',hidden:true},{index:3,display:'____',hidden:true},{index:4,display:'of',hidden:false},{index:5,display:'____',hidden:true}],sequence:1,total:2},attempt:null,summary:null});
    renderStudy('/student/study?sessionId=session-1');
    await waitFor(()=>expect(screen.getByRole('textbox',{name:'Blank 1 of 3'})).toHaveValue('in the'));
    expect(screen.getByRole('textbox',{name:'Blank 2 of 3'})).toHaveValue('');
    expect(screen.getByRole('textbox',{name:'Blank 3 of 3'})).toHaveValue('king');
    expect(screen.getByRole('textbox',{name:'Blank 1 of 3'})).toBeDisabled();
    fireEvent.click(screen.getByTestId('submit-answer'));
    await screen.findByTestId('challenge-feedback'); expect(api.submitAttempt).toHaveBeenCalledWith('session-1',payload);
  });
  it('allows deliberately empty slots and restores only saved feedback after acceptance',async()=>{
    vi.mocked(api.submitAttempt).mockResolvedValue({attemptId:'empty-result',isCorrect:false,evaluationResult:'Incorrect',canonicalAnswer:'answer',citation:'Daniel 1:1',sourceText:'answer',masteryLevel:'Learning',exactWordingScore:0,skillKey:'exactWording',skillLabel:'Exact wording',skillScore:0,reviewDueAtUtc:null,alreadyProcessed:false,missingWordResults:[{index:2,isCorrect:false,expected:'answer'}]});
    renderStudy('/student/study?mode=Practice&format=Memory');
    const blank=await screen.findByRole('textbox',{name:'Blank 1 of 1'});
    expect(blank).toHaveValue('');expect(screen.queryByText(/Expected:/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('submit-answer'));
    await screen.findByTestId('challenge-feedback');
    expect(api.submitAttempt).toHaveBeenCalledWith('session-1',expect.objectContaining({missingWordAnswers:[{index:2,text:''}]}));
    expect(screen.getByTestId('missing-words-summary')).toHaveTextContent('0 of 1 correct — review blank 1');expect(blank).toBeDisabled();
  });
  it('restores the original wrong and empty indexed values on accepted reload',async()=>{
    const card={id:'saved-slots',sessionId:'session-1',activityType:'MissingWords',citation:'Daniel 1:1',prompt:'____ ____',tokens:[{index:2,display:'____',hidden:true},{index:3,display:'____',hidden:true}],sequence:1,total:2};
    const attempt={attemptId:'saved-result',isCorrect:false,evaluationResult:'Incorrect',canonicalAnswer:'in the',citation:'Daniel 1:1',sourceText:'in the',masteryLevel:'Learning',exactWordingScore:0,skillKey:'exactWording',skillLabel:'Exact wording',skillScore:0,reviewDueAtUtc:null,alreadyProcessed:true,missingWordAnswers:[{index:2,text:' IN THE '},{index:3,text:''}],missingWordResults:[{index:2,isCorrect:false,expected:'in'},{index:3,isCorrect:false,expected:'the'}]};
    vi.mocked(api.resumeSession).mockResolvedValue({session:{id:'session-1',seasonId:'season-1',mode:'Practice',status:'Active',targetCardCount:2},card,attempt,summary:null});
    renderStudy('/student/study?sessionId=session-1');
    await screen.findByTestId('challenge-feedback');
    expect(screen.getByRole('textbox',{name:'Blank 1 of 2'})).toHaveValue(' IN THE ');
    expect(screen.getByRole('textbox',{name:'Blank 2 of 2'})).toHaveValue('');
    expect(screen.getByRole('textbox',{name:'Blank 1 of 2'})).toBeDisabled();
    expect(screen.getByTestId('missing-words-summary')).toHaveTextContent('0 of 2 correct — review blank 1, blank 2');
    expect(api.submitAttempt).not.toHaveBeenCalled();
  });
  it("starts Builder empty, submits duplicate IDs once each, and preserves pending text on refresh", async () => {
    const card = { id:"builder",sessionId:"session-1",activityType:"VerseBuilder",citation:"Daniel 1:1",prompt:"Build the verse",tokens:[{index:4,display:"one",hidden:false},{index:9,display:"two",hidden:false},{index:12,display:"one",hidden:false}],sequence:1,total:2 };
    vi.mocked(api.nextCard).mockResolvedValue(card);
    renderStudy("/student/study?mode=Practice&format=Memory");
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
    vi.mocked(api.resumeSession).mockResolvedValue({ session: { id: "session-1", seasonId: "season-1", mode: "Practice", status: "Active", targetCardCount: 2, difficulty: "Advanced" }, card: { id: "final", sessionId: "session-1", activityType: "MissingWords", citation: "Daniel 1:1", prompt: "____", tokens: [{index:2,display:"____",hidden:true}], sequence: 2, total: 2 }, attempt: { attemptId: "accepted", isCorrect: true, evaluationResult: "Correct", canonicalAnswer: "answer", citation: "Daniel 1:1", sourceText: "answer", masteryLevel: "Learning", exactWordingScore: 18, skillKey: "exactWording", skillLabel: "Exact wording", skillScore: 18, reviewDueAtUtc: null, alreadyProcessed: true }, summary: null });
    renderStudy("/student/study?sessionId=session-1&seasonId=season-1&mode=Practice");
    await screen.findByTestId("challenge-feedback");
    expect(screen.getByTestId("complete-session")).toBeEnabled();
    expect(screen.queryByTestId("next-card")).not.toBeInTheDocument();
    expect(api.startSession).not.toHaveBeenCalled();
    expect(api.nextCard).not.toHaveBeenCalled();
    expect(screen.queryByText(/Session difficulty/)).not.toBeInTheDocument();
  });
  it("retries a pending answer from before refresh with the original payload", async () => {
    const payload = { clientSubmissionId: "original", challengeCardId: "pending", submittedAnswer: "answer", responseTimeMs: 123, hintsUsed: false };
    sessionStorage.setItem("erudoza:attempt:session-1", JSON.stringify(payload));
    vi.mocked(api.resumeSession).mockResolvedValue({ session: { id: "session-1", seasonId: "season-1", mode: "Practice", status: "Active", targetCardCount: 2 }, card: { id: "pending", sessionId: "session-1", activityType: "MissingWords", citation: "Daniel 1:1", prompt: "____", tokens: [{index:2,display:"____",hidden:true}], sequence: 1, total: 2 }, attempt: null, summary: null });
    renderStudy("/student/study?sessionId=session-1&seasonId=season-1&mode=Practice");
    expect(await screen.findByTestId("pending-answer")).toHaveTextContent("answer");
    expect(screen.getByRole("textbox",{name:"Blank 1 of 1"})).toBeDisabled();
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
    fireEvent.change(await screen.findByRole("textbox",{name:"Blank 1 of 1"}), { target: { value: "answer" } });
    fireEvent.click(screen.getByTestId("submit-answer"));
  }
  it("uses an inline blank and presents feedback before the next decision", async () => {
    renderStudy("/student/study?mode=Practice");
    const answer = await screen.findByRole("textbox",{name:"Blank 1 of 1"});
    expect(answer.tagName).toBe("INPUT");
    expect(screen.getByTestId("submit-answer")).toBeVisible();
    expect(screen.getByTestId("submit-answer")).toBeEnabled();
    expect(screen.queryByTestId("next-card")).not.toBeInTheDocument();
    await answerCard();
    const feedback = await screen.findByTestId("challenge-feedback");
    const next = screen.getByTestId("next-card");
    expect(feedback.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(next).toHaveClass("ds-button-primary");
    expect(screen.getByTestId("mastery-impact")).toHaveTextContent("Exact wording score: 18 / 100");
    expect(screen.getByTestId("submit-answer")).toBeDisabled();
    // Feedback keeps its status semantics but is no longer a heading; the prompt owns the card heading.
    expect(feedback).toHaveAttribute("role", "status");
    expect(feedback.querySelector("h1,h2,h3")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Well remembered" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Read it once more" })).not.toBeInTheDocument();
  });
  it("reports the evaluated skill for non-writing activities instead of exact wording", async () => {
    vi.mocked(api.nextCard).mockResolvedValue({ id: "card-tf", sessionId: "session-1", activityType: "TrueFalse", citation: "Daniel 1:1", prompt: "According to Daniel 1:1, is this the verse? one two", tokens: [], sequence: 1, total: 2 });
    vi.mocked(api.submitAttempt).mockResolvedValue({ attemptId: "attempt-tf", isCorrect: true, evaluationResult: "Correct", canonicalAnswer: "True", citation: "Daniel 1:1", sourceText: "one two", masteryLevel: "Learning", exactWordingScore: 0, skillKey: "recognition", skillLabel: "Recognition", skillScore: 10, reviewDueAtUtc: null, alreadyProcessed: false });
    renderStudy("/student/study?mode=Practice");
    fireEvent.click(await screen.findByTestId("true-false-true"));
    fireEvent.click(screen.getByTestId("submit-answer"));
    await screen.findByTestId("challenge-feedback");
    expect(screen.getByTestId("mastery-impact")).toHaveTextContent("Recognition score: 10 / 100");
    expect(screen.getByTestId("mastery-impact")).not.toHaveTextContent("exact wording");
  });
  it("reuses the identical submitted payload after an uncertain response", async () => {
    vi.mocked(api.submitAttempt).mockRejectedValueOnce(new Error("Connection lost"));
    renderStudy("/student/study?mode=Practice");
    await answerCard();
    await screen.findByRole("alert");
    expect(screen.getByRole("textbox",{name:"Blank 1 of 1"})).toBeDisabled();
    fireEvent.click(screen.getByTestId("submit-answer"));
    await screen.findByTestId("challenge-feedback");
    expect(vi.mocked(api.submitAttempt).mock.calls[1][1]).toEqual(vi.mocked(api.submitAttempt).mock.calls[0][1]);
  });
  it("offers Finish without Next on the final card and reaches its saved summary", async () => {
    const summary = { sessionId: "session-1", mode: "Practice", attempted: 2, correct: 2, targetCardCount: 2, status: "Completed" };
    vi.mocked(api.completeSession).mockResolvedValue(summary);
    vi.mocked(api.nextCard).mockResolvedValue({ id: "last", sessionId: "session-1", activityType: "MissingWords", citation: "Daniel 1:1", prompt: "____", tokens: [{index:2,display:"____",hidden:true}], sequence: 2, total: 2 });
    const router = renderStudy("/student/study?mode=Practice");
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
    renderStudy("/student/study?mode=Practice");
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

describe("StudyPage Shuffle blanks", () => {
  const cardBefore = { id: "card-1", sessionId: "session-1", activityType: "MissingWords", citation: "Genesis 1:1", prompt: "In the ____ created ____ earth", tokens: [
    { index: 0, display: "In", hidden: false }, { index: 1, display: "the", hidden: false }, { index: 2, display: "____", hidden: true },
    { index: 3, display: "created", hidden: false }, { index: 4, display: "____", hidden: true }, { index: 5, display: "earth", hidden: false },
  ], sequence: 1, total: 2, blankShuffles: 0, blankShuffleLimit: 3 };
  const cardAfter = { ...cardBefore, prompt: "In ____ God ____ heaven earth", tokens: [
    { index: 0, display: "In", hidden: false }, { index: 1, display: "____", hidden: true }, { index: 2, display: "God", hidden: false },
    { index: 3, display: "____", hidden: true }, { index: 4, display: "heaven", hidden: false }, { index: 5, display: "earth", hidden: false },
  ], blankShuffles: 1 };
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.progress).mockResolvedValue(progress({ seasonStatus: "Active" }));
    vi.mocked(api.resumeSession).mockResolvedValue({ session: { id: "session-1", seasonId: "season-1", mode: "Practice", status: "Active", targetCardCount: 2 }, card: cardBefore, attempt: null, summary: null });
  });

  it("re-deals the blanks on the same verse, clears the draft, and submits against the new pattern", async () => {
    vi.mocked(api.reblankCard).mockResolvedValue(cardAfter);
    vi.mocked(api.submitAttempt).mockResolvedValue({ attemptId: "attempt-1", isCorrect: true, evaluationResult: "Correct", canonicalAnswer: "the created", citation: "Genesis 1:1", sourceText: "In the God created heaven earth", masteryLevel: "Learning", exactWordingScore: 10, skillKey: "exactWording", skillLabel: "Exact wording", skillScore: 10, reviewDueAtUtc: null, alreadyProcessed: false, missingWordAnswers: [{ index: 1, text: "the" }, { index: 3, text: "created" }], missingWordResults: [{ index: 1, isCorrect: true, expected: "the" }, { index: 3, isCorrect: true, expected: "created" }] });
    renderStudy("/student/study?sessionId=session-1&seasonId=season-1&mode=Practice");
    await screen.findByTestId("challenge-card");
    fireEvent.change(screen.getByRole("textbox", { name: "Blank 1 of 2" }), { target: { value: "God" } });
    fireEvent.click(screen.getByTestId("shuffle-blanks"));
    expect(await screen.findByTestId("reblank-note")).toBeInTheDocument();
    expect(api.reblankCard).toHaveBeenCalledWith("session-1", "card-1");
    // Same card, new pattern: the typed draft is gone and the blanks moved.
    expect(screen.getByRole("textbox", { name: "Blank 1 of 2" })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "Blank 2 of 2" })).toHaveValue("");
    expect(screen.queryByDisplayValue("God")).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Blank 1 of 2" }), { target: { value: "the" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Blank 2 of 2" }), { target: { value: "created" } });
    fireEvent.click(screen.getByTestId("submit-answer"));
    await waitFor(() => expect(api.submitAttempt).toHaveBeenCalledWith("session-1", expect.objectContaining({ challengeCardId: "card-1", missingWordAnswers: [{ index: 1, text: "the" }, { index: 3, text: "created" }], hintsUsed: false })));
  });

  it("disables Shuffle blanks once the card reaches its shuffle limit", async () => {
    vi.mocked(api.resumeSession).mockResolvedValue({ session: { id: "session-1", seasonId: "season-1", mode: "Practice", status: "Active", targetCardCount: 2 }, card: { ...cardBefore, blankShuffles: 3 }, attempt: null, summary: null });
    renderStudy("/student/study?sessionId=session-1&seasonId=season-1&mode=Practice");
    await screen.findByTestId("challenge-card");
    expect(screen.getByTestId("shuffle-blanks")).toBeDisabled();
  });

  it("does not offer Shuffle blanks in Simulation", async () => {
    vi.mocked(api.resumeSession).mockResolvedValue({ session: { id: "session-1", seasonId: "season-1", mode: "Simulation", status: "Active", targetCardCount: 2 }, card: cardBefore, attempt: null, summary: null });
    renderStudy("/student/study?sessionId=session-1&seasonId=season-1&mode=Simulation");
    await screen.findByTestId("challenge-card");
    expect(screen.queryByTestId("shuffle-blanks")).not.toBeInTheDocument();
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
    vi.mocked(api.nextCard).mockResolvedValue({ id: "read-card-1", sessionId: "session-reader", activityType: "MissingWords", citation: "Genesis 1:1", prompt: "In the beginning ____ created the heaven and the earth.", tokens: [{index:2,display:"____",hidden:true}], sequence: 1, total: 2 });
    vi.mocked(api.submitAttempt).mockResolvedValue({ attemptId: "attempt", isCorrect: true, citation: "Genesis 1:1", sourceText: "In the beginning God created the heaven and the earth.", masteryLevel: "Learning", exactWordingScore: 5, skillKey: "exactWording", skillLabel: "Exact wording", skillScore: 5, reviewDueAtUtc: "2026-09-11T00:00:00Z", alreadyProcessed: false, evaluationResult: "Correct", canonicalAnswer: "God" });
    vi.mocked(scriptureApi.assigned).mockResolvedValue({ seasonId: "season-1", verses: [
      { id: "source1", citation: "Genesis 1:1", bookKey: "GEN", chapter: 1, verse: 1, ordinal: 1, canonicalText: "In the beginning God created the heaven and the earth." },
      { id: "source2", citation: "Genesis 2:1", bookKey: "GEN", chapter: 2, verse: 1, ordinal: 2, canonicalText: "Thus the heavens and the earth were finished," },
    ] });
  });

  it("resets the in-progress draft when the passage is opened during a from-memory activity", async () => {
    renderStudy("/student/study?mode=Practice");
    const answer = await screen.findByRole("textbox",{name:"Blank 1 of 1"});
    fireEvent.change(answer, { target: { value: "God" } });
    expect(scriptureApi.assigned).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Read passage" }));
    await screen.findByLabelText("Chapter");
    // The draft was cleared the moment the passage opened, with the warning.
    expect(answer).toHaveValue("");
    expect(screen.getByTestId("attempt-reset-note")).toHaveTextContent("restarted this activity");
    fireEvent.change(screen.getByLabelText("Chapter"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Search assigned Scripture"), { target: { value: "Genesis 1:1" } });
    fireEvent.click(screen.getByRole("button", { name: "Hide passage" }));
    expect(api.startSession).toHaveBeenCalledTimes(1);
    expect(api.nextCard).toHaveBeenCalledTimes(1);
    // Re-answer from scratch; the read flag still marks the attempt assisted.
    fireEvent.change(answer, { target: { value: "God" } });
    fireEvent.click(screen.getByRole("button", { name: "Check answer" }));
    await waitFor(() => expect(api.submitAttempt).toHaveBeenCalledWith("session-reader", expect.objectContaining({ missingWordAnswers: [{index:2,text:"God"}], challengeCardId: "read-card-1", hintsUsed: true })));
  });

  it("does not reset a recognition activity when the passage is opened", async () => {
    vi.mocked(api.nextCard).mockResolvedValue({ id: "read-card-tf", sessionId: "session-reader", activityType: "TrueFalse", citation: "Genesis 1:1", prompt: "According to Genesis 1:1, is this the verse? In the beginning God created", tokens: [], sequence: 1, total: 2 });
    renderStudy("/student/study?mode=Practice");
    fireEvent.click(await screen.findByTestId("true-false-true"));
    fireEvent.click(screen.getByRole("button", { name: "Read passage" }));
    await screen.findByLabelText("Chapter");
    expect(screen.queryByTestId("attempt-reset-note")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide passage" }));
    // The selection survived browsing; the attempt is still marked assisted.
    fireEvent.click(screen.getByRole("button", { name: "Check answer" }));
    await waitFor(() => expect(api.submitAttempt).toHaveBeenCalledWith("session-reader", expect.objectContaining({ submittedAnswer: "True", challengeCardId: "read-card-tf", hintsUsed: true })));
  });

  it("hides the scripture automatically when the next card is a from-memory activity", async () => {
    renderStudy("/student/study?mode=Practice");
    fireEvent.change(await screen.findByRole("textbox",{name:"Blank 1 of 1"}), { target: { value: "God" } });
    fireEvent.click(screen.getByRole("button", { name: "Read passage" }));
    const search = await screen.findByLabelText("Search assigned Scripture");
    fireEvent.change(search, { target: { value: "Genesis 2:1" } });
    fireEvent.click(screen.getByRole("button", { name: "Check answer" }));
    await screen.findByTestId("challenge-feedback");
    vi.mocked(api.nextCard).mockResolvedValueOnce({ id: "read-card-2", sessionId: "session-reader", activityType: "MissingWords", citation: "Genesis 2:1", prompt: "Thus the ____", tokens: [{index:2,display:"____",hidden:true}], sequence: 2, total: 2 });
    fireEvent.click(screen.getByRole("button", { name: "Next card" }));
    await waitFor(() => expect(screen.getByTestId("card-progress")).toHaveTextContent("2 / 2"));
    // The passage hid itself on arrival, with the warning shown.
    expect(screen.getByRole("button", { name: "Read passage" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hide passage" })).not.toBeInTheDocument();
    expect(screen.getByTestId("reader-auto-hidden-note")).toHaveTextContent("answered from memory");
    // The new card was never exposed to the open reader, so it is not assisted.
    fireEvent.change(screen.getByRole("textbox",{name:"Blank 1 of 1"}), { target: { value: "heavens" } });
    fireEvent.click(screen.getByRole("button", { name: "Check answer" }));
    await waitFor(() => expect(api.submitAttempt).toHaveBeenLastCalledWith("session-reader", expect.objectContaining({ challengeCardId: "read-card-2", hintsUsed: false })));
  });

  it("keeps the scripture open when the next card is a recognition activity", async () => {
    renderStudy("/student/study?mode=Practice");
    fireEvent.change(await screen.findByRole("textbox",{name:"Blank 1 of 1"}), { target: { value: "God" } });
    fireEvent.click(screen.getByRole("button", { name: "Read passage" }));
    const search = await screen.findByLabelText("Search assigned Scripture");
    fireEvent.change(search, { target: { value: "Genesis 2:1" } });
    fireEvent.click(screen.getByRole("button", { name: "Check answer" }));
    await screen.findByTestId("challenge-feedback");
    vi.mocked(api.nextCard).mockResolvedValueOnce({ id: "read-card-2", sessionId: "session-reader", activityType: "TrueFalse", citation: "Genesis 2:1", prompt: "According to Genesis 2:1, is this the verse? Thus the heavens", tokens: [], sequence: 2, total: 2 });
    fireEvent.click(screen.getByRole("button", { name: "Next card" }));
    await waitFor(() => expect(screen.getByTestId("card-progress")).toHaveTextContent("2 / 2"));
    // Non-restricted: reader stays open, search preserved, no auto-hide note,
    // and the open reader counts as assistance for this card as before.
    expect(screen.getByRole("button", { name: "Hide passage" })).toBeInTheDocument();
    expect(screen.queryByTestId("reader-auto-hidden-note")).not.toBeInTheDocument();
    expect(search).toHaveValue("Genesis 2:1");
    fireEvent.click(screen.getByTestId("true-false-true"));
    fireEvent.click(screen.getByRole("button", { name: "Check answer" }));
    await waitFor(() => expect(api.submitAttempt).toHaveBeenLastCalledWith("session-reader", expect.objectContaining({ challengeCardId: "read-card-2", hintsUsed: true })));
  });

  it("starts a resumed from-memory card with the scripture closed", async () => {
    vi.mocked(api.resumeSession).mockResolvedValue({ session: { id: "session-reader", seasonId: "season-1", mode: "Practice", status: "Active", targetCardCount: 2 }, card: { id: "read-card-1", sessionId: "session-reader", activityType: "MissingWords", citation: "Genesis 1:1", prompt: "In the beginning ____", tokens: [{index:2,display:"____",hidden:true}], sequence: 1, total: 2 }, attempt: null, summary: null });
    renderStudy("/student/study?sessionId=session-reader&seasonId=season-1&mode=Practice");
    await screen.findByTestId("challenge-card");
    // Reader open state is never persisted, so a resumed restricted card
    // cannot arrive with the passage open.
    expect(screen.getByRole("button", { name: "Read passage" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hide passage" })).not.toBeInTheDocument();
  });

  it("preserves an uncertain submission's exact payload after opening the reader", async () => {
    vi.mocked(api.submitAttempt).mockRejectedValueOnce(new Error("Network lost"));
    renderStudy("/student/study?mode=Practice");
    fireEvent.change(await screen.findByRole("textbox",{name:"Blank 1 of 1"}), { target: { value: "God" } });
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
    await screen.findByRole("textbox",{name:"Blank 1 of 1"});
    expect(screen.queryByRole("button", { name: "Read passage" })).not.toBeInTheDocument();
    expect(scriptureApi.assigned).not.toHaveBeenCalled();
  });
});

describe("StudyPage mode select", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.progress).mockResolvedValue(progress({ seasonStatus: "Active", pbeEnabled: false, reviewDueCount: 0 }));
    vi.mocked(trainingApi.today).mockResolvedValue(today());
  });
  it("renders the Learn, Review, and Rehearse cards without starting a session", async () => {
    renderStudy("/student/study?seasonId=season-1&format=Memory");
    expect(await screen.findByRole("heading", { name: "Choose your training" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Learn" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Review" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Rehearse" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Training format" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse the Scripture library" })).toHaveAttribute("href", "/student/study?mode=Library&seasonId=season-1&format=Memory");
    expect(api.startSession).not.toHaveBeenCalled();
  });
  it("defaults the format to PBE for PBE seasons and lets the learner switch to Memory", async () => {
    vi.mocked(api.progress).mockResolvedValue(progress({ seasonStatus: "Active", pbeEnabled: true }));
    renderStudy("/student/study?seasonId=season-1");
    expect(await screen.findByRole("button", { name: /PBE.*Season default/ })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Memory" }));
    expect(screen.getByRole("button", { name: "Memory" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("start-learn")).toHaveAttribute("href", expect.stringContaining("format=Memory"));
  });
  it("the Review card follows the format toggle: PBE counts due PBE questions, Memory counts due passages", async () => {
    vi.mocked(api.progress).mockResolvedValue(progress({ seasonStatus: "Active", pbeEnabled: true, reviewDueCount: 3 }));
    vi.mocked(trainingApi.today).mockResolvedValue({ ...(today() as Record<string, unknown>), format: "Pbe", pbeReviewDueCount: 2 } as never);
    renderStudy("/student/study?seasonId=season-1");
    // Season default is PBE: the badge counts due PBE questions (2) — never
    // the Memory mastery count (3) — and the start opens the PBE review.
    const cta = await screen.findByTestId("start-review");
    expect(cta).not.toBeDisabled();
    expect(cta).toHaveAttribute("href", expect.stringContaining("mode=Review"));
    expect(cta).toHaveAttribute("href", expect.stringContaining("format=Pbe"));
    expect(screen.getByText("2 due")).toBeInTheDocument();
    expect(screen.queryByText("3 due")).not.toBeInTheDocument();
    // Switching to Memory swaps the count and the start to the Memory set.
    fireEvent.click(screen.getByRole("button", { name: "Memory" }));
    expect(await screen.findByText("3 due")).toBeInTheDocument();
    expect(screen.getByTestId("start-review")).toHaveAttribute("href", expect.stringContaining("format=Memory"));
    expect(screen.getByTestId("start-learn")).toHaveAttribute("href", expect.stringContaining("format=Memory"));
  });
  it("disables Review with an honest reason when no passages are due", async () => {
    renderStudy("/student/study?seasonId=season-1&format=Memory");
    await screen.findByRole("heading", { name: "Review" });
    const reviewCta = screen.getByTestId("start-review");
    expect(reviewCta).toBeDisabled();
    expect(reviewCta).toHaveAttribute("aria-describedby", "study-blocked-review");
    expect(screen.getByText("Nothing is due for review right now.", { selector: "#study-blocked-review" })).toBeInTheDocument();
    expect(api.startSession).not.toHaveBeenCalled();
  });
  it("enables Review with the due count when passages are due", async () => {
    vi.mocked(api.progress).mockResolvedValue(progress({ seasonStatus: "Active", reviewDueCount: 3 }));
    renderStudy("/student/study?seasonId=season-1&format=Memory");
    const cta = await screen.findByTestId("start-review");
    expect(cta).not.toBeDisabled();
    expect(cta).toHaveAttribute("href", expect.stringContaining("mode=Review"));
    expect(screen.getByText("3 due")).toBeInTheDocument();
  });
  it("shows the streak and XP ticker from the game layer", async () => {
    renderStudy("/student/study?seasonId=season-1&format=Memory");
    expect(await screen.findByTestId("study-ticker-streak")).toHaveTextContent("5");
    expect(screen.getByTestId("study-ticker-xp")).toHaveTextContent("Rank 3");
  });
  it("explains the mode rules without starting a session", async () => {
    renderStudy("/student/study?seasonId=season-1&format=Memory");
    expect(await screen.findByRole("heading", { name: "Choose your training" })).toBeInTheDocument();
    expect(screen.getByText("Competition conditions — no aids, typed answers only. Each answer is checked as you go.")).toBeInTheDocument();
    expect(screen.getByText("Learn your passage with memory games and drills.")).toBeInTheDocument();
    expect(screen.getByText(/See how each mode works in the Help Center/)).toBeInTheDocument();
    expect(screen.getByText("Just read and explore — no session, no score.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See how each mode works in the Help Center" })).toHaveAttribute("href", "/help#wiki-study-and-practice");
  });
  it("starts today's drill from the Learn card in the chosen format", async () => {
    vi.mocked(api.startSession).mockResolvedValue({ id: "session-1", seasonId: "season-1", status: "Active", mode: "Practice", targetCardCount: 8 });
    vi.mocked(api.nextCard).mockResolvedValue({ id: "card-1", sessionId: "session-1", activityType: "MissingWords", prompt: "____", citation: "Daniel 1:1", tokens: [{ index: 2, display: "____", hidden: true }], sequence: 1, total: 8 });
    const router = renderStudy("/student/study?seasonId=season-1&format=Memory");
    fireEvent.click(await screen.findByTestId("start-learn"));
    await waitFor(() => expect(vi.mocked(api.startSession)).toHaveBeenCalledWith("season-1", "Practice", expect.anything()));
    expect(router.state.location.search).toContain("mode=Practice");
  });
  it("renders the Scripture library without starting a training session", () => {
    renderStudy("/student/study?mode=Library&seasonId=season-1");
    expect(screen.getByTestId("library-embed")).toBeInTheDocument();
    expect(api.progress).not.toHaveBeenCalled();
    expect(api.startSession).not.toHaveBeenCalled();
  });
});
describe("StudyPage session framing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.progress).mockResolvedValue(progress({ seasonStatus: "Active", reviewDueCount: 2 }));
    vi.mocked(api.startSession).mockImplementation(async (_seasonId, mode = "Practice") => ({ id: "session-1", seasonId: "season-1", status: "Active", mode, targetCardCount: 8 }));
    vi.mocked(api.nextCard).mockResolvedValue({ id: "card-1", sessionId: "session-1", activityType: "MissingWords", prompt: "____", citation: "Daniel 1:1", tokens: [{ index: 2, display: "____", hidden: true }], sequence: 1, total: 8 });
    vi.mocked(trainingApi.today).mockResolvedValue(today());
    vi.mocked(api.submitAttempt).mockResolvedValue({ attemptId: "attempt-1", isCorrect: true, evaluationResult: "Correct", canonicalAnswer: "answer", citation: "Daniel 1:1", sourceText: "answer", masteryLevel: "Learning", exactWordingScore: 18, skillKey: "exactWording", skillLabel: "Exact wording", skillScore: 18, reviewDueAtUtc: null, alreadyProcessed: false });
  });

  it("frames Learn as coached practice with labeled aids and a single way back", async () => {
    renderStudy("/student/study?mode=Practice");
    await screen.findByRole("heading", { name: "Fill in the Blank" });
    expect(screen.getByText("Learn · coached practice")).toBeInTheDocument();
    expect(screen.getByLabelText("Learning aids")).toBeInTheDocument();
    expect(screen.getByTestId("academy-session-kicker")).toBeInTheDocument();
    // The app frame's breadcrumb provides the one "Back to training" exit;
    // the session header must not duplicate it.
    expect(screen.queryByRole("link", { name: "Back to training" })).not.toBeInTheDocument();
  });

  it("explains why a passage returned for Review with stored history", async () => {
    vi.mocked(api.progress).mockResolvedValue(progress({
      seasonStatus: "Active",
      reviewDueCount: 2,
      mastery: [{ knowledgeUnitId: "ku-1", title: "Daniel 1:1", level: "Learning", exactWordingScore: 72, recognitionScore: 80, reviewDueAtUtc: null }],
      recentAttempts: [{ id: "a-1", title: "Daniel 1:1", activityType: "MissingWords", isCorrect: false, submittedAnswer: "", evaluationResult: "", createdAtUtc: new Date(Date.now() - 86_400_000).toISOString() }],
    }));
    renderStudy("/student/study?mode=Review&format=Memory&seasonId=season-1");
    const banner = await screen.findByTestId("review-return-banner");
    expect(banner).toHaveTextContent("Back for another pass");
    expect(banner).toHaveTextContent("last practiced yesterday");
    expect(banner).toHaveTextContent("last score 72%");
    // The due-position line duplicated the card progress ("1 / 8") and was removed.
    expect(screen.queryByTestId("study-due-label")).not.toBeInTheDocument();
    expect(banner).not.toHaveTextContent("Daniel 1:1");
  });

  it("falls back to an honest due reason when no history matches the passage", async () => {
    renderStudy("/student/study?mode=Review&format=Memory&seasonId=season-1");
    const banner = await screen.findByTestId("review-return-banner");
    expect(banner).toHaveTextContent("due for review");
    expect(banner).not.toHaveTextContent("last practiced");
  });

  it("frames Simulation as challenge mode without learning aids", async () => {
    renderStudy("/student/study?mode=Simulation");
    await screen.findByTestId("exam-mode-banner");
    expect(screen.getByText("Rehearse · challenge mode")).toBeInTheDocument();
    expect(screen.getByTestId("exam-mode-banner")).toHaveTextContent("Typed answers only");
    expect(screen.queryByLabelText("Learning aids")).not.toBeInTheDocument();
  });

  it("labels feedback as assisted only when the reader was opened", async () => {
    renderStudy("/student/study?mode=Practice");
    const answer = await screen.findByRole("textbox", { name: "Blank 1 of 1" });
    fireEvent.change(answer, { target: { value: "Daniel" } });
    fireEvent.click(screen.getByRole("button", { name: "Read passage" }));
    fireEvent.click(screen.getByRole("button", { name: "Check answer" }));
    await screen.findByTestId("challenge-feedback");
    expect(screen.getByTestId("assistance-note")).toHaveTextContent("You opened the reader on this one");
  });

  it("labels feedback as unaided when the reader stayed closed", async () => {
    renderStudy("/student/study?mode=Practice");
    const answer = await screen.findByRole("textbox", { name: "Blank 1 of 1" });
    fireEvent.change(answer, { target: { value: "Daniel" } });
    fireEvent.click(screen.getByRole("button", { name: "Check answer" }));
    await screen.findByTestId("challenge-feedback");
    expect(screen.getByTestId("assistance-note")).toHaveTextContent("You did this one from memory");
  });
});

describe("StudyPage word-level answer diff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.progress).mockResolvedValue(progress({ seasonStatus: "Active" }));
    vi.mocked(trainingApi.today).mockResolvedValue(today());
    vi.mocked(api.startSession).mockResolvedValue({ id: "session-1", seasonId: "season-1", status: "Created", mode: "Practice", targetCardCount: 8 });
    vi.mocked(api.nextCard).mockResolvedValue({
      id: "card-wcn", sessionId: "session-1", activityType: "WhatComesNext",
      prompt: "What comes next after Mark 1:4? Write the full next verse.",
      citation: "Mark 1:5", tokens: [], sequence: 1, total: 8,
    });
  });

  it("highlights the missed word in the correct verse and explains it in words", async () => {
    vi.mocked(api.submitAttempt).mockResolvedValue({
      attemptId: "a1", isCorrect: false, score: 82, evaluationResult: "Partial",
      canonicalAnswer: "went out to him and were baptized",
      citation: "Mark 1:5", sourceText: "went out to him and were baptized",
      submittedAnswer: "went to him and were baptized",
      masteryLevel: "Learning", exactWordingScore: 10, skillKey: "sequence", skillLabel: "Sequence", skillScore: 82,
      reviewDueAtUtc: "2026-11-22T00:00:00.000Z", alreadyProcessed: false,
    });
    renderStudy("/student/study?mode=Practice&seasonId=season-1");
    fireEvent.change(await screen.findByRole("textbox", { name: "Type the next verse" }), { target: { value: "went to him and were baptized" } });
    fireEvent.click(screen.getByTestId("submit-answer"));
    const diff = await screen.findByTestId("answer-diff");
    const missed = diff.querySelector(".diff-missed");
    expect(missed?.textContent).toBe("out");
    expect(diff.querySelectorAll(".diff-extra")).toHaveLength(0);
    expect(screen.getByTestId("answer-diff-summary")).toHaveTextContent("1 missed word is underlined");
    // The highlighted verse replaces the plain correct-text block.
    expect(screen.getByTestId("feedback-source").querySelector(".diff-missed")?.textContent).toBe("out");
  });

  it("calls out a spelling slip by name instead of missed+extra", async () => {
    vi.mocked(api.submitAttempt).mockResolvedValue({
      attemptId: "a2", isCorrect: false, score: 90, evaluationResult: "Partial",
      canonicalAnswer: "went out to him and were baptized",
      citation: "Mark 1:5", sourceText: "went out to him and were baptized",
      submittedAnswer: "went out to him and were baptised",
      masteryLevel: "Learning", exactWordingScore: 10, skillKey: "sequence", skillLabel: "Sequence", skillScore: 90,
      reviewDueAtUtc: "2026-11-22T00:00:00.000Z", alreadyProcessed: false,
    });
    renderStudy("/student/study?mode=Practice&seasonId=season-1");
    fireEvent.change(await screen.findByRole("textbox", { name: "Type the next verse" }), { target: { value: "went out to him and were baptised" } });
    fireEvent.click(screen.getByTestId("submit-answer"));
    const diff = await screen.findByTestId("answer-diff");
    expect(diff.querySelector(".diff-spelling")?.textContent).toBe("baptized");
    expect(diff.querySelectorAll(".diff-missed")).toHaveLength(0);
    expect(screen.getByTestId("answer-diff-summary")).toHaveTextContent("Spelling: you wrote “baptised” for “baptized”");
  });
});

describe("StudyPage activity improvements (Q1-Q4, B1)", () => {
  const blankCard = {
    id: "card-1", sessionId: "session-1", activityType: "MissingWords",
    prompt: "In the beginning ____ created the heaven and the earth.",
    citation: "Genesis 1:1", tokens: [{ index: 2, display: "____", hidden: true }], sequence: 1, total: 8,
  };
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.progress).mockResolvedValue(progress({ seasonStatus: "Active" }));
    vi.mocked(trainingApi.today).mockResolvedValue(today());
    vi.mocked(api.startSession).mockResolvedValue({ id: "session-1", seasonId: "season-1", status: "Created", mode: "Practice", targetCardCount: 8 });
    vi.mocked(api.nextCard).mockResolvedValue(blankCard);
  });

  it("Q2: names the deck shuffle 'Shuffle deck' and explains it as a deck shuffle", async () => {
    vi.mocked(api.shuffleSession).mockResolvedValue({} as never);
    renderStudy("/student/study?mode=Practice&seasonId=season-1");
    await screen.findByRole("textbox", { name: "Blank 1 of 1" });
    const deckButton = screen.getByRole("button", { name: "Shuffle deck" });
    expect(screen.queryByRole("button", { name: "Shuffle" })).not.toBeInTheDocument();
    fireEvent.click(deckButton);
    expect(await screen.findByTestId("shuffle-note")).toHaveTextContent("Deck shuffled — the order of the remaining cards has changed. This card stays as it is.");
  });

  it("Q1: renders the spelling callout and styling for a flagged Fill in the Blank slot", async () => {
    vi.mocked(api.submitAttempt).mockResolvedValue({
      attemptId: "a-q1", isCorrect: false, evaluationResult: "Incorrect", canonicalAnswer: "baptized",
      citation: "Genesis 1:1", sourceText: "In the beginning baptized created the heaven and the earth.",
      masteryLevel: "Learning", exactWordingScore: 0, skillKey: "exactWording", skillLabel: "Exact wording", skillScore: 0,
      reviewDueAtUtc: null, alreadyProcessed: false,
      missingWordAnswers: [{ index: 2, text: "baptised" }],
      missingWordResults: [{ index: 2, isCorrect: false, expected: "baptized", spelling: true }],
    } as never);
    renderStudy("/student/study?mode=Practice&seasonId=season-1");
    fireEvent.change(await screen.findByRole("textbox", { name: "Blank 1 of 1" }), { target: { value: "baptised" } });
    fireEvent.click(screen.getByTestId("submit-answer"));
    await screen.findByTestId("challenge-feedback");
    expect(screen.getByTestId("missing-words-spelling")).toHaveTextContent("Spelling: you wrote “baptised” for “baptized” — a spelling slip, not a wrong word; in PBE a misspelling can still earn credit.");
    expect(screen.getByRole("textbox", { name: "Blank 1 of 1" })).toHaveClass("diff-spelling");
  });

  it("B1: shows the earned XP and session streak in the feedback block", async () => {
    vi.mocked(api.submitAttempt).mockResolvedValue({
      attemptId: "a-b1", isCorrect: true, evaluationResult: "Correct", canonicalAnswer: "God",
      citation: "Genesis 1:1", sourceText: "In the beginning God created the heaven and the earth.",
      masteryLevel: "Learning", exactWordingScore: 18, skillKey: "exactWording", skillLabel: "Exact wording", skillScore: 18,
      reviewDueAtUtc: null, alreadyProcessed: false, xpEarned: 10, sessionStreak: 4,
    } as never);
    renderStudy("/student/study?mode=Practice&seasonId=season-1");
    fireEvent.change(await screen.findByRole("textbox", { name: "Blank 1 of 1" }), { target: { value: "God" } });
    fireEvent.click(screen.getByTestId("submit-answer"));
    await screen.findByTestId("challenge-feedback");
    expect(screen.getByTestId("session-xp-line")).toHaveTextContent("+10 XP · Session streak 4");
  });

  it("B1: hides the streak segment at streak 1 and the whole line for legacy results without xpEarned", async () => {
    vi.mocked(api.submitAttempt).mockResolvedValue({
      attemptId: "a-b1b", isCorrect: true, evaluationResult: "Correct", canonicalAnswer: "God",
      citation: "Genesis 1:1", sourceText: "In the beginning God created the heaven and the earth.",
      masteryLevel: "Learning", exactWordingScore: 18, skillKey: "exactWording", skillLabel: "Exact wording", skillScore: 18,
      reviewDueAtUtc: null, alreadyProcessed: false, xpEarned: 10, sessionStreak: 1,
    } as never);
    renderStudy("/student/study?mode=Practice&seasonId=season-1");
    fireEvent.change(await screen.findByRole("textbox", { name: "Blank 1 of 1" }), { target: { value: "God" } });
    fireEvent.click(screen.getByTestId("submit-answer"));
    await screen.findByTestId("challenge-feedback");
    expect(screen.getByTestId("session-xp-line")).toHaveTextContent("+10 XP");
    expect(screen.getByTestId("session-xp-line")).not.toHaveTextContent("Session streak");
    cleanup();

    vi.mocked(api.submitAttempt).mockResolvedValue({
      attemptId: "a-b1c", isCorrect: true, evaluationResult: "Correct", canonicalAnswer: "God",
      citation: "Genesis 1:1", sourceText: "In the beginning God created the heaven and the earth.",
      masteryLevel: "Learning", exactWordingScore: 18, skillKey: "exactWording", skillLabel: "Exact wording", skillScore: 18,
      reviewDueAtUtc: null, alreadyProcessed: false,
    });
    renderStudy("/student/study?mode=Practice&seasonId=season-1");
    fireEvent.change(await screen.findByRole("textbox", { name: "Blank 1 of 1" }), { target: { value: "God" } });
    fireEvent.click(screen.getByTestId("submit-answer"));
    await screen.findByTestId("challenge-feedback");
    expect(screen.queryByTestId("session-xp-line")).not.toBeInTheDocument();
  });

  it("Q3: offers the recitation comparison only after the card is checked, and renders the diff", async () => {
    vi.mocked(api.submitAttempt).mockResolvedValue({
      attemptId: "a-q3", isCorrect: true, evaluationResult: "Correct", canonicalAnswer: "God",
      citation: "Genesis 1:1", sourceText: "In the beginning God created the heaven and the earth.",
      masteryLevel: "Learning", exactWordingScore: 18, skillKey: "exactWording", skillLabel: "Exact wording", skillScore: 18,
      reviewDueAtUtc: null, alreadyProcessed: false,
    });
    renderStudy("/student/study?mode=Practice&seasonId=season-1");
    const blank = await screen.findByRole("textbox", { name: "Blank 1 of 1" });
    const recitation = screen.getByLabelText("Your private recitation practice");
    fireEvent.change(recitation, { target: { value: "In the beginning God created the heaven" } });
    // Before the check there is no comparison affordance at all.
    expect(screen.queryByRole("button", { name: "Compare your recitation" })).not.toBeInTheDocument();
    fireEvent.change(blank, { target: { value: "God" } });
    fireEvent.click(screen.getByTestId("submit-answer"));
    await screen.findByTestId("challenge-feedback");
    fireEvent.click(screen.getByRole("button", { name: "Compare your recitation" }));
    const compare = await screen.findByTestId("recitation-compare");
    expect(compare.querySelector(".diff-missed")?.textContent).toBe("and");
    expect(screen.getByTestId("recitation-compare-summary")).toHaveTextContent("3 missed words are underlined");
  });

  it("Q4: marks VerseBuilder chunks by placement in the checked feedback", async () => {
    vi.mocked(api.nextCard).mockResolvedValue({
      id: "card-vb", sessionId: "session-1", activityType: "VerseBuilder",
      prompt: "Build the verse in the correct order.", citation: "Genesis 1:1",
      tokens: [
        { index: 0, display: "God created", hidden: false },
        { index: 1, display: "In the beginning", hidden: false },
        { index: 2, display: "the heaven and the earth", hidden: false },
      ],
      sequence: 1, total: 8,
    });
    vi.mocked(api.submitAttempt).mockResolvedValue({
      attemptId: "a-q4", isCorrect: false, evaluationResult: "Partial", canonicalAnswer: "In the beginning God created the heaven and the earth",
      citation: "Genesis 1:1", sourceText: "In the beginning God created the heaven and the earth",
      submittedAnswer: "In the beginning the heaven and the earth God created",
      masteryLevel: "Learning", exactWordingScore: 10, skillKey: "sequence", skillLabel: "Sequence", skillScore: 40,
      reviewDueAtUtc: null, alreadyProcessed: false,
    });
    renderStudy("/student/study?mode=Practice&seasonId=season-1");
    fireEvent.click(await screen.findByRole("button", { name: "Add In the beginning" }));
    fireEvent.click(screen.getByRole("button", { name: "Add the heaven and the earth" }));
    fireEvent.click(screen.getByRole("button", { name: "Add God created" }));
    expect(screen.queryByTestId("chunk-placements")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("submit-answer"));
    await screen.findByTestId("challenge-feedback");
    const items = screen.getAllByTestId("chunk-placement");
    expect(items.map(item => item.getAttribute("data-placement"))).toEqual(["correct-position", "wrong-position", "wrong-position"]);
    expect(items[0]).toHaveTextContent("Right place");
  });
});

describe("StudyPage phone layout (Option D)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(max-width: 760px)", media: query, onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn() }));
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
      tokens: [{ index: 2, display: "____", hidden: true }],
      sequence: 1,
      total: 8,
    });
    vi.mocked(api.progress).mockResolvedValue(progress({ seasonStatus: "Active" }));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("docks check/finish in the bottom action dock and keeps shuffle tools in flow", async () => {
    renderStudy("/student/study?mode=Practice");
    // Wait for the card itself (the action row renders before it loads;
    // Shuffle blanks only exists once the Fill in the Blank card is in).
    const shuffle = await screen.findByTestId("shuffle-blanks");
    const submit = screen.getByTestId("submit-answer");
    const dock = submit.closest(".mobile-action-dock");
    expect(dock).not.toBeNull();
    expect(dock).toHaveAttribute("aria-label", "Session actions");
    expect(screen.getByTestId("complete-session").closest(".mobile-action-dock")).toBe(dock);
    // Secondary practice tools stay in the in-flow row, out of the dock.
    expect(shuffle.closest(".mobile-action-dock")).toBeNull();
    expect(shuffle.closest(".student-study-actions--secondary")).not.toBeNull();
    // The dock mirrors the in-flow button states exactly (no answer yet = enabled for MissingWords).
    expect(submit).not.toBeDisabled();
    expect(screen.getByTestId("complete-session")).toBeDisabled();
  });

  it("marks the live session stage so the tab bar hides and the dock owns the bottom (R1)", async () => {
    renderStudy("/student/study?mode=Practice");
    const submit = await screen.findByTestId("submit-answer");
    const stage = submit.closest(".er-study-stage");
    expect(stage).toHaveAttribute("data-session-active", "true");
    // The dock lives inside the marked stage, so the :has() chrome rules
    // engage for exactly the session's lifetime.
    expect(submit.closest(".mobile-action-dock")?.closest(".er-study-stage")).toBe(stage);
  });
});

describe("session chrome CSS pins (R1)", () => {
  it("hides the tab bar in-session, re-anchors the dock to the true bottom, and shrinks the shell padding", async () => {
    const nodeFs = "node:" + "fs";
    const { readFileSync } = (await import(/* @vite-ignore */ nodeFs)) as { readFileSync(path: string, encoding: string): string };
    const cwd = (globalThis as { process?: { cwd(): string } }).process?.cwd() ?? ".";
    const css = readFileSync(`${cwd}/src/styles/command-center.css`, "utf8");
    expect(css).toContain('.command-app:has(.er-study-stage[data-session-active="true"]) .command-bottom-nav { display:none; }');
    expect(css).toContain('.er-study-stage[data-session-active="true"] .mobile-action-dock { bottom:0; padding-bottom:calc(var(--er-space-2) + env(safe-area-inset-bottom,0px)); }');
    expect(css).toContain('.command-app.training-app:has(.er-study-stage[data-session-active="true"]) { padding-bottom:calc(72px + env(safe-area-inset-bottom,0px)); }');
  });
});
