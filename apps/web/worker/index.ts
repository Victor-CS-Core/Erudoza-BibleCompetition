type Env = {
  ERUDOZA_API_BASE_URL?: string;
};

function unavailable(detail: string) {
  return Response.json(
    { title: "Service unavailable", detail },
    {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const requestUrl = new URL(request.url);
    if (!requestUrl.pathname.startsWith("/api/")) {
      return new Response("Not found", { status: 404 });
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
    if (apiBase.protocol !== "https:" && !isLocalDevelopment) {
      return unavailable("The Erudoza API connection must use HTTPS.");
    }

    const upstreamUrl = new URL(
      `${requestUrl.pathname}${requestUrl.search}`,
      `${apiBase.toString().replace(/\/$/, "")}/`,
    );
    const headers = new Headers(request.headers);
    headers.delete("host");
    const upstreamInit: RequestInit & { duplex?: "half" } = {
      method: request.method,
      headers,
      redirect: "manual",
    };
    if (request.method !== "GET" && request.method !== "HEAD") {
      upstreamInit.body = request.body;
      upstreamInit.duplex = "half";
    }
    const upstreamRequest = new Request(upstreamUrl, upstreamInit);

    return fetch(upstreamRequest);
  },
};
