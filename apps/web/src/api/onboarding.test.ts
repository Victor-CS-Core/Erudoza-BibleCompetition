import { afterEach, expect, it, vi } from "vitest";
import { onboardingApi } from "./onboarding";

afterEach(() => vi.unstubAllGlobals());
it.each([404, 405])("treats a missing options endpoint (%s) as unavailable", async status => {
 vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status })));
 expect(await onboardingApi.options()).toEqual({ available: false, turnstileSiteKey: null });
});
it("fails closed when a legacy app serves HTML for the options endpoint", async () => {
 vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<!doctype html>")));
 expect(await onboardingApi.options()).toEqual({ available: false, turnstileSiteKey: null });
});
it("does not put invitation secrets in URLs or return them in a list cache", async () => {
 const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ organizationName: "Club", emailHint: "c***@example.com", expiresAt: "2026-09-20" })));
 vi.stubGlobal("fetch", fetcher);
 await onboardingApi.invitationDetails("private-invitation-secret");
 expect(fetcher.mock.calls[0][0]).toBe("/api/v1/auth/invitation/details");
 expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ token: "private-invitation-secret" });
});
