export type AcademyTrackId = "learner" | "review" | "rehearsal";

export type AcademyTrack = {
  id: AcademyTrackId;
  label: string;
  description: string;
  ctaLabel: string;
  href: string;
  ctaTestId: string;
};

export const ACADEMY_TRACKS: Record<AcademyTrackId, AcademyTrack> = {
  learner: {
    id: "learner",
    label: "Learner",
    description: "Practice the assigned passage with memorization games.",
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
    description: "Run a PBE-style simulation from the assigned Scripture.",
    ctaLabel: "Start competition simulation",
    href: "/student/study?mode=Simulation",
    ctaTestId: "start-simulation",
  },
};

export function visibleAcademyTracks(progress?: {
  seasonStatus?: string | null;
  reviewDueCount?: number | null;
} | null): AcademyTrackId[] {
  const tracks: AcademyTrackId[] = ["learner"];
  if ((progress?.reviewDueCount ?? 0) > 0) {
    tracks.push("review");
  }
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

export function academySessionSummaryCopy(summary: {
  mode: string;
  correct: number;
  attempted: number;
}): string {
  const counts = `${summary.correct} / ${summary.attempted} exact`;
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
