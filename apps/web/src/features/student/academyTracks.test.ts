import {
  ACADEMY_TRACKS,
  academyActivityName,
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
  it("blocks learner until the season is Active", () => {
    expect(canStartAcademyTrack("learner", { seasonStatus: "Draft", reviewDueCount: 0 })).toBe(false);
    expect(canStartAcademyTrack("learner", { seasonStatus: "ContentReady", reviewDueCount: 0 })).toBe(false);
    expect(canStartAcademyTrack("learner", { seasonStatus: "None", reviewDueCount: 0 })).toBe(false);
    expect(canStartAcademyTrack("learner", { seasonStatus: "Active", reviewDueCount: 0 })).toBe(true);
  });

  it("blocks review until the season is Active and reviewDueCount is positive", () => {
    expect(canStartAcademyTrack("review", { seasonStatus: "Active", reviewDueCount: 0 })).toBe(false);
    expect(canStartAcademyTrack("review", { seasonStatus: "Draft", reviewDueCount: 2 })).toBe(false);
    expect(canStartAcademyTrack("review", { seasonStatus: "ContentReady", reviewDueCount: 2 })).toBe(false);
    expect(canStartAcademyTrack("review", { seasonStatus: "None", reviewDueCount: 2 })).toBe(false);
    expect(canStartAcademyTrack("review", { seasonStatus: "Active", reviewDueCount: 2 })).toBe(true);
  });

  it("blocks rehearsal until the season is Active", () => {
    expect(canStartAcademyTrack("rehearsal", { seasonStatus: "Draft", reviewDueCount: 4 })).toBe(false);
    expect(canStartAcademyTrack("rehearsal", { seasonStatus: "Active", reviewDueCount: 0 })).toBe(true);
  });
});

describe("academyUnavailableCopy", () => {
  it("explains hidden tracks without inventing scores", () => {
    expect(academyUnavailableCopy("review")).toBe("No passages are due for review.");
    expect(academyUnavailableCopy("review", { seasonStatus: "Draft", reviewDueCount: 2 })).toBe(
      "Reviews open when this season is Active.",
    );
    expect(academyUnavailableCopy("review", { seasonStatus: "Active", reviewDueCount: 0 })).toBe(
      "No passages are due for review.",
    );
    expect(academyUnavailableCopy("rehearsal")).toBe("Rehearsal opens when this season is Active.");
    expect(academyUnavailableCopy("learner")).toBe("Learner drill opens when this season is Active.");
  });
});

describe("ACADEMY_TRACKS leftover verbs", () => {
  it("names learner and rehearsal copy without practice or simulation", () => {
    expect(ACADEMY_TRACKS.learner.description).toBe(
      "Drill the assigned passage with memorization games.",
    );
    expect(ACADEMY_TRACKS.rehearsal.description).toBe(
      "Run a PBE-style rehearsal from the assigned Scripture.",
    );
    expect(ACADEMY_TRACKS.rehearsal.ctaLabel).toBe("Start rehearsal");
    expect(ACADEMY_TRACKS.rehearsal.ctaTestId).toBe("start-simulation");
    expect(ACADEMY_TRACKS.rehearsal.href).toBe("/student/study?mode=Simulation");
  });
});

describe("academyActivityName", () => {
  it("names existing study activities from the games spec", () => {
    expect(academyActivityName("MissingWords")).toBe("Missing Words");
    expect(academyActivityName("VerseBuilder")).toBe("Verse Builder");
    expect(academyActivityName("ReferenceMatch")).toBe("Reference Match");
    expect(academyActivityName("WhatComesNext")).toBe("What Comes Next");
    expect(academyActivityName("TrueFalse")).toBe("True/False");
    expect(academyActivityName("ShortAnswer")).toBe("Short answer");
  });

  it("keeps an unknown API activity type raw", () => {
    expect(academyActivityName("SelectedChoice")).toBe("SelectedChoice");
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
