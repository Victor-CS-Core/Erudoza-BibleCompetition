import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import manifest from "../../../../../content/nkjv/library-manifest.json";
import { BookBrowser } from "./BookBrowser";
it("includes all 66 installed Bible books and searches both Testaments", () => {
  render(<BookBrowser books={manifest.books} renderBook={book => <button>{book.name}</button>} />);
  expect(screen.getAllByRole("button")).toHaveLength(66);
  expect(screen.getByRole("region", { name: "Old Testament" }).querySelectorAll("button")).toHaveLength(39);
  expect(screen.getByRole("region", { name: "New Testament" }).querySelectorAll("button")).toHaveLength(27);
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "gen" } });
  expect(screen.getByRole("button", { name: "Genesis" })).toBeInTheDocument();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "rev" } });
  expect(screen.getByRole("button", { name: "Revelation" })).toBeInTheDocument();
});
