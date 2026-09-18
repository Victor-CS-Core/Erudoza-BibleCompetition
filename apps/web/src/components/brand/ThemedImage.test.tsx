import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ThemedImage } from "./ThemedImage";

function renderWithTheme(theme: string | null, props: Partial<Parameters<typeof ThemedImage>[0]> = {}) {
  const previous = window.localStorage.getItem("erudoza:theme");
  if (theme === null) window.localStorage.removeItem("erudoza:theme");
  else window.localStorage.setItem("erudoza:theme", theme);
  try {
    return render(<ThemedImage
      src="/assets/training/journey-hero-720.webp"
      srcSet="/assets/training/journey-hero-720.webp 720w, /assets/training/journey-hero-1440.webp 1440w"
      darkSrc="/assets/training/journey-hero-dark-720.webp"
      darkSrcSet="/assets/training/journey-hero-dark-720.webp 720w, /assets/training/journey-hero-dark-1440.webp 1440w"
      alt=""
      {...props}
    />);
  } finally {
    if (previous === null) window.localStorage.removeItem("erudoza:theme");
    else window.localStorage.setItem("erudoza:theme", previous);
  }
}

describe("ThemedImage", () => {
  it("uses the light artwork when the theme is light", () => {
    const { container } = renderWithTheme("light");
    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("/assets/training/journey-hero-720.webp");
    expect(img.getAttribute("srcset")).toContain("journey-hero-720.webp 720w");
  });

  it("swaps to the dark artwork when the resolved theme is dark", () => {
    const { container } = renderWithTheme("dark");
    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("/assets/training/journey-hero-dark-720.webp");
    expect(img.getAttribute("srcset")).toContain("journey-hero-dark-720.webp 720w");
    expect(img.getAttribute("srcset")).toContain("journey-hero-dark-1440.webp 1440w");
  });

  it("falls back to the dark src when no dark srcSet is given", () => {
    const { container } = renderWithTheme("dark", { darkSrcSet: undefined, srcSet: undefined });
    const img = container.querySelector("img")!;
    expect(img.getAttribute("srcset")).toBe("/assets/training/journey-hero-dark-720.webp");
  });
});
