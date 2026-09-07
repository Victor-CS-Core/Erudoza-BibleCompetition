import { academySessionKicker, visibleAcademyTracks } from "./academyTracks";

describe("visibleAcademyTracks", () => {
  it("always includes learner and hides rehearsal until the season is Active", () => {
    expect(visibleAcademyTracks(undefined)).toEqual(["learner"]);
    expect(visibleAcademyTracks({ seasonStatus: "Draft", reviewDueCount: 0 })).toEqual(["learner"]);
  });

  it("adds reviews only when reviewDueCount is positive", () => {
    expect(visibleAcademyTracks({ seasonStatus: "Active", reviewDueCount: 2 })).toEqual([
      "learner",
      "review",
      "rehearsal",
    ]);
  });
});

describe("academySessionKicker", () => {
  it("names the study session from the existing mode", () => {
    expect(academySessionKicker("Practice")).toBe("Learner drill");
    expect(academySessionKicker("Review")).toBe("Due review");
    expect(academySessionKicker("Simulation")).toBe("Rehearsal");
  });
});
