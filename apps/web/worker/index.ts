type Env = {
  ERUDOZA_API_BASE_URL?: string;
};

function unavailable(detail: string) {
  return Response.json(
    { title: "Service unavailable", detail },
    {
      status: 503,
      headers: { "Cache-Control": "no-store", "Retry-After": "15" },
    },
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const requestUrl = new URL(request.url);
    if (!requestUrl.pathname.startsWith("/api/")) {
      return new Response("Not found", { status: 404 });
    }
    const isWebSocket = request.headers.get("upgrade")?.toLowerCase() === "websocket";
    if (request.headers.has("upgrade") &&
      (!isWebSocket || request.method !== "GET" || requestUrl.pathname !== "/api/v1/pvp/hub")) {
      return new Response("Unsupported upgrade", { status: 400 });
    }

    const configuredBase = env.ERUDOZA_API_BASE_URL?.trim();
    if (!configuredBase) {
      return unavailable("The Erudoza API has not been connected to this deployment yet.");
    }

    let apiBase: URL;
    try {
      apiBase = new URL(configuredBase);
    } catch {
      return unavailable("The Erudoza API connection is not configured correctly.");
    }

    const isLocalDevelopment = apiBase.hostname === "localhost" || apiBase.hostname === "127.0.0.1";
    if (apiBase.protocol !== "https:" && !(apiBase.protocol === "http:" && isLocalDevelopment)) {
      return unavailable("The Erudoza API connection must use HTTPS.");
    }
    if (apiBase.username || apiBase.password || apiBase.origin === requestUrl.origin) {
      return unavailable("The Erudoza API connection is not configured correctly.");
    }

    const upstreamUrl = new URL(
      `${requestUrl.pathname}${requestUrl.search}`,
      `${apiBase.toString().replace(/\/$/, "")}/`,
    );
    const headers = new Headers(request.headers);
    headers.delete("host");
    // Never trust caller-supplied proxy identity headers at the API boundary.
    headers.delete("forwarded");
    headers.delete("x-forwarded-for");
    headers.delete("x-forwarded-host");
    headers.delete("x-forwarded-proto");
    const upstreamInit: RequestInit & { duplex?: "half" } = {
      method: request.method,
      headers,
      redirect: "manual",
      // A match connection must outlive the ordinary HTTP request timeout.
      ...(isWebSocket ? {} : { signal: AbortSignal.timeout(15_000) }),
    };
    if (request.method !== "GET" && request.method !== "HEAD") {
      upstreamInit.body = request.body;
      upstreamInit.duplex = "half";
    }
    const upstreamRequest = new Request(upstreamUrl, upstreamInit);

    try {
      const response = await fetch(upstreamRequest);
      // Workers' 101 response owns the upgraded webSocket. Reconstructing it with
      // the standard Response fields silently discards the live connection.
      if (isWebSocket && response.status === 101) return response;
      if (response.status >= 500) {
        await response.body?.cancel();
        return unavailable("Erudoza is temporarily unavailable. Please try again shortly.");
      }
      const responseHeaders = new Headers(response.headers);
      responseHeaders.set("Cache-Control", "no-store");
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers: responseHeaders });
    } catch {
      // DNS, TLS, connection failures and timeouts must not expose internal details.
      return unavailable("Erudoza is temporarily unavailable. Please try again shortly.");
    }
  },
};
