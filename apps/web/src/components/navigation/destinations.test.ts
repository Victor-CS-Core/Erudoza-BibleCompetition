import { expect, it } from "vitest";
import { currentDestination, navigation } from "./destinations";
it("offers coach management only in coach navigation", () => {
 expect(navigation(true).some(item => item.to === "/admin/coaches")).toBe(true);
 expect(JSON.stringify(navigation(false))).not.toContain("/admin/coaches");
});

it("keeps Honors in the selected student season and recaps in Study navigation", () => {
  const items = navigation(false, "season with spaces");
  expect(items.find(item => item.id === "honors")?.to).toBe("/student/honors?seasonId=season%20with%20spaces");
  expect(currentDestination(items, "/student/sessions/saved/recap", "")?.id).toBe("study");
  expect(navigation(true).some(item => item.id === "honors")).toBe(false);
});
