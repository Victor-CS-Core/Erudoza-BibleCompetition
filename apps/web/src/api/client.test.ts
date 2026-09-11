import { afterEach, expect, it, vi } from "vitest";
import { request } from "./client";
afterEach(() => vi.unstubAllGlobals());
it("preserves a server retry delay alongside Problem Details", async () => {
 vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: "Please wait before requesting another code." }), { status: 429, headers: { "Retry-After": "60" } })));
 await expect(request("/api/v1/auth/signup/code")).rejects.toMatchObject({ status: 429, retryAfterSeconds: 60, message: "Please wait before requesting another code." });
});
