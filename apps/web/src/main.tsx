import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { AppProviders } from "./app/providers";
import "./styles/index.css";

function renderApp() {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <AppProviders>
        <App />
      </AppProviders>
    </StrictMode>,
  );
}

// Vite can move the async module into <head>. Wait for parsing, not
// DOMContentLoaded: optional deferred third-party scripts can delay that event.
if (document.readyState === "loading") {
  document.addEventListener("readystatechange", renderApp, { once: true });
} else {
  renderApp();
}
