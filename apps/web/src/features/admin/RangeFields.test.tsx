import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import type { PassageRange, SourceUnit } from "../../api/types";
import { RangeFields } from "./SeasonWizardPage";

const units: SourceUnit[] = [["DAN", 2, 2], ["DAN", 2, 5], ["DAN", 3, 1], ["JUD", 1, 1], ["JUD", 1, 2]].map(([bookKey, chapter, verse], index) => ({ id: String(index), bookKey: String(bookKey), chapter: Number(chapter), verse: Number(verse), ordinal: index, citation: "Fixture", canonicalText: "Fixture" }));
function Harness() {
  const [range, setRange] = useState<PassageRange>({ bookKey: "DAN", startChapter: 2, startVerse: 2, endChapter: 3, endVerse: 1 });
  return <><RangeFields prefix="range" label="Passage" range={range} onChange={setRange} units={units} /><output data-testid="range-value">{JSON.stringify(range)}</output></>;
}
describe("Stored passage bounds", () => {
  it("offers only stored chapters and verses, including gaps in imported content", () => {
    render(<Harness />);
    expect(Array.from(screen.getByTestId("range-start-chapter").querySelectorAll("option")).map(option => option.value)).toEqual(["2", "3"]);
    expect(Array.from(screen.getByTestId("range-start").querySelectorAll("option")).map(option => option.value)).toEqual(["2", "5"]);
    fireEvent.change(screen.getByTestId("range-start"), { target: { value: "5" } });
    expect(screen.getByTestId("range-end-chapter")).toHaveValue("2");
    expect(screen.getByTestId("range-end")).toHaveValue("5");
    expect(screen.getByTestId("range-end").querySelector('option[value="2"]')).toBeNull();
  });
  it("resets all dependent fields when changing to a one-chapter book", () => {
    render(<Harness />);
    fireEvent.change(screen.getByTestId("range-book"), { target: { value: "JUD" } });
    expect(JSON.parse(screen.getByTestId("range-value").textContent!)).toEqual({ bookKey: "JUD", startChapter: 1, startVerse: 1, endChapter: 1, endVerse: 1 });
    expect(screen.getByTestId("range-end-chapter").querySelectorAll("option")).toHaveLength(1);
  });
});
