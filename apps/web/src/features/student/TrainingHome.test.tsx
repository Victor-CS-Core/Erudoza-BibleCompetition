import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { StudentHomePage } from "./StudentHomePage";

vi.mock("../../api/client", () => ({ api: { assignedSeasons: vi.fn().mockResolvedValue([]), progress: vi.fn() } }));
it("offers training from the real assignment and reports mastered units without inventing a percentage", async () => {
  vi.mocked(api.progress).mockResolvedValue({ seasonId: "s", seasonName: "Daniel 2026", seasonStatus: "Active", assignments: [{ id: "a", studentUserId: "u", type: "PrimarySpecialist", bookKey: "DAN", startChapter: 2, startVerse: 1, endChapter: 2, endVerse: 23 }], masteredCount: 8, reviewDueCount: 3, attemptCount: 12, mastery: [] });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><StudentHomePage /></MemoryRouter></QueryClientProvider>);
  expect(await screen.findByRole("heading", { name: "Training HQ" })).toBeInTheDocument();
  expect(await screen.findByRole("link", { name: /Continue study/ })).toHaveAttribute("href", "/student/study");
  expect(screen.getByTestId("mastered-count")).toHaveTextContent("8");
  expect(screen.getByTestId("assignment-range")).toHaveTextContent("DAN 2:1–2:23");
  expect(screen.queryByText("72%")).not.toBeInTheDocument();
});

vi.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ me: { organizationId: "org", userId: "student" } }) }));
