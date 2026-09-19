import {
  ACADEMY_TRACKS,
  academyActivityName,
  academyModeRules,
  academyRecentExactPercent,
  academySessionKicker,
  academySessionSummaryCopy,
  academyTrackForMode,
  academyUnavailableCopy,
  canStartAcademyTrack,
  resolveStudyFormat,
  STUDY_MODE_CARDS,
  studySessionFraming,
  visibleAcademyTracks,
} from "./academyTracks";

describe("visibleAcademyTracks", () => {
  it("always includes learner and reviews and hides rehearsal until the season is Active", () => {
    expect(visibleAcademyTracks(undefined)).toEqual(["learner", "review"]);
    expect(visibleAcademyTracks({ seasonStatus: "Draft", reviewDueCount: 0 })).toEqual([
      "learner",
      "review",
    ]);
  });

  it("keeps reviews when the season is Active even if no reviews are due", () => {
    expect(visibleAcademyTracks({ seasonStatus: "Active", reviewDueCount: 0 })).toEqual([
      "learner",
      "review",
      "rehearsal",
    ]);
  });

  it("adds rehearsal only when the season is Active", () => {
    expect(visibleAcademyTracks({ seasonStatus: "Active", reviewDueCount: 2 })).toEqual([
      "learner",
      "review",
      "rehearsal",
    ]);
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
  });

  it("keeps an unknown API activity type raw", () => {
    expect(academyActivityName("SelectedChoice")).toBe("SelectedChoice");
  });
});

describe("academySessionSummaryCopy", () => {
  it("names finished sessions from academy tracks, not raw API mode", () => {
    expect(academySessionSummaryCopy({ mode: "Practice", correct: 1, attempted: 1 })).toBe(
      "Last Learner drill session: 1 / 1 correct",
    );
    expect(academySessionSummaryCopy({ mode: "review", correct: 2, attempted: 3 })).toBe(
      "Last Due review session: 2 / 3 correct",
    );
    expect(academySessionSummaryCopy({ mode: "SIMULATION", correct: 0, attempted: 2 })).toBe(
      "Last Rehearsal session: 0 / 2 correct",
    );
  });

  it("omits a track name when the API mode is unknown", () => {
    expect(academySessionSummaryCopy({ mode: "Unknown", correct: 1, attempted: 4 })).toBe(
      "Last session: 1 / 4 correct",
    );
  });
});

describe("academyRecentExactPercent", () => {
  it("reports the percent of correct recent attempts", () => {
    expect(academyRecentExactPercent(undefined)).toBe("—");
    expect(academyRecentExactPercent([])).toBe("—");
    expect(
      academyRecentExactPercent([
        { isCorrect: true },
        { isCorrect: false },
        { isCorrect: true },
        { isCorrect: true },
      ]),
    ).toBe("75%");
    expect(academyRecentExactPercent([{ isCorrect: true }])).toBe("100%");
  });
});

describe("resolveStudyFormat", () => {
  it("prefers an explicit Memory request even when the season enables PBE", () => {
    expect(resolveStudyFormat("Memory", true)).toBe("Memory");
    expect(resolveStudyFormat("Memory", false)).toBe("Memory");
  });

  it("uses PBE when explicitly requested or when the season enables it", () => {
    expect(resolveStudyFormat("Pbe", false)).toBe("Pbe");
    expect(resolveStudyFormat(null, true)).toBe("Pbe");
  });

  it("falls back to Memory when the season does not enable PBE", () => {
    expect(resolveStudyFormat(null, false)).toBe("Memory");
    expect(resolveStudyFormat(null, undefined)).toBe("Memory");
  });
});

describe("academyModeRules", () => {
  it("lists Learn aids per format", () => {
    expect(academyModeRules("learner", "Pbe")).toEqual(["Read source with assistance", "Immediate feedback", "Untimed"]);
    expect(academyModeRules("learner", "Memory")).toEqual(["Multiple choice", "Scripture reader", "Recitation panel"]);
  });

  it("keeps Review untimed with immediate feedback and no source aid in PBE", () => {
    expect(academyModeRules("review", "Pbe")).toContain("No source aid in Review");
    expect(academyModeRules("review", "Memory")).toEqual(["Due passages only", "Immediate feedback", "Untimed"]);
  });

  it("describes Rehearse as exam conditions", () => {
    expect(academyModeRules("rehearsal", "Pbe")).toEqual(["Shortened timed practice", "Answers freeze", "Feedback at end"]);
    expect(academyModeRules("rehearsal", "Memory")).toEqual(["Typed answers only", "No reader", "No recitation"]);
  });
});

describe("studySessionFraming", () => {
  it("gives each mode a distinct identity", () => {
    expect(studySessionFraming("Practice").eyebrow).toBe("Learn · coached practice");
    expect(studySessionFraming("Review").eyebrow).toBe("Review · due practice");
    expect(studySessionFraming("Simulation").eyebrow).toBe("Rehearse · exam mode");
  });
});

describe("STUDY_MODE_CARDS", () => {
  it("covers the three modes with distinct calls to action", () => {
    expect(STUDY_MODE_CARDS.map((card) => card.mode)).toEqual(["Practice", "Review", "Simulation"]);
    expect(STUDY_MODE_CARDS.map((card) => card.title)).toEqual(["Learn", "Review", "Rehearse"]);
  });
});
