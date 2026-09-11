import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { scriptureApi } from "../../api/scripture";
import type { SourceUnit } from "../../api/types";
import { ScriptureReader, searchScripture } from "./ScriptureReader";

vi.mock("../../api/scripture", () => ({ scriptureApi: { assigned: vi.fn() } }));
vi.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ me: { userId: "student", organizationId: "org" } }) }));
const verses: SourceUnit[] = [
  { id: "1", citation: "Genesis 1:1", bookKey: "GEN", chapter: 1, verse: 1, ordinal: 1, canonicalText: "In the beginning God created the heaven and the earth." },
  { id: "2", citation: "Genesis 1:10", bookKey: "GEN", chapter: 1, verse: 10, ordinal: 2, canonicalText: "And God called the dry land Earth;" },
  { id: "3", citation: "Genesis 2:1", bookKey: "GEN", chapter: 2, verse: 1, ordinal: 3, canonicalText: "Thus the heavens and the earth were finished," },
  { id: "4", citation: "Psalms 119:176", bookKey: "PSA", chapter: 119, verse: 176, ordinal: 4, canonicalText: "I have gone astray like a lost sheep; seek thy servant; for I do not forget thy commandments." },
];
beforeEach(() => { vi.clearAllMocks(); vi.mocked(scriptureApi.assigned).mockResolvedValue({ seasonId: "season", verses }); });
function mount(citation = "Genesis 1:1") {
  const onRead = vi.fn();
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ScriptureReader seasonId="season" citation={citation} onRead={onRead} />
  </QueryClientProvider>);
  return onRead;
}

