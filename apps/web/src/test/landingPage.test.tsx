import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { LandingPage } from "../features/marketing/LandingPage";

describe("LandingPage", () => {
  it("presents the three Bible Bowl training decks with their supplied artwork", () => {
    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>,
    );

    expect(screen.getByText("Field Guide Academy")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Choose today’s training deck" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "New deck" })).toHaveAttribute("src", "/brand/deck-new.webp");
    expect(screen.getByRole("img", { name: "Review deck" })).toHaveAttribute("src", "/brand/deck-review.webp");
    expect(screen.getByRole("img", { name: "Simulation deck" })).toHaveAttribute(
      "src",
      "/brand/deck-simulation.webp",
    );
  });
});
