import { render, screen } from "@testing-library/react";
import { ErudozaWordmark } from "../components/brand/ErudozaWordmark";

describe("ErudozaWordmark", () => {
  it("renders the product name and tagline", () => {
    render(<ErudozaWordmark />);
    expect(screen.getByText("Erudoza")).toBeInTheDocument();
    expect(screen.getByText("Study. Master. Compete.")).toBeInTheDocument();
  });
});
