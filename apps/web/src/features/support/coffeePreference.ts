import { useSyncExternalStore } from "react";

const key = "erudoza:coffee-minimized:v1";
const read = () => { try { return localStorage.getItem(key) === "1"; } catch { return false; } };
let minimized = read();
const listeners = new Set<() => void>();
const publish = (value: boolean) => {
  if (value === minimized) return;
  minimized = value;
  listeners.forEach(listener => listener());
};
// This browser-wide preference survives account changes and SPA navigation.
window.addEventListener("storage", event => {
  try {
    if (event.storageArea === localStorage && (event.key === key || event.key === null)) publish(read());
  } catch { /* Keep the current visit's choice when storage is unavailable. */ }
});
export const coffeeMinimized = () => minimized;
export function setCoffeeMinimized(value: boolean) {
  try { localStorage.setItem(key, value ? "1" : "0"); } catch { /* Still applies for this visit. */ }
  publish(value);
}
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const useCoffeeMinimized = () => useSyncExternalStore(subscribe, coffeeMinimized);
