import { describe, expect, it } from "vitest";
import { academyCoachChapterLine } from "./academyCover";

describe("academyCoachChapterLine", () => {
  it("names a season chapter from real name and status", () => {
    expect(academyCoachChapterLine({ seasonName: "Imported Joshua", seasonStatus: "Draft" })).toBe(
      "Imported Joshua · Draft",
    );
    expect(
      academyCoachChapterLine({
        organizationName: "Development Academy",
        seasonName: "Daniel Gauntlet",
        seasonStatus: "Active",
      }),
    ).toBe("Daniel Gauntlet · Active");
  });

  it("falls back to the organization name when no season is selected", () => {
    expect(academyCoachChapterLine({ organizationName: "Development Academy" })).toBe("Development Academy");
    expect(academyCoachChapterLine({ organizationName: "Development Academy", seasonName: "Imported Joshua" })).toBe(
      "Development Academy",
    );
    expect(academyCoachChapterLine({ organizationName: "Development Academy", seasonStatus: "Draft" })).toBe(
      "Development Academy",
    );
  });

  it("stays empty instead of inventing readiness", () => {
    expect(academyCoachChapterLine({})).toBe("");
    expect(academyCoachChapterLine({ seasonName: "   ", seasonStatus: "  " })).toBe("");
    expect(academyCoachChapterLine({ organizationName: "  " })).toBe("");
  });
});
