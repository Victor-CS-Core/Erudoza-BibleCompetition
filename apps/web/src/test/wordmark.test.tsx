import { render, screen } from "@testing-library/react";
import { ErudozaWordmark } from "../components/brand/ErudozaWordmark";

describe("ErudozaWordmark", () => {
  it("renders the product name and tagline", () => {
    render(<ErudozaWordmark />);
    expect(screen.getByText("Erudoza")).toBeInTheDocument();
    expect(screen.getByText("Study. Master. Compete.")).toBeInTheDocument();
    expect(screen.getByTestId("erudoza-mark")).toHaveAttribute("src", "/brand/erudoza-patch-96.webp");
    expect(screen.getByTestId("erudoza-mark")).toHaveAttribute("alt", "");
    expect(screen.getByTestId("erudoza-mark").parentElement).toHaveClass("ds-patch-art", "er-wordmark-mark");
    expect(screen.getByText("Erudoza").closest(".ds-patch-art")).toBeNull();
    expect(screen.getByText("Erudoza")).toHaveClass("sr-only");
    const lettering = screen.getByTestId("erudoza-lettering");
    expect(lettering).toHaveAttribute("src", "/brand/erudoza-wordmark-320.webp");
    expect(lettering).toHaveAttribute("srcset", "/brand/erudoza-wordmark-320.webp 320w, /brand/erudoza-wordmark-640.webp 640w");
    expect(lettering).toHaveAttribute("alt", "");
    expect(lettering).toHaveAttribute("loading", "eager");
    expect(lettering.parentElement).toHaveClass("ds-patch-art", "er-wordmark-lettering");
  });

  it("keeps compact branding accessible without a tagline or duplicate image names", () => {
    render(<a href="/"><ErudozaWordmark compact inverted /></a>);
    expect(screen.getByRole("link", { name: "Erudoza" })).toBeInTheDocument();
    expect(screen.queryByText("Study. Master. Compete.")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("img")).toHaveLength(0);
  });
});
