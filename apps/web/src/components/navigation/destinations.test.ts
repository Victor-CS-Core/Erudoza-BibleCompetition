import { expect, it } from "vitest";
import { navigation } from "./destinations";
it("offers coach management only in coach navigation", () => {
 expect(navigation(true).some(item => item.to === "/admin/coaches")).toBe(true);
 expect(JSON.stringify(navigation(false))).not.toContain("/admin/coaches");
});
