import { cloudflare } from "@cloudflare/vite-plugin";
import { sites } from "@openai/sites-vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";
import { coffeeWidgetPlugin } from "./scripts/coffeeWidgetPlugin.ts";

export default defineConfig({
  plugins: [react(), tailwindcss(), coffeeWidgetPlugin(), sites(), cloudflare()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:5080",
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
