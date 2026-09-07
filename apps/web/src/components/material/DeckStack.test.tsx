import { render, screen } from "@testing-library/react";
import { DeckStack } from "./DeckStack";

describe("DeckStack", () => {
  it("labels today's deck with academy tracks and honest fields", () => {
    render(<DeckStack learner={2} reviews={3} seasonStatus="Active" />);

    expect(screen.getByTestId("deck-stack")).toHaveTextContent("Learner");
    expect(screen.getByTestId("deck-stack")).toHaveTextContent("Reviews");
    expect(screen.getByTestId("deck-stack")).toHaveTextContent("Rehearsal");
    expect(screen.getByTestId("deck-learner")).toHaveTextContent("2");
    expect(screen.getByTestId("deck-reviews")).toHaveTextContent("3");
    expect(screen.getByTestId("deck-rehearsal")).toHaveTextContent("Active");
    expect(screen.getByTestId("deck-stack")).not.toHaveTextContent("Due");
    expect(screen.getByTestId("deck-stack")).not.toHaveTextContent("New");
    expect(screen.queryByTestId("deck-due")).not.toBeInTheDocument();
  });

  it("shows an em dash when rehearsal has no season status", () => {
    render(<DeckStack learner={0} reviews={0} />);

    expect(screen.getByTestId("deck-rehearsal")).toHaveTextContent("—");
  });
});
