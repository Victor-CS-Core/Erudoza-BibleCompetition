import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyTheme, getThemePreference, resolveTheme, setThemePreference } from "./theme";

function mockMatchMedia(dark: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    matches: dark,
    addEventListener: (_: string, fn: () => void) => { listeners.add(fn); },
    removeEventListener: (_: string, fn: () => void) => { listeners.delete(fn); },
  };
  Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value: () => query });
  return { query, listeners };
}

describe("theme preference", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.style.colorScheme = "";
  });

  it("defaults to the system theme when nothing is saved", () => {
    expect(getThemePreference()).toBe("system");
  });

  it("reads a saved light or dark preference and ignores junk", () => {
    localStorage.setItem("erudoza:theme", "dark");
    expect(getThemePreference()).toBe("dark");
    localStorage.setItem("erudoza:theme", "banana");
    expect(getThemePreference()).toBe("system");
  });

  it("follows the phone's dark mode while the preference is system", () => {
    mockMatchMedia(true);
    expect(resolveTheme("system")).toBe("dark");
    mockMatchMedia(false);
    expect(resolveTheme("system")).toBe("light");
  });

  it("a pinned preference wins over the system theme", () => {
    mockMatchMedia(true);
    expect(resolveTheme("light")).toBe("light");
    mockMatchMedia(false);
    expect(resolveTheme("dark")).toBe("dark");
  });

  it("applies the resolved theme to <html> and the theme-color meta", () => {
    mockMatchMedia(true);
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    meta.content = "#102e47";
    document.head.appendChild(meta);
    try {
      expect(applyTheme("system")).toBe("dark");
      expect(document.documentElement.dataset.theme).toBe("dark");
      expect(document.documentElement.style.colorScheme).toBe("dark");
      expect(meta.content).toBe("#0c0b09");
      applyTheme("light");
      expect(document.documentElement.dataset.theme).toBe("light");
      expect(meta.content).toBe("#102e47");
    } finally {
      meta.remove();
    }
  });

  it("persists the preference when it changes", () => {
    mockMatchMedia(false);
    setThemePreference("dark");
    expect(localStorage.getItem("erudoza:theme")).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("survives unavailable storage", () => {
    mockMatchMedia(false);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    try {
      expect(getThemePreference()).toBe("system");
      expect(setThemePreference("dark")).toBe("dark");
      expect(document.documentElement.dataset.theme).toBe("dark");
    } finally {
      vi.restoreAllMocks();
    }
  });
});
