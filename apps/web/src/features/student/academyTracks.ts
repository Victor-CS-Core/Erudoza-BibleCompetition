export type AcademyTrackId = "learner" | "review" | "rehearsal";

export type AcademyTrack = {
  id: AcademyTrackId;
  label: string;
  description: string;
  ctaLabel: string;
  href: string;
  ctaTestId: string;
};

/** Training format: PBE or Memory. Orthogonal to the Learn/Review/Rehearse modes. */
export type StudyFormat = "Pbe" | "Memory";

/**
 * Resolves the training format for a study URL. PBE is the season default
 * whenever the season enables it, unless Memory was explicitly requested.
 */
export function resolveStudyFormat(formatParam: string | null, pbeEnabled?: boolean): StudyFormat {
  if (formatParam === "Memory") return "Memory";
  if (formatParam === "Pbe" || pbeEnabled) return "Pbe";
  return "Memory";
}

/** Entry-screen cards for the "Choose your training" mode select. */
export type StudyModeCard = {
  track: AcademyTrackId;
  mode: "Practice" | "Review" | "Simulation";
  title: string;
  description: string;
  ctaLabel: string;
  ctaTestId: string;
};

export const STUDY_MODE_CARDS: StudyModeCard[] = [
  {
    track: "learner",
    mode: "Practice",
    title: "Learn",
    description: "Drill the assigned passage with memorization games.",
    ctaLabel: "Start today's drill",
    ctaTestId: "start-learn",
  },
  {
    track: "review",
    mode: "Review",
    title: "Review",
    description: "Revisit passages due for another pass — keep them from fading.",
    ctaLabel: "Start due reviews",
    ctaTestId: "start-review",
  },
  {
    track: "rehearsal",
    mode: "Simulation",
    title: "Rehearse",
    description: "Competition conditions — no aids, timed answers, results at the end. Like the real event.",
    ctaLabel: "Start rehearsal",
    ctaTestId: "start-rehearse",
  },
];

/** Actual rules per mode and format, shown on the mode-select cards and in-session. */
export function academyModeRules(track: AcademyTrackId, format: StudyFormat): string[] {
  if (track === "learner") {
    return format === "Pbe"
      ? ["Read source with assistance", "Immediate feedback", "Untimed"]
      : ["Multiple choice", "Scripture reader", "Recitation panel"];
  }
  if (track === "review") {
    return format === "Pbe"
      ? ["Due passages only", "Immediate feedback", "Untimed", "No source aid in Review"]
      : ["Due passages only", "Immediate feedback", "Untimed"];
  }
  return format === "Pbe"
    ? ["Shortened timed practice", "Answers freeze", "Feedback at end"]
    : ["Typed answers only", "No reader", "No recitation"];
}

/** Mode-specific session identity: the eyebrow and coaching copy above each session. */
export function studySessionFraming(mode: "Practice" | "Review" | "Simulation"): {
  eyebrow: string;
  blurb: string;
} {
  if (mode === "Review") {
    return {
      eyebrow: "Review · due practice",
      blurb: "Review is not a second assignment list — it only brings back passages when they are due for another pass.",
    };
  }
  if (mode === "Simulation") {
    return {
      eyebrow: "Rehearse · exam mode",
      blurb: "Competition conditions. Answers are final and feedback waits until the finish.",
    };
  }
  return {
    eyebrow: "Learn · coached practice",
    blurb: "Assistance is part of learning. Use the aids when you need them — your feedback shows what was truly unaided.",
  };
}

/** The "how training works" comparison shown on the mode-select screen. */
export const STUDY_BEHAVIOR_MATRIX: { behavior: string; learn: string; review: string; rehearse: string }[] = [
  { behavior: "Purpose", learn: "Build", review: "Protect", rehearse: "Perform" },
  { behavior: "Memory aids", learn: "All on", review: "Review set", rehearse: "None" },
  { behavior: "PBE feedback", learn: "Immediate", review: "Immediate", rehearse: "At end" },
  { behavior: "Timing", learn: "Untimed", review: "Untimed", rehearse: "Countdown" },
  { behavior: "Start gate", learn: "Active season", review: "Active season + due passages", rehearse: "Active season" },
];

