import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import type { ChapterPage } from "../../api/pbeTypes";
import { trainingApi } from "../../api/training";
import { useMyProfile, type MyProfile } from "../profile/profile";
import { HonorsPage } from "./HonorsPage";
import { honorFixture } from "./trainingFixtures";
vi.mock("../../api/client", () => ({ api: { assignedSeasons: vi.fn() } }));
vi.mock("../../api/training", () => ({ trainingApi: { honors: vi.fn(), chapters: vi.fn() } }));
vi.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ me: { organizationId: "org", userId: "student" } }) }));
vi.mock("../profile/profile", () => ({ useMyProfile: vi.fn() }));
const profile: MyProfile = { userId: "student", displayName: "Anna", avatarHonorKey: null, honors: [
  { key: "solo:exact-recall", title: "Exact Recall", category: "Scripture", requirement: "Exact wording score of at least 90 on 12 distinct assigned passages.", ruleVersion: "mastery-v1", earnedAtUtc: null },
  { key: "solo:reference-ready", title: "Reference Ready", category: "Scripture", requirement: "Reference score of at least 90 on 20 distinct assigned passages.", ruleVersion: "mastery-v1", earnedAtUtc: "2026-09-11T10:00:00Z" },
  { key: "team:team-precision", title: "Team Precision", category: "Team Practice", requirement: "At least 95% team accuracy across 50 distinct questions and 15 passages, plus 90% personal accuracy across 10 manual answers.", ruleVersion: "mastery-v1", earnedAtUtc: null },
] };
function profileResult(overrides: object = {}) { return { data: profile, isPending: false, isError: false, isSuccess: true, refetch: vi.fn(), ...overrides } as unknown as ReturnType<typeof useMyProfile>; }
function page() { render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><HonorsPage /></MemoryRouter></QueryClientProvider>); }
function stampPage(matchesCurrentScope: boolean | null): ChapterPage {
  return { seasonId: 's', ruleVersion: 'r', scopeVersion: matchesCurrentScope === null ? null : 'v', snapshotId: matchesCurrentScope === null ? null : 'snap', chapterKey: null, work: { id: null, state: 'Complete', stage: null, reason: null }, currentAvailable: true, historyAvailable: true, asOfUtc: '2026-09-12T00:00:00Z', dueRefreshAtUtc: '2099-09-12T00:00:00Z', nextCursor: null, view: 'Stamps', items: [{ stampId: 'stamp-1', chapterKey: 'chapter:pack:Daniel:1', kind: 'Chapter', label: 'Assigned passages retained', scopeLabel: 'Daniel 1:1–3', scopeVersion: 'v', ruleVersion: 'r', earnedAtUtc: '2026-09-10T12:00:00Z', matchesCurrentScope }] };
}
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  vi.mocked(useMyProfile).mockReturnValue(profileResult());
  vi.mocked(api.assignedSeasons).mockResolvedValue([{ id: "s", name: "Daniel" }]);
  vi.mocked(trainingApi.honors).mockResolvedValue([honorFixture()]);
  vi.mocked(trainingApi.chapters).mockResolvedValue(stampPage(false));
});
it("shows mastery requirements and only earned profile choices, independently of assignments", async () => {
  vi.mocked(api.assignedSeasons).mockResolvedValue([]); page();
  expect(screen.getByText("1 Honor earned")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Reference Ready: view details" }));
  const earnedDialog = screen.getByRole("dialog");
  expect(within(earnedDialog).getByText(profile.honors[1].requirement)).toBeInTheDocument();
  expect(within(earnedDialog).getByRole("link", { name: "Use Reference Ready as profile image" })).toHaveAttribute("href", "/student/profile");
  fireEvent.click(within(earnedDialog).getByRole("button", { name: "Close dialog" }));
  expect(screen.queryByRole("link", { name: "Use Exact Recall as profile image" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Exact Recall: view details" }));
  expect(screen.getByRole("dialog")).toHaveTextContent("This patch is locked");
  expect(within(screen.getByRole("dialog")).queryByRole("link", { name: "Use as profile image" })).not.toBeInTheDocument();
});
it("combines category and earned/locked filters without promoting milestone awards", async () => {
  vi.mocked(trainingApi.honors).mockResolvedValue([honorFixture({ earnedAtUtc: "2026-09-10T12:00:00Z" })]); page();
  fireEvent.change(screen.getByLabelText("Honor category"), { target: { value: "Team Practice" } });
  expect(screen.getByRole("button", { name: "Team Precision: view details" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Reference Ready: view details" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Earned" }));
  expect(screen.getByText("No earned Honors yet")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Locked" }));
  expect(screen.getByRole("button", { name: "Team Precision: view details" })).toBeInTheDocument();
});
it("preserves the original milestone progress and Advanced requirement inside history", async () => {
  page(); fireEvent.click(screen.getByText("Practice milestones", { selector: "summary" }));
  expect(await screen.findByText("4 / 5")).toBeInTheDocument();
  const milestones = screen.getByText("Practice milestones", { selector: "summary" }).closest("details")!;
  fireEvent.click(within(milestones).getByRole("button", { name: "Exact Recall: view details" }));
  expect(screen.getByRole("dialog")).toHaveTextContent("Reach an exact wording score of 80 in 5 distinct eligible passages.");
  expect(screen.getByRole("dialog")).toHaveTextContent("Requires Advanced practice; Foundation and Standard wording scores are capped at 40 and 70.");
  expect(within(screen.getByRole("dialog")).queryByRole("link", { name: /profile image/ })).not.toBeInTheDocument();
});
it("preserves milestone earning date, scope and evidence-session route", async () => {
  vi.mocked(trainingApi.honors).mockResolvedValue([honorFixture({ earnedAtUtc: "2026-09-10T12:00:00Z", evidenceSessionId: "saved" })]); page();
  fireEvent.click(screen.getByText("Practice milestones", { selector: "summary" }));
  const milestones = screen.getByText("Practice milestones", { selector: "summary" }).closest("details")!;
  fireEvent.click(await within(milestones).findByRole("button", { name: "Exact Recall: view details" }));
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
  fireEvent.click(screen.getByRole("button", { name: "Reference Ready: view details" }));
  expect(within(screen.getByRole("dialog")).getByRole("link", { name: "Use Reference Ready as profile image" })).toBeInTheDocument();
});
it('keeps dated chapter stamps separate from permanent Honors and legacy milestones', async () => {
  page();
  expect(await screen.findByRole('heading', { name: 'PBE chapter stamps' })).toBeVisible();
  expect(await screen.findByText('Assigned passages retained')).toBeVisible();
  expect(screen.getByText('Earned for an earlier assigned scope.')).toBeVisible();
  fireEvent.click(screen.getByText('Practice milestones', { selector: 'summary' }));
  expect(screen.getByText(/Team Practice answers do not establish individual Solo accuracy/)).toBeVisible();
  const milestones = screen.getByText('Practice milestones', { selector: 'summary' }).closest('details')!;
  fireEvent.click(within(milestones).getByRole('button', { name: 'Exact Recall: view details' }));
  expect(within(screen.getByRole('dialog')).queryByRole('link', { name: /profile image/i })).not.toBeInTheDocument();
});
it('keeps an unverifiable scope match distinct from an unavailable current assignment', async () => {
  vi.mocked(trainingApi.chapters).mockResolvedValue(stampPage(null));
  page();
  expect(await screen.findByText('Assigned passages retained')).toBeVisible();
  expect(screen.getByText('Its match to your current assignment is not yet verified; this dated stamp remains saved.')).toBeVisible();
  expect(screen.queryByText(/Current assignment is unavailable/)).not.toBeInTheDocument();
  expect(screen.getByText('Sep 10, 2026')).toBeVisible();
});
it('keeps simulation patches separate while preserving the original Honor collection',()=>{
 vi.mocked(useMyProfile).mockReturnValue(profileResult({data:{...profile,honors:[...profile.honors,{key:'simulation:first-rehearsal',title:'First Rehearsal',category:'Simulation',ruleVersion:'simulation-v1',requirement:'Complete one versioned simulation.',earnedAtUtc:'2026-09-13T00:00:00Z'}]}}));
 page();fireEvent.change(screen.getByLabelText('Honor category'),{target:{value:'Simulation'}});
 expect(screen.getByRole('heading',{name:'First Rehearsal'})).toBeInTheDocument();
 expect(screen.queryByRole('heading',{name:'Exact Recall'})).not.toBeInTheDocument();
 const card=screen.getByRole('heading',{name:'First Rehearsal'}).closest('article')!;
 expect(card.querySelector('img')).toHaveAttribute('src','/brand/simulation/first-rehearsal-256.webp');
 expect(card.querySelector('img')?.getAttribute('srcset')).toContain('/brand/simulation/first-rehearsal-512.webp');
 fireEvent.change(screen.getByLabelText('Honor category'),{target:{value:'Scripture'}});
 expect(screen.getByRole('heading',{name:'Exact Recall'})).toBeInTheDocument();
});
