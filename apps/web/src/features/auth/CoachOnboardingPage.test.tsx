import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onboardingApi } from "../../api/onboarding";
import { ApiError } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import type { Me } from "../../api/types";
import { CoachOnboardingPage } from "./CoachOnboardingPage";

vi.mock("../../auth/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("../../api/onboarding", () => ({ onboardingApi: { options: vi.fn(), signupCode: vi.fn(), signupComplete: vi.fn(), recoveryCode: vi.fn(), recoveryComplete: vi.fn(), invitationDetails: vi.fn(), invitationCode: vi.fn(), invitationComplete: vi.fn(), invitationAcceptDirect: vi.fn() } }));
const owner = { userId: "new-owner", organizationId: "new-club", organizationName: "New club", kind: "Adult", role: "Owner", displayName: "Coach" } as Me;
const acceptSession = vi.fn();
type WidgetCallbacks = { callback: (token: string) => void; "expired-callback": () => void; "error-callback": () => void; action: string; size: string };
let widget: WidgetCallbacks;
const renderWidget = vi.fn((_element: HTMLElement, callbacks: WidgetCallbacks) => { widget = callbacks; return "widget"; });
const resetWidget = vi.fn();
const receipt = () => ({ challengeId: "challenge-1", expiresAt: new Date(Date.now() + 600_000).toISOString(), resendAfterSeconds: 60 });
function setup(mode: "signup" | "recovery" | "invitation" = "signup", fragment = "") {
 const router = createMemoryRouter([{ path: "/flow", element: <CoachOnboardingPage mode={mode} /> }, { path: "/admin", element: <p>Coach workspace</p> }, { path: "/login", element: <p>Account login</p> }], { initialEntries: ["/flow" + fragment] });
 render(<RouterProvider router={router} />); return router;
}
async function solve() {
 await waitFor(() => expect(renderWidget).toHaveBeenCalled());
 act(() => widget.callback("verified-widget-token"));
}
async function sendCode() {
 fireEvent.change(await screen.findByLabelText("Email address"), { target: { value: "coach@example.com" } });
 await solve(); fireEvent.click(screen.getByRole("button", { name: "Send verification code" }));
 await screen.findByLabelText("Verification code");
}
function completeFields() {
 fireEvent.change(screen.getByLabelText("Verification code"), { target: { value: "123456" } });
 if (screen.queryByLabelText("Your name")) fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "New coach" } });
 if (screen.queryByLabelText("Club name")) fireEvent.change(screen.getByLabelText("Club name"), { target: { value: "New club" } });
 fireEvent.change(screen.getByLabelText("New password"), { target: { value: "Long secure password!42" } });
 if (screen.queryByLabelText("I confirm that I am 18 years old or older.")) fireEvent.click(screen.getByLabelText("I confirm that I am 18 years old or older."));
}
beforeEach(() => {
 vi.clearAllMocks(); acceptSession.mockResolvedValue(undefined);
 vi.mocked(useAuth).mockReturnValue({ me: null, loading: false, error: null, login: vi.fn(), logout: vi.fn(), refresh: vi.fn(), acceptSession });
 vi.mocked(onboardingApi.options).mockResolvedValue({ available: true, turnstileSiteKey: "configured-site-key" });
 vi.mocked(onboardingApi.signupCode).mockImplementation(async () => receipt());
 vi.mocked(onboardingApi.recoveryCode).mockImplementation(async () => receipt());
 vi.mocked(onboardingApi.invitationCode).mockImplementation(async () => receipt());
 vi.mocked(onboardingApi.signupComplete).mockResolvedValue(owner);
 vi.mocked(onboardingApi.invitationComplete).mockResolvedValue({ ...owner, role: "Admin" });
 vi.mocked(onboardingApi.recoveryComplete).mockResolvedValue(undefined);
 vi.mocked(onboardingApi.invitationDetails).mockResolvedValue({ organizationName: "Inviting club", emailHint: "c***@example.com", expiresAt: new Date(Date.now() + 86_400_000).toISOString() });
 vi.stubGlobal("turnstile", { render: renderWidget, reset: resetWidget, remove: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());

describe("Coach onboarding", () => {
 it("creates a club after code verification and accepts the returned session", async () => {
  const router = setup(); await sendCode();
  expect(screen.getByLabelText("Verification code")).toHaveAttribute("autocomplete", "one-time-code");
  expect(screen.getByLabelText("Verification code")).toHaveAttribute("inputmode", "numeric");
  expect(screen.queryByLabelText("Email address")).not.toBeInTheDocument();
  expect(widget.action).toBe("coach_signup"); expect(widget.size).toBe("flexible");
  completeFields(); fireEvent.click(screen.getByRole("button", { name: "Create club and coach account" }));
  await screen.findByText("Coach workspace"); expect(router.state.location.pathname).toBe("/admin");
  expect(onboardingApi.signupComplete).toHaveBeenCalledWith({ challengeId: "challenge-1", code: "123456", displayName: "New coach", organizationName: "New club", password: "Long secure password!42", ageConfirmed: true });
  expect(acceptSession).toHaveBeenCalledWith(owner); expect(resetWidget).toHaveBeenCalled();
 });
 it("keeps an invalid code visible and focused without accepting a session", async () => {
  vi.mocked(onboardingApi.signupComplete).mockRejectedValue(new Error("The code is invalid or expired. Request a new code."));
  setup(); await sendCode(); completeFields(); fireEvent.click(screen.getByRole("button", { name: "Create club and coach account" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("invalid or expired");
  await waitFor(() => expect(screen.getByLabelText("Verification code")).toHaveFocus());
  expect(acceptSession).not.toHaveBeenCalled();
 });
 it("requires the 18+ confirmation before creating a coach account", async () => {
  setup(); await sendCode();
  fireEvent.change(screen.getByLabelText("Verification code"), { target: { value: "123456" } });
  fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "New coach" } });
  fireEvent.change(screen.getByLabelText("Club name"), { target: { value: "New club" } });
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: "Long secure password!42" } });
  fireEvent.click(screen.getByRole("button", { name: "Create club and coach account" }));
  expect(onboardingApi.signupComplete).not.toHaveBeenCalled();
  expect(screen.getByLabelText("I confirm that I am 18 years old or older.")).toBeRequired();
  fireEvent.click(screen.getByLabelText("I confirm that I am 18 years old or older."));
  fireEvent.click(screen.getByRole("button", { name: "Create club and coach account" }));
  await screen.findByText("Coach workspace");
  expect(onboardingApi.signupComplete).toHaveBeenCalledWith(expect.objectContaining({ ageConfirmed: true }));
 });
 it("shows cooldown and requires a new bot check before resending", async () => {
  setup(); await sendCode();
  expect(screen.getByRole("button", { name: /Resend code in/ })).toBeDisabled();
  expect(screen.getByText(/Only the newest code works/)).toBeInTheDocument();
  expect(onboardingApi.signupCode).toHaveBeenCalledTimes(1);
 });
 it("resends to the bound email and replaces the old challenge", async () => {
  vi.mocked(onboardingApi.signupCode).mockResolvedValueOnce({ ...receipt(), resendAfterSeconds: 0 }).mockResolvedValueOnce({ ...receipt(), challengeId: "challenge-2" });
  setup(); await sendCode(); await solve(); fireEvent.click(screen.getByRole("button", { name: "Resend code" }));
  await waitFor(() => expect(onboardingApi.signupCode).toHaveBeenCalledTimes(2));
  expect(onboardingApi.signupCode).toHaveBeenLastCalledWith("coach@example.com", "verified-widget-token");
  await waitFor(() => expect(screen.getByRole("button", { name: /Resend code in/ })).toBeDisabled());
  completeFields(); fireEvent.click(screen.getByRole("button", { name: "Create club and coach account" }));
  await screen.findByText("Coach workspace");
  expect(onboardingApi.signupComplete).toHaveBeenCalledWith(expect.objectContaining({ challengeId: "challenge-2" }));
 });
 it("invalidates an expired widget token before sending", async () => {
  setup(); await solve(); act(() => widget["expired-callback"]());
  expect(screen.getByRole("button", { name: "Send verification code" })).toBeDisabled();
  expect(screen.getByText(/Security check expired/)).toBeInTheDocument();
 });
 it("shows a retryable security-check error without accepting a token", async () => {
  setup(); await solve(); act(() => widget["error-callback"]());
  expect(screen.getByRole("button", { name: "Send verification code" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Retry security check" })).toBeInTheDocument();
 });
 it("fails closed when onboarding is unavailable", async () => {
  vi.mocked(onboardingApi.options).mockResolvedValue({ available: false, turnstileSiteKey: null });
  setup(); expect(await screen.findByText(/Coach account services are currently unavailable/)).toBeInTheDocument();
  expect(screen.queryByLabelText("Email address")).not.toBeInTheDocument(); expect(renderWidget).not.toHaveBeenCalled();
 });
 it("honors a server email cooldown even before a code was sent", async () => {
  vi.mocked(onboardingApi.invitationCode).mockRejectedValue(new ApiError("Please wait before requesting another code.", 429, 60));
  setup("invitation", "#token=private-invite");
  fireEvent.change(await screen.findByLabelText("Email address"), { target: { value: "coach@example.com" } });
  await solve(); fireEvent.click(screen.getByRole("button", { name: "Send verification code" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Please wait");
  expect(screen.getByRole("button", { name: /Send code in/ })).toBeDisabled();
  expect(screen.queryByLabelText("Verification code")).not.toBeInTheDocument();
 });
 it("disables completion when the emailed code has expired", async () => {
  vi.mocked(onboardingApi.signupCode).mockResolvedValue({ ...receipt(), expiresAt: new Date(Date.now() - 1000).toISOString() });
  setup(); await sendCode();
  expect(screen.getByText(/This code has expired/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Create club and coach account" })).toBeDisabled();
 });
 it("blocks a signed-in account from claiming another account", async () => {
  vi.mocked(useAuth).mockReturnValue({ me: owner, loading: false, error: null, login: vi.fn(), logout: vi.fn(), refresh: vi.fn(), acceptSession });
  setup("invitation", "#token=private-invite");
  expect(await screen.findByRole("button", { name: "Sign out to continue" })).toBeInTheDocument();
  expect(screen.queryByLabelText("Email address")).not.toBeInTheDocument(); expect(onboardingApi.invitationDetails).not.toHaveBeenCalled();
 });
 it("offers sign-out without losing the invitation when another tab signs in", async () => {
  const refresh = vi.fn(async () => {
   vi.mocked(useAuth).mockReturnValue({ me: owner, loading: false, error: null, login: vi.fn(), logout: vi.fn(), refresh, acceptSession });
  });
  vi.mocked(useAuth).mockReturnValue({ me: null, loading: false, error: null, login: vi.fn(), logout: vi.fn(), refresh, acceptSession });
  vi.mocked(onboardingApi.invitationComplete).mockRejectedValue(new ApiError("Sign out before joining as a different coach.", 409));
  setup("invitation", "#private-invite"); await sendCode(); completeFields();
  fireEvent.click(screen.getByRole("button", { name: "Join club as a coach" }));
  expect(await screen.findByRole("button", { name: "Sign out to continue" })).toBeInTheDocument();
  expect(acceptSession).not.toHaveBeenCalled();
 });
 it("removes the fragment and binds invitation acceptance to a fresh code", async () => {
  const router = setup("invitation", "#token=private-invite");
  expect(await screen.findByText(/Inviting club/)).toBeInTheDocument();
  await waitFor(() => expect(router.state.location.hash).toBe(""));
  await sendCode(); expect(widget.action).toBe("coach_invitation");
  expect(onboardingApi.invitationCode).toHaveBeenCalledWith("private-invite", "coach@example.com", "verified-widget-token");
  expect(screen.queryByLabelText("Club name")).not.toBeInTheDocument();
  completeFields(); fireEvent.click(screen.getByRole("button", { name: "Join club as a coach" }));
  await screen.findByText("Coach workspace"); expect(onboardingApi.invitationComplete).toHaveBeenCalledWith(expect.objectContaining({ challengeId: "challenge-1" }));
 });
 it("accepts the native email's plain secret fragment and removes it from history", async () => {
  const token = "fW89MwZZVMZVKjlSKsuazFi_0ooP-GAYcmFVGa4_gF8";
  const router = setup("invitation", `#${token}`);
  expect(await screen.findByText(/Inviting club/)).toBeInTheDocument();
  await waitFor(() => expect(router.state.location.hash).toBe(""));
  await sendCode(); expect(onboardingApi.invitationCode).toHaveBeenCalledWith(token, "coach@example.com", "verified-widget-token");
 });
 it("accepts the invitation directly when email delivery is unavailable", async () => {
  vi.mocked(onboardingApi.options).mockResolvedValue({ available: false, turnstileSiteKey: null });
  const invited = { ...owner, role: "Content Manager" } as Me;
  vi.mocked(onboardingApi.invitationAcceptDirect).mockResolvedValue(invited);
  const router = setup("invitation", "#direct-token");
  expect(await screen.findByText(/the invitation link you opened is your proof/)).toBeInTheDocument();
  await waitFor(() => expect(router.state.location.hash).toBe(""));
  expect(onboardingApi.invitationDetails).toHaveBeenCalledWith("direct-token");
  fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Direct Coach" } });
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: "Long secure password!42" } });
  fireEvent.click(screen.getByLabelText("I confirm that I am 18 years old or older."));
  fireEvent.click(screen.getByRole("button", { name: "Join club as a coach" }));
  await waitFor(() => expect(onboardingApi.invitationAcceptDirect).toHaveBeenCalledWith({ token: "direct-token", displayName: "Direct Coach", password: "Long secure password!42", ageConfirmed: true }));
  await screen.findByText("Coach workspace");
  expect(acceptSession).toHaveBeenCalledWith(invited);
 });
 it("locks the completion form while verification is pending", async () => {
  let resolve!: (value: Me) => void;
  vi.mocked(onboardingApi.signupComplete).mockImplementation(() => new Promise<Me>(done => { resolve = done; }));
  setup(); await sendCode(); completeFields();
  fireEvent.click(screen.getByRole("button", { name: "Create club and coach account" }));
  expect(screen.getByRole("button", { name: "Verifying…" })).toBeDisabled();
  expect(screen.getByLabelText("New password")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Change email" })).toBeDisabled();
  await act(async () => resolve(owner)); await screen.findByText("Coach workspace");
  expect(onboardingApi.signupComplete).toHaveBeenCalledTimes(1);
 });
 it("shows expired or revoked invitation recovery without an acceptance form", async () => {
  vi.mocked(onboardingApi.invitationDetails).mockRejectedValue(new Error("This invitation is invalid, expired, or revoked."));
  setup("invitation", "#token=old-invite");
  expect(await screen.findByRole("alert")).toHaveTextContent(/invalid, expired, or revoked/);
  expect(screen.queryByLabelText("Email address")).not.toBeInTheDocument();
 });
 it("recovers an adult password and requires a fresh login", async () => {
  setup("recovery"); await sendCode(); expect(widget.action).toBe("coach_recovery");
  expect(screen.getByText(/If this email belongs to an eligible coach/)).toBeInTheDocument();
  completeFields(); fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
  expect(await screen.findByText(/Your password has been reset/)).toBeInTheDocument();
  expect(acceptSession).not.toHaveBeenCalled(); expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
 });
});
