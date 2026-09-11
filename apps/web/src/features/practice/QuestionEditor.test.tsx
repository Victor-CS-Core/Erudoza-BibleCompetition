import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import type { PracticeBootstrap } from "../../api/practice";
import { QuestionEditor } from "./QuestionEditor";

vi.mock("../../api/client", () => ({ api: { library: vi.fn(), seasonScope: vi.fn(), contentPacks: vi.fn(), sourceUnits: vi.fn() } }));
vi.mock("../../api/practice", () => ({ practiceApi: { import: vi.fn(), publish: vi.fn() } }));
const question = { contentPackId: "pack", sourceUnitId: "verse", prompt: "Who was Daniel?", kind: "ShortAnswer", parts: [{ acceptedAnswers: ["A prophet"], points: 1 }], ordered: false, reference: "Daniel 1:1", evidence: "Scripture", version: 1 };
const data: PracticeBootstrap = { enabled: true, seasons: [{ id: "daniel", name: "Daniel" }, { id: "joshua", name: "Joshua" }], players: [], rooms: [], invitations: [], achievements: [], questions: [
  { id: "published", seasonId: "daniel", published: true, question },
  { id: "draft", seasonId: "daniel", published: false, question: { ...question, prompt: "What did the king ask?", reference: "Daniel 2:1" } },
] };
function mount(value = data) { render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><QuestionEditor org="org" data={value} /></QueryClientProvider>); }
beforeEach(() => { vi.clearAllMocks(); vi.mocked(api.library).mockResolvedValue({ translationId: "nkjv", translationName: "New King James Version", version: 1, books: [] }); vi.mocked(api.seasonScope).mockResolvedValue({ contentPackId: "pack", includes: [{ bookKey: "DAN", startChapter: 1, startVerse: 1, endChapter: 1, endVerse: 1 }], excludes: [] }); vi.mocked(api.contentPacks).mockResolvedValue([]); vi.mocked(api.sourceUnits).mockResolvedValue([]); });
describe("Coach question discovery", () => {
  it("filters saved questions by reference and publication status", async () => {
    mount();
    fireEvent.change(screen.getByLabelText("Search questions"), { target: { value: "Daniel 2" } });
    expect(screen.getByText("What did the king ask? · Draft")).toBeInTheDocument();
    expect(screen.queryByText("Who was Daniel? · Published")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Question status"), { target: { value: "published" } });
    expect(screen.getByText(/No questions match your search and status/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search questions"), { target: { value: "" } });
    expect(screen.getByText("Who was Daniel? · Published")).toBeInTheDocument();
  });
  it("shows an empty state for the selected season even when another has questions", () => {
    mount();
    fireEvent.change(screen.getByLabelText("Question season"), { target: { value: "joshua" } });
    expect(screen.getByText(/No questions in this season yet/)).toBeInTheDocument();
    expect(screen.queryByText("Who was Daniel? · Published")).not.toBeInTheDocument();
  });
  it("explains an empty season list instead of rendering an empty selector", () => {
    mount({ ...data, seasons: [] });
    expect(screen.getByLabelText("Question season")).toBeDisabled();
    expect(screen.getByRole("option", { name: "No active seasons" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview question" })).toBeDisabled();
  });
  it("offers recovery when source content cannot load", async () => {
    vi.mocked(api.seasonScope).mockRejectedValueOnce(new Error("offline"));
    mount();
    expect(await screen.findByRole("button", { name: "Retry season passages" })).toBeInTheDocument();
    expect(screen.getByLabelText("Source unit")).toBeDisabled();
  });
});

it("offers only the selected season's source books and clears a stale source after season change", async () => {
  vi.mocked(api.seasonScope).mockImplementation(async (_org, season) => ({ contentPackId: null, includes: [], excludes: [], packs: [{ contentPackId: season === "daniel" ? "eph" : "jude", includes: [{ bookKey: season === "daniel" ? "EPH" : "JUD", startChapter: 1, startVerse: 1, endChapter: 1, endVerse: 1 }], excludes: [] }] }));
  vi.mocked(api.library).mockResolvedValue({ translationId: "nkjv", translationName: "New King James Version", version: 1, books: [{ contentPackId: "eph", bookKey: "EPH", name: "Ephesians", verseCount: 1, chapters: [{ number: 1, verses: [1] }] }] });
  vi.mocked(api.sourceUnits).mockResolvedValue([{ id: "verse", bookKey: "EPH", chapter: 1, verse: 1, ordinal: 1, citation: "Ephesians 1:1", canonicalText: "Fixture" }]);
  mount(); fireEvent.click(screen.getByText("Create a question"));
  const book=await screen.findByRole("option",{name:"Ephesians"}); expect(book).toHaveValue("eph");
  fireEvent.change(screen.getByLabelText("Source book"),{target:{value:"eph"}});
  await screen.findByRole("option",{name:"Ephesians 1:1"}); fireEvent.change(screen.getByLabelText("Source unit"),{target:{value:"verse"}});
  fireEvent.change(screen.getByLabelText("Question season"),{target:{value:"joshua"}});
  expect(screen.getByLabelText("Source unit")).toHaveValue(""); expect(screen.getByLabelText("Source unit")).toBeDisabled();
});
