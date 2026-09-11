import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { coffeeWidgetPlugin } from "./scripts/coffeeWidgetPlugin.ts";
export default defineConfig({
  plugins: [react(), tailwindcss(), coffeeWidgetPlugin()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  define: { "import.meta.env.VITE_NATIVE_CLOUDFLARE": JSON.stringify("true"), "import.meta.env.VITE_API_BASE_URL": JSON.stringify("") },
  build: { outDir: "dist-native" },
  server: { port: 5174, proxy: { "/api": { target: "http://localhost:8787", changeOrigin: false, ws: true } } }
});
