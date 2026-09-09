import { render, screen, within } from "@testing-library/react";
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
    const learner = screen.getByRole("link", { name: "Open the learner deck" });
    const reviews = screen.getByRole("link", { name: "Open the reviews deck" });
    const rehearsal = screen.getByRole("link", { name: "Open the rehearsal deck" });
    expect(within(learner).getByTestId("landing-deck-learner")).toHaveTextContent("Learner");
    expect(within(reviews).getByTestId("landing-deck-reviews")).toHaveTextContent("Reviews");
    expect(within(rehearsal).getByTestId("landing-deck-rehearsal")).toHaveTextContent("Rehearsal");
    expect(screen.queryByTestId("landing-deck-new")).not.toBeInTheDocument();
    expect(screen.queryByTestId("landing-deck-simulation")).not.toBeInTheDocument();
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

  it("stacks lockup, CTAs, and TRAINING DECKS in a portrait phone column", () => {
    renderLanding();

    const column = screen.getByTestId("landing-phone-column");
    expect(column).toHaveClass("er-landing-column");

    const lockup = within(column).getByTestId("field-guide-academy");
    const start = within(column).getByTestId("start-studying");
    const season = within(column).getByTestId("build-a-season");
    const decks = within(column).getByTestId("landing-training-decks");

    expect(lockup.compareDocumentPosition(start) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(start.compareDocumentPosition(season) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(season.compareDocumentPosition(decks) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(decks).getByRole("heading", { name: "TRAINING DECKS" })).toBeInTheDocument();
    expect(within(column).getByTestId("erudoza-mark")).toHaveAttribute("src", "/brand/erudoza-mark.png");
  });

  it("keeps Field Guide chrome on the landing column", () => {
    renderLanding();

    const chrome = within(screen.getByTestId("landing-phone-column")).getByTestId("landing-field-guide-chrome");
    expect(chrome).toHaveAttribute("aria-hidden", "true");
    expect(within(chrome).getByTestId("chrome-compass")).toBeInTheDocument();
    expect(within(chrome).getByTestId("chrome-mountain")).toBeInTheDocument();
    expect(within(chrome).getByTestId("chrome-forest")).toBeInTheDocument();
    expect(within(chrome).getByTestId("chrome-leaf")).toBeInTheDocument();
  });

  it("stacks training decks without a horizontal fan", () => {
    renderLanding();

    const decks = screen.getByTestId("landing-training-decks");
    expect(decks).toHaveClass("er-deck-stack");
    expect(decks).not.toHaveClass("er-deck-fan");
    expect(within(decks).getByTestId("landing-deck-learner")).toHaveTextContent("Learner");
    expect(within(decks).getByTestId("landing-deck-reviews")).toHaveTextContent("Reviews");
    expect(within(decks).getByTestId("landing-deck-rehearsal")).toHaveTextContent("Rehearsal");
    expect(decks).not.toHaveTextContent("%");
    expect(decks).not.toHaveTextContent("streak");
  });
});
