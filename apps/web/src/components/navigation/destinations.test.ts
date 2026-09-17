import { expect, it } from "vitest";
import { currentDestination, navigation, studentSearchExtras } from "./destinations";
it("offers coach management only in coach navigation", () => {
 expect(navigation(true).some(item => item.to === "/admin/coaches")).toBe(true);
 expect(JSON.stringify(navigation(false))).not.toContain("/admin/coaches");
});

it("keeps six student destinations with study modes consolidated under Study", () => {
  const items = navigation(false, "season with spaces");
  expect(items.map(item => item.id)).toEqual(["home", "study", "news", "practice", "progress", "profile"]);
  expect(items.find(item => item.id === "study")?.to).toBe("/student/study?seasonId=season%20with%20spaces");
  expect(currentDestination(items, "/student/sessions/saved/recap")?.id).toBe("study");
  // Legacy library/honors routes and every study mode resolve to the consolidated destinations.
  expect(currentDestination(items, "/student/library")?.id).toBe("study");
  expect(currentDestination(items, "/student/honors")?.id).toBe("progress");
  expect(currentDestination(items, "/student/study")?.id).toBe("study");
  expect(navigation(true).some(item => item.id === "honors")).toBe(false);
});

it("keeps ten focused coach destinations with five default shortcuts", () => {
  const items = navigation(true, "s", false, "Owner");
  expect(items.map(item => item.id)).toEqual(["overview", "seasons", "students", "coaches", "assignments", "practice", "profile", "library", "materials", "news"]);
  // Help moved out of primary navigation; it stays in the account menu and workspace footer.
  expect(items.some(item => item.id === "wiki")).toBe(false);
  // Students no longer duplicates the Assignments destination as a child link.
  expect(items.find(item => item.id === "students")?.children?.map(child => child.id)).toEqual(["directory", "add-student"]);
  // Team Practice keeps room and invitation actions; bank, honors and progress are page sections.
  expect(items.find(item => item.id === "practice")?.children?.map(child => child.id)).toEqual(["rooms", "create-room", "invitations"]);
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

it("exposes PBE materials and PBE news destinations with article deep links", () => {
  const coach = navigation(true, undefined, false, "Owner");
  expect(coach.find(item => item.id === "materials")?.to).toBe("/admin/materials");
  expect(coach.find(item => item.id === "news")?.to).toBe("/admin/news");
  expect(navigation(false).find(item => item.id === "news")?.to).toBe("/student/news");
  // News article readers resolve under the news destination in both workspaces.
  expect(currentDestination(coach, "/admin/news/some-id")?.id).toBe("news");
  expect(currentDestination(navigation(false), "/student/news/some-id")?.id).toBe("news");
  expect(currentDestination(coach, "/admin/materials")?.id).toBe("materials");
});

it("limits content managers to PBE materials and PBE news", () => {
  const items = navigation(true, "s", false, "Content Manager");
  expect(items.map(item => item.id)).toEqual(["materials", "news"]);
  // Owners keep the full coach navigation.
  expect(navigation(true, "s", false, "Owner").some(item => item.id === "coaches")).toBe(true);
  expect(navigation(true, "s", false, "Owner").some(item => item.id === "materials")).toBe(true);
});

it("hides PBE materials/news and the invite link from regular admins", () => {
  const items = navigation(true, "s", false, "Admin");
  expect(items.some(item => item.id === "materials")).toBe(false);
  expect(items.some(item => item.id === "news")).toBe(false);
  // Admins keep every other coach area, including the (read-only) coach directory.
  expect(items.some(item => item.id === "coaches")).toBe(true);
  expect(items.find(item => item.id === "coaches")?.children?.some(child => child.id === "invite-coach")).toBe(false);
  // Unknown roles default to the least-privilege view: no materials/news.
  expect(navigation(true, "s").some(item => item.id === "materials")).toBe(false);
  expect(navigation(true, "s", false, "Owner").find(item => item.id === "coaches")?.children?.some(child => child.id === "invite-coach")).toBe(true);
});
