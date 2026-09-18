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

export function setThemePreference(preference: ThemePreference): ResolvedTheme {
  try {
    localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    /* The preference still applies for this visit. */
  }
  return applyTheme(preference);
}

const ORDER: ThemePreference[] = ["system", "light", "dark"];

/** Keeps <html data-theme> in sync with the preference and the OS theme. */
export function useTheme(): { preference: ThemePreference; resolved: ResolvedTheme; cycle: () => void } {
  const [preference, setPreferenceState] = useState<ThemePreference>(getThemePreference);
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(getThemePreference()));

  useEffect(() => {
    setResolved(applyTheme(preference));
    const query = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    if (preference !== "system" || !query) return;
    const onChange = () => setResolved(applyTheme("system"));
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [preference]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return;
      const next = getThemePreference();
      setPreferenceState(next);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const cycle = () => {
    const next = ORDER[(ORDER.indexOf(preference) + 1) % ORDER.length];
    setPreferenceState(next);
    setResolved(setThemePreference(next));
  };

  return { preference, resolved, cycle };
}

/** Mount once near the app root so every page follows the theme. */
export function ApplyTheme() {
  useTheme();
  return null;
}
