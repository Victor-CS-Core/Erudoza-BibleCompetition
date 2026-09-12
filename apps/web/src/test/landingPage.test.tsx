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
      "Rooted in Scripture. Ready for the journey.",
    );
    expect(within(main).getByText(/Learn your assigned passages/))
      .toBeInTheDocument();
    expect(within(main).getByText("Use the account provided by your coach."))
      .toBeInTheDocument();
    expect(within(main).getByRole("heading", { level: 2, name: "Guide your team’s next step." }))
      .toBeInTheDocument();
    expect(within(main).getByText(/Assign passages and see where each student needs practice/))
      .toBeInTheDocument();
  });

  it("presents learning, due review, and competition rehearsal in order", () => {
    renderLanding();

    const training = screen.getByRole("region", { name: "Your training, chapter by chapter." });
    const steps = within(within(training).getByRole("list")).getAllByRole("listitem");
    expect(steps).toHaveLength(3);
    expect(within(steps[0]).getByRole("heading", { level: 3, name: "Learn your passages" }))
      .toBeInTheDocument();
    expect(steps[0]).toHaveTextContent("Read the Scripture your coach assigns, then work through it a few verses at a time.");
    expect(within(steps[1]).getByRole("heading", { level: 3, name: "Review with purpose" }))
      .toBeInTheDocument();
    expect(steps[1]).toHaveTextContent("Return to the verses you missed and review them when they’re due.");
    expect(within(steps[2]).getByRole("heading", { level: 3, name: "Rehearse with your team" }))
      .toBeInTheDocument();
    expect(steps[2]).toHaveTextContent("Try a timed rehearsal or answer questions together in your coach’s practice room.");
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
    expect(screen.getByRole("link", { name: "Create your club" })).toHaveAttribute("href", "/signup");

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
    expect(screen.getByRole("img", { name: /An open Bible, compass and Pathfinder neckerchief/ }))
      .toBeInTheDocument();
    expect(screen.getByRole("contentinfo")).toHaveTextContent("Study. Master. Compete.");
  });

  it("labels decorative Honors as examples without presenting earned progress", () => {
    renderLanding();
    const preview = screen.getByRole("figure", { name: /A glimpse of Erudoza Honors/ });
    expect(preview).toHaveTextContent("Sample artwork");
    expect(preview).not.toHaveTextContent(/unlocked|earned|\d+%/i);
    expect(within(preview).queryByRole("button")).not.toBeInTheDocument();
    expect(within(preview).queryByRole("link")).not.toBeInTheDocument();
  });
});

it("offers phone installation help without relying on a browser install prompt", () => {
  renderLanding();
  expect(screen.getAllByRole("button", { name: "Install app" })[0]).toBeVisible();
});
