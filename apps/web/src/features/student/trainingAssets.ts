import type { BadgeKey } from "../../api/trainingTypes";
const asset = (name: string, small: number, large: number) => ({ src: `/assets/training/${name}-${small}.webp`, srcSet: `/assets/training/${name}-${small}.webp 1x, /assets/training/${name}-${large}.webp 2x` });
export const trainingAssets = { journey: asset("journey-hero", 720, 1440), guide: asset("coach-guide", 480, 960), complete: asset("practice-complete", 320, 640) };
export const honorAsset = (key: BadgeKey) => key.startsWith("streak-")
  ? { src: `/assets/training/${key}.svg` }
  : asset(key, 160, 320);
export const honorCriteria: Record<BadgeKey, string> = {
  "exact-recall": "Get a wording score of 80 or more on 5 different passages. You'll need Advanced practice for this — Foundation caps wording scores at 40 and Standard at 70.",
  "reference-ready": "Get a reference score of 70 or more on 10 different passages by typing the reference yourself. Picking from choices doesn't count for this one.",
  "chapter-strong": "Get every verse your coach assigned in one chapter up to Strong or Mastered. That's your assigned verses — not always the whole chapter.",
  "review-complete": "Answer every passage in one day's review set. Wrong answers still count — they'll just come back for more review.",
  "steady-study": "Hit your weekly practice goal in 4 different weeks. They don't have to be in a row, and practice from any season counts.",
  "full-coverage": "Try every passage in your season's assignment at least once. This one is about covering all of it — mastery is tracked separately.",
  "streak-7": "Practice 7 days in a row. Miss a day and your streak pauses instead of ending. You earn this the day your streak reaches 7.",
  "streak-14": "Practice 14 days in a row. Miss a day and your streak pauses instead of ending. You earn this the day your streak reaches 14.",
  "streak-30": "Practice 30 days in a row. Miss a day and your streak pauses instead of ending. You earn this the day your streak reaches 30.",
};
export const trainingLink = (path: string, seasonId?: string | null) => seasonId ? `${path}${path.includes("?") ? "&" : "?"}seasonId=${encodeURIComponent(seasonId)}` : path;
export const evidenceDate = (date: string, timeZone?: string) => new Date(date).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", ...(timeZone ? { timeZone } : {}) });
