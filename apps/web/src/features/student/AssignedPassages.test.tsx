import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { AssignedPassages } from "./AssignedPassages";

vi.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ me: { userId: "student", organizationId: "org", kind: "Student" } }) }));
vi.mock("../../api/client", () => ({ api: { myAssignments: vi.fn() } }));

beforeEach(() => { vi.clearAllMocks(); });

function mount() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AssignedPassages seasonId="season" /></QueryClientProvider>);
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

it("explains an empty assignment list and retries after a failure", async () => {
  vi.mocked(api.myAssignments).mockResolvedValue([]);
  mount();
  expect(await screen.findByText(/No passages assigned yet/)).toBeInTheDocument();
});
