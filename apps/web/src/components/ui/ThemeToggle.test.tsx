import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { ThemeToggle } from "./ThemeToggle";
import { useTheme } from "../../theme";

function mockMatchMedia(dark: boolean) {
  const query = {
    matches: dark,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value: () => query });
}

/** A second hook instance, like the banner's ThemedImage — it must stay in sync. */
function ResolvedProbe() {
  const { resolved } = useTheme();
  return <span data-testid="resolved-probe">{resolved}</span>;
}

describe("ThemeToggle", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.style.colorScheme = "";
    mockMatchMedia(false); // phone in light mode
  });

  it("renders a switch that starts off in light theme", () => {
    render(<ThemeToggle />);
    const toggle = screen.getByRole("switch", { name: /dark theme is off/i });
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  it("flips between light and dark and pins an explicit preference", () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("switch"));
    expect(localStorage.getItem("erudoza:theme")).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    const on = screen.getByRole("switch", { name: /dark theme is on/i });
    expect(on).toHaveAttribute("aria-checked", "true");
    fireEvent.click(on);
    expect(localStorage.getItem("erudoza:theme")).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
  });

  it("reflects the phone's theme until touched, then pins the flip", () => {
    mockMatchMedia(true); // phone in dark mode
    render(<ThemeToggle />);
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("switch"));
    expect(localStorage.getItem("erudoza:theme")).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
  });

  it("keeps every hook instance in sync when the preference changes", () => {
    mockMatchMedia(true); // phone in dark mode: stale instances used to keep showing dark
    render(<><ThemeToggle /><ResolvedProbe /></>);
    expect(screen.getByTestId("resolved-probe")).toHaveTextContent("dark");
    fireEvent.click(screen.getByRole("switch")); // pin light
    expect(screen.getByTestId("resolved-probe")).toHaveTextContent("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
