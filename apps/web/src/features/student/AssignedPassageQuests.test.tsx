import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, it } from "vitest";
import type { Assignment, Progress } from "../../api/types";
import { formatPassageCitation } from "../admin/passageRanges";
import { AssignedPassageQuests } from "./AssignedPassageQuests";

type MasteryItem = Progress["mastery"][number];

const assignment = (id: string, bookKey: string, startChapter: number, startVerse: number, endChapter: number, endVerse: number, verseCount: number): Assignment =>
  ({ id, studentUserId: "student", contentPackId: "pack", type: "PrimarySpecialist", bookKey, startChapter, startVerse, endChapter, endVerse, verseCount } as Assignment);
const masteryItem = (id: string, level: string, bookKey: string, chapter: number, verse: number, reviewDueAtUtc: string | null = null): MasteryItem =>
  ({ knowledgeUnitId: id, title: `${bookKey} ${chapter}:${verse}`, level, exactWordingScore: 50, recognitionScore: 50, bookKey, chapter, verse, reviewDueAtUtc } as MasteryItem);

function mount(items: Assignment[], mastery: MasteryItem[] | undefined) {
  return render(<MemoryRouter><AssignedPassageQuests items={items} mastery={mastery} seasonId="season" /></MemoryRouter>);
}

const rowTitles = () => screen.getAllByTestId("assigned-passage-quest").map(row => row.querySelector(".game-passage-quest__title")?.textContent);

const fiveFresh = () => [
  assignment("a1", "Exodus", 6, 1, 6, 10, 10),
  assignment("a2", "Exodus", 14, 1, 14, 12, 12),
  assignment("a3", "Genesis", 1, 1, 2, 25, 56),
  assignment("a4", "Daniel", 1, 1, 1, 3, 3),
  assignment("a5", "Daniel", 2, 1, 2, 2, 2),
];

it("shows three quest rows and a toggle with the remaining count for five assignments", () => {
  mount(fiveFresh(), []);
  expect(screen.getAllByTestId("assigned-passage-quest")).toHaveLength(3);
  const toggle = screen.getByRole("button", { name: /Show all 5 passages/ });
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(toggle).toHaveTextContent("+2 more");
});

it("expands in place to every passage and collapses back", () => {
  mount(fiveFresh(), []);
  fireEvent.click(screen.getByRole("button", { name: /Show all 5 passages/ }));
  expect(screen.getAllByTestId("assigned-passage-quest")).toHaveLength(5);
  const toggle = screen.getByRole("button", { name: "Show less" });
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  fireEvent.click(toggle);
  expect(screen.getAllByTestId("assigned-passage-quest")).toHaveLength(3);
  expect(screen.getByRole("button", { name: /Show all 5 passages/ })).toBeInTheDocument();
});

it("renders no toggle at three or fewer assignments", () => {
  mount(fiveFresh().slice(0, 3), []);
  expect(screen.getAllByTestId("assigned-passage-quest")).toHaveLength(3);
  expect(screen.queryByRole("button", { name: /Show all|Show less/ })).not.toBeInTheDocument();
});

it("orders rows by what needs the student next, keeping server order within a group", () => {
  // Server order deliberately interleaves states: mastered, not started,
  // due, strong, in progress — plus a second not-started passage after the
  // first, to prove within-group order is the server's.
  const items = [
    assignment("m", "Genesis", 1, 1, 1, 2, 2),
    assignment("n1", "Exodus", 6, 1, 6, 10, 10),
    assignment("d", "John", 3, 16, 3, 16, 1),
    assignment("s", "Psalms", 23, 1, 23, 2, 2),
    assignment("p", "Daniel", 1, 1, 1, 3, 3),
    assignment("n2", "Exodus", 14, 1, 14, 12, 12),
  ];
  const mastery = [
    masteryItem("k1", "Mastered", "Genesis", 1, 1),
    masteryItem("k2", "Mastered", "Genesis", 1, 2),
    masteryItem("k3", "Learning", "John", 3, 16, "2020-01-01T00:00:00Z"),
    masteryItem("k4", "Strong", "Psalms", 23, 1),
    masteryItem("k5", "Strong", "Psalms", 23, 2),
    masteryItem("k6", "Strong", "Daniel", 1, 1),
    masteryItem("k7", "Learning", "Daniel", 1, 2),
  ];
  mount(items, mastery);
  const cite = (item: Assignment) => formatPassageCitation(item);
  // Collapsed: due first, then in progress, then the first not-started.
  expect(rowTitles()).toEqual([cite(items[2]), cite(items[4]), cite(items[1])]);
  fireEvent.click(screen.getByRole("button", { name: /Show all 6 passages/ }));
  expect(rowTitles()).toEqual([cite(items[2]), cite(items[4]), cite(items[1]), cite(items[5]), cite(items[3]), cite(items[0])]);
});
