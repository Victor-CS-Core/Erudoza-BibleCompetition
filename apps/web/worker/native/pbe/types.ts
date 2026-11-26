export type RecallSkill = "FactualRecall" | "ExactWords";

/**
 * Solo PBE run types. Practice/Review are the untimed mission modes;
 * Simulation is the shortened timed rehearsal; Rescue (card 47) is a
 * short untimed repair run; Checkpoint (card 47) is a 10-question run on
 * the exact official clock; MockHalf (45) and MockFull (90, with the
 * halftime break after question 45) are card 51's full-length mocks on
 * the same clock.
 */
export type PbeMode = "Practice" | "Review" | "Simulation" | "Rescue" | "Checkpoint" | "MockHalf" | "MockFull";

export interface PbeTarget {
  id: string;
  sourceUnitIds: string[];
  skill: RecallSkill;
  label: string;
}

export interface PbeQuestionPart {
  targetId: string;
  acceptedAnswers: string[];
  points: number;
}

export interface PbeQuestion {
  schemaVersion: 2;
  id: string;
  version: number;
  contentPackId: string;
  sourceUnitId: string;
  sourceUnitIds: string[];
  sourceKind: "Scripture" | "Commentary";
  reference: string;
  evidence: string;
  kind: "ShortAnswer" | "List" | "ExactWords" | "TrueFalse";
  prompt: string;
  ordered: boolean;
  parts: PbeQuestionPart[];
}

export interface PbeGradePart {
  index: number;
  targetId: string;
  answerIndex: number | null;
  earnedPoints: number;
  availablePoints: number;
}

export interface PbeGrade {
  earnedPoints: number;
  availablePoints: number;
  parts: PbeGradePart[];
}
