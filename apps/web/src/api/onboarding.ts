import { ApiError, request } from "./client";
import type { Me } from "./types";

export type CoachOptions = { available: boolean; turnstileSiteKey: string | null };
export type CodeReceipt = { challengeId: string; expiresAt: string; resendAfterSeconds: number };
export type InvitationDetails = { organizationName: string; emailHint: string; expiresAt: string };
export type Coach = { userId: string; displayName: string; email: string | null; role: "Owner" | "Admin" };
export type CoachInvitation = { id: string; email: string; createdAt: string; expiresAt: string; status: "pending" | "accepted" | "revoked" | "expired" };
type Completion = { challengeId: string; code: string; password: string };
const post = <T>(path: string, body: unknown) => request<T>(`/api/v1/${path}`, { method: "POST", body: JSON.stringify(body) });
const clubPath = (organizationId: string) => `/api/v1/organizations/${encodeURIComponent(organizationId)}`;

export const onboardingApi = {
  options: async (): Promise<CoachOptions> => {
    try {
      const options = await request<CoachOptions>("/api/v1/auth/coach-options");
      return options?.available === true && typeof options.turnstileSiteKey === "string" && options.turnstileSiteKey.trim()
        ? options : { available: false, turnstileSiteKey: null };
    } catch (error) {
      // The retained backend may return 404/405 or its HTML app shell here.
      if (error instanceof SyntaxError || error instanceof ApiError && [404, 405, 503].includes(error.status)) return { available: false, turnstileSiteKey: null };
      throw error;
    }
  },
  signupCode: (email: string, turnstileToken: string) => post<CodeReceipt>("auth/signup/code", { email, turnstileToken }),
  signupComplete: (body: Completion & { displayName: string; organizationName: string }) => post<Me>("auth/signup/complete", body),
  recoveryCode: (email: string, turnstileToken: string) => post<CodeReceipt>("auth/password/code", { email, turnstileToken }),
  recoveryComplete: (body: Completion) => post<void>("auth/password/complete", body),
  invitationDetails: (token: string) => post<InvitationDetails>("auth/invitation/details", { token }),
  invitationCode: (token: string, email: string, turnstileToken: string) => post<CodeReceipt>("auth/invitation/code", { token, email, turnstileToken }),
  invitationComplete: (body: Completion & { displayName: string }) => post<Me>("auth/invitation/complete", body),
  coaches: (org: string) => request<Coach[]>(`${clubPath(org)}/coaches`),
  invitations: (org: string) => request<CoachInvitation[]>(`${clubPath(org)}/coach-invitations`),
  invite: (org: string, email: string) => request<CoachInvitation>(`${clubPath(org)}/coach-invitations`, { method: "POST", body: JSON.stringify({ email }) }),
  resend: (org: string, id: string) => request<CoachInvitation>(`${clubPath(org)}/coach-invitations/${encodeURIComponent(id)}/resend`, { method: "POST" }),
  revoke: (org: string, id: string) => request<void>(`${clubPath(org)}/coach-invitations/${encodeURIComponent(id)}`, { method: "DELETE" }),
};
