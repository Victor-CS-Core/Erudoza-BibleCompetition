import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadEnv, type Plugin } from "vite";
import { COFFEE_WIDGET_SCRIPT_URL, parseCoffeeProfile } from "../src/features/support/coffeeConfig.ts";

const visibilityGuard = `html:not([data-erudoza-coffee-ready="true"]) :is(#bmc-wbtn, #bmc-iframe, #bmc-close-btn) { display: none !important; }`;

export function coffeeWidgetPlugin(): Plugin {
  let profile: ReturnType<typeof parseCoffeeProfile> = null;
  let color = "";
  return {
    name: "erudoza-coffee-widget",
    async configResolved(config) {
      const env = loadEnv(config.mode, config.envDir, "VITE_");
      profile = parseCoffeeProfile(env.VITE_BUY_ME_A_COFFEE_URL);
      if (!profile) return;
      const tokens = await readFile(path.join(config.root, "src/styles/tokens.css"), "utf8");
      const teal = tokens.match(/--er-teal:\s*(#[a-f\d]{6}|#[a-f\d]{3})\s*;/i)?.[1];
      if (!teal) throw new Error("The coffee widget needs a literal --er-teal color in src/styles/tokens.css.");
      color = teal;
    },
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        if (!profile || html.includes('id="erudoza-coffee-widget-script"')) return;
        return [
          {
            tag: "style",
            attrs: { id: "erudoza-coffee-visibility-guard" },
            children: visibilityGuard,
            injectTo: "head-prepend",
          },
          {
            tag: "script",
            attrs: {
              id: "erudoza-coffee-widget-script",
              src: COFFEE_WIDGET_SCRIPT_URL,
              defer: true,
              "data-cfasync": "false",
              "data-name": "BMC-Widget",
              "data-id": profile.creatorId,
              "data-description": "Support Erudoza",
              "data-message": "",
              "data-color": color,
              "data-position": "Right",
              "data-x_margin": "18",
              "data-y_margin": "18",
            },
            // Execute after the app module, while still preceding DOMContentLoaded.
            // This keeps a slow optional CDN out of the app's startup queue.
            injectTo: "body",
          },
        ];
      },
    },
  };
}
