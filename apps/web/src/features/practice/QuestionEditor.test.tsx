import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { practiceApi, type PracticeBootstrap } from "../../api/practice";
import { QuestionEditor } from "./QuestionEditor";
import { ToastProvider } from "../../components/ui";

vi.mock("../../api/client", () => ({ api: { library: vi.fn(), seasonScope: vi.fn(), contentPacks: vi.fn(), sourceUnits: vi.fn() } }));
vi.mock("../../api/practice", () => ({ practiceApi: { import: vi.fn(), publish: vi.fn() } }));
const question = { contentPackId: "pack", sourceUnitId: "verse", prompt: "Who was Daniel?", kind: "ShortAnswer", parts: [{ acceptedAnswers: ["A prophet"], points: 1 }], ordered: false, reference: "Daniel 1:1", evidence: "Scripture", version: 1 };
const data: PracticeBootstrap = { enabled: true, seasons: [{ id: "daniel", name: "Daniel" }, { id: "joshua", name: "Joshua" }], players: [], rooms: [], invitations: [], achievements: [], questions: [
  { id: "published", seasonId: "daniel", published: true, question },
  { id: "draft", seasonId: "daniel", published: false, question: { ...question, prompt: "What did the king ask?", reference: "Daniel 2:1" } },
] };
function mount(value = data) { render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ToastProvider><QuestionEditor org="org" data={value} /></ToastProvider></QueryClientProvider>); }
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
    expect(screen.queryByRole("button", { name: "Preview question" })).not.toBeInTheDocument();
    expect(screen.getByText("Set up a season before adding questions")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Manage seasons" })).toHaveAttribute("href", "/admin/seasons");
  });
  it("offers recovery when source content cannot load", async () => {
    vi.mocked(api.seasonScope).mockRejectedValueOnce(new Error("offline"));
    mount();
    expect(await screen.findByRole("button", { name: "Retry season passages" })).toBeInTheDocument();
    expect(screen.getByLabelText("Source unit")).toBeDisabled();
  });
});

describe("Preview invalidation (stale-preview regression)", () => {
  function mockSources() {
    vi.mocked(api.seasonScope).mockResolvedValue({ contentPackId: "pack", includes: [{ bookKey: "DAN", startChapter: 1, startVerse: 1, endChapter: 1, endVerse: 3 }], excludes: [] });
    vi.mocked(api.sourceUnits).mockResolvedValue([
      { id: "verse", bookKey: "DAN", chapter: 1, verse: 1, ordinal: 1, citation: "Daniel 1:1", canonicalText: "Fixture one" },
      { id: "verse2", bookKey: "DAN", chapter: 1, verse: 2, ordinal: 2, citation: "Daniel 1:2", canonicalText: "Fixture two" },
    ]);
  }
  async function previewDraft() {
    fireEvent.click(screen.getByText("Create a question"));
    await screen.findByRole("option", { name: "DAN" });
    fireEvent.change(screen.getByLabelText("Source book"), { target: { value: "pack" } });
    await screen.findByRole("option", { name: "Daniel 1:1" });
    fireEvent.change(screen.getByLabelText("Source unit"), { target: { value: "verse" } });
    fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "Original prompt" } });
    fireEvent.change(screen.getByLabelText("Reference"), { target: { value: "Daniel 1:1" } });
    fireEvent.change(screen.getByLabelText("Evidence"), { target: { value: "Scripture" } });
    fireEvent.change(screen.getByLabelText("Part 1 accepted answers"), { target: { value: "A prophet" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview question" }));
    expect(await screen.findByRole("button", { name: "Save validated drafts" })).toBeInTheDocument();
  }
  it("drops the preview when the prompt changes, and a fresh preview saves the corrected prompt", async () => {
    mockSources();
    vi.mocked(practiceApi.import).mockResolvedValue(undefined);
    mount();
    await previewDraft();
    fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "Corrected prompt" } });
    expect(screen.queryByRole("button", { name: "Save validated drafts" })).not.toBeInTheDocument();
    expect(screen.queryByText("Original prompt")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Preview question" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save validated drafts" }));
    expect(await screen.findByText("Saved. Drafts require publication before matches can use them.")).toBeInTheDocument();
    expect(practiceApi.import).toHaveBeenCalledWith("org", "daniel", [expect.objectContaining({ prompt: "Corrected prompt" })]);
  });
  it("drops the preview when the source unit changes", async () => {
    mockSources();
    mount();
    await previewDraft();
    fireEvent.change(screen.getByLabelText("Source unit"), { target: { value: "verse2" } });
    expect(screen.queryByRole("button", { name: "Save validated drafts" })).not.toBeInTheDocument();
  });
  it("drops the preview when scoring points change", async () => {
    mockSources();
    mount();
    await previewDraft();
    fireEvent.change(screen.getByLabelText("Part 1 points"), { target: { value: "3" } });
    expect(screen.queryByRole("button", { name: "Save validated drafts" })).not.toBeInTheDocument();
  });
  it("drops the preview when accepted answers change", async () => {
    mockSources();
    mount();
    await previewDraft();
    fireEvent.change(screen.getByLabelText("Part 1 accepted answers"), { target: { value: "A prophet\nA seer" } });
    expect(screen.queryByRole("button", { name: "Save validated drafts" })).not.toBeInTheDocument();
  });
  it("shows a singular point label in the preview for a one-point part", async () => {
    mockSources();
    mount();
    await previewDraft();
    expect(screen.getByText(/\(1 point\)/)).toBeInTheDocument();
  });
});

describe("Per-action confirmations", () => {
  it("confirms publication with a published-state message, not the draft message", async () => {
    vi.mocked(practiceApi.publish).mockResolvedValue(undefined);
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Publish reviewed question" }));
    expect(await screen.findByText("Published. Matches can now use this question.")).toBeInTheDocument();
    expect(screen.queryByText(/Drafts require publication/)).not.toBeInTheDocument();
    expect(practiceApi.publish).toHaveBeenCalledWith("org", "draft");
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
