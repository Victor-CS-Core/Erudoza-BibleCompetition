import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { AssignedPassages } from "./AssignedPassages";

vi.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ me: { userId: "student", organizationId: "org", kind: "Student" } }) }));
vi.mock("../../api/client", () => ({ api: { myAssignments: vi.fn() } }));

beforeEach(() => { vi.clearAllMocks(); });

function wrap(node: ReactNode) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter>{node}</MemoryRouter></QueryClientProvider>;
}

function mount() {
  return render(wrap(<AssignedPassages seasonId="season" />));
}

const assignment = (changes: object) => ({ id: `assignment-${Math.random()}`, studentUserId: "student", contentPackId: "pack", type: "PrimarySpecialist", ...changes });

it("lists each assignment as a verse-aware citation", async () => {
  vi.mocked(api.myAssignments).mockResolvedValue([
    assignment({ bookKey: "John", startChapter: 3, startVerse: 36, endChapter: 3, endVerse: 36 }),
    assignment({ bookKey: "John", startChapter: 3, startVerse: 16, endChapter: 3, endVerse: 16 }),
    assignment({ bookKey: "John", startChapter: 3, startVerse: 16, endChapter: 4, endVerse: 3 }),
  ] as never);
  mount();
  expect(await screen.findByText("John 3:16")).toBeInTheDocument();
  expect(screen.getByText("John 3:36")).toBeInTheDocument();
  expect(screen.getByText("John 3:16–4:3")).toBeInTheDocument();
});

it("divides by the assignment's full verse count, not just the practiced rows", async () => {
  vi.mocked(api.myAssignments).mockResolvedValue([
    assignment({ bookKey: "Daniel", startChapter: 1, startVerse: 1, endChapter: 1, endVerse: 3, verseCount: 3 }),
  ] as never);
  const mastery = [
    { knowledgeUnitId: "ku-1", title: "Daniel 1:1", level: "Strong", exactWordingScore: 95, recognitionScore: 95, bookKey: "Daniel", chapter: 1, verse: 1, reviewDueAtUtc: null },
  ] as never;
  render(wrap(<AssignedPassages seasonId="season" seasonStatus="Active" mastery={mastery} />));
  expect(await screen.findByText("1 of 3 verses strong or mastered")).toBeInTheDocument();
});

it("explains an empty assignment list and retries after a failure", async () => {
  vi.mocked(api.myAssignments).mockResolvedValue([]);
  mount();
  expect(await screen.findByText(/No passages assigned yet/)).toBeInTheDocument();
});

it("shows the season state and weaves per-range mastery progress into each assignment", async () => {
  vi.mocked(api.myAssignments).mockResolvedValue([
    assignment({ bookKey: "Daniel", startChapter: 1, startVerse: 1, endChapter: 1, endVerse: 3 }),
  ] as never);
  const mastery = [
    { knowledgeUnitId: "ku-1", title: "Daniel 1:1", level: "Strong", exactWordingScore: 95, recognitionScore: 95, bookKey: "Daniel", chapter: 1, verse: 1, reviewDueAtUtc: null },
    { knowledgeUnitId: "ku-2", title: "Daniel 1:2", level: "Learning", exactWordingScore: 40, recognitionScore: 40, bookKey: "Daniel", chapter: 1, verse: 2, reviewDueAtUtc: null },
    { knowledgeUnitId: "ku-9", title: "Daniel 2:1", level: "Mastered", exactWordingScore: 100, recognitionScore: 100, bookKey: "Daniel", chapter: 2, verse: 1, reviewDueAtUtc: null },
  ] as never;
  render(wrap(<AssignedPassages seasonId="season" seasonName="Daniel 2026" seasonStatus="Active" mastery={mastery} />));
  expect(await screen.findByText("1 of 2 verses strong or mastered")).toBeInTheDocument();
  expect(screen.getByText(/Ready to study/)).toBeInTheDocument();
  expect(screen.getByText("Daniel 2026")).toBeInTheDocument();
});

it("presents a brand-new passage as a quest about to start, with a practice action", async () => {
  vi.mocked(api.myAssignments).mockResolvedValue([
    assignment({ bookKey: "Numbers", startChapter: 1, startVerse: 1, endChapter: 1, endVerse: 54, verseCount: 54 }),
  ] as never);
  render(wrap(<AssignedPassages seasonId="season" seasonStatus="Active" mastery={[] as never} />));
  expect(await screen.findByText("0 of 54 verses strong or mastered")).toBeInTheDocument();
  expect(screen.getByText("Not started")).toBeInTheDocument();
  expect(screen.getByText(/The quest is about to start/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Start this passage/ })).toHaveAttribute("href", "/student/study?mode=Practice&seasonId=season");
});

it("chips a fully mastered passage as Mastered and a due passage with a review action", async () => {
  vi.mocked(api.myAssignments).mockResolvedValue([
    assignment({ bookKey: "Daniel", startChapter: 1, startVerse: 1, endChapter: 1, endVerse: 2, verseCount: 2 }),
    assignment({ bookKey: "Daniel", startChapter: 2, startVerse: 1, endChapter: 2, endVerse: 1, verseCount: 1 }),
  ] as never);
  const mastery = [
    { knowledgeUnitId: "ku-1", title: "Daniel 1:1", level: "Mastered", exactWordingScore: 100, recognitionScore: 100, bookKey: "Daniel", chapter: 1, verse: 1, reviewDueAtUtc: null },
    { knowledgeUnitId: "ku-2", title: "Daniel 1:2", level: "Mastered", exactWordingScore: 100, recognitionScore: 100, bookKey: "Daniel", chapter: 1, verse: 2, reviewDueAtUtc: null },
    { knowledgeUnitId: "ku-3", title: "Daniel 2:1", level: "Learning", exactWordingScore: 40, recognitionScore: 40, bookKey: "Daniel", chapter: 2, verse: 1, reviewDueAtUtc: "2020-01-01T00:00:00Z" },
  ] as never;
  render(wrap(<AssignedPassages seasonId="season" seasonStatus="Active" mastery={mastery} />));
  expect(await screen.findByText("Mastered")).toBeInTheDocument();
  expect(screen.getByText("In progress")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Review this passage/ })).toHaveAttribute("href", "/student/study?mode=Review&seasonId=season");
});
