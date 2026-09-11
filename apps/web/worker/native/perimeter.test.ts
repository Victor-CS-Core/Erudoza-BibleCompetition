// @vitest-environment node
import { expect, it, vi } from "vitest";
import { enforcePerimeter, type PerimeterEnv } from "./perimeter";

const request = (path = "/api/v1/me", headers: HeadersInit = {}) => {
  const value = new Request(`https://erudoza.com${path}`, { headers });
  Object.defineProperty(value, "cf", { value: {} });
  return value;
};
const limiter = (success = true) => ({ limit: vi.fn(async () => ({ success })) });
const configured = (): PerimeterEnv => ({ PUBLIC_ORIGIN: "https://erudoza.com", STRICT_PUBLIC_HOST: "true", ENFORCE_RATE_LIMITS: "true", API_RATE_LIMITER: limiter(), AUTH_RATE_LIMITER: limiter() });

it("rejects an alternate hostname before touching rate counters, regardless of forged Origin", async () => {
  const env = configured();
  await expect(enforcePerimeter(new Request("https://erudoza-native.example.workers.dev/api/v1/me", { headers: { Origin: "https://erudoza.com" } }), env)).rejects.toMatchObject({ status: 404 });
  expect(env.API_RATE_LIMITER!.limit).not.toHaveBeenCalled();
});
it("uses only the Cloudflare ingress IP and one stable key across randomized paths", async () => {
  const env = configured();
  await enforcePerimeter(request("/api/v1/missing?nonce=1", { "CF-Connecting-IP": "192.0.2.5", "X-Forwarded-For": "1.2.3.4" }), env);
  await enforcePerimeter(request("/api/v1/other?nonce=2", { "CF-Connecting-IP": "192.0.2.5", "X-Forwarded-For": "5.6.7.8" }), env);
  expect(env.API_RATE_LIMITER!.limit).toHaveBeenNthCalledWith(1, { key: "api:192.0.2.5" });
  expect(env.API_RATE_LIMITER!.limit).toHaveBeenNthCalledWith(2, { key: "api:192.0.2.5" });
});
it("applies the tighter auth budget without applying it to practice traffic", async () => {
  const env = configured();
  await enforcePerimeter(request("/api/v1/auth/signup/code"), env);
  expect(env.AUTH_RATE_LIMITER!.limit).toHaveBeenCalledWith({ key: "auth:unknown-ingress" });
  await enforcePerimeter(request("/api/v1/organizations/club/practice/rooms/room/socket"), env);
  expect(env.AUTH_RATE_LIMITER!.limit).toHaveBeenCalledTimes(1);
});
it("rejects saturated traffic before subsequent work and fails closed if production bindings disappear", async () => {
  const env = configured(); env.API_RATE_LIMITER = limiter(false);
  await expect(enforcePerimeter(request("/api/v1/auth/login"), env)).rejects.toMatchObject({ status: 429 });
  expect(env.AUTH_RATE_LIMITER!.limit).not.toHaveBeenCalled();
  delete env.API_RATE_LIMITER;
  await expect(enforcePerimeter(request(), env)).rejects.toMatchObject({ status: 503 });
});
it("keeps local fixtures available without production bindings and rejects oversized URLs cheaply", async () => {
  await expect(enforcePerimeter(request(), {})).resolves.toBeUndefined();
  const env = configured();
  await expect(enforcePerimeter(request(`/api/v1/${"x".repeat(2050)}`), env)).rejects.toMatchObject({ status: 414 });
  expect(env.API_RATE_LIMITER!.limit).not.toHaveBeenCalled();
});
it("does not accept spoofed IP headers from direct callers without Cloudflare metadata", async () => {
  const env = configured();
  await enforcePerimeter(new Request("https://erudoza.com/api/v1/me", { headers: { "CF-Connecting-IP": "192.0.2.5" } }), env);
  expect(env.API_RATE_LIMITER!.limit).toHaveBeenCalledWith({ key: "api:untrusted-ingress" });
});
