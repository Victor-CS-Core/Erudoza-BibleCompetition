import type { PbeMode } from "./types";

export const PBE_RULE_VERSION = "nad-pbe-2023-24-v2";
export const PBE_SCORING_VERSION = "pbe-rubric-v2";

/**
 * Modes that run under the authoritative timed window (Durable Object
 * presentation, frozen answers, deferred feedback, official timing).
 * Simulation is the shortened rehearsal; Checkpoint (and the card-51
 * mocks) run the same authority at their full lengths. There is exactly
 * one timing dialect: responseSeconds below, for every timed mode.
 */
export const isTimedPbeMode = (mode: PbeMode): boolean =>
  mode === "Simulation" || mode === "Checkpoint" || mode === "MockHalf" || mode === "MockFull";

export const responseSeconds = (points: number): number => {
  if (!Number.isInteger(points) || points < 1 || points > 8)
    throw new Error("PBE questions require 1–8 points.");
  return 20 + 5 * points;
};
