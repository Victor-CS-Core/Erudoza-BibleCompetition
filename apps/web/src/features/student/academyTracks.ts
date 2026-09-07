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
