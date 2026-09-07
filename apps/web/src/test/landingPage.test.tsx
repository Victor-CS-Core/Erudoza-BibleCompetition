import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { LandingPage } from "../features/marketing/LandingPage";

function renderLanding() {
  render(
    <MemoryRouter>
      <LandingPage />
    </MemoryRouter>,
  );
}

describe("LandingPage", () => {
  it("opens on the Field Guide Academy cover and keeps the training decks", () => {
    renderLanding();

    const cover = screen.getByTestId("field-guide-academy");
    expect(screen.getByRole("heading", { name: "Field Guide Academy" })).toBeInTheDocument();
    expect(screen.queryByTestId("academy-chapter-line")).not.toBeInTheDocument();
    expect(cover).not.toHaveTextContent("%");
    expect(cover).not.toHaveTextContent("streak");
    expect(screen.getByRole("heading", { name: /Know the passage/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Choose today’s training deck" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "New deck" })).toHaveAttribute("src", "/brand/deck-new.webp");
    expect(screen.getByRole("img", { name: "Review deck" })).toHaveAttribute("src", "/brand/deck-review.webp");
    expect(screen.getByRole("img", { name: "Simulation deck" })).toHaveAttribute(
      "src",
      "/brand/deck-simulation.webp",
    );
    expect(screen.getByTestId("start-studying")).toBeInTheDocument();
    expect(screen.getByTestId("build-a-season")).toBeInTheDocument();
  });
});
