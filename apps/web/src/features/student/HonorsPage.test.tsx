import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { trainingApi } from "../../api/training";
import { useMyProfile, type MyProfile } from "../profile/profile";
import { HonorsPage } from "./HonorsPage";
import { honorFixture } from "./trainingFixtures";
vi.mock("../../api/client", () => ({ api: { assignedSeasons: vi.fn() } }));
vi.mock("../../api/training", () => ({ trainingApi: { honors: vi.fn() } }));
vi.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ me: { organizationId: "org", userId: "student" } }) }));
vi.mock("../profile/profile", () => ({ useMyProfile: vi.fn() }));
const profile: MyProfile = { userId: "student", displayName: "Anna", avatarHonorKey: null, honors: [
  { key: "solo:exact-recall", title: "Exact Recall", category: "Scripture", requirement: "Exact wording score of at least 90 on 12 distinct assigned passages.", ruleVersion: "mastery-v1", earnedAtUtc: null },
  { key: "solo:reference-ready", title: "Reference Ready", category: "Scripture", requirement: "Reference score of at least 90 on 20 distinct assigned passages.", ruleVersion: "mastery-v1", earnedAtUtc: "2026-09-11T10:00:00Z" },
  { key: "team:team-precision", title: "Team Precision", category: "Team Practice", requirement: "At least 95% team accuracy across 50 distinct questions and 15 passages, plus 90% personal accuracy across 10 manual answers.", ruleVersion: "mastery-v1", earnedAtUtc: null },
] };
function profileResult(overrides: object = {}) { return { data: profile, isPending: false, isError: false, isSuccess: true, refetch: vi.fn(), ...overrides } as unknown as ReturnType<typeof useMyProfile>; }
function page() { render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><HonorsPage /></MemoryRouter></QueryClientProvider>); }
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  vi.mocked(useMyProfile).mockReturnValue(profileResult());
  vi.mocked(api.assignedSeasons).mockResolvedValue([{ id: "s", name: "Daniel" }]);
  vi.mocked(trainingApi.honors).mockResolvedValue([honorFixture()]);
});
it("shows mastery requirements and only earned profile choices, independently of assignments", async () => {
  vi.mocked(api.assignedSeasons).mockResolvedValue([]); page();
  expect(screen.getByText("1 Honor earned")).toBeInTheDocument();
  expect(screen.getByText(profile.honors[0].requirement)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Use Reference Ready as profile image" })).toHaveAttribute("href", "/student/profile");
  expect(screen.queryByRole("link", { name: "Use Exact Recall as profile image" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "View Exact Recall requirements" }));
  expect(screen.getByRole("dialog")).toHaveTextContent("This patch is locked");
  expect(within(screen.getByRole("dialog")).queryByRole("link", { name: "Use as profile image" })).not.toBeInTheDocument();
});
it("combines category and earned/locked filters without promoting milestone awards", async () => {
  vi.mocked(trainingApi.honors).mockResolvedValue([honorFixture({ earnedAtUtc: "2026-09-10T12:00:00Z" })]); page();
  fireEvent.change(screen.getByLabelText("Honor category"), { target: { value: "Team Practice" } });
  expect(screen.getByRole("button", { name: "View Team Precision requirements" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "View Reference Ready requirements" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Earned" }));
  expect(screen.getByText("No earned Honors yet")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Locked" }));
  expect(screen.getByRole("button", { name: "View Team Precision requirements" })).toBeInTheDocument();
});
it("preserves the original milestone progress and Advanced requirement inside history", async () => {
  page(); fireEvent.click(screen.getByText("Practice milestones", { selector: "summary" }));
  expect(await screen.findByText("4 / 5")).toBeInTheDocument();
  expect(screen.getByText("Advanced practice: reach 80 in exact wording across 5 passages.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "View Exact Recall milestone details" }));
  expect(screen.getByRole("dialog")).toHaveTextContent("Requires Advanced practice; Foundation and Standard wording scores are capped at 40 and 70.");
  expect(within(screen.getByRole("dialog")).queryByRole("link", { name: /profile image/ })).not.toBeInTheDocument();
});
it("preserves milestone earning date, scope and evidence-session route", async () => {
  vi.mocked(trainingApi.honors).mockResolvedValue([honorFixture({ earnedAtUtc: "2026-09-10T12:00:00Z", evidenceSessionId: "saved" })]); page();
  fireEvent.click(screen.getByText("Practice milestones", { selector: "summary" }));
  fireEvent.click(await screen.findByRole("button", { name: "View Exact Recall milestone details" }));
  expect(screen.getByRole("dialog")).toHaveTextContent("saved historical evidence");
  expect(screen.getByRole("dialog")).toHaveTextContent("Daniel assigned scope");
  expect(screen.getByRole("link", { name: "View evidence session" })).toHaveAttribute("href", "/student/sessions/saved/recap?seasonId=s");
});
it("keeps mastery failure recoverable without rendering an empty or unlocked collection", () => {
  const refetch=vi.fn(); vi.mocked(useMyProfile).mockReturnValue(profileResult({ data: undefined, isError: true, isSuccess: false, refetch })); page();
  expect(screen.getByRole("alert")).toHaveTextContent("Honors could not load");
  fireEvent.click(screen.getByRole("button", { name: "Try again" })); expect(refetch).toHaveBeenCalledOnce();
  expect(screen.queryByRole("link", { name: /as profile image/ })).not.toBeInTheDocument();
});
it("shows a milestone error independently of the mastery collection", async () => {
  vi.mocked(trainingApi.honors).mockRejectedValue(new Error("offline")); page();
  fireEvent.click(screen.getByText("Practice milestones", { selector: "summary" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Practice milestones could not load");
  expect(screen.getByRole("link", { name: "Use Reference Ready as profile image" })).toBeInTheDocument();
});
