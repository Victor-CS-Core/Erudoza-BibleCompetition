import type { BadgeKey } from "../../api/trainingTypes";
const asset = (name: string, small: number, large: number) => ({ src: `/assets/training/${name}-${small}.webp`, srcSet: `/assets/training/${name}-${small}.webp 1x, /assets/training/${name}-${large}.webp 2x` });
export const trainingAssets = { journey: asset("journey-hero", 720, 1440), guide: asset("coach-guide", 480, 960), complete: asset("practice-complete", 320, 640) };
export const honorAsset = (key: BadgeKey) => asset(key, 160, 320);
export const honorCriteria: Record<BadgeKey, string> = {
  "exact-recall": "Reach an exact wording score of 80 in 5 distinct eligible passages. Requires Advanced practice; Foundation and Standard wording scores are capped at 40 and 70.",
  "reference-ready": "Reach a reference score of 70 in 10 distinct eligible passages with written reference evidence. Selected choices do not earn reference evidence.",
  "chapter-strong": "Bring every eligible assigned verse in one chapter to Strong or Mastered. This covers your assigned verses, not necessarily the whole chapter.",
  "review-complete": "Make an accepted attempt for every passage in one nonempty daily review set. Incorrect answers still need review.",
  "steady-study": "Meet your saved weekly practice goal in 4 recorded weeks. The weeks do not need to be consecutive; practice across seasons in this academy counts.",
  "full-coverage": "Make an accepted attempt for every eligible passage in an assigned season scope. Participation counts separately from mastery.",
};
export const trainingLink = (path: string, seasonId?: string | null) => seasonId ? `${path}${path.includes("?") ? "&" : "?"}seasonId=${encodeURIComponent(seasonId)}` : path;
export const evidenceDate = (date: string, timeZone?: string) => new Date(date).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", ...(timeZone ? { timeZone } : {}) });