export const ACADEMY_TRACKS: Record<AcademyTrackId, AcademyTrack> = {
  learner: {
    id: "learner",
    label: "Learner",
    description: "Drill the assigned passage with memorization games.",
    ctaLabel: "Start today's deck",
    href: "/student/study",
    ctaTestId: "start-todays-deck",
  },
  review: {
    id: "review",
    label: "Reviews",
    description: "Revisit passages that are due for another pass.",
    ctaLabel: "Start due reviews",
    href: "/student/study?mode=Review",
    ctaTestId: "start-reviews",
  },
  rehearsal: {
    id: "rehearsal",
    label: "Rehearsal",
    description: "Run a PBE-style rehearsal from the assigned Scripture.",
    ctaLabel: "Start rehearsal",
    href: "/student/study?mode=Simulation",
    ctaTestId: "start-simulation",
  },
};

export function visibleAcademyTracks(progress?: {
  seasonStatus?: string | null;
  reviewDueCount?: number | null;
} | null): AcademyTrackId[] {
  const tracks: AcademyTrackId[] = ["learner", "review"];
  if (progress?.seasonStatus === "Active") {
    tracks.push("rehearsal");
  }
  return tracks;
}

export function academySessionKicker(mode: "Practice" | "Review" | "Simulation"): string {
  if (mode === "Simulation") {
    return "Rehearsal";
  }
  if (mode === "Review") {
    return "Due review";
  }
  return "Learner drill";
}

export function academyTrackForMode(mode: "Practice" | "Review" | "Simulation"): AcademyTrackId {
  if (mode === "Simulation") {
    return "rehearsal";
  }
  if (mode === "Review") {
    return "review";
  }
  return "learner";
}

type AcademyProgress = {
  seasonStatus?: string | null;
  reviewDueCount?: number | null;
};

export function canStartAcademyTrack(track: AcademyTrackId, progress?: AcademyProgress | null): boolean {
  if (track === "learner") {
    return progress?.seasonStatus === "Active";
  }
  if (track === "review") {
    return progress?.seasonStatus === "Active" && (progress?.reviewDueCount ?? 0) > 0;
  }
  return visibleAcademyTracks(progress).includes(track);
}

export function academyUnavailableCopy(track: AcademyTrackId, progress?: AcademyProgress | null): string {
  if (track === "review") {
    if ((progress?.reviewDueCount ?? 0) > 0 && progress?.seasonStatus !== "Active") {
      return "Reviews open when this season is Active.";
    }
    return "No passages are due for review.";
  }
  if (track === "rehearsal") {
    return "Rehearsal opens when this season is Active.";
  }
  return "Learner drill opens when this season is Active.";
}

const ACADEMY_ACTIVITY_NAMES: Record<string, string> = {
  MissingWords: "Missing Words",
  VerseBuilder: "Verse Builder",
  ReferenceMatch: "Reference Match",
  WhatComesNext: "What Comes Next",
  TrueFalse: "True/False",
};

export function academyActivityName(activityType: string): string {
  return ACADEMY_ACTIVITY_NAMES[activityType] ?? activityType;
}

export function academySessionSummaryCopy(summary: {
  mode: string;
  correct: number;
  attempted: number;
}): string {
  const counts = `${summary.correct} / ${summary.attempted} correct`;
  const mode = summary.mode.toLowerCase();
  if (mode === "practice") {
    return `Last ${academySessionKicker("Practice")} session: ${counts}`;
  }
  if (mode === "review") {
    return `Last ${academySessionKicker("Review")} session: ${counts}`;
  }
  if (mode === "simulation") {
    return `Last ${academySessionKicker("Simulation")} session: ${counts}`;
  }
  return `Last session: ${counts}`;
}

export function academyRecentExactPercent(
  recentAttempts?: { isCorrect: boolean }[] | null,
): string {
  if (!recentAttempts?.length) {
    return "—";
  }
  const exact = recentAttempts.filter((item) => item.isCorrect).length;
  return `${Math.round((exact / recentAttempts.length) * 100)}%`;
}