it("loads lazily and preserves chapter and verse navigation when collapsed", async () => {
  const onRead = mount();
  expect(scriptureApi.assigned).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Read passage" }));
  expect(await screen.findByText(verses[0].canonicalText)).toBeVisible();
  expect(onRead).toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Chapter"), { target: { value: "2" } });
  expect(screen.getByText(verses[2].canonicalText)).toBeVisible();
  expect(screen.queryByText(verses[0].canonicalText)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Hide passage" }));
  expect(screen.getByText(verses[2].canonicalText)).not.toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Read passage" }));
  await waitFor(() => expect(screen.getByLabelText("Chapter")).toBeVisible());
  expect(screen.getByLabelText("Chapter")).toHaveValue("2");
  fireEvent.change(screen.getByLabelText("Book"), { target: { value: "PSA" } });
  expect(screen.getByLabelText("Chapter")).toHaveValue("119");
  fireEvent.change(screen.getByLabelText("Verse"), { target: { value: "176" } });
  expect(screen.getByText(verses[3].canonicalText)).toBeVisible();
});

it("searches assigned text and exact chapter, verse, range and book-key references", async () => {
  expect(searchScripture(verses, "Genesis 1:1").map(v => v.id)).toEqual(["1"]);
  expect(searchScripture(verses, "gen 1:1-10").map(v => v.id)).toEqual(["1", "2"]);
  expect(searchScripture(verses, "GENESIS 1").map(v => v.id)).toEqual(["1", "2"]);
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Read passage" }));
  const search = await screen.findByLabelText("Search assigned Scripture");
  fireEvent.change(search, { target: { value: "lost sheep" } });
  expect(screen.getByText(verses[3].canonicalText)).toBeVisible();
  expect(screen.getByLabelText("Book")).toBeDisabled();
  fireEvent.change(search, { target: { value: "John 3:16" } });
  expect(screen.getByText("No verses match this search")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
  expect(screen.getByText(verses[0].canonicalText)).toBeVisible();
});

it("keeps all 2,501 assigned verses searchable and pages long chapters", async () => {
  const large = Array.from({ length: 2501 }, (_, index) => ({ id: String(index), citation: `Psalms ${Math.floor(index / 100) + 1}:${index % 100 + 1}`, bookKey: "PSA", chapter: Math.floor(index / 100) + 1, verse: index % 100 + 1, ordinal: index + 1, canonicalText: `Assigned passage number ${index + 1}.` }));
  vi.mocked(scriptureApi.assigned).mockResolvedValue({ seasonId: "season", verses: large });
  mount("Psalms 1:1");
  fireEvent.click(screen.getByRole("button", { name: "Read passage" }));
  await screen.findByText("Assigned passage number 1.");
  expect(within(screen.getByRole("list", { name: "Scripture verses" })).getAllByRole("listitem")).toHaveLength(40);
  fireEvent.click(screen.getByRole("button", { name: "Next verses" }));
  expect(screen.getByText("Assigned passage number 41.")).toBeVisible();
  fireEvent.change(screen.getByLabelText("Search assigned Scripture"), { target: { value: "Psalms 26:1" } });
  expect(screen.getByText("Assigned passage number 2501.")).toBeVisible();
});

it("falls back to an available passage and offers recovery without claiming a hint on failure", async () => {
  vi.mocked(scriptureApi.assigned).mockRejectedValueOnce(new Error("Unavailable"));
  const onRead = mount("An unavailable reference");
  fireEvent.click(screen.getByRole("button", { name: "Read passage" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Your passages could not load.");
  expect(onRead).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Try loading passages again" }));
  expect(await screen.findByText(verses[0].canonicalText)).toBeVisible();
  expect(onRead).toHaveBeenCalled();
});

it("paginates all 176 verses of Psalm 119 and finds its final verse", async () => {
  const chapter = Array.from({ length: 176 }, (_, index) => ({ ...verses[3], id: `psa-119-${index + 1}`,
    citation: `Psalms 119:${index + 1}`, verse: index + 1, ordinal: index + 1,
    canonicalText: index === 175 ? verses[3].canonicalText : `Psalm 119 verse ${index + 1}.` }));
  vi.mocked(scriptureApi.assigned).mockResolvedValue({ seasonId: "season", verses: chapter });
  mount("Psalms 119:1");
  fireEvent.click(screen.getByRole("button", { name: "Read passage" }));
  await screen.findByText("Psalm 119 verse 1.");
  for (let page = 0; page < 4; page++) fireEvent.click(screen.getByRole("button", { name: "Next verses" }));
  expect(screen.getByText("Page 5 of 5")).toBeVisible();
  expect(screen.getByText(verses[3].canonicalText)).toBeVisible();
  expect(screen.getByRole("button", { name: "Next verses" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Search assigned Scripture"), { target: { value: "PSA 119:176" } });
  expect(screen.getByText("1 verse")).toBeVisible();
  expect(screen.getByText(verses[3].canonicalText)).toBeVisible();
});

it("explains empty assignments without recording a hint", async () => {
  vi.mocked(scriptureApi.assigned).mockResolvedValue({ seasonId: "season", verses: [] });
  const onRead = mount();
  fireEvent.click(screen.getByRole("button", { name: "Read passage" }));
  expect(await screen.findByText("No passages available")).toBeVisible();
  expect(onRead).not.toHaveBeenCalled();
});

it("shows remaining chapter verses when a refreshed assignment removes the selected verse", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><ScriptureReader seasonId="season" citation="Genesis 1:1" onRead={() => {}} /></QueryClientProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Read passage" }));
  await screen.findByText(verses[0].canonicalText);
  fireEvent.change(screen.getByLabelText("Verse"), { target: { value: "10" } });
  expect(screen.getByText(verses[1].canonicalText)).toBeVisible();
  vi.mocked(scriptureApi.assigned).mockResolvedValue({ seasonId: "season", verses: verses.filter(verse => verse.id !== "2") });
  await client.invalidateQueries({ queryKey: ["assigned-scripture"] });
  await waitFor(() => expect(screen.getByLabelText("Verse")).toHaveValue(""));
  expect(screen.getByText(verses[0].canonicalText)).toBeVisible();
  expect(screen.queryByText(verses[1].canonicalText)).not.toBeInTheDocument();
});
