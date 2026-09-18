import { useEffect, useState } from "react";

/** Theme preference: follow the phone/system, or pin light/dark. */
export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "erudoza:theme";
const THEME_COLORS: Record<ResolvedTheme, string> = { light: "#102e47", dark: "#0c0b09" };

export function getThemePreference(): ThemePreference {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark" || saved === "system") return saved;
  } catch {
    /* Storage can be unavailable; fall back to the system theme. */
  }
  return "system";
}

export function systemTheme(): ResolvedTheme {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === "system" ? systemTheme() : preference;
}

/** Applies the resolved theme to <html>. Safe to call before React mounts. */
export function applyTheme(preference: ThemePreference): ResolvedTheme {
  const resolved = resolveTheme(preference);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[resolved]);
  return resolved;
}

/**
 * Same-tab subscribers. Every useTheme() instance keeps its own React state,
 * so a preference change made through one instance (e.g. the theme toggle)
 * must re-sync the others — the storage event only fires in *other* tabs.
 */
type ThemeSync = () => void;
const themeListeners = new Set<ThemeSync>();

function readTheme(): { preference: ThemePreference; resolved: ResolvedTheme } {
  const preference = getThemePreference();
  return { preference, resolved: resolveTheme(preference) };
}

export function setThemePreference(preference: ThemePreference): ResolvedTheme {
  try {
    localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    /* The preference still applies for this visit. */
  }
  const resolved = applyTheme(preference);
  themeListeners.forEach((sync) => sync());
  return resolved;
}

/** Keeps <html data-theme> in sync with the preference and the OS theme. */
export function useTheme(): {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (next: ThemePreference) => void;
} {
  const [state, setState] = useState(readTheme);

  useEffect(() => {
    const sync = () => {
      const next = readTheme();
      // Re-apply so <html> reflects the saved preference even when the change
      // came from another hook instance or another tab.
      setState({ preference: next.preference, resolved: applyTheme(next.preference) });
    };
    themeListeners.add(sync);
    sync();
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) sync();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      themeListeners.delete(sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    const query = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    if (state.preference !== "system" || !query) return;
    const onChange = () => setState({ preference: "system", resolved: applyTheme("system") });
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [state.preference]);

  const setPreference = (next: ThemePreference) => {
    setThemePreference(next);
  };

  return { preference: state.preference, resolved: state.resolved, setPreference };
}

/** Mount once near the app root so every page follows the theme. */
export function ApplyTheme() {
  useTheme();
  return null;
}
