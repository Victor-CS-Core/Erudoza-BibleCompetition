export const ACADEMY_DECK_ART = [
  {
    id: "learner",
    label: "Learner",
    src: "/brand/deck-learner.webp",
    className: "er-deck-learner",
    tone: "new",
    testId: "landing-deck-learner",
  },
  {
    id: "reviews",
    label: "Reviews",
    src: "/brand/deck-reviews.webp",
    className: "er-deck-reviews",
    tone: "review",
    testId: "landing-deck-reviews",
  },
  {
    id: "rehearsal",
    label: "Rehearsal",
    src: "/brand/deck-rehearsal.webp",
    className: "er-deck-rehearsal",
    tone: "due",
    testId: "landing-deck-rehearsal",
  },
] as const;

export type AcademyDeckArtId = (typeof ACADEMY_DECK_ART)[number]["id"];
