export const PBE_RULE_VERSION = "nad-pbe-2023-24-v2";
export const PBE_SCORING_VERSION = "pbe-rubric-v2";

export const responseSeconds = (points: number): number => {
  if (!Number.isInteger(points) || points < 1 || points > 8)
    throw new Error("PBE questions require 1–8 points.");
  return 20 + 5 * points;
};
