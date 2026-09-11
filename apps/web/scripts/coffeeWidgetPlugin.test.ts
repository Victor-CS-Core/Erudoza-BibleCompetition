// @vitest-environment node
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { JSDOM } from "jsdom";
import { createServer } from "vite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { coffeeWidgetPlugin } from "./coffeeWidgetPlugin";

const folders: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

async function transform(profile?: string, injectedProfile?: string, repeat = false) {
  const root = await mkdtemp(path.join(tmpdir(), "erudoza-coffee-plugin-"));
  folders.push(root);
  const envDir = path.join(root, "configuration");
  await mkdir(envDir);
  await mkdir(path.join(root, "src/styles"), { recursive: true });
  await writeFile(path.join(root, "src/styles/tokens.css"), ":root { --er-teal: #123456; }");
  await writeFile(path.join(envDir, ".env.widgettest"), `VITE_BUY_ME_A_COFFEE_URL=${profile ?? ""}\n`);
  vi.stubEnv("VITE_BUY_ME_A_COFFEE_URL", injectedProfile);
  const server = await createServer({
    root, envDir, mode: "widgettest", configFile: false, cacheDir: path.join(root, ".vite"),
    optimizeDeps: { noDiscovery: true, include: [] },
    plugins: [coffeeWidgetPlugin()],
    server: { middlewareMode: true, hmr: false, watch: null },
  });
  try {
    const original = "<!doctype html><html><head><title>Erudoza</title></head><body><div id='root'></div></body></html>";
    const first = await server.transformIndexHtml("/", original);
    const html = repeat ? await server.transformIndexHtml("/", first) : first;
    return { document: new JSDOM(html).window.document, html };
  } finally {
    await server.close();
  }
}

describe("coffeeWidgetPlugin", () => {
  it("reads the active mode and envDir and places one guarded deferred widget in the head", async () => {
    const { document } = await transform("https://www.buymeacoffee.com/TestCreator/");
    const scripts = document.querySelectorAll('script[data-name="BMC-Widget"]');
    expect(scripts).toHaveLength(1);
    const script = scripts[0];
    expect(script.parentElement).toBe(document.head);
    expect(script.getAttribute("src")).toBe("https://cdnjs.buymeacoffee.com/1.0.0/widget.prod.min.js");
    expect(script.hasAttribute("defer")).toBe(true);
    expect(script.hasAttribute("async")).toBe(false);
    expect(script.getAttribute("data-cfasync")).toBe("false");
    expect(script.getAttribute("data-id")).toBe("TestCreator");
    expect(script.getAttribute("data-description")).toBe("Support Erudoza");
    expect(script.getAttribute("data-message")).toBe("");
    expect(script.getAttribute("data-color")).toBe("#123456");
    expect(script.getAttribute("data-position")).toBe("Right");
    expect(script.getAttribute("data-x_margin")).toBe("18");
    expect(script.getAttribute("data-y_margin")).toBe("18");
    const guard = document.querySelector("style#erudoza-coffee-visibility-guard");
    expect(guard?.parentElement).toBe(document.head);
    expect(Boolean(guard!.compareDocumentPosition(script) & 4)).toBe(true);
    document.body.innerHTML = '<button id="bmc-wbtn"></button><iframe id="bmc-iframe"></iframe><button id="bmc-close-btn"></button>';
    for (const id of ["bmc-wbtn", "bmc-iframe", "bmc-close-btn"]) {
      expect(document.defaultView!.getComputedStyle(document.getElementById(id)!).display).toBe("none");
    }
    document.documentElement.dataset.erudozaCoffeeReady = "true";
    expect(document.defaultView!.getComputedStyle(document.getElementById("bmc-wbtn")!).display).not.toBe("none");
  });

  it.each([undefined, "", "http://buymeacoffee.com/TestCreator", "https://other.example/TestCreator"])(
    "does not load a third party or inject a guard when configuration is %s", async profile => {
      const { document } = await transform(profile);
      expect(document.querySelector('script[data-name="BMC-Widget"]')).toBeNull();
      expect(document.querySelector("#erudoza-coffee-visibility-guard")).toBeNull();
    },
  );

  it("respects a build-process value ahead of the env file", async () => {
    const { document } = await transform("https://buymeacoffee.com/FileCreator", "https://buymeacoffee.com/InjectedCreator");
    expect(document.querySelector('script[data-name="BMC-Widget"]')?.getAttribute("data-id")).toBe("InjectedCreator");
  });

  it("does not duplicate the provider script or guard when HTML is transformed again", async () => {
    const { document } = await transform("https://buymeacoffee.com/TestCreator", undefined, true);
    expect(document.querySelectorAll('script[data-name="BMC-Widget"]')).toHaveLength(1);
    expect(document.querySelectorAll("#erudoza-coffee-visibility-guard")).toHaveLength(1);
  });
});
