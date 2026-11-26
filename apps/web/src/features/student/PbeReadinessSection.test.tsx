import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { TrainingToday } from "../../api/trainingTypes";
import { PbeReadinessSection } from "./PbeReadinessSection";

vi.mock("../../api/training", () => ({ trainingApi: { pbeReadiness: async () => ({ version: "pbe-readiness-v1", seasonId: "season-1", dimensions: [{ key: "Coverage", percent: 40, basis: "Targets practiced." }, { key: "Recall", percent: null, basis: "Recall basis." }, { key: "Precision", percent: null, basis: "Precision basis." }, { key: "Reference", percent: null, basis: "Reference basis." }, { key: "Composure", percent: null, basis: "Composure basis." }, { key: "Team", percent: null, basis: "Team basis." }] }) } }));

const today = {
  seasonId: "season-1",
  nextAction: { label: "Continue your PBE checkpoint", mode: "Checkpoint", sessionId: null },
  honors: [
    { key: "a", ruleVersion: "training-v1", title: "First Steps", completed: 1, target: 1, earnedAtUtc: "2026-11-20T00:00:00Z", scopeLabel: "", evidenceSessionId: null },
    { key: "b", ruleVersion: "training-v1", title: "Steady Ten", completed: 3, target: 5, earnedAtUtc: null, scopeLabel: "", evidenceSessionId: null },
  ],
} as unknown as TrainingToday;

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><PbeReadinessSection seasonId="season-1" today={today} /></MemoryRouter></QueryClientProvider>);
}

describe("PbeReadinessSection (card 48)", () => {
  it("composes hero next action, all seven run cards, the dimensions panel, and the patch strip from the existing summary", async () => {
    renderSection();
    // Hero: the summary's own nextAction, linked to that mode's study URL.
    const action = screen.getByTestId("pbe-readiness-next-action");
    expect(action.textContent).toBe("Continue your PBE checkpoint");
    expect(action.getAttribute("href")).toBe("/student/study?mode=Checkpoint&format=Pbe&seasonId=season-1");
    expect(screen.getByRole("heading", { name: "PBE Readiness" })).toBeTruthy();
    // Run cards: every solo run type is reachable with its real mode.
    for (const mode of ["Practice", "Rescue", "Review", "Checkpoint", "MockHalf", "MockFull", "Simulation"]) {
      const link = screen.getByTestId(`pbe-run-${mode}`);
      expect(link.getAttribute("href")).toBe(`/student/study?mode=${mode}&format=Pbe&seasonId=season-1`);
    }
    expect(screen.getByText("90 questions · official clock")).toBeTruthy();
    // Dimensions panel (card 49) is mounted and renders its data.
    expect(await screen.findByText("Coverage")).toBeTruthy();
    expect(screen.getByText("40%")).toBeTruthy();
    // Patch strip: earned honor shown, next honor named with real progress.
    expect(screen.getByText("First Steps")).toBeTruthy();
    expect(screen.getByText(/Next up: Steady Ten \(3 of 5\)/)).toBeTruthy();
    // No third-HQ naming and no progression ladder anywhere.
    expect(screen.queryByText(/Practice HQ/)).toBeNull();
    expect(screen.queryByText(/Responder|Captain's path|Team skill/)).toBeNull();
  });
});
