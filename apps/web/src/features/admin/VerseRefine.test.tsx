import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { VerseRefine } from "./VerseRefine";
import type { ChapterOption } from "./chapterAssignments";

const units = (verses: number[]) => verses.map(verse => ({ bookKey: "John", chapter: 3, verse }));
const option: ChapterOption = { chapter: 3, available: units([16, 17, 18, 36]), remaining: units([16, 17, 18, 36]), partial: false };

it("keeps verse fields hidden until the coach refines, then offers only remaining verses", () => {
  const onAdd = vi.fn();
  render(<VerseRefine option={option} ranges={[]} onAdd={onAdd} onRemove={vi.fn()} />);
  expect(screen.getByText("Whole chapter")).toBeInTheDocument();
  expect(screen.queryByLabelText("From verse in chapter 3")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Refine" }));
  const from = screen.getByLabelText("From verse in chapter 3") as HTMLSelectElement;
  expect([...from.options].map(item => item.value)).toEqual(["16", "17", "18", "36"]);
  fireEvent.change(from, { target: { value: "18" } });
  expect([...(screen.getByLabelText("To verse in chapter 3") as HTMLSelectElement).options].map(item => item.value)).toEqual(["18", "36"]);
  fireEvent.click(screen.getByRole("button", { name: "Add verses" }));
  expect(onAdd).toHaveBeenCalledWith({ chapter: 3, startVerse: 18, endVerse: 18 });
});

it("renders verse tokens with removal and reports a fully assigned chapter", () => {
  const onRemove = vi.fn();
  render(<VerseRefine option={option} ranges={[{ chapter: 3, startVerse: 16, endVerse: 18 }, { chapter: 3, startVerse: 36, endVerse: 36 }]} onAdd={vi.fn()} onRemove={onRemove} />);
  const tokens = within(screen.getByRole("list", { name: "Selected verse ranges for chapter 3" }));
  expect(tokens.getByText("vv. 16–18", { exact: false })).toBeInTheDocument();
  expect(tokens.getByText("v. 36", { exact: false })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Remove vv. 16–18 from chapter 3" }));
  expect(onRemove).toHaveBeenCalledWith({ chapter: 3, startVerse: 16, endVerse: 18 });
});

it("reports a chapter with no remaining verses", () => {
  render(<VerseRefine option={{ ...option, remaining: [] }} ranges={[]} onAdd={vi.fn()} onRemove={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Refine" }));
  expect(screen.getByText("All available verses are already assigned.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Add verses" })).not.toBeInTheDocument();
});
