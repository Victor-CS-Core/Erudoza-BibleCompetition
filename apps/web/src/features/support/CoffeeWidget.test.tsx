import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { CoffeeWidget } from "./CoffeeWidget";

afterEach(() => vi.unstubAllEnvs());

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
