import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CoffeeFooter, CoffeeWidget } from "./CoffeeWidget";

import { setCoffeeMinimized } from "./coffeePreference";

beforeEach(() => { localStorage.clear(); setCoffeeMinimized(false); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it("keeps a real support link available when the provider cannot load, with the same eligibility", () => {
  vi.stubEnv("VITE_BUY_ME_A_COFFEE_URL", "https://buymeacoffee.com/erudoza");
  const view = render(<MemoryRouter><CoffeeWidget /></MemoryRouter>);
  expect(screen.getByRole("link", { name: /Buy me a coffee/ })).toHaveAttribute("href", "https://buymeacoffee.com/erudoza");
  view.rerender(<MemoryRouter><CoffeeWidget enabled={false} /></MemoryRouter>);
  expect(screen.queryByRole("link")).toBeNull();
  vi.stubEnv("VITE_BUY_ME_A_COFFEE_URL", "https://example.com/erudoza");
  view.rerender(<MemoryRouter><CoffeeWidget /></MemoryRouter>);
  expect(screen.queryByRole("link")).toBeNull();
});

it("minimizes the floating fallback and remembers the browser preference", () => {
  vi.stubEnv("VITE_BUY_ME_A_COFFEE_URL", "https://buymeacoffee.com/erudoza");
  render(<MemoryRouter><CoffeeWidget /></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: "Minimize support widget" }));
  expect(screen.queryByRole("link", { name: /Buy me a coffee/ })).toBeNull();
  expect(localStorage.getItem("erudoza:coffee-minimized:v1")).toBe("1");
});

it("offers eligible footer support and restores the floating controls with focus", () => {
  vi.stubEnv("VITE_BUY_ME_A_COFFEE_URL", "https://buymeacoffee.com/erudoza");
  const view = render(<MemoryRouter><CoffeeWidget /><footer><CoffeeFooter /></footer></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: "Minimize support widget" }));
  const link = screen.getByRole("link", { name: "Support Erudoza (opens in a new tab)" });
  expect(link).toHaveAttribute("href", "https://buymeacoffee.com/erudoza");
  expect(link).toHaveFocus();
  view.rerender(<MemoryRouter><CoffeeWidget enabled={false} /><CoffeeFooter enabled={false} /></MemoryRouter>);
  expect(screen.queryByRole("link")).toBeNull();
  view.rerender(<MemoryRouter><CoffeeWidget /><CoffeeFooter /></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: "Show floating support button" }));
  expect(screen.getByRole("button", { name: "Minimize support widget" })).toHaveFocus();
  expect(localStorage.getItem("erudoza:coffee-minimized:v1")).toBe("0");
  expect(screen.queryByRole("button", { name: "Show floating support button" })).toBeNull();
});

it("updates from another tab and clearing storage, but ignores unrelated preferences", () => {
  vi.stubEnv("VITE_BUY_ME_A_COFFEE_URL", "https://buymeacoffee.com/erudoza");
  render(<MemoryRouter><CoffeeWidget /><CoffeeFooter /></MemoryRouter>);
  act(() => {
    localStorage.setItem("erudoza:coffee-minimized:v1", "1");
    window.dispatchEvent(new StorageEvent("storage", { key: "unrelated", storageArea: localStorage }));
  });
  expect(screen.getByRole("button", { name: "Minimize support widget" })).toBeVisible();
  act(() => window.dispatchEvent(new StorageEvent("storage", { key: "erudoza:coffee-minimized:v1", storageArea: localStorage })));
  expect(screen.getByRole("button", { name: "Show floating support button" })).toBeVisible();
  act(() => { localStorage.clear(); window.dispatchEvent(new StorageEvent("storage", { key: null, storageArea: localStorage })); });
  expect(screen.getByRole("button", { name: "Minimize support widget" })).toBeVisible();
});

it("keeps an in-memory choice through remounts when storage writes fail", () => {
  vi.stubEnv("VITE_BUY_ME_A_COFFEE_URL", "https://buymeacoffee.com/erudoza");
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Denied", "SecurityError"); });
  const view = render(<MemoryRouter><CoffeeWidget /><CoffeeFooter /></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: "Minimize support widget" }));
  view.unmount();
  render(<MemoryRouter><CoffeeWidget /><CoffeeFooter /></MemoryRouter>);
  expect(screen.getByRole("button", { name: "Show floating support button" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Show floating support button" }));
  expect(screen.getByRole("button", { name: "Minimize support widget" })).toBeVisible();
});
