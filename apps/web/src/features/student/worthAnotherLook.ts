import type { Progress } from "../../api/types";

export type MasteryItem = Progress["mastery"][number];
export type AttentionItem = { item: MasteryItem; due: boolean };

/**
 * The single "worth another look" ranking, shared by Training HQ (the passage
 * picker's Up-next card) and the Progress page: passages due for review first,
 * then the weakest unmastered passages by wording score.
 */
export function rankWorthAnotherLook(mastery: MasteryItem[] | undefined, now: number, limit = 5): AttentionItem[] {
  return (mastery ?? [])
    .map((item) => {
      const due = item.level === "Review" || (item.reviewDueAtUtc != null && Date.parse(item.reviewDueAtUtc) <= now);
      return { item, due };
    })
    .filter(({ item, due }) => due || (item.level !== "Mastered" && item.level !== "Strong"))
    .sort((a, b) => Number(b.due) - Number(a.due) || a.item.exactWordingScore - b.item.exactWordingScore)
    .slice(0, limit);
}
