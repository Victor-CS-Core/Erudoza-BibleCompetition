import { fireEvent, render, screen } from "@testing-library/react";
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
    expect(screen.getByText("1 of 2 mastered")).toBeInTheDocument();
    expect(screen.getByText("Exodus")).toBeInTheDocument();
    expect(screen.getByText("0 of 1 mastered")).toBeInTheDocument();
    expect(screen.getByText("1 of 3 mastered")).toBeInTheDocument();
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
