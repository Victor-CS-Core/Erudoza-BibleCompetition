import {
  academySessionKicker,
  academySessionSummaryCopy,
  academyTrackForMode,
  academyUnavailableCopy,
  canStartAcademyTrack,
  visibleAcademyTracks,
} from "./academyTracks";

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

  it("keeps rehearsal when the season is Active even if no reviews are due", () => {
    expect(visibleAcademyTracks({ seasonStatus: "Active", reviewDueCount: 0 })).toEqual(["learner", "rehearsal"]);
  });

  it("can show due reviews on a Draft season without unlocking rehearsal", () => {
    expect(visibleAcademyTracks({ seasonStatus: "Draft", reviewDueCount: 1 })).toEqual(["learner", "review"]);
  });
});

describe("academySessionKicker", () => {
  it("names the study session from the existing mode", () => {
    expect(academySessionKicker("Practice")).toBe("Learner drill");
    expect(academySessionKicker("Review")).toBe("Due review");
    expect(academySessionKicker("Simulation")).toBe("Rehearsal");
  });
});

describe("academyTrackForMode", () => {
  it("maps existing study modes onto academy tracks", () => {
    expect(academyTrackForMode("Practice")).toBe("learner");
    expect(academyTrackForMode("Review")).toBe("review");
    expect(academyTrackForMode("Simulation")).toBe("rehearsal");
  });
});

describe("canStartAcademyTrack", () => {
  it("lets learner start even when later tracks are hidden", () => {
    expect(canStartAcademyTrack("learner", { seasonStatus: "Draft", reviewDueCount: 0 })).toBe(true);
  });

  it("blocks review until reviewDueCount is positive", () => {
    expect(canStartAcademyTrack("review", { seasonStatus: "Active", reviewDueCount: 0 })).toBe(false);
    expect(canStartAcademyTrack("review", { seasonStatus: "Draft", reviewDueCount: 2 })).toBe(true);
  });

  it("blocks rehearsal until the season is Active", () => {
    expect(canStartAcademyTrack("rehearsal", { seasonStatus: "Draft", reviewDueCount: 4 })).toBe(false);
    expect(canStartAcademyTrack("rehearsal", { seasonStatus: "Active", reviewDueCount: 0 })).toBe(true);
  });
});

describe("academyUnavailableCopy", () => {
  it("explains hidden tracks without inventing scores", () => {
    expect(academyUnavailableCopy("review")).toBe("No passages are due for review.");
    expect(academyUnavailableCopy("rehearsal")).toBe("Rehearsal opens when this season is Active.");
    expect(academyUnavailableCopy("learner")).toBe("Learner drill is available from today's deck.");
  });
});

describe("academySessionSummaryCopy", () => {
  it("names finished sessions from academy tracks, not raw API mode", () => {
    expect(academySessionSummaryCopy({ mode: "Practice", correct: 1, attempted: 1 })).toBe(
      "Last Learner drill session: 1 / 1 exact",
    );
    expect(academySessionSummaryCopy({ mode: "review", correct: 2, attempted: 3 })).toBe(
      "Last Due review session: 2 / 3 exact",
    );
    expect(academySessionSummaryCopy({ mode: "SIMULATION", correct: 0, attempted: 2 })).toBe(
      "Last Rehearsal session: 0 / 2 exact",
    );
  });

  it("omits a track name when the API mode is unknown", () => {
    expect(academySessionSummaryCopy({ mode: "Unknown", correct: 1, attempted: 4 })).toBe(
      "Last session: 1 / 4 exact",
    );
  });
});
