import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./index";

describe("Sites API worker", () => {
  afterEach(() => {
    vi.restoreAllMocks();
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
});
