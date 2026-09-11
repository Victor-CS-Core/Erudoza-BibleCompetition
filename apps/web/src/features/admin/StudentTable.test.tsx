import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { Student } from "../../api/types";
import { StudentTable } from "./StudentTable";

vi.mock("../profile/ProfileAvatar", () => ({ ProfileAvatar: () => null }));
const students: Student[] = Array.from({ length: 12 }, (_, index) => ({
  userId: String(index), userName: `learner.${index}`, displayName: `Student ${String(index).padStart(2, "0")}`, email: null,
  ...(index === 11 ? { isActive: false } : {}),
}));
function Location() { return <output data-testid="table-location">{useLocation().search}</output>; }
function setup(route = "/admin/students", items = students) {
  return render(<MemoryRouter initialEntries={[route]}><StudentTable students={items} renderActions={() => <button>Manage</button>} /><Location /></MemoryRouter>);
}
function names() { return within(screen.getByTestId("student-list")).getAllByRole("rowheader").map(cell => cell.textContent); }

describe("Student table filters", () => {
  it("filters account status, treats omitted active flags as active, and resets pagination", () => {
    setup("/admin/students?page=2&seasonId=season-1");
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "inactive" } });
    expect(names()).toEqual(["Student 11learner.11"]);
    expect(screen.getByTestId("table-location")).toHaveTextContent("page=1&seasonId=season-1&studentStatus=inactive");
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "active" } });
    expect(names()).toHaveLength(10);
    expect(screen.getByText("1–10 of 11 students")).toBeInTheDocument();
  });
  it("sorts the full filtered set before pagination and combines username search with status", () => {
    setup("/admin/students?page=2");
    fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "desc" } });
    expect(names()[0]).toBe("Student 11learner.11");
    expect(screen.getByRole("columnheader", { name: "Student" })).toHaveAttribute("aria-sort", "descending");
    fireEvent.change(screen.getByLabelText("Search students"), { target: { value: "learner.1" } });
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "active" } });
    expect(names()).toEqual(["Student 10learner.10", "Student 01learner.1"]);
  });
  it("clamps an out-of-range page and safely ignores invalid filter values", () => {
    setup("/admin/students?page=999&studentStatus=unknown&studentSort=unknown", students.slice(0, 2));
    expect(names()).toEqual(["Student 00learner.0", "Student 01learner.1"]);
    expect(screen.getByText("Page 1 of 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(screen.getByLabelText("Status")).toHaveValue("all");
  });
});
