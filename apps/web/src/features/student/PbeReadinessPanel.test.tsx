import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PbeReadiness } from "../../api/pbeTypes";
import { PbeReadinessPanel } from "./PbeReadinessPanel";

const readiness = vi.hoisted(() => ({ current: null as PbeReadiness | null, fail: false }));
vi.mock("../../api/training", () => ({ trainingApi: { pbeReadiness: async () => { if (readiness.fail) throw new Error("unavailable"); return readiness.current; } } }));

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><PbeReadinessPanel seasonId="season" /></QueryClientProvider>);
}

const fixture: PbeReadiness = {
  version: "pbe-readiness-v1", seasonId: "season",
  dimensions: [
    { key: "Coverage", percent: 40, basis: "Targets you have practiced, out of every target in your assigned passages." },
    { key: "Recall", percent: 67, basis: "Practiced targets your later answers kept — recall that held up over time." },
    { key: "Precision", percent: 75, basis: "Points earned out of points available across your solo PBE answers." },
    { key: "Reference", percent: null, basis: "Points earned on exact-words questions, where the wording itself is the answer." },
    { key: "Composure", percent: null, basis: "Points earned in timed runs, where answers freeze when the clock ends." },
    { key: "Team", percent: 88, basis: "Your team's accuracy in finalized PBE matches." },
  ],
};

describe("PbeReadinessPanel (card 49)", () => {
  it("renders measured dimensions with bars and unmeasured ones as honest pending states with no bar", async () => {
    readiness.current = fixture; readiness.fail = false;
    renderPanel();
    expect(await screen.findByText("Coverage")).toBeTruthy();
    expect(screen.getByText("40%")).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Coverage readiness" })).toBeTruthy();
    expect(screen.getByText("67%")).toBeTruthy();
    // Reference + Composure have no evidence: pending badge, and crucially
    // NO progressbar (the #50 mockup's filled-but-pending bar was wrong).
    expect(screen.getAllByText("Not measured yet")).toHaveLength(2);
    expect(screen.queryByRole("progressbar", { name: "Reference readiness" })).toBeNull();
    expect(screen.queryByRole("progressbar", { name: "Composure readiness" })).toBeNull();
    expect(screen.getByText("88%")).toBeTruthy();
  });

  it("hides itself when the readiness read fails, so the entry page still works", async () => {
    readiness.current = null; readiness.fail = true;
    const { container } = renderPanel();
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(container.querySelector('[data-testid="pbe-readiness"]')).toBeNull();
  });
});
