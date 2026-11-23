import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { PassageBrowser } from "./PassageBrowser";
import type { Progress } from "../../api/types";

type MasteryItem = Progress["mastery"][number];

function item(overrides: Partial<MasteryItem> = {}): MasteryItem {
  return {
    knowledgeUnitId: "ku-1",
    title: "Genesis 1:1",
    level: "Learning",
    exactWordingScore: 40,
    recognitionScore: 40,
    reviewDueAtUtc: null,
    bookKey: "Genesis",
    ...overrides,
  };
}

describe("PassageBrowser", () => {
  it("groups passages by book with mastered counts", () => {
    render(<PassageBrowser mastery={[
      item({ knowledgeUnitId: "ku-1", title: "Genesis 1:1", bookKey: "Genesis", level: "Mastered", exactWordingScore: 100 }),
      item({ knowledgeUnitId: "ku-2", title: "Genesis 1:2", bookKey: "Genesis", level: "Learning", exactWordingScore: 30 }),
      item({ knowledgeUnitId: "ku-3", title: "Exodus 2:1", bookKey: "Exodus", level: "Learning", exactWordingScore: 20 }),
    ]} />);
    expect(screen.getByText("Genesis")).toBeInTheDocument();
    expect(screen.getByText("1 of 2 strong or mastered")).toBeInTheDocument();
    expect(screen.getByText("Exodus")).toBeInTheDocument();
    expect(screen.getByText("0 of 1 strong or mastered")).toBeInTheDocument();
    expect(screen.getByText("1 of 3 strong or mastered")).toBeInTheDocument();
  });

  it("counts against the assigned verse total, not just practiced rows", () => {
    render(<PassageBrowser mastery={[
      item({ knowledgeUnitId: "ku-1", title: "Genesis 1:1", bookKey: "Genesis", level: "Mastered", exactWordingScore: 100 }),
      item({ knowledgeUnitId: "ku-2", title: "Genesis 1:2", bookKey: "Genesis", level: "Learning", exactWordingScore: 30 }),
    ]} assignments={[{ id: "a1", studentUserId: "s", type: "Primary", bookKey: "Genesis", startChapter: 1, startVerse: 1, endChapter: 1, endVerse: 10, verseCount: 10 }]} />);
    // 2 verses practiced of 10 assigned: the honest denominator is 10 —
    // in the overall summary and in the Genesis group header alike.
    expect(screen.getAllByText("1 of 10 strong or mastered")).toHaveLength(2);
  });

  it("makes each row start that verse's scoped session", () => {
    render(<MemoryRouter><PassageBrowser mastery={[
      item({ knowledgeUnitId: "ku-1", title: "Genesis 1:1", level: "Learning", exactWordingScore: 30 }),
      item({ knowledgeUnitId: "ku-2", title: "Genesis 1:2", level: "Review", exactWordingScore: 60 }),
    ]} seasonId="season-1" /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "Practice Genesis 1:1" })).toHaveAttribute("href", "/student/study?mode=Practice&knowledgeUnitId=ku-1&seasonId=season-1");
    expect(screen.getByRole("link", { name: "Review Genesis 1:2" })).toHaveAttribute("href", "/student/study?mode=Review&format=Memory&knowledgeUnitId=ku-2&seasonId=season-1");
  });

  it("filters by needs practice, due, and mastered", () => {
    render(<PassageBrowser mastery={[
      item({ knowledgeUnitId: "ku-1", title: "Genesis 1:1", level: "Mastered", exactWordingScore: 100 }),
      item({ knowledgeUnitId: "ku-2", title: "Genesis 1:2", level: "Review", exactWordingScore: 60 }),
      item({ knowledgeUnitId: "ku-3", title: "Genesis 1:3", level: "Learning", exactWordingScore: 20 }),
    ]} />);
    fireEvent.click(screen.getByRole("button", { name: "Mastered" }));
    expect(screen.getByTestId("progress-mastery")).toHaveTextContent("Genesis 1:1");
    expect(screen.getByTestId("progress-mastery")).not.toHaveTextContent("Genesis 1:2");
    fireEvent.click(screen.getByRole("button", { name: "Due" }));
    expect(screen.getByTestId("progress-mastery")).toHaveTextContent("Genesis 1:2");
    expect(screen.getByTestId("progress-mastery")).not.toHaveTextContent("Genesis 1:1");
    fireEvent.click(screen.getByRole("button", { name: "Needs practice" }));
    expect(screen.getByTestId("progress-mastery")).toHaveTextContent("Genesis 1:2");
    expect(screen.getByTestId("progress-mastery")).toHaveTextContent("Genesis 1:3");
    expect(screen.getByTestId("progress-mastery")).not.toHaveTextContent("Genesis 1:1");
  });

  it("searches by passage title", () => {
    render(<PassageBrowser mastery={[
      item({ knowledgeUnitId: "ku-1", title: "Genesis 1:1" }),
      item({ knowledgeUnitId: "ku-2", title: "Genesis 1:2" }),
    ]} />);
    fireEvent.change(screen.getByLabelText("Search passages"), { target: { value: "1:2" } });
    expect(screen.getByTestId("progress-mastery")).toHaveTextContent("Genesis 1:2");
    expect(screen.getByTestId("progress-mastery")).not.toHaveTextContent("Genesis 1:1");
  });

  it("shows the empty state honestly", () => {
    render(<PassageBrowser mastery={[]} />);
    expect(screen.getByText(/No passage progress yet/)).toBeInTheDocument();
  });
});
