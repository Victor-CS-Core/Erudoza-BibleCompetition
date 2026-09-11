import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { onboardingApi, type CoachInvitation } from "../../api/onboarding";
import { useAuth } from "../../auth/AuthContext";
import type { Me } from "../../api/types";
import { ApiError } from "../../api/client";
import { CoachesPage } from "./CoachesPage";

vi.mock("../../auth/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("../../api/onboarding", () => ({ onboardingApi: { options: vi.fn(), coaches: vi.fn(), invitations: vi.fn(), invite: vi.fn(), resend: vi.fn(), revoke: vi.fn() } }));
const owner = { userId: "owner", organizationId: "club-a", organizationName: "Club A", displayName: "Owner", kind: "Adult", role: "Owner" } as Me;
const invitation: CoachInvitation = { id: "inv-1", email: "coach@example.com", createdAt: "2026-09-11T10:00:00Z", expiresAt: "2026-09-18T10:00:00Z", status: "pending" };
function setup() {
 const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
 render(<QueryClientProvider client={client}><MemoryRouter><CoachesPage /></MemoryRouter></QueryClientProvider>);
}
beforeEach(() => {
 vi.resetAllMocks();
 Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute("open", ""); } });
 Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute("open"); } });
 vi.mocked(useAuth).mockReturnValue({ me: owner, loading: false, error: null, login: vi.fn(), logout: vi.fn(), refresh: vi.fn(), acceptSession: vi.fn() });
 vi.mocked(onboardingApi.options).mockResolvedValue({ available: true, turnstileSiteKey: "configured-key" });
 vi.mocked(onboardingApi.coaches).mockResolvedValue([{ userId: "owner", displayName: "Club owner", email: "owner@example.com", role: "Owner" }]);
 vi.mocked(onboardingApi.invitations).mockResolvedValue([invitation]);
 vi.mocked(onboardingApi.invite).mockResolvedValue(invitation);
 vi.mocked(onboardingApi.resend).mockResolvedValue({ ...invitation, expiresAt: "2026-09-19T10:00:00Z" });
 vi.mocked(onboardingApi.revoke).mockResolvedValue(undefined);
});
describe("CoachesPage", () => {
 it("lists current club coaches and recipient-bound invitation status", async () => {
  setup(); expect(await screen.findByText("Club owner")).toBeInTheDocument();
  expect(screen.getByText("coach@example.com")).toBeInTheDocument();
  expect(screen.getByText("Pending")).toBeInTheDocument();
  expect(onboardingApi.coaches).toHaveBeenCalledWith("club-a");
 });
 it("sends a coach invitation to the email provided and reports the recipient", async () => {
  setup(); fireEvent.change(await screen.findByLabelText("Coach email address"), { target: { value: "newcoach@example.com" } });
  vi.mocked(onboardingApi.invite).mockResolvedValue({ ...invitation, email: "newcoach@example.com" });
  fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));
  expect(await screen.findByText("Invitation sent to newcoach@example.com.")).toBeInTheDocument();
  expect(onboardingApi.invite).toHaveBeenCalledWith("club-a", "newcoach@example.com");
 });
 it("does not report a provider failure as a sent invitation", async () => {
  vi.mocked(onboardingApi.invite).mockRejectedValue(new ApiError("Email delivery is unavailable. Try again later.", 503));
  setup(); fireEvent.change(await screen.findByLabelText("Coach email address"), { target: { value: "newcoach@example.com" } });
  fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Email delivery is unavailable");
  expect(screen.queryByText(/Invitation sent to/)).not.toBeInTheDocument();
 });
 it("resends to the stored recipient", async () => {
  setup(); fireEvent.click(await screen.findByRole("button", { name: "Resend invitation to coach@example.com" }));
  expect(await screen.findByText("New invitation sent to coach@example.com. The previous link no longer works.")).toBeInTheDocument();
  expect(onboardingApi.resend).toHaveBeenCalledWith("club-a", "inv-1");
 });
 it("requires confirmation before revocation and places focus on Cancel", async () => {
  setup(); fireEvent.click(await screen.findByRole("button", { name: "Revoke invitation for coach@example.com" }));
  const dialog = screen.getByRole("dialog"); expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
  expect(onboardingApi.revoke).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Revoke invitation" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(screen.getByText("Invitation revoked for coach@example.com.")).toBeInTheDocument();
 });
 it("shows a revoke failure inside the confirmation without hiding it", async () => {
  vi.mocked(onboardingApi.revoke).mockRejectedValue(new Error("Unable to revoke invitation."));
  setup(); fireEvent.click(await screen.findByRole("button", { name: "Revoke invitation for coach@example.com" }));
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Revoke invitation" }));
  expect(await within(screen.getByRole("dialog")).findByRole("alert")).toHaveTextContent("Unable to revoke invitation");
 });
 it("does not allow students to fetch or manage coaches", async () => {
  vi.mocked(useAuth).mockReturnValue({ me: { ...owner, kind: "Student", role: "Student" }, loading: false, error: null, login: vi.fn(), logout: vi.fn(), refresh: vi.fn(), acceptSession: vi.fn() });
  setup(); expect(screen.getByText(/Only club owners and coaches can manage/)).toBeInTheDocument();
  expect(onboardingApi.coaches).not.toHaveBeenCalled(); expect(onboardingApi.invitations).not.toHaveBeenCalled();
 });
 it("does not render invite controls after a server permission denial", async () => {
  vi.mocked(onboardingApi.coaches).mockRejectedValue(new ApiError("Forbidden", 403));
  setup(); expect(await screen.findByText(/You do not have permission/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Send invitation" })).not.toBeInTheDocument();
 });
 it("shows an unavailable fallback on the retained backend", async () => {
  vi.mocked(onboardingApi.options).mockResolvedValue({ available: false, turnstileSiteKey: null });
  setup(); expect(await screen.findByText(/Coach invitations are currently unavailable/)).toBeInTheDocument();
  expect(onboardingApi.coaches).not.toHaveBeenCalled(); expect(screen.queryByLabelText("Coach email address")).not.toBeInTheDocument();
 });
 it("does not offer acceptance-changing controls for accepted or revoked invitations", async () => {
  vi.mocked(onboardingApi.invitations).mockResolvedValue([{ ...invitation, status: "accepted" }, { ...invitation, id: "inv-2", email: "revoked@example.com", status: "revoked" }]);
  setup(); await screen.findByText("Accepted");
  expect(screen.queryByRole("button", { name: /Resend invitation/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Revoke invitation/ })).not.toBeInTheDocument();
 });
 it("lets a coach renew an expired invitation with a fresh link", async () => {
  vi.mocked(onboardingApi.invitations).mockResolvedValue([{ ...invitation, status: "expired" }]);
  setup(); fireEvent.click(await screen.findByRole("button", { name: "Resend invitation to coach@example.com" }));
  expect(await screen.findByText(/New invitation sent/)).toBeInTheDocument();
 });
});
