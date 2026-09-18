import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HelpTip, PageHeader } from "./index";

describe("HelpTip", () => {
  it("hides the detail message until the question-mark trigger is tapped", () => {
    render(<h2>Simulation patches<HelpTip label="About Simulation patches">Earned together through completed simulations.</HelpTip></h2>);
    expect(screen.queryByText("Earned together through completed simulations.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "About Simulation patches" }));
    expect(screen.getByText("Earned together through completed simulations.")).toBeVisible();
  });

  it("exposes the tooltip relationship and toggles on repeat taps", () => {
    render(<HelpTip label="About Team Honors">Arcade mastery Honors use finalized personal accuracy.</HelpTip>);
    const trigger = screen.getByRole("button", { name: "About Team Honors" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    const tip = screen.getByRole("tooltip");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger.getAttribute("aria-controls")).toBe(tip.id);
    fireEvent.click(trigger);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("dismisses on Escape and on outside press", () => {
    render(<><HelpTip label="About this section">Detail message.</HelpTip><button type="button">Elsewhere</button></>);
    const trigger = screen.getByRole("button", { name: "About this section" });
    fireEvent.click(trigger);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.click(trigger);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Elsewhere" }));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("renders a PageHeader help tooltip beside the title instead of a description paragraph", () => {
    render(<PageHeader title="Team Practice" help="Practice answering questions about your assigned Scripture as a team." />);
    expect(screen.queryByText("Practice answering questions about your assigned Scripture as a team.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "About Team Practice" }));
    expect(screen.getByText("Practice answering questions about your assigned Scripture as a team.")).toBeVisible();
  });
});
