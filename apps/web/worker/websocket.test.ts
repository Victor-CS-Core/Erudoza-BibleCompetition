// @vitest-environment node
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import ts from "typescript";
import { expect, it } from "vitest";

it("passes a real workerd WebSocket upgrade and bidirectional frames through the API bridge", async () => {
  const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  const script = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  const runtime = new Miniflare({
    workers: [
      {
        name: "bridge", modules: true, script, compatibilityDate: "2026-05-22",
        bindings: { ERUDOZA_API_BASE_URL: "https://api.erudoza.test" },
        outboundService: "upstream",
      },
      {
        name: "upstream", modules: true, compatibilityDate: "2026-05-22",
        script: `export default { fetch(request) {
          if (request.headers.get("Cookie") !== "erudoza.auth=test") return new Response("Unauthorized", {status:401});
          const pair = new WebSocketPair();
          pair[1].accept();
          pair[1].addEventListener("message", event => pair[1].send(event.data));
          return new Response(null, {status:101, webSocket:pair[0]});
        } };`,
      },
    ],
  });
  try {
    const response = await runtime.dispatchFetch("https://erudoza.test/api/v1/pvp/hub?id=room", {
      headers: { Upgrade: "websocket", Cookie: "erudoza.auth=test" },
    });
    expect(response.status).toBe(101);
    const socket = response.webSocket;
    expect(socket).not.toBeNull();
    socket!.accept();
    const echo = new Promise<unknown>((resolve) => {
      socket!.addEventListener("message", (event) => resolve(event.data), { once: true });
    });
    socket!.send("practice-frame");
    expect(await echo).toBe("practice-frame");
    socket!.close(1000);
  } finally {
    await runtime.dispose();
  }
}, 20_000);
