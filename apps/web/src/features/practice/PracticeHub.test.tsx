import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { practiceApi, type PracticeBootstrap, type PracticeRoom } from "../../api/practice";
import { PracticeHub } from "./PracticeHub";
import { useMyProfile } from "../profile/profile";

vi.mock("../profile/profile", () => ({ useMyProfile: vi.fn() }));
const account = vi.hoisted(() => ({ userId: "player", organizationId: "org", kind: "Student" }));
vi.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ me: account }) }));
vi.mock("../../api/practice", () => ({ practiceApi: { bootstrap: vi.fn(), create: vi.fn(), accept: vi.fn(), enabled: vi.fn(), simulationMaterial:vi.fn(), simulationAvailability:vi.fn() } }));
vi.mock("../../api/client", () => ({ api: { library: vi.fn(), seasonScope: vi.fn(), contentPacks: vi.fn(), sourceUnits: vi.fn() } }));

const data: PracticeBootstrap = {
  enabled: true, seasons: [{ id: "daniel", name: "Daniel 2026" }, { id: "luke", name: "Luke 2026" }],
  players: [], rooms: [], invitations: [], achievements: [], questions: [], trends: [],
};
const destinationRoom = { id: "created-room" } as PracticeRoom;
function Destination() { return <output aria-label="Current destination">{useLocation().pathname}</output>; }
function mount(path = account.kind === "Adult" ? "/admin/practice" : "/student/practice") {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return { cache, ...render(<QueryClientProvider client={cache}><MemoryRouter initialEntries={[path]}><PracticeHub /><Destination /></MemoryRouter></QueryClientProvider>) };
}
beforeEach(() => {
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
  HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
  vi.mocked(practiceApi.simulationMaterial).mockResolvedValue({seasonId:'daniel',translation:'NKJV',books:[{key:'DAN',label:'Daniel',chapters:[1,2]}],introductionsAvailable:true});
  vi.mocked(practiceApi.simulationAvailability).mockResolvedValue({eligibleQuestions:100,requestedQuestions:90,canStart:true,reason:null});
  account.kind = "Student";
  vi.mocked(useMyProfile).mockReturnValue({ data: { userId: "player", displayName: "Player", avatarHonorKey: null, honors: [] }, isPending: false, isError: false, isSuccess: true, refetch: vi.fn() } as unknown as ReturnType<typeof useMyProfile>);
  vi.mocked(practiceApi.bootstrap).mockResolvedValue(data);
  vi.mocked(practiceApi.create).mockResolvedValue(destinationRoom);
  vi.mocked(practiceApi.accept).mockResolvedValue({ ...destinationRoom, id: "invited-room" });
  vi.mocked(practiceApi.enabled).mockResolvedValue();
  vi.mocked(api.library).mockResolvedValue({ translationId: "nkjv", translationName: "NKJV", version: 1, books: [] });
  vi.mocked(api.seasonScope).mockResolvedValue({ contentPackId: null, includes: [], excludes: [] });
  vi.mocked(api.contentPacks).mockResolvedValue([]);
  vi.mocked(api.sourceUnits).mockResolvedValue([]);
});
afterEach(cleanup);

