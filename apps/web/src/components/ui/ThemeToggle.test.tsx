import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { ThemeToggle } from "./ThemeToggle";

describe("ThemeToggle", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("starts on automatic and cycles through light and dark", () => {
    render(<ThemeToggle />);
    const button = screen.getByRole("button", { name: /theme: automatic/i });
    expect(button).toHaveAccessibleName(expect.stringMatching(/switch to light/i));

    fireEvent.click(button);
    expect(localStorage.getItem("erudoza:theme")).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(screen.getByRole("button", { name: /theme: light/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /theme: light/i }));
    expect(localStorage.getItem("erudoza:theme")).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");

    fireEvent.click(screen.getByRole("button", { name: /theme: dark/i }));
    expect(localStorage.getItem("erudoza:theme")).toBe("system");
  });
});
