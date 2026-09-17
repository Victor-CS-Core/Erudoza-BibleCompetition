import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { onboardingApi, type Coach, type CoachInvitation } from "../../api/onboarding";
import { useAuth } from "../../auth/AuthContext";
import type { Me } from "../../api/types";
import { ApiError } from "../../api/client";
import { CoachesPage } from "./CoachesPage";
import { ToastProvider } from "../../components/ui";

vi.mock("../../auth/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("../../api/onboarding", () => ({ onboardingApi: { options: vi.fn(), coaches: vi.fn(), invitations: vi.fn(), invite: vi.fn(), resend: vi.fn(), revoke: vi.fn(), changeRole: vi.fn(), removeCoach: vi.fn() } }));
const owner = { userId: "owner", organizationId: "club-a", organizationName: "Club A", displayName: "Owner", kind: "Adult", role: "Owner" } as Me;
const admin: Me = { ...owner, userId: "admin", displayName: "Coach", role: "Admin" };
const invitation: CoachInvitation = { id: "inv-1", email: "coach@example.com", role: "Admin", createdAt: "2026-09-11T10:00:00Z", expiresAt: "2026-09-18T10:00:00Z", status: "pending" };
const directory: Coach[] = [
 { userId: "owner", displayName: "Club owner", email: "owner@example.com", role: "Owner" },
 { userId: "admin", displayName: "Other coach", email: "other@example.com", role: "Admin" },
];
function setup() {
 const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
 render(<QueryClientProvider client={client}><MemoryRouter><ToastProvider><CoachesPage /></ToastProvider></MemoryRouter></QueryClientProvider>);
}
function authAs(me: Me) {
 vi.mocked(useAuth).mockReturnValue({ me, loading: false, error: null, login: vi.fn(), logout: vi.fn(), refresh: vi.fn(), acceptSession: vi.fn() });
}
beforeEach(() => {
 vi.resetAllMocks();
 Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute("open", ""); } });
 Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute("open"); } });
 authAs(owner);
 vi.mocked(onboardingApi.options).mockResolvedValue({ available: true, turnstileSiteKey: "configured-key" });
 vi.mocked(onboardingApi.coaches).mockResolvedValue(directory);
 vi.mocked(onboardingApi.invitations).mockResolvedValue([invitation]);
 vi.mocked(onboardingApi.invite).mockResolvedValue(invitation);
 vi.mocked(onboardingApi.resend).mockResolvedValue({ ...invitation, expiresAt: "2026-09-19T10:00:00Z" });
 vi.mocked(onboardingApi.revoke).mockResolvedValue(undefined);
 vi.mocked(onboardingApi.changeRole).mockResolvedValue({ userId: "admin", role: "Content Manager" });
 vi.mocked(onboardingApi.removeCoach).mockResolvedValue(undefined);
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
  expect(onboardingApi.invite).toHaveBeenCalledWith("club-a", "newcoach@example.com", "Admin");
 });
 it("lets owners invite with a chosen role", async () => {
  setup(); fireEvent.change(await screen.findByLabelText("Coach email address"), { target: { value: "manager@example.com" } });
  fireEvent.change(screen.getByLabelText("Role"), { target: { value: "Content Manager" } });
  fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));
  await waitFor(() => expect(onboardingApi.invite).toHaveBeenCalledWith("club-a", "manager@example.com", "Content Manager"));
 });
 it("shows admins the directory but hides invitation management", async () => {
  authAs(admin); setup();
  expect(await screen.findByText("Club owner")).toBeInTheDocument();
  expect(screen.queryByLabelText("Coach email address")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Send invitation" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Create invitation" })).not.toBeInTheDocument();
  expect(screen.queryByText("coach@example.com")).not.toBeInTheDocument();
  expect(screen.getByText(/resend or revoke invitations/)).toBeInTheDocument();
  expect(onboardingApi.invitations).not.toHaveBeenCalled();
 });
 it("shows the manual-share link when email delivery is unavailable", async () => {
  vi.mocked(onboardingApi.options).mockResolvedValue({ available: false, turnstileSiteKey: null });
  vi.mocked(onboardingApi.invite).mockResolvedValue({ ...invitation, inviteUrl: "https://staging.erudoza.com/join-coach#secret-token" });
  setup();
  expect(await screen.findByRole("button", { name: "Create invitation" })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Coach email address"), { target: { value: "newcoach@example.com" } });
  fireEvent.click(screen.getByRole("button", { name: "Create invitation" }));
  expect(await screen.findByText("https://staging.erudoza.com/join-coach#secret-token")).toBeInTheDocument();
  expect(screen.getByText(/the invitation will not be sent automatically/)).toBeInTheDocument();
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
 it("lets owners change another coach's role", async () => {
  setup(); fireEvent.change(await screen.findByLabelText("Change role for Other coach"), { target: { value: "Content Manager" } });
  await waitFor(() => expect(onboardingApi.changeRole).toHaveBeenCalledWith("club-a", "admin", "Content Manager"));
  expect(await screen.findByText(/Other coach is now a Content Manager/)).toBeInTheDocument();
 });
 it("does not offer role controls for the owner themselves or to admins", async () => {
  setup();
  await screen.findByText("Club owner");
  expect(screen.queryByLabelText("Change role for Club owner")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Remove Club owner/ })).not.toBeInTheDocument();
  cleanup(); authAs(admin); setup();
  await screen.findByText("Club owner");
  expect(screen.queryByLabelText(/Change role for/)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Remove / })).not.toBeInTheDocument();
 });
 it("requires confirmation before removing a coach", async () => {
  setup(); fireEvent.click(await screen.findByRole("button", { name: "Remove Other coach from this club" }));
  const dialog = screen.getByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Remove coach" }));
  await waitFor(() => expect(onboardingApi.removeCoach).toHaveBeenCalledWith("club-a", "admin"));
  expect(await screen.findByText("Other coach has been removed from this club.")).toBeInTheDocument();
 });
 it("does not allow students to fetch or manage coaches", async () => {
  authAs({ ...owner, kind: "Student", role: "Student" });
  setup(); expect(screen.getByText(/Only club owners and coaches can manage/)).toBeInTheDocument();
  expect(onboardingApi.coaches).not.toHaveBeenCalled(); expect(onboardingApi.invitations).not.toHaveBeenCalled();
 });
 it("does not render invite controls after a server permission denial", async () => {
  vi.mocked(onboardingApi.coaches).mockRejectedValue(new ApiError("Forbidden", 403));
  setup(); expect(await screen.findByText(/You do not have permission/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Send invitation" })).not.toBeInTheDocument();
 });
 it("keeps management available where email delivery is unavailable", async () => {
  vi.mocked(onboardingApi.options).mockResolvedValue({ available: false, turnstileSiteKey: null });
  setup(); expect(await screen.findByLabelText("Coach email address")).toBeInTheDocument();
  expect(onboardingApi.coaches).toHaveBeenCalled();
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