describe("Team Practice hub", () => {
  it("creates an enabled independent six-student rehearsal without inventing an opponent", async () => {
    vi.mocked(practiceApi.bootstrap).mockResolvedValue({...data,seasons:[{id:"daniel",name:"Daniel",pbeEnabled:true}]});
    vi.mocked(practiceApi.simulationAvailability).mockResolvedValue({eligibleQuestions:0,requestedQuestions:90,canStart:false,reason:'Invite your assigned team'});
    mount();fireEvent.click(await screen.findByRole('button',{name:'Set up simulation'}));
    fireEvent.click(await screen.findByRole('button',{name:'Save setup'}));
    await waitFor(()=>expect(practiceApi.create).toHaveBeenCalledWith("org",expect.objectContaining({seasonId:"daniel",format:"Pbe",teamCount:1,teamSize:6,questionCount:90,coached:false,simulation:expect.objectContaining({version:1,preset:'FullEvent',bookKeys:['DAN']})})));
  });

  it("prioritizes a playing room using only returned room evidence", async () => {
    vi.mocked(practiceApi.bootstrap).mockResolvedValue({ ...data, rooms: [
      { id: "lobby", seasonId: "daniel", status: "Lobby", teamSize: 5, questionCount: 30, coached: true, ownerId: "other", memberCount: 3 },
      { id: "live", seasonId: "luke", status: "Playing", teamSize: 2, questionCount: 10, coached: false, ownerId: "player", memberCount: 4 },
    ] });
    mount();
    const current = await screen.findByRole("region", { name: "Current room" });
    expect(within(current).getByRole("link", { name: "Return to match" })).toHaveAttribute("href", "/student/practice/live?seasonId=luke");
    expect(within(current).getByText(/Luke 2026/)).toBeInTheDocument();
    expect(within(current).getByText(/4 players/)).toBeInTheDocument();
    expect(within(current).queryByText(/players ready|of .* ready/)).not.toBeInTheDocument();
  });

  it("does not manufacture an active room or earned honors from empty history", async () => {
    mount();
    expect(await screen.findByText("No rooms yet. Create a room or accept an invitation.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Current room" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Open lobby|Return to match|View results/ })).not.toBeInTheDocument();
    expect(screen.queryByText("First Fellowship")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Set up PVP" })).toBeEnabled();
  });

  it("preserves all create parameters and navigates a Coach to the created room", async () => {
    account.kind = "Adult";
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Set up PVP" })); await screen.findByRole("button", { name: "Create room" });
    fireEvent.change(screen.getByLabelText("Season", { exact: true }), { target: { value: "luke" } });
    fireEvent.change(screen.getByLabelText("Team size"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Match length"), { target: { value: "90" } });
    fireEvent.change(screen.getByLabelText("Format"), { target: { value: "true" } });
    fireEvent.change(screen.getByLabelText("Book scope (optional)"), { target: { value: " LUK " } });
    fireEvent.click(screen.getByRole("button", { name: "Create room" }));
    await waitFor(() => expect(practiceApi.create).toHaveBeenCalledWith("org", { seasonId: "luke", teamSize: 5, questionCount: 90, coached: true, bookKey: "LUK" }));
    expect(await screen.findByText("/admin/practice/created-room")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Coach question bank" })).toBeInTheDocument();
  });

  it("limits students to independent play while retaining every supported size and length", async () => {
    mount(); fireEvent.click(await screen.findByRole("button", { name: "Set up PVP" })); await screen.findByRole("button", { name: "Create room" });
    expect(within(screen.getByLabelText("Format")).getAllByRole("option")).toHaveLength(1);
    expect(screen.queryByRole("option", { name: /Coach-led/ })).not.toBeInTheDocument();
    expect(within(screen.getByLabelText("Team size")).getAllByRole("option").map(option => option.getAttribute("value"))).toEqual(["1", "2", "3", "4", "5"]);
    expect(within(screen.getByLabelText("Match length")).getAllByRole("option").map(option => option.getAttribute("value"))).toEqual(["10", "30", "90"]);
    fireEvent.click(screen.getByRole("button", { name: "Create room" }));
    await waitFor(() => expect(practiceApi.create).toHaveBeenCalledWith("org", { seasonId: "daniel", teamSize: 1, questionCount: 10, coached: false, bookKey: undefined }));
    expect(await screen.findByText("/student/practice/created-room")).toBeInTheDocument();
  });

  it("accepts a team-specific invitation only for its destination team", async () => {
    vi.mocked(practiceApi.bootstrap).mockResolvedValue({ ...data, invitations: [{ id: "invite", roomId: "invited-room", team: 2, inviterName: "Ana", expiresAt: "2026-10-01T12:00:00Z" }] });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Join Team 2" }));
    expect(screen.queryByRole("button", { name: "Join Team 1" })).not.toBeInTheDocument();
    await waitFor(() => expect(practiceApi.accept).toHaveBeenCalledWith("org", "invite", 2));
    expect(await screen.findByText("/student/practice/invited-room")).toBeInTheDocument();
  });

  it("lets an unrestricted invitation choose either team and keeps failures recoverable", async () => {
    vi.mocked(practiceApi.bootstrap).mockResolvedValue({ ...data, invitations: [{ id: "invite", roomId: "invited-room", inviterName: "Ana", expiresAt: "2026-10-01T12:00:00Z" }] });
    vi.mocked(practiceApi.accept).mockRejectedValueOnce(new Error("Team 1 is full."));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Join Team 1" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Team 1 is full.");
    fireEvent.click(screen.getByRole("button", { name: "Join Team 2" }));
    await waitFor(() => expect(practiceApi.accept).toHaveBeenLastCalledWith("org", "invite", 2));
    expect(await screen.findByText("/student/practice/invited-room")).toBeInTheDocument();
  });

  it("offers only Team 1 for an unrestricted one-team invitation", async () => {
    vi.mocked(practiceApi.bootstrap).mockResolvedValue({ ...data, invitations: [{ id: "invite", roomId: "invited-room", teamCount: 1, inviterName: "Ana", expiresAt: "2026-10-01T12:00:00Z" }] });
    mount();
    expect(await screen.findByRole("button", { name: "Join Team 1" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Join Team 2" })).not.toBeInTheDocument();
  });

  it("prevents room creation without an active season", async () => {
    vi.mocked(practiceApi.bootstrap).mockResolvedValue({ ...data, seasons: [] });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Set up PVP" })); expect(await screen.findByRole("button", { name: "Create room" })).toBeDisabled();
    expect(screen.getByLabelText("Season", { exact: true })).toBeDisabled();
    expect(practiceApi.create).not.toHaveBeenCalled();
  });

  it("keeps disabled practice unavailable to a student", async () => {
    vi.mocked(practiceApi.bootstrap).mockResolvedValue({ ...data, enabled: false });
    mount();
    await screen.findByText("Team Practice is not enabled");
    expect(screen.getByText("Ask your coach to enable Team Practice for your club.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create room" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enable Team Practice" })).not.toBeInTheDocument();
  });

  it("tells a coach to enable Team Practice instead of asking them to ask their coach", async () => {
    account.kind = "Adult";
    vi.mocked(practiceApi.bootstrap).mockResolvedValue({ ...data, enabled: false });
    mount();
    await screen.findByText("Team Practice is not enabled");
    expect(screen.getByText("Enable Team Practice below to run rooms, simulations, and answer reviews for your club.")).toBeInTheDocument();
    expect(screen.queryByText("Ask your coach to enable Team Practice for your club.")).not.toBeInTheDocument();
  });

  it("lets a Coach enable practice and refresh the available setup", async () => {
    account.kind = "Adult";
    vi.mocked(practiceApi.bootstrap).mockResolvedValueOnce({ ...data, enabled: false }).mockResolvedValue(data);
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Enable Team Practice" }));
    expect(await screen.findByRole("button", { name: "Set up PVP" })).toBeEnabled();
    expect(practiceApi.enabled).toHaveBeenCalledWith("org", true);
  });

  it("retries unavailable bootstrap data without exposing sample rooms", async () => {
    vi.mocked(practiceApi.bootstrap).mockRejectedValueOnce(new Error("Practice is offline.")).mockResolvedValue(data);
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("Practice is offline.");
    expect(screen.queryByRole("link", { name: "Open room" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("button", { name: "Set up PVP" })).toBeEnabled();
  });

  it("preserves historical milestones and the returned participant-scoped trend", async () => {
    account.kind = "Adult";
    vi.mocked(practiceApi.bootstrap).mockResolvedValue({ ...data,
      achievements: [{ key: "first-fellowship", title: "First Fellowship", seasonId: "daniel" }],
      trends: [{ seasonId: "daniel", teamSize: 3, bookKey: "DAN", ruleVersion: "v1", matches: 2, wins: 1, draws: 0, accuracyHundredths: 1750, availableHundredths: 2000, speedHundredths: 250, unansweredQuestions: 1, averageResponseMs: 12300, distinctQuestions: 10, distinctPassages: 8, participatedQuestions: 6 }],
    });
    mount();
    await screen.findByRole("heading", { name: "Team Honors" });
    fireEvent.click(screen.getByText("Practice milestones", { selector: "summary" }));
    expect(screen.getByText("First Fellowship")).toBeInTheDocument();
    expect(screen.getByText("Milestone recorded")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Use First Fellowship as profile image" })).not.toBeInTheDocument();
    expect(screen.queryByText("Team Steady")).not.toBeInTheDocument();
    const progress = screen.getByRole("region", { name: "Team practice progress" });
    expect(within(progress).getByText("88%")).toBeInTheDocument();
    expect(within(progress).getByText("2.50")).toBeInTheDocument();
    expect(within(progress).getByText("12.3s")).toBeInTheDocument();
    expect(within(progress).getByText(/6 questions with your participation/)).toBeInTheDocument();
  });
});

it("shows only mastery-qualified Team Honor profile choices", async () => {
  vi.mocked(useMyProfile).mockReturnValue({ data: { userId: "player", displayName: "Player", avatarHonorKey: null, honors: [
    { key: "team:first-fellowship", title: "First Fellowship", category: "Team Practice", requirement: "90% personal accuracy across 10 distinct manual answers.", ruleVersion: "mastery-v1", earnedAtUtc: null },
    { key: "team:team-precision", title: "Team Precision", category: "Team Practice", requirement: "95% team accuracy across 50 questions plus personal mastery.", ruleVersion: "mastery-v1", earnedAtUtc: "2026-09-11T12:00:00Z" },
    { key: "solo:exact-recall", title: "Exact Recall", category: "Scripture", requirement: "12 passages at 90.", ruleVersion: "mastery-v1", earnedAtUtc: "2026-09-11T12:00:00Z" },
  ] }, isPending: false, isError: false, isSuccess: true, refetch: vi.fn() } as unknown as ReturnType<typeof useMyProfile>);
  mount(); await screen.findByRole("heading", { name: "Team Honors" });
  expect(screen.getByRole("link", { name: "Use Team Precision as profile image" })).toHaveAttribute("href", "/student/profile");
  expect(screen.queryByRole("link", { name: "Use First Fellowship as profile image" })).not.toBeInTheDocument();
  expect(screen.queryByText("Exact Recall")).not.toBeInTheDocument();
  expect(screen.getByText("90% personal accuracy across 10 distinct manual answers.")).toBeInTheDocument();
});

it("renders player controls for an Adult in Student mode", async () => {
 account.kind = "Adult";
 mount("/student/practice");
 expect(await screen.findByRole("button", { name: "Set up PVP" })).toBeEnabled();
 expect(screen.queryByText("Question bank")).not.toBeInTheDocument();
});
it("starts room setup with the season carried from Student mode", async () => {
 account.kind = "Adult";
 mount("/student/practice?seasonId=luke");
 fireEvent.click(await screen.findByRole("button",{name:"Set up PVP"}));
 expect(await screen.findByLabelText("Season")).toHaveValue("luke");
 fireEvent.click(screen.getByRole("button", { name: "Create room" }));
 await waitFor(() => expect(practiceApi.create).toHaveBeenCalledWith("org", expect.objectContaining({ seasonId: "luke", coached: false })));
});
it("shows PBE pending counts beside finalized team accuracy and links the coach review queue", async () => {
 account.kind = "Adult";
 vi.mocked(practiceApi.bootstrap).mockResolvedValue({...data,trends:[{format:"Pbe",teamCount:1,seasonId:"daniel",teamSize:6,bookKey:null,ruleVersion:"pbe-v1",scoringVersion:"pbe-score-v1",matches:1,wins:0,draws:0,accuracyHundredths:5800,availableHundredths:5800,speedHundredths:0,unansweredQuestions:0,averageResponseMs:1000,distinctQuestions:29,distinctPassages:1,participatedQuestions:30,pendingCount:1,provisional:true}]});
 mount();expect(await screen.findByText(/1 answer awaiting review/)).toBeVisible();expect(screen.getByText("Finalized accuracy")).toBeVisible();expect(screen.getByRole("link",{name:"Open PBE answer reviews"})).toHaveAttribute("href","/admin/practice/reviews");
});

it("keeps Solo answer reviews reachable when Team Practice is disabled", async () => {
 account.kind = "Adult";vi.mocked(practiceApi.bootstrap).mockResolvedValue({...data,enabled:false});mount();expect(await screen.findByRole("link",{name:"Open PBE answer reviews"})).toHaveAttribute("href","/admin/practice/reviews");
});

it('keeps setup behind explicit mode actions and puts rooms in the hub',async()=>{mount();await screen.findByRole('button',{name:'Set up PVP'});expect(screen.queryByRole('form',{name:'Create room'})).not.toBeInTheDocument();expect(screen.getByRole('heading',{name:'Your rooms'})).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Set up PVP'}));expect(screen.getByRole('dialog',{name:'PVP setup'})).toBeInTheDocument();});

it('opens setup from existing create-room anchors',async()=>{mount('/student/practice?seasonId=luke#create-room');expect(await screen.findByRole('dialog',{name:'PVP setup'})).toBeInTheDocument();expect(screen.getByLabelText('Season',{exact:true})).toHaveValue('luke');});
it('creates PBE head-to-head with two teams and the chosen settings',async()=>{vi.mocked(practiceApi.bootstrap).mockResolvedValue({...data,seasons:[{id:'daniel',name:'Daniel',pbeEnabled:true}]});mount();fireEvent.click(await screen.findByRole('button',{name:'Set up PVP'}));fireEvent.change(screen.getByLabelText('Practice mode'),{target:{value:'Pbe'}});fireEvent.change(screen.getByLabelText('Match length'),{target:{value:'30'}});fireEvent.change(screen.getByLabelText('Team size'),{target:{value:'4'}});fireEvent.click(screen.getByRole('button',{name:'Create room'}));await waitFor(()=>expect(practiceApi.create).toHaveBeenCalledWith('org',expect.objectContaining({format:'Pbe',teamCount:2,teamSize:4,questionCount:30})));expect(screen.queryByRole('dialog',{name:'Simulation menu'})).not.toBeInTheDocument();});
it('keeps coach practice setup on supported PVP and review routes',async()=>{
 account.kind='Adult';vi.mocked(practiceApi.bootstrap).mockResolvedValue({...data,seasons:[{id:'daniel',name:'Daniel',pbeEnabled:true}]});
 mount('/admin/practice');await screen.findByRole('button',{name:'Set up PVP'});
 expect(screen.queryByRole('button',{name:'Set up simulation'})).not.toBeInTheDocument();
 expect(screen.getByRole('link',{name:'Open PBE answer reviews'})).toBeInTheDocument();
});
