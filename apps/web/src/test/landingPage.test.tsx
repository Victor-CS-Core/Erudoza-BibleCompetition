import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { LandingPage } from "../features/marketing/LandingPage";

function renderLanding() {
  return render(
    <MemoryRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<h1>Account sign in</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("LandingPage", () => {
  it("introduces assigned Scripture training and the coach-managed account workflow", () => {
    renderLanding();

    const main = screen.getByRole("main");
    expect(within(main).getByRole("heading", { level: 1 })).toHaveTextContent(
      "Know the passage.Own the moment.",
    );
    expect(within(main).getByText(/Study your assigned passages, strengthen your recall, and prepare together/))
      .toBeInTheDocument();
    expect(within(main).getByText("Sign in with the account provided by your coach or academy."))
      .toBeInTheDocument();
    expect(within(main).getByRole("heading", { level: 2, name: "Give every student a clear next step." }))
      .toBeInTheDocument();
    expect(within(main).getByText(/Choose a season’s passages, set each student’s difficulty, and follow their progress/))
      .toBeInTheDocument();
  });

  it("presents learning, due review, and competition rehearsal in order", () => {
    renderLanding();

    const training = screen.getByRole("region", { name: "A clear path to confident recall." });
    const steps = within(within(training).getByRole("list")).getAllByRole("listitem");
    expect(steps).toHaveLength(3);
    expect(within(steps[0]).getByRole("heading", { level: 3, name: "Learn your passages" }))
      .toBeInTheDocument();
    expect(steps[0]).toHaveTextContent("Restore missing words, rebuild verses, and match references from the Scripture your coach assigns.");
    expect(within(steps[1]).getByRole("heading", { level: 3, name: "Review what needs attention" }))
      .toBeInTheDocument();
    expect(steps[1]).toHaveTextContent("Return to due verses and follow your saved progress as your recall grows.");
    expect(within(steps[2]).getByRole("heading", { level: 3, name: "Rehearse for competition" }))
      .toBeInTheDocument();
    expect(steps[2]).toHaveTextContent("Practice under time pressure in a simulation or join your team in a coach-led room.");
    expect(training).not.toHaveTextContent(/%|streak/i);
  });

  it("routes student and coach calls to action to sign in", () => {
    renderLanding();

    const header = screen.getByRole("banner");
    expect(within(header).getByRole("link", { name: "Erudoza home" })).toHaveAttribute("href", "/");
    expect(within(header).getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
    const start = screen.getByRole("link", { name: "Start studying" });
    expect(start).toHaveAttribute("href", "/login");
    expect(screen.getByRole("link", { name: "Coach your team" })).toHaveAttribute("href", "/login");
    expect(screen.getByRole("link", { name: "Sign in as a coach" })).toHaveAttribute("href", "/login");
    expect(screen.getByRole("link", { name: /Create a club with a coach account/ })).toHaveAttribute("href", "/signup");

    fireEvent.click(start);
    expect(screen.getByRole("heading", { name: "Account sign in" })).toBeInTheDocument();
  });

  it("provides accessible page landmarks and preserves the Erudoza landscape branding", () => {
    const { container } = renderLanding();

    const main = screen.getByRole("main");
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveAttribute("href", `#${main.id}`);
    expect(main.id).not.toBe("");
    expect(screen.getByRole("banner").compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
    expect(main.compareDocumentPosition(screen.getByRole("contentinfo")) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
    expect(container.firstElementChild).toHaveClass("training-public");
    const home = screen.getByRole("link", { name: "Erudoza home" });
    expect(home).toHaveTextContent("Erudoza");
    const mark = within(home).getByTestId("erudoza-mark");
    expect(mark).toHaveAttribute("src", "/brand/erudoza-patch-96.webp");
    expect(mark).toHaveAttribute("alt", "");
    expect(screen.getByRole("img", { name: "Mountains and forest surrounding an open valley" }))
      .toBeInTheDocument();
    expect(screen.getByRole("contentinfo")).toHaveTextContent("SCRIPTURE · DISCIPLESHIP · REAL-WORLD FAITH");
  });
});
