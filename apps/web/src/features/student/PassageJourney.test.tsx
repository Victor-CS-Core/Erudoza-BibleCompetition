import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { trainingApi } from "../../api/training";
import { PassageJourney } from "./PassageJourney";
import { journeyFixture } from "./trainingFixtures";
vi.mock("../../api/training", () => ({ trainingApi: { journey: vi.fn() } }));
vi.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ me: { organizationId: "org", userId: "student" } }) }));
function page(preview = false) { render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><PassageJourney seasonId="s" preview={preview} /></MemoryRouter></QueryClientProvider>); }
beforeEach(() => { vi.mocked(trainingApi.journey).mockResolvedValue(journeyFixture()); });
it("labels partial assignment and distinct skill evidence", async () => { page(); expect(await screen.findByText("Assigned scope")).toBeInTheDocument(); expect(screen.getByText(/1 of 2 assigned passages practiced/)).toBeInTheDocument(); expect(screen.getByRole("progressbar", { name: "Wording" })).toHaveAttribute("value", "20"); expect(screen.getByRole("progressbar", { name: "Reference" })).toHaveAttribute("value", "70"); });
it("fetches the next server cursor only on request", async () => { vi.mocked(trainingApi.journey).mockResolvedValueOnce(journeyFixture({ after: "cursor" })).mockResolvedValueOnce(journeyFixture({ chapters: [] })); page(); fireEvent.click(await screen.findByRole("button", { name: "Load more passages" })); await screen.findByText("Assigned scope"); expect(trainingApi.journey).toHaveBeenLastCalledWith("s", "cursor"); });
it("shows empty assignment honestly", async () => { vi.mocked(trainingApi.journey).mockResolvedValue(journeyFixture({ chapters: [] })); page(); expect(await screen.findByText("No eligible passages yet")).toBeInTheDocument(); });
it.each(["Learning", "Unknown"])("does not treat legacy %s skill values as current or missing evidence", async level => { const data = journeyFixture(); data.chapters[0].passages[0].level = level; data.chapters[0].passages[0].algorithmVersion = "v1-scaffold"; vi.mocked(trainingApi.journey).mockResolvedValue(data); page(); expect(await screen.findByText(/Legacy scoring/)).toBeInTheDocument(); expect(screen.queryByRole("progressbar", { name: "Wording" })).not.toBeInTheDocument(); });

it("unseen passages have a useful start state instead of legacy scoring", async () => { const data = journeyFixture(); data.chapters[0].passages[0].level = "Unseen"; data.chapters[0].passages[0].algorithmVersion = "unknown"; vi.mocked(trainingApi.journey).mockResolvedValue(data); page(); expect(await screen.findByText(/Ready to begin/)).toBeInTheDocument(); expect(screen.queryByText(/Legacy scoring/)).not.toBeInTheDocument(); });

it("keeps the HQ preview compact and links legacy evidence to its full passage", async () => {
  const data = journeyFixture();
  data.chapters[0].passages[0].level = "Mastered";
  data.chapters[0].passages[0].algorithmVersion = "v1-scaffold";
  vi.mocked(trainingApi.journey).mockResolvedValue(data);
  page(true);
  const passage = await screen.findByRole("link", { name: "Daniel 1:1 Legacy scoring" });
  expect(passage).toHaveAttribute("href", "/student/progress?seasonId=s#passage-k");
  expect(screen.queryByText("Mastered")).not.toBeInTheDocument();
  expect(screen.queryByRole("progressbar", { name: "Wording" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "View full passage journey" })).toHaveAttribute("href", "/student/progress?seasonId=s");
});
