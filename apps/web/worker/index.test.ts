import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./index";

describe("Sites API worker", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("returns a clear unavailable response until an API is configured", async () => {
    const response = await worker.fetch(new Request("https://erudoza.test/api/v1/me"), {});

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ title: "Service unavailable" });
  });

  it("does not act as a general-purpose proxy", async () => {
    const response = await worker.fetch(new Request("https://erudoza.test/admin"), {
      ERUDOZA_API_BASE_URL: "https://api.erudoza.test",
    });

    expect(response.status).toBe(404);
  });

  it.each(["/api/v1/me", "/api/v1/pvp/hub/negotiate"])("rejects upgrades outside the hub: %s", async (path) => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const response = await worker.fetch(new Request(`https://erudoza.test${path}`, {
      headers: { Upgrade: "websocket" },
    }), { ERUDOZA_API_BASE_URL: "https://api.erudoza.test" });
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves failed upgrade authentication and never installs the HTTP timeout", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("Unauthorized", { status: 401 }));
    const response = await worker.fetch(new Request("https://erudoza.test/api/v1/pvp/hub?id=connection", {
      headers: { Upgrade: "websocket", Cookie: "erudoza.auth=session" },
    }), { ERUDOZA_API_BASE_URL: "https://api.erudoza.test" });
    expect(timeout).not.toHaveBeenCalled();
    const upstream = fetchMock.mock.calls[0][0] as Request;
    expect(upstream.headers.get("upgrade")).toBe("websocket");
    expect(upstream.headers.get("cookie")).toBe("erudoza.auth=session");
    expect(upstream.url).toBe("https://api.erudoza.test/api/v1/pvp/hub?id=connection");
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects an insecure non-local API target", async () => {
    const response = await worker.fetch(new Request("https://erudoza.test/api/v1/me"), {
      ERUDOZA_API_BASE_URL: "http://api.erudoza.test",
    });

    expect(response.status).toBe(503);
  });

  it("preserves the API path, query, method, body, and cookies", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const request = new Request("https://erudoza.test/api/v1/study?mode=review", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: "erudoza.auth=session",
      },
      body: JSON.stringify({ answer: "Joshua" }),
    });

    const response = await worker.fetch(request, {
      ERUDOZA_API_BASE_URL: "https://api.erudoza.test/base/",
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
    const upstreamRequest = fetchMock.mock.calls[0][0] as Request;
    expect(upstreamRequest.url).toBe("https://api.erudoza.test/api/v1/study?mode=review");
    expect(upstreamRequest.method).toBe("POST");
    expect(upstreamRequest.headers.get("cookie")).toBe("erudoza.auth=session");
    await expect(upstreamRequest.json()).resolves.toEqual({ answer: "Joshua" });
  });

  it.each(["ftp://localhost", "https://user:secret@api.erudoza.test", "https://erudoza.test"])("rejects unsafe target %s", async (base) => {
    const upstream = vi.spyOn(globalThis, "fetch");
    const response = await worker.fetch(new Request("https://erudoza.test/api/v1/me"), { ERUDOZA_API_BASE_URL: base });
    expect(response.status).toBe(503);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("converts network failures into a private retryable outage response", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("internal-host secret TLS failure"));
    const response = await worker.fetch(new Request("https://erudoza.test/api/v1/me"), { ERUDOZA_API_BASE_URL: "https://api.erudoza.test" });
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).not.toContain("internal-host");
  });

  it("hides upstream server error bodies", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("database password stack trace", { status: 500 }));
    const response = await worker.fetch(new Request("https://erudoza.test/api/v1/me"), { ERUDOZA_API_BASE_URL: "https://api.erudoza.test" });
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("password");
  });

  it("returns an outage when the upstream timeout aborts the request", async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => new Promise((_resolve, reject) => {
      (input as Request).signal.addEventListener("abort", () => reject(new DOMException("Timed out", "AbortError")));
    }));
    const pending = worker.fetch(new Request("https://erudoza.test/api/v1/me"), { ERUDOZA_API_BASE_URL: "https://api.erudoza.test" });
    controller.abort();
    const response = await pending;
    expect(timeout).toHaveBeenCalledWith(15_000);
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("15");
  });

  it("preserves authentication responses and sets private caching while removing spoofed proxy headers", async () => {
    const upstream = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", {
      status: 401, headers: { "Set-Cookie": "erudoza.auth=; Max-Age=0; Secure; HttpOnly", "Cache-Control": "public" },
    }));
    const response = await worker.fetch(new Request("https://erudoza.test/api/v1/me", {
      headers: { "X-Forwarded-For": "spoofed", Forwarded: "for=spoofed", Origin: "https://erudoza.test" },
    }), { ERUDOZA_API_BASE_URL: "https://api.erudoza.test" });
    const request = upstream.mock.calls[0][0] as Request;
    expect(request.headers.get("x-forwarded-for")).toBeNull();
    expect(request.headers.get("forwarded")).toBeNull();
    expect(request.headers.get("origin")).toBe("https://erudoza.test");
    expect(request.signal).toBeDefined();
    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
