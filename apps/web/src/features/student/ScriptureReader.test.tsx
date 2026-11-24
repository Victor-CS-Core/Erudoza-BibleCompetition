import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { scriptureApi } from "../../api/scripture";
import type { SourceUnit } from "../../api/types";
import { ScriptureReader, focusVerses, searchScripture, type ReaderFocus } from "./ScriptureReader";

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
function mountFocused(focus: ReaderFocus, citation?: string) {
  const onRead = vi.fn();
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ScriptureReader seasonId="season" citation={citation ?? focus.citation} focus={focus} onRead={onRead} />
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

it("resolves focus to exactly the practiced verses", () => {
  expect(focusVerses(verses, { citation: "Genesis 1:10" }).map(v => v.id)).toEqual(["2"]);
  expect(focusVerses(verses, { citation: "Genesis 1:1-10" }).map(v => v.id)).toEqual(["1", "2"]);
  expect(focusVerses(verses, { citation: "GEN 1:10" }).map(v => v.id)).toEqual(["2"]);
  // What Comes Next practices the verse after the cited one.
  expect(focusVerses(verses, { citation: "Genesis 1:10", nextVerse: true }).map(v => v.id)).toEqual(["3"]);
  // Unresolvable references resolve to nothing, so the reader falls back.
  expect(focusVerses(verses, { citation: "John 3:16" })).toEqual([]);
  expect(focusVerses(verses, { citation: "Assigned passage" })).toEqual([]);
  expect(focusVerses(verses, { citation: "Psalms 119:176", nextVerse: true })).toEqual([]);
});

it("opens on the card's passage only — no sibling verses from the chapter", async () => {
  const onRead = mountFocused({ citation: "Genesis 1:10" });
  fireEvent.click(screen.getByRole("button", { name: "Read passage" }));
  const panel = await screen.findByTestId("reader-focused-passage");
  expect(within(panel).getByRole("heading", { name: "Genesis 1:10" })).toBeInTheDocument();
  expect(within(panel).getByText(verses[1].canonicalText)).toBeVisible();
  // Genesis 1:1 sits in the same chapter but is not this card's passage.
  expect(screen.queryByText(verses[0].canonicalText)).not.toBeInTheDocument();
  expect(screen.queryByText(verses[2].canonicalText)).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Chapter")).not.toBeInTheDocument();
  // The focused read still records the hint, exactly like a chapter read.
  expect(onRead).toHaveBeenCalled();
});

it("focuses the next verse for What Comes Next", async () => {
  mountFocused({ citation: "Genesis 1:10", nextVerse: true });
  fireEvent.click(screen.getByRole("button", { name: "Read passage" }));
  const panel = await screen.findByTestId("reader-focused-passage");
  expect(within(panel).getByRole("heading", { name: "Genesis 2:1" })).toBeInTheDocument();
  expect(within(panel).getByText(verses[2].canonicalText)).toBeVisible();
  expect(screen.queryByText(verses[1].canonicalText)).not.toBeInTheDocument();
});

it("shows every verse of a ranged passage, and nothing outside it", async () => {
  mountFocused({ citation: "Genesis 1:1-10" });
  fireEvent.click(screen.getByRole("button", { name: "Read passage" }));
  const panel = await screen.findByTestId("reader-focused-passage");
  expect(within(panel).getByRole("heading", { name: "Genesis 1:1–10" })).toBeInTheDocument();
  expect(within(panel).getByText(verses[0].canonicalText)).toBeVisible();
  expect(within(panel).getByText(verses[1].canonicalText)).toBeVisible();
  expect(screen.queryByText(verses[2].canonicalText)).not.toBeInTheDocument();
});

it("escapes to the full chapter browser and back to the card's passage", async () => {
  mountFocused({ citation: "Genesis 1:10" });
  fireEvent.click(screen.getByRole("button", { name: "Read passage" }));
  await screen.findByTestId("reader-focused-passage");
  fireEvent.click(screen.getByRole("button", { name: "Browse the full chapter instead" }));
  // The whole chapter is one click away, under the same assisted read.
  expect(await screen.findByLabelText("Chapter")).toBeVisible();
  expect(screen.getByText(verses[0].canonicalText)).toBeVisible();
  expect(screen.getByText(verses[1].canonicalText)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Back to this card's passage" }));
  const panel = await screen.findByTestId("reader-focused-passage");
  expect(within(panel).getByText(verses[1].canonicalText)).toBeVisible();
  expect(screen.queryByText(verses[0].canonicalText)).not.toBeInTheDocument();
});

it("reveals the top of the reader card when expanding to the full chapter", async () => {
  mountFocused({ citation: "Genesis 1:10" });
  fireEvent.click(screen.getByRole("button", { name: "Read passage" }));
  await screen.findByTestId("reader-focused-passage");
  // jsdom has no layout engine, so observe the reveal call itself: the
  // reader card is scrolled to its top (not left wherever the browser's
  // scroll anchoring parks the tapped bottom-of-card spot), and focus
  // moves into the region the reader toggle controls, because the escape
  // button unmounts in the swap.
  const card = document.querySelector(".scripture-reader") as HTMLElement;
  const scrollSpy = vi.fn();
  card.scrollIntoView = scrollSpy;
  fireEvent.click(screen.getByRole("button", { name: "Browse the full chapter instead" }));
  await screen.findByLabelText("Chapter");
  await waitFor(() => expect(scrollSpy).toHaveBeenCalledWith(expect.objectContaining({ block: "start" })));
  const toggle = screen.getByRole("button", { name: "Hide passage" });
  const region = document.getElementById(toggle.getAttribute("aria-controls")!);
  expect(document.activeElement).toBe(region);
  // Collapsing swaps the "Back" button out the same way: focus stays in
  // the region instead of dropping to the page body (no scroll is needed
  // — the shrunken card lands in view on its own).
  fireEvent.click(screen.getByRole("button", { name: "Back to this card's passage" }));
  await screen.findByTestId("reader-focused-passage");
  await waitFor(() => expect(document.activeElement).toBe(region));
  expect(scrollSpy).toHaveBeenCalledTimes(1);
});

it("falls back to the chapter browser when the focus is not assigned", async () => {
  mountFocused({ citation: "John 3:16" });
  fireEvent.click(screen.getByRole("button", { name: "Read passage" }));
  expect(await screen.findByLabelText("Chapter")).toBeVisible();
  expect(screen.queryByTestId("reader-focused-passage")).not.toBeInTheDocument();
  expect(screen.getByText(verses[0].canonicalText)).toBeVisible();
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
