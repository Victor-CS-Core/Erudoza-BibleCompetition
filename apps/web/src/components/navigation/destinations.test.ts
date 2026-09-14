import { expect, it } from "vitest";
import { currentDestination, navigation, studentSearchExtras } from "./destinations";
it("offers coach management only in coach navigation", () => {
 expect(navigation(true).some(item => item.to === "/admin/coaches")).toBe(true);
 expect(JSON.stringify(navigation(false))).not.toContain("/admin/coaches");
});

it("keeps five student destinations with study modes consolidated under Study", () => {
  const items = navigation(false, "season with spaces");
  expect(items.map(item => item.id)).toEqual(["home", "study", "practice", "progress", "profile"]);
  expect(items.find(item => item.id === "study")?.to).toBe("/student/study?seasonId=season%20with%20spaces");
  expect(currentDestination(items, "/student/sessions/saved/recap")?.id).toBe("study");
  // Legacy library/honors routes and every study mode resolve to the consolidated destinations.
  expect(currentDestination(items, "/student/library")?.id).toBe("study");
  expect(currentDestination(items, "/student/honors")?.id).toBe("progress");
  expect(currentDestination(items, "/student/study")?.id).toBe("study");
  expect(navigation(true).some(item => item.id === "honors")).toBe(false);
});

it("offers the shared Scripture reader in both modes with season context", () => {
  // Students reach the library through the Study destination's Library tab now.
  expect(navigation(false, "s").find(item => item.id === "study")?.to).toBe("/student/study?seasonId=s");
  const coach = navigation(true, "s").find(item => item.id === "library")!;
  expect(coach.to).toBe("/admin/content?seasonId=s");
  expect(coach.children?.every(item => item.to.includes("?seasonId=s#"))).toBe(true);
});

it("keeps My assignments searchable for eligible coaches without adding a nav entry", () => {
  expect(studentSearchExtras(false, "s")).toEqual([]);
  const extras = studentSearchExtras(true, "s");
  expect(extras.map(item => item.id)).toEqual(["my-assignments"]);
  expect(extras[0].to).toBe("/student/assignments?seasonId=s");
  expect(extras[0].searchOnly).toBe(true);
  expect(navigation(false, "s", true).some(item => item.id === "my-assignments")).toBe(false);
});