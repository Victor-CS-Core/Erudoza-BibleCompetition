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
    expect(screen.getByText("Erudoza")).not.toHaveClass("sr-only");
    expect(screen.queryByTestId("erudoza-lettering")).not.toBeInTheDocument();
  });

  it("keeps compact branding accessible without a tagline or duplicate image names", () => {
    render(<a href="/"><ErudozaWordmark compact inverted /></a>);
    expect(screen.getByRole("link", { name: "Erudoza" })).toBeInTheDocument();
    expect(screen.queryByText("Study. Master. Compete.")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("img")).toHaveLength(0);
  });
});
