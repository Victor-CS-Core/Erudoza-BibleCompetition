import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { practiceApi } from "../../api/practice";
import { PracticePage } from "./PracticePage";

vi.mock("../../api/practice", () => ({ practiceApi: { bootstrap: vi.fn(), create: vi.fn(), accept: vi.fn() } }));
vi.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ me: { userId: "player", organizationId: "org", kind: "Student" } }) }));
const data = { enabled: true, seasons: [{ id: "season", name: "Daniel" }], players: [], rooms: [], invitations: [], achievements: [], questions: [] };
function mount() { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><PracticePage /></MemoryRouter></QueryClientProvider>); }
beforeEach(() => { HTMLDialogElement.prototype.showModal=function(){this.setAttribute("open","");};HTMLDialogElement.prototype.close=function(){this.removeAttribute("open");};vi.clearAllMocks(); vi.mocked(practiceApi.bootstrap).mockResolvedValue(data); });
afterEach(cleanup);
describe("Team Practice entry", () => {
  it("shows evidence-backed empty states and the speed adaptation", async () => {
    mount();
    expect(await screen.findByText("No rooms yet. Create a room or accept an invitation.")).toBeInTheDocument();
    expect(screen.getByText(/Arcade adds up to 25% as a speed bonus/)).toBeInTheDocument();
    expect(screen.queryByText("First Fellowship")).not.toBeInTheDocument();
  });
  it("creates selected 5v5 room without client timing fields", async () => {
    vi.mocked(practiceApi.create).mockResolvedValue({ id: "room" } as Awaited<ReturnType<typeof practiceApi.create>>);
    mount(); fireEvent.click(await screen.findByRole("button",{name:"Set up PVP"})); await screen.findByText("Create a room");
    fireEvent.change(screen.getByLabelText("Team size"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Create room" }));
    await waitFor(() => expect(practiceApi.create).toHaveBeenCalledWith("org", { seasonId: "season", teamSize: 5, questionCount: 10, coached: false, bookKey: undefined }));
  });
  it("does not expose creation when pilot disabled", async () => {
    vi.mocked(practiceApi.bootstrap).mockResolvedValue({ ...data, enabled: false });
    mount();
    expect(await screen.findByText("Team Practice is not enabled")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create room" })).not.toBeInTheDocument();
  });
  it("restricts direct invitations to their intended team", async () => {
    vi.mocked(practiceApi.bootstrap).mockResolvedValue({ ...data, invitations: [{ id: "invite", roomId: "room", inviterName: "Ana", team: 2, expiresAt: "2026-09-11T12:00:00Z" }] });
    mount();
    expect(await screen.findByRole("button", { name: "Join Team 2" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Join Team 1" })).not.toBeInTheDocument();
  });
});
