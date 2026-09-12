import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { PathfinderBackdrop, pathfinderArtworkForRoute } from "./PathfinderBackdrop";

describe("approved Pathfinder page artwork", () => {
  it.each([
    ["/", "camp", "right"],
    ["/login", "camp", "right"],
    ["/signup", "camp", "right"],
    ["/admin", "notes", "left"],
    ["/student", "camp", "right"],
    ["/student/study", "trail", "left"],
    ["/student/progress", "campcraft", "right"],
    ["/student/honors", "notes", "left"],
    ["/student/sessions/saved-session/recap", "camp", "right"],
  ])("preserves the approved assignment for %s", (route, name, side) => {
    expect(pathfinderArtworkForRoute(route)).toMatchObject({ name, side });
  });

  it("keeps page artwork stable across season, activity, and fragment changes", () => {
    const study = pathfinderArtworkForRoute("/student/study");
    expect(pathfinderArtworkForRoute("/student/study?seasonId=two&mode=Review#answer")).toEqual(study);
    expect(pathfinderArtworkForRoute("/student/study/?mode=Simulation")).toEqual(study);
  });

  it.each([
    ["/forgot-password", "trail"], ["/join-coach", "notes"],
    ["/admin/seasons", "trail"], ["/admin/seasons/new", "trail"],
    ["/admin/seasons/a?step=students", "trail"],
    ["/admin/seasons/a/students/b/progress", "campcraft"],
    ["/admin/students", "campcraft"], ["/admin/coaches", "notes"],
    ["/admin/assignments", "camp"], ["/admin/content", "notes"],
    ["/admin/design-system", "campcraft"], ["/admin/practice/room-one", "camp"],
    ["/student/practice/room-two", "campcraft"], ["/unavailable", "trail"],
  ])("uses a consistent related illustration for %s", (route, name) => {
    expect(pathfinderArtworkForRoute(route).name).toBe(name);
  });

  it("renders background decoration outside the accessibility and focus order", () => {
    const { container } = render(<MemoryRouter initialEntries={["/student/honors?seasonId=one"]}><PathfinderBackdrop /></MemoryRouter>);
    const backdrop = container.firstElementChild!;
    expect(backdrop).toHaveAttribute("aria-hidden", "true");
    expect(backdrop).toHaveAttribute("data-corner", "left");
    expect(backdrop).toHaveAttribute("data-artwork", "notes");
    expect(backdrop.querySelector("img, a, button, [tabindex]")).toBeNull();
    expect(backdrop.getAttribute("style")).toContain("field-notes-left-v1-960.webp");
  });
});
