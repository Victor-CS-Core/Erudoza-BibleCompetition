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

// The app module precedes the deferred provider in document order. Keep the
// parsing guard for alternate entry hosts; never wait for DOMContentLoaded.
if (document.readyState === "loading") {
  document.addEventListener("readystatechange", renderApp, { once: true });
} else {
  renderApp();
}
