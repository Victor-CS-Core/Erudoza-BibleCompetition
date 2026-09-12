type InstallChoice = { outcome: "accepted" | "dismissed" };
type InstallPrompt = Event & { prompt(): Promise<InstallChoice | void>; userChoice?: Promise<InstallChoice> };
type Installation = { prompt: InstallPrompt | null; installed: boolean };
const displayMode = window.matchMedia?.("(display-mode: standalone)");
const isStandalone = () => Boolean(displayMode?.matches || (navigator as Navigator & { standalone?: boolean }).standalone);
let state: Installation = { prompt: null, installed: isStandalone() };
const listeners = new Set<() => void>();
const publish = (next: Installation) => { state = next; listeners.forEach(listener => listener()); };

// Listen for the lifetime of the application so navigation cannot discard an
// unconsumed browser prompt. Installation is always initiated by a user click.
window.addEventListener("beforeinstallprompt", event => {
  if (!("prompt" in event) || typeof event.prompt !== "function" || state.installed) return;
  event.preventDefault();
  publish({ prompt: event as InstallPrompt, installed: false });
});
window.addEventListener("appinstalled", () => publish({ prompt: null, installed: true }));
displayMode?.addEventListener("change", () => publish({ prompt: null, installed: isStandalone() }));

export const installation = () => state;
export const subscribeInstallation = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export async function installApp() {
  const prompt = state.prompt;
  if (!prompt) return;
  // A browser prompt is single-use, including dismissal and errors.
  publish({ ...state, prompt: null });
  const prompted = await prompt.prompt();
  const result = prompt.userChoice ? await prompt.userChoice : prompted;
  if (result?.outcome === "accepted") publish({ prompt: null, installed: true });
}
