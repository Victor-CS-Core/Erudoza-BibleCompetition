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
    expect(screen.getByRole("img", { name: "Learner deck" })).toHaveAttribute("src", "/brand/deck-new.webp");
    expect(screen.getByRole("img", { name: "Reviews deck" })).toHaveAttribute("src", "/brand/deck-review.webp");
    expect(screen.getByRole("img", { name: "Rehearsal deck" })).toHaveAttribute(
      "src",
      "/brand/deck-simulation.webp",
    );
    expect(screen.queryByRole("img", { name: "New deck" })).not.toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Review deck" })).not.toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Simulation deck" })).not.toBeInTheDocument();
    expect(screen.getByTestId("start-studying")).toBeInTheDocument();
    expect(screen.getByTestId("build-a-season")).toBeInTheDocument();
    expect(screen.getByText(/due reviews, and realistic rehearsal/)).toBeInTheDocument();
    expect(screen.getByText("Your team chooses the passage. Erudoza deals the deck.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Drill only the assigned Scripture." })).toBeInTheDocument();
    expect(
      screen.getByText("Timed rehearsal turns growing recall into confident Bible Bowl performance."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/practice/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/simulation/i)).not.toBeInTheDocument();
  });
});
