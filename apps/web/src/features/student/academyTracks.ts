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
    description: "Learn your passage with memory games and drills.",
    ctaLabel: "Start today's drill",
    ctaTestId: "start-learn",
  },
  {
    track: "review",
    mode: "Review",
    title: "Review",
    description: "Passages you learned before, brought back before you forget them.",
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
      ? ["Reader help allowed", "Feedback right away", "Untimed"]
      : ["Multiple choice", "Scripture reader", "Recitation panel"];
  }
  if (track === "review") {
    return format === "Pbe"
      ? ["Due passages only", "Feedback right away", "Untimed", "No reader help"]
      : ["Due passages only", "Feedback right away", "Untimed"];
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
      blurb: "Passages you've learned before, coming back right when you're about to forget them.",
    };
  }
  if (mode === "Simulation") {
    return {
      eyebrow: "Rehearse · exam mode",
      blurb: "Just like the real competition: answers are final, and you'll see how you did at the end.",
    };
  }
  return {
    eyebrow: "Learn · coached practice",
    blurb: "Help is part of learning. Use the reader and hints whenever you need them — your feedback will honestly show what you remembered on your own.",
  };
}

/** The "how training works" comparison shown on the mode-select screen. */
export const STUDY_BEHAVIOR_MATRIX: { behavior: string; learn: string; review: string; rehearse: string }[] = [
  { behavior: "Purpose", learn: "Build", review: "Protect", rehearse: "Perform" },
  { behavior: "Memory aids", learn: "All on", review: "Review set", rehearse: "None" },
  { behavior: "PBE feedback", learn: "Immediate", review: "Immediate", rehearse: "At end" },
  { behavior: "Timing", learn: "Untimed", review: "Untimed", rehearse: "Countdown" },
  { behavior: "You need", learn: "Your season started", review: "Your season started + passages due", rehearse: "Your season started" },
];

export const ACADEMY_TRACKS: Record<AcademyTrackId, AcademyTrack> = {
  learner: {
    id: "learner",
    label: "Learner",
    description: "Learn your passage with memory games and drills.",
    ctaLabel: "Start today's deck",
    href: "/student/study",
    ctaTestId: "start-todays-deck",
  },
  review: {
    id: "review",
    label: "Reviews",
    description: "Passages due for another look, before they fade.",
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
      return "Review opens once your season starts.";
    }
    return "Nothing is due for review right now.";
  }
  if (track === "rehearsal") {
    return "Rehearse opens once your season starts.";
  }
  return "Learn opens once your season starts.";
}

const ACADEMY_ACTIVITY_NAMES: Record<string, string> = {
  MissingWords: "Fill in the Blank",
  VerseBuilder: "Verse Builder",
  ReferenceMatch: "Reference Match",
  WhatComesNext: "What Comes Next",
  TrueFalse: "True/False",
};

export function academyActivityName(activityType: string): string {
  return ACADEMY_ACTIVITY_NAMES[activityType] ?? activityType;
}

/**
 * Activities answered from memory whose verbatim answer is exactly what the
 * Assigned Scripture reader displays (fill-in-the-blank passage, verse
 * building, what-comes-next). The reader must never be open when one of
 * these cards arrives: StudyPage hides it automatically on navigation.
 * Recognition activities (ReferenceMatch, TrueFalse) judge material already
 * in the prompt, so the reader may stay open for them; opening it still
 * marks the attempt as assisted, as it does for every activity.
 */
const READER_RESTRICTED_ACTIVITIES = new Set(["MissingWords", "VerseBuilder", "WhatComesNext"]);
export function readerRestrictedActivity(activityType: string): boolean {
  return READER_RESTRICTED_ACTIVITIES.has(activityType);
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
