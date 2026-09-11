import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { academyCoachChapterLine, CoachFieldGuideCover } from "./academyCover";

describe("academyCoachChapterLine", () => {
  it("names a season chapter from real name and status", () => {
    expect(academyCoachChapterLine({ seasonName: "Imported Joshua", seasonStatus: "Draft" })).toBe(
      "Imported Joshua · Draft",
    );
    expect(
      academyCoachChapterLine({
        organizationName: "Erudoza Academy",
        seasonName: "Daniel Gauntlet",
        seasonStatus: "Active",
      }),
    ).toBe("Daniel Gauntlet · Active");
  });

  it("falls back to the organization name when no season is selected", () => {
    expect(academyCoachChapterLine({ organizationName: "Erudoza Academy" })).toBe("Erudoza Academy");
    expect(academyCoachChapterLine({ organizationName: "Erudoza Academy", seasonName: "Imported Joshua" })).toBe(
      "Erudoza Academy",
    );
    expect(academyCoachChapterLine({ organizationName: "Erudoza Academy", seasonStatus: "Draft" })).toBe(
      "Erudoza Academy",
    );
  });

  it("stays empty instead of inventing readiness", () => {
    expect(academyCoachChapterLine({})).toBe("");
    expect(academyCoachChapterLine({ seasonName: "   ", seasonStatus: "  " })).toBe("");
    expect(academyCoachChapterLine({ organizationName: "  " })).toBe("");
  });
});

describe("CoachFieldGuideCover", () => {
  it("omits the chapter line when there is nothing honest to show", () => {
    render(<CoachFieldGuideCover />);
    expect(screen.getByTestId("field-guide-academy")).toBeInTheDocument();
    expect(screen.queryByTestId("academy-chapter-line")).not.toBeInTheDocument();
    expect(screen.getByTestId("field-guide-academy")).not.toHaveTextContent("%");
    expect(screen.getByTestId("field-guide-academy")).not.toHaveTextContent("streak");
  });
});
